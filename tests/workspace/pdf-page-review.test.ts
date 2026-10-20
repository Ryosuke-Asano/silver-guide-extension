import { describe, expect, it } from "vitest";
import { makeManualPdfField, type PdfAnalysis, type PdfField, type PdfPageInfo, type PdfTemplateBinding } from "../../src/domain/pdf";
import { applyPdfPageReview, createPdfTask, getPdfTaskIssues, isPdfTask, PdfMappingRestoreError, planPdfPageReview, restorePdfMappingSnapshot, snapshotPdfMapping, updatePdfTask, type PdfMappingSnapshot, type PdfTask } from "../../src/apps/workspace/task-model";

const HASH = "a".repeat(64);
function retainedBinding(): PdfTemplateBinding {
  // Portable provenance fixture only; signature authentication has separate real-P256 tests.
  return { schemaVersion: 1, templateId: "page-review-authored-template", templateVersion: "2026-10", templateFieldId: "applicant-name", match: "exact",
    originalHash: HASH, layoutFingerprint: null, descriptorHash: "b".repeat(64), fieldSemanticHash: "c".repeat(64), adoptedAt: "2026-10-13T00:00:00.000Z",
    source: { keyId: "retained-issuer", packageId: "retained-package-1", release: 1, payloadHash: "d".repeat(64), sourceURL: "https://municipality.example.test/form.pdf",
      reviewedAt: "2026-10-12", validUntil: "2027-01-10", packageValidUntil: "2027-01-10" }, review: { state: "current", reason: null, invalidationKey: null } };
}
function field(id: string, pageIndex: number): PdfField {
  return { ...makeManualPdfField(pageIndex, [60, 520, 310, 548], id), id, role: "applicant", required: false,
    requiredSource: { kind: "document", text: "この欄は任意です。", pageIndex }, mappingState: "confirmed" };
}
function page(index: number): PdfPageInfo {
  return { index, label: String(index + 1), mediaBox: [0, 0, 595, 842], cropBox: [0, 0, 595, 842], visibleBox: [0, 0, 595, 842], rotation: 0,
    userUnit: 1, widthPt: 595, heightPt: 842, extraction: "native", review: "inputs-confirmed" };
}
function task(): PdfTask {
  const name = field("applicant", 0); name.source = "acroform"; name.initialValue = "Original applicant"; name.templateBinding = retainedBinding();
  name.native = { name: "applicant_name", fieldRef: "42 0 R", referenceKind: "field", widgetRefs: ["43 0 R"], maxLength: 64,
    lengthUnit: "utf16-code-unit", multiSelect: false, editableSelect: false, originalRequired: false, originalReadOnly: false, unsupported: false };
  const proxy = field("proxy", 0); proxy.role = "proxy"; proxy.conditionStatus = "confirmed";
  proxy.condition = { op: "present", fieldId: name.id }; proxy.conditionSource = { text: "代理人が記入する場合", pageIndex: 0 };
  proxy.placements[0].quad.forEach(point => { point.y -= 80; });
  const address = field("address", 1), office = field("office", 2); office.role = "office"; office.readOnly = true; office.initialValue = "Original office value";
  office.source = "acroform"; office.native = { ...name.native, name: "office_name", fieldRef: "44 0 R", widgetRefs: ["45 0 R"], originalReadOnly: true };
  const allowed = { allowed: true, reason: null }, pages = [page(0), page(1), page(2)];
  const analysis: PdfAnalysis = { document: { id: "page-review-synthetic", hash: HASH, name: "架空の3ページ申請書.pdf", byteLength: 2048, pageCount: 3, pages,
    capabilities: { read: allowed, analyze: allowed, nativeWrite: allowed, overlayWrite: allowed, export: allowed }, issues: [], actionDependent: false },
    fields: [name, proxy, address, office], evidence: [], issues: [], complete: true };
  const created = createPdfTask(analysis);
  return updatePdfTask(created, { stage: "saved", selectedFieldId: "applicant", answers: { applicant: "Updated applicant", proxy: "架空の代理人", address: "架空の住所", office: office.initialValue },
    answerStatus: { applicant: "entered", proxy: "entered", address: "entered", office: "entered" } });
}
function commit(task: PdfTask, pages: number[], review: PdfPageInfo["review"]): PdfTask {
  const plan = applyPdfPageReview(task, pages, review); expect(plan.reason).toBeNull(); expect(plan.update).not.toBeNull();
  return updatePdfTask(task, plan.update!);
}
function jsonTask(value: PdfTask): PdfTask { const parsed = structuredClone(value); expect(isPdfTask(parsed)).toBe(true); return parsed; }

describe("atomic PDF page decisions", () => {
  it("keeps first-occurrence issue order and distinct field identities while deduplicating repeated geometry messages",()=>{
    const original=task(),first=field("same-message-first",0),second=field("same-message-second",0);for(const item of [first,second]){const outside=structuredClone(item.placements[0]);outside.quad.forEach(point=>{point.x+=1000;});item.placements=[outside,structuredClone(outside)];item.style={fontSizePt:8};}
    original.fields=[first,second];original.selectedFieldId=first.id;original.answers={[first.id]:"確認する回答",[second.id]:"別の回答"};original.answerStatus={[first.id]:"entered",[second.id]:"entered"};
    const issues=getPdfTaskIssues(original);expect(issues.map(issue=>[issue.fieldId,issue.message])).toEqual([[first.id,"記入枠が用紙の範囲外にあります。"],[first.id,"10pt より小さい文字を使う場合は拡大プレビューで確認してください。"],[second.id,"記入枠が用紙の範囲外にあります。"],[second.id,"10pt より小さい文字を使う場合は拡大プレビューで確認してください。"]]);
  });

  it("accepts bounded explicit answer-review audit records without using them to restore a rejected mapping or overwrite latest answers",()=>{
    const original=task();original.answerReviewHistory=[{fieldId:"applicant",fieldRevision:original.fields[0].revision,taskRevision:original.revision,confirmedAt:"2026-10-13T00:00:00.000Z"}];const excluded=commit(original,[0],"excluded"),restored=jsonTask(excluded);restored.answers.address="確認記録の後の最新住所";
    const undo=updatePdfTask(restored,restorePdfMappingSnapshot(restored,restored.mappingHistory!.at(-1)!));expect(undo.answers.address).toBe("確認記録の後の最新住所");expect(undo.fields[0].mappingState).toBe("needs-review");expect(undo.answerReviewHistory).toEqual(original.answerReviewHistory);expect(isPdfTask(undo)).toBe(true);
  });
  it("rejects oversized, future-revision or non-timestamp answer-review audit metadata while preserving legacy drafts without it",()=>{
    const original=task(),record={fieldId:"applicant",fieldRevision:original.fields[0].revision,taskRevision:original.revision,confirmedAt:"2026-10-13T00:00:00.000Z"};expect(isPdfTask(original)).toBe(true);
    expect(isPdfTask({...original,answerReviewHistory:Array.from({length:41},()=>record)})).toBe(false);expect(isPdfTask({...original,answerReviewHistory:[{...record,taskRevision:original.revision+1}]})).toBe(false);expect(isPdfTask({...original,answerReviewHistory:[{...record,confirmedAt:"2026-10-13"}]})).toBe(false);expect(isPdfTask({...original,answerReviewHistory:[{...record,fieldRevision:0}]})).toBe(false);
  });

  it.each(["no-inputs-confirmed", "excluded"] as const)("keeps original answers and constraints while %s excludes only fields wholly on the page", review => {
    const original = task(), before = structuredClone(original), plan = applyPdfPageReview(original, [0], review), next = updatePdfTask(original, plan.update!);
    expect(plan).toMatchObject({ affectedFieldIds: ["applicant", "proxy"], sharedPageIndices: [], reason: null });
    expect(next.pages.map(page => page.review)).toEqual([review, "inputs-confirmed", "inputs-confirmed"]);
    expect(next.fields.slice(0, 2).map(field => field.mappingState)).toEqual(["rejected", "rejected"]);
    expect(next.fields[1].conditionStatus).toBe("confirmed"); expect(next.fields[2]).toBe(original.fields[2]); expect(next.fields[3]).toBe(original.fields[3]);
    expect(next.answers).toBe(original.answers); expect(next.answerStatus).toBe(original.answerStatus); expect(next.fields[0].native).toBe(original.fields[0].native);
    expect(next.fields[0].placements).toBe(original.fields[0].placements); expect(next.fields[0].templateBinding).toBe(original.fields[0].templateBinding);
    expect(next.analysis).toBe(original.analysis); expect(next.selectedFieldId).toBe("address"); expect(next.revision).toBe(original.revision + 1);
    expect(next.mappingHistory).toHaveLength(1); expect(next.mappingHistory![0].pages).toEqual(original.pages); expect(next.mappingRedo).toEqual([]);
    expect(original).toEqual(before); expect(jsonTask(next)).toEqual(next);
  });
  it("confirms a page without reactivating rejected fields, rewriting answers or changing selection", () => {
    const excluded = commit(task(), [0], "excluded"), selection = excluded.selectedFieldId;
    const plan = planPdfPageReview(excluded, [0], "inputs-confirmed"), next = updatePdfTask(excluded, plan.update!);
    expect(plan.affectedFieldIds).toEqual([]); expect(Object.hasOwn(plan.update!, "fields")).toBe(false);
    expect(next.fields).toBe(excluded.fields); expect(next.fields[0].mappingState).toBe("rejected"); expect(next.answers).toBe(excluded.answers);
    expect(next.selectedFieldId).toBe(selection); expect(next.pages[0].review).toBe("inputs-confirmed");
  });
  it("reincludes excluded fields as unconfirmed, preserves conditional text and does not repeatedly erase explicit condition corrections", () => {
    const original = task(), excluded = commit(original, [0], "excluded"), reentered = commit(excluded, [0], "unseen");
    expect(reentered).toMatchObject({ stage: "mapping", selectedFieldId: "applicant" }); expect(reentered.pages[0].review).toBe("unseen");
    expect(reentered.fields.slice(0, 2).map(field => field.mappingState)).toEqual(["needs-review", "needs-review"]);
    expect(reentered.fields[1].conditionStatus).toBe("unknown"); expect(reentered.fields[1].condition).toBe(original.fields[1].condition);
    expect(reentered.answers).toBe(original.answers); expect(reentered.fields[0].native).toBe(original.fields[0].native);
    const corrected = updatePdfTask(reentered, { fields: reentered.fields.map(field => field.id === "proxy" ? { ...field, conditionStatus: "confirmed", mappingState: "confirmed" } : field) });
    expect(corrected.fields[1]).toMatchObject({ conditionStatus: "confirmed", mappingState: "confirmed" });
    expect(jsonTask(corrected)).toEqual(corrected);
  });
  it("makes direct-placement sharing an atomic no-op, then accepts all related pages together", () => {
    const original = task(); original.fields[0].placements.push({ ...structuredClone(original.fields[0].placements[0]), pageIndex: 1 });
    const before = structuredClone(original), blocked = applyPdfPageReview(original, [0], "excluded");
    expect(blocked).toMatchObject({ update: null, affectedFieldIds: [], sharedPageIndices: [0, 1] }); expect(blocked.reason).toBeTruthy(); expect(original).toEqual(before);
    const all = applyPdfPageReview(original, [1, 0, 1], "excluded");
    expect(all.affectedFieldIds).toEqual(["applicant", "proxy", "address"]); expect(all.sharedPageIndices).toEqual([]);
    const next = updatePdfTask(original, all.update!); expect(next.fields.slice(0, 3).every(field => field.mappingState === "rejected")).toBe(true);
    expect(next.selectedFieldId).toBe("office"); expect(jsonTask(next)).toEqual(next);
  });
  it("includes option placements in the whole-field decision, even when the direct placement is only on the selected page", () => {
    const original = task(), choice = original.fields[1]; choice.kind = "radio"; choice.conditionStatus = "unconditional"; choice.condition = null;
    choice.options = [
      { id: "first-option", label: "本人", exportValue: "applicant", placements: [structuredClone(choice.placements[0])] },
      { id: "second-option", label: "代理", exportValue: "proxy", placements: [{ ...structuredClone(choice.placements[0]), pageIndex: 1 }] }
    ];
    original.answers.proxy = "first-option";
    const before = structuredClone(original), blocked = planPdfPageReview(original, [0], "no-inputs-confirmed");
    expect(blocked).toMatchObject({ update: null, sharedPageIndices: [0, 1] }); expect(original).toEqual(before);
    const next = commit(original, [0, 1], "no-inputs-confirmed"); expect(next.fields[1].mappingState).toBe("rejected");
    expect(next.fields[1].options).toBe(original.fields[1].options); expect(next.answers.proxy).toBe("first-option"); expect(jsonTask(next)).toEqual(next);
  });
  it("returns the transitive page group so linked shared fields can be decided in one operation", () => {
    const original = task(); original.fields[0].placements.push({ ...structuredClone(original.fields[0].placements[0]), pageIndex: 1 });
    original.fields[2].placements.push({ ...structuredClone(original.fields[2].placements[0]), pageIndex: 2 });
    const blocked = planPdfPageReview(original, [0], "excluded"); expect(blocked.sharedPageIndices).toEqual([0, 1, 2]); expect(blocked.update).toBeNull();
    const next = commit(original, blocked.sharedPageIndices, "excluded"); expect(next.pages.every(page => page.review === "excluded")).toBe(true);
    expect(next.fields.every(field => field.mappingState === "rejected")).toBe(true); expect(next.selectedFieldId).toBeNull();
  });
  it("blocks partial reentry of a shared rejected field without changing pages, then reopens the entire group", () => {
    const original = task(); original.fields[1].placements.push({ ...structuredClone(original.fields[1].placements[0]), pageIndex: 1 });
    const excluded = commit(original, [0, 1], "excluded"), before = structuredClone(excluded);
    const blocked = applyPdfPageReview(excluded, [0], "unseen"); expect(blocked).toMatchObject({ update: null, sharedPageIndices: [0, 1], affectedFieldIds: [] });
    expect(excluded).toEqual(before); const reopened = commit(excluded, [0, 1], "unseen");
    expect(reopened.pages.slice(0, 2).every(page => page.review === "unseen")).toBe(true);
    expect(reopened.fields.slice(0, 3).every(field => field.mappingState === "needs-review")).toBe(true); expect(reopened.fields[1].conditionStatus).toBe("unknown");
  });
  it("does not adopt fields with no placement or revive already rejected fields when an input page is confirmed", () => {
    const original = task(), floating = field("unplaced", 0); floating.placements = []; original.fields.push(floating);
    const rejected = { ...field("individually-excluded", 0), mappingState: "rejected" as const }; original.fields.push(rejected);
    const next = commit(original, [0], "no-inputs-confirmed");
    expect(next.fields.find(field => field.id === floating.id)).toBe(floating); expect(next.fields.find(field => field.id === rejected.id)).toBe(rejected);
    expect(planPdfPageReview(next, [0], "inputs-confirmed").affectedFieldIds).toEqual([]);
  });
  it("does not append history for repeated identical decisions or malformed page selections", () => {
    const original = task(); expect(applyPdfPageReview(original, [0], "inputs-confirmed")).toEqual({ update: null, affectedFieldIds: [], sharedPageIndices: [], reason: null });
    for (const pages of [[], [-1], [3], [0.5], [NaN], Array.from({ length: 101 }, () => 0)]) {
      const invalid = applyPdfPageReview(original, pages, "excluded"); expect(invalid.update).toBeNull(); expect(invalid.reason).toBeTruthy(); expect(Object.hasOwn(original, "mappingHistory")).toBe(false);
    }
    const excluded = commit(original, [0], "excluded"); expect(applyPdfPageReview(excluded, [0], "excluded").update).toBeNull();
  });
});

describe("page decisions in bounded mapping history", () => {
  it("keeps later input on another page through exclusion undo, further input, redo and vault JSON", () => {
    const original = task(), excluded = commit(original, [0], "excluded");
    const latest = updatePdfTask(excluded, { answers: { ...excluded.answers, address: "除外した後に入力した新しい住所", "retained-orphan": "最新の履歴にない回答" },
      answerStatus: { ...excluded.answerStatus, address: "entered", "retained-orphan": "deferred" } });
    const before = structuredClone(latest), previous = latest.mappingHistory![0];
    const undo = updatePdfTask(latest, { ...restorePdfMappingSnapshot(latest, previous), mappingHistory: [], mappingRedo: [snapshotPdfMapping(latest)] });
    expect(undo.answers.address).toBe(latest.answers.address); expect(undo.answerStatus.address).toBe("entered");
    expect(undo.fields[2].mappingState).toBe("confirmed"); expect(undo.pages[1].review).toBe("inputs-confirmed");
    expect(undo.answers["retained-orphan"]).toBe("最新の履歴にない回答"); expect(undo.answerStatus["retained-orphan"]).toBe("deferred");
    expect(undo.answerStatus.applicant).toBe("needs-review"); expect(undo.answerStatus.proxy).toBe("needs-review");
    const restored = jsonTask(undo), further = updatePdfTask(restored, { answers: { ...restored.answers, address: "取り消した後にさらに入力した住所" }, answerStatus: { ...restored.answerStatus, address: "entered" } });
    const redo = updatePdfTask(further, { ...restorePdfMappingSnapshot(further, further.mappingRedo![0]), mappingHistory: [snapshotPdfMapping(further)], mappingRedo: [] });
    expect(redo.answers.address).toBe(further.answers.address); expect(redo.answerStatus.address).toBe("entered");
    expect(redo.fields[2].mappingState).toBe("confirmed"); expect(redo.pages[1].review).toBe("inputs-confirmed"); expect(redo.pages[0].review).toBe("excluded");
    expect(jsonTask(redo).answers).toEqual(redo.answers); expect(latest).toEqual(before);
  });
  it.each([
    [false, "entered"], [null, "deferred"], ["", "empty"], [[], "empty"], [["new-one", "new-two"], "entered"]
  ] as const)("preserves an own current answer %j and its status instead of using the historical answer", (answer, status) => {
    const original = task(), snapshot = snapshotPdfMapping(original), latest = updatePdfTask(original, {
      answers: { ...original.answers, address: Array.isArray(answer) ? [...answer] : answer }, answerStatus: { ...original.answerStatus, address: status }
    });
    const restored = updatePdfTask(latest, restorePdfMappingSnapshot(latest, snapshot));
    expect(restored.answers.address).toEqual(answer); expect(restored.answerStatus.address).toBe(status);
    expect(restored.fields[2].mappingState).toBe("confirmed"); expect(restored.pages[1].review).toBe("inputs-confirmed"); expect(isPdfTask(jsonTask(restored))).toBe(true);
  });
  it("uses a snapshot-only answer/status as fallback when a historical field returns and retains current orphan answers", () => {
    const original = task(), snapshot = snapshotPdfMapping(original), removed = updatePdfTask(original, {
      fields: original.fields.filter(field => field.id !== "address"), selectedFieldId: "applicant",
      answers: { applicant: original.answers.applicant, proxy: original.answers.proxy, office: original.answers.office, "current-orphan": "保管する最新回答" },
      answerStatus: { applicant: "entered", proxy: "entered", office: "entered", "current-orphan": "entered" }
    });
    const restored = updatePdfTask(removed, restorePdfMappingSnapshot(removed, snapshot));
    expect(restored.answers.address).toBe(snapshot.answers.address); expect(restored.answers["current-orphan"]).toBe("保管する最新回答");
    expect(restored.answerStatus["current-orphan"]).toBe("entered"); expect(restored.answerStatus.address).toBe("needs-review");
    expect(restored.fields[2].mappingState).toBe("needs-review"); expect(restored.pages[1].review).toBe("unseen"); expect(isPdfTask(jsonTask(restored))).toBe(true);
    const withoutStatus = { ...original, answerStatus: { applicant: "entered", proxy: "entered", office: "entered" } as PdfTask["answerStatus"] };
    expect(restorePdfMappingSnapshot(withoutStatus, snapshot).answerStatus!.address).toBe("entered");
  });
  it.each(["label", "kind", "role", "placements", "options", "style"] as const)("retains the latest answer but requires source review when undo changes %s", change => {
    const original = task(), snapshot = snapshotPdfMapping(original), changed = structuredClone(original.fields[2]);
    if (change === "label") changed.label = "意味を変更した住所欄";
    if (change === "kind") changed.kind = "multiline";
    if (change === "role") changed.role = "proxy";
    if (change === "placements") changed.placements[0].pageIndex = 2;
    if (change === "options") changed.options = [{ id: "new-choice", label: "新しい選択肢", exportValue: null, placements: [structuredClone(changed.placements[0])] }];
    if (change === "style") changed.style = { fontSizePt: 18, alignment: "right" };
    const latest = updatePdfTask(original, { fields: original.fields.map(field => field.id === changed.id ? changed : field), answers: { ...original.answers, address: "意味の編集後に入力した最新回答" } });
    const restored = updatePdfTask(latest, restorePdfMappingSnapshot(latest, snapshot));
    expect(restored.answers.address).toBe(latest.answers.address); expect(restored.answerStatus.address).toBe("needs-review");
    expect(restored.fields[2]).toMatchObject({ mappingState: "needs-review", conditionStatus: "unconditional" }); expect(restored.fields[2].placements).toEqual(snapshot.fields[2].placements);
    expect(restored.pages[1].review).toBe("unseen"); expect(restored.pages[0].review).toBe("inputs-confirmed");
    if (change === "placements") expect(restored.pages[2].review).toBe("unseen");
    expect(restored.fields[0].native).toEqual(original.fields[0].native); expect(restored.fields[0].templateBinding).toEqual(original.fields[0].templateBinding);
    expect(restored.answerStatus.applicant).toBe(original.answerStatus.applicant); expect(isPdfTask(jsonTask(restored))).toBe(true);
  });
  it("does not silently reuse a confirmed conditional rule when undo changes it around a retained newer answer", () => {
    const original = task(), snapshot = snapshotPdfMapping(original), changed = { ...original.fields[1], condition: { op: "eq" as const, fieldId: "applicant", value: "別の申請者" } };
    const latest = updatePdfTask(original, { fields: [original.fields[0], changed, ...original.fields.slice(2)], answers: { ...original.answers, proxy: "条件を変更した後の最新回答" } });
    const restored = updatePdfTask(latest, restorePdfMappingSnapshot(latest, snapshot));
    expect(restored.answers.proxy).toBe(latest.answers.proxy); expect(restored.fields[1]).toMatchObject({ mappingState: "needs-review", conditionStatus: "unknown" });
    expect(restored.fields[1].condition).toEqual(snapshot.fields[1].condition); expect(restored.answerStatus.proxy).toBe("needs-review"); expect(restored.pages[0].review).toBe("unseen");
  });
  it("retains an unmatched latest option after choice undo instead of reverting it to a formerly valid selection", () => {
    const original = task(), choice = original.fields[2]; choice.kind = "select";
    choice.options = [{ id: "old-choice", label: "以前の項目", exportValue: "old", placements: [structuredClone(choice.placements[0])] }]; original.answers.address = "old-choice";
    const snapshot = snapshotPdfMapping(original), latest = updatePdfTask(original, { fields: original.fields.map(field => field.id === choice.id ? {
      ...field, options: [{ id: "new-choice", label: "新しい項目", exportValue: "new", placements: [structuredClone(field.placements[0])] }]
    } : field), answers: { ...original.answers, address: "new-choice" } });
    const restored = updatePdfTask(latest, restorePdfMappingSnapshot(latest, snapshot));
    expect(restored.answers.address).toBe("new-choice"); expect(restored.fields[2].options[0].id).toBe("old-choice");
    expect(restored.fields[2].mappingState).toBe("needs-review"); expect(restored.answerStatus.address).toBe("needs-review"); expect(isPdfTask(jsonTask(restored))).toBe(true);
  });
  it("refuses a merged answer or status record beyond 10,000 entries without dropping current work or mutating either input", () => {
    for (const record of ["answers", "answerStatus"] as const) {
      const original = task(), snapshot = snapshotPdfMapping(original);
      if (record === "answers") original.answers = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`latest-${index}`, "keep"]));
      else original.answerStatus = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`latest-${index}`, "entered" as const]));
      const before = structuredClone(original), beforeSnapshot = structuredClone(snapshot);
      expect(() => restorePdfMappingSnapshot(original, snapshot)).toThrow(PdfMappingRestoreError);
      try { restorePdfMappingSnapshot(original, snapshot); } catch (cause) { expect(cause).toMatchObject({ code: "ANSWER_LIMIT" }); expect((cause as Error).message).toMatch(/現在の入力.*残/); }
      expect(original).toEqual(before); expect(snapshot).toEqual(beforeSnapshot);
    }
    const original = task(), snapshot = snapshotPdfMapping(original); original.answers = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`value-${index}`, "keep"]));
    snapshot.answers = {}; expect(Object.keys(restorePdfMappingSnapshot(original, snapshot).answers!)).toHaveLength(10_000);
  });
  it("takes an independent JSON-safe snapshot of all four mapping parts", () => {
    const original = task(), snapshot = snapshotPdfMapping(original), before = structuredClone(original);
    expect(snapshot.fields).not.toBe(original.fields); expect(snapshot.answers).not.toBe(original.answers); expect(snapshot.answerStatus).not.toBe(original.answerStatus); expect(snapshot.pages).not.toBe(original.pages);
    snapshot.fields[0].placements[0].quad[0].x += 20; snapshot.fields[0].native!.widgetRefs.push("99 0 R"); snapshot.pages[0].review = "excluded";
    snapshot.answers.applicant = "changed in history"; snapshot.answerStatus.applicant = "deferred";
    expect(original).toEqual(before); expect(() => structuredClone(snapshot)).not.toThrow();
  });
  it("restores undo fields and pages together but requires fresh confirmation for rejected-field reentry", () => {
    const original = task(), excluded = commit(original, [0], "excluded"), stored = jsonTask(excluded), previous = stored.mappingHistory![0];
    const undo = updatePdfTask(stored, { ...restorePdfMappingSnapshot(stored, previous), mappingHistory: [], mappingRedo: [snapshotPdfMapping(stored)] });
    expect(undo.fields[0].mappingState).toBe("needs-review"); expect(undo.fields[1].conditionStatus).toBe("unknown"); expect(undo.pages[0].review).toBe("unseen");
    expect(undo.pages.slice(1)).toEqual(original.pages.slice(1)); expect(undo.fields[2]).toEqual(original.fields[2]); expect(undo.answers).toEqual(original.answers);
    expect(undo.fields[0].native).toEqual(original.fields[0].native); expect(undo.fields[0].templateBinding).toEqual(original.fields[0].templateBinding);
    const redo = updatePdfTask(undo, { ...restorePdfMappingSnapshot(undo, undo.mappingRedo![0]), mappingHistory: [snapshotPdfMapping(undo)], mappingRedo: [] });
    expect(redo.fields.slice(0, 2).every(field => field.mappingState === "rejected")).toBe(true); expect(redo.pages[0].review).toBe("excluded");
    expect(jsonTask(redo)).toEqual(redo);
  });
  it("keeps ordinary undo mappings intact when no rejected field is reentered", () => {
    const original = task(), snapshot = snapshotPdfMapping(original), edited = updatePdfTask(original, { fields: original.fields.map(field => field.id === "proxy" ? { ...field, mappingState: "needs-review" } : field) });
    const restored = updatePdfTask(edited, restorePdfMappingSnapshot(edited, snapshot));
    expect(restored.fields[1]).toMatchObject({ mappingState: "confirmed", conditionStatus: "confirmed" }); expect(restored.pages).toEqual(original.pages); expect(restored.answers).toEqual(original.answers);
  });
  it("guards a direct rejected-to-active transition once and preserves later explicit field confirmation", () => {
    const original = task(), excluded = commit(original, [0], "excluded");
    const direct = updatePdfTask(excluded, { fields: original.fields });
    expect(direct.fields[0].mappingState).toBe("needs-review"); expect(direct.fields[1].conditionStatus).toBe("unknown");
    const edited = updatePdfTask(direct, { fields: direct.fields.map(field => field.id === "proxy" ? { ...field, mappingState: "confirmed", conditionStatus: "confirmed" } : field) });
    expect(edited.fields[1]).toMatchObject({ mappingState: "confirmed", conditionStatus: "confirmed" });
  });
  it("accepts legacy history without pages and retains the current page decision when restoring it", () => {
    const original = task(), legacy: PdfMappingSnapshot = { fields: structuredClone(original.fields), answers: { ...original.answers }, answerStatus: { ...original.answerStatus } };
    original.mappingHistory = [legacy]; original.mappingRedo = [structuredClone(legacy)]; original.pages[2].review = "excluded";
    const stored = jsonTask(original), restored = restorePdfMappingSnapshot(stored, stored.mappingHistory![0]);
    expect(restored.pages).toEqual(stored.pages); expect(restored.pages![2].review).toBe("excluded"); expect(isPdfTask(updatePdfTask(stored, restored))).toBe(true);
  });
  it("caps history at twenty snapshots and clears redo only after a successful atomic decision", () => {
    const original = task(); original.mappingHistory = Array.from({ length: 20 }, () => snapshotPdfMapping(original)); original.mappingRedo = [snapshotPdfMapping(original)];
    const oldest = original.mappingHistory[0], latest = commit(original, [0], "excluded");
    expect(latest.mappingHistory).toHaveLength(20); expect(latest.mappingHistory![0]).not.toBe(oldest); expect(latest.mappingRedo).toEqual([]); expect(isPdfTask(latest)).toBe(true);
    const tooMany = structuredClone(latest); tooMany.mappingHistory!.push(snapshotPdfMapping(latest)); expect(isPdfTask(tooMany)).toBe(false);
  });
  it("accepts one hundred source-aligned history pages and rejects excess, malformed, reordered and changed-source pages", () => {
    const original = task(); original.analysis.document.pages = Array.from({ length: 100 }, (_, index) => page(index)); original.analysis.document.pageCount = 100;
    original.pages = structuredClone(original.analysis.document.pages); original.mappingHistory = [snapshotPdfMapping(original)]; original.mappingRedo = [snapshotPdfMapping(original)];
    expect(isPdfTask(jsonTask(original))).toBe(true);
    const mutations = [
      (pages: PdfPageInfo[]) => { pages.push(page(100)); },
      (pages: PdfPageInfo[]) => { pages.pop(); },
      (pages: PdfPageInfo[]) => { [pages[0], pages[1]] = [pages[1], pages[0]]; },
      (pages: PdfPageInfo[]) => { pages[0].index = 2; },
      (pages: PdfPageInfo[]) => { pages[0].visibleBox[2] = 400; },
      (pages: PdfPageInfo[]) => { pages[0].widthPt = 400; },
      (pages: PdfPageInfo[]) => { (pages[0] as unknown as Record<string, unknown>).review = "automatic"; },
      (pages: PdfPageInfo[]) => { pages[0].userUnit = NaN; }
    ];
    for (const location of ["mappingHistory", "mappingRedo"] as const) for (const corrupt of mutations) {
      const invalid = structuredClone(original); corrupt(invalid[location]![0].pages!); expect(isPdfTask(invalid)).toBe(false);
    }
  });
});
