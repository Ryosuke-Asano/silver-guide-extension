import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { degrees, PDFDocument } from "pdf-lib";
import { makeManualPdfField, PdfSession, type PdfExportOptions, type PdfField, type PdfPageInfo } from "../../src/adapters/pdf";

type Reviews = NonNullable<PdfExportOptions["pageReviews"]>;
let fontPromise: Promise<Uint8Array> | undefined;
const font = () => fontPromise ??= readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf", import.meta.url)).then(bytes => new Uint8Array(bytes));
const reviews = (first: PdfPageInfo["review"], second: PdfPageInfo["review"] = "inputs-confirmed"): Reviews => [{ pageIndex: 0, review: first }, { pageIndex: 1, review: second }];
const editable = (field: PdfField): PdfField => ({ ...field, role: "applicant", mappingState: "confirmed" });
// The added fields have explicit author confirmation. Unknown requiredness is a
// separate rejection boundary, rather than an accidental competing page error.
const manual = (pageIndex: number, label: string, kind: PdfField["kind"] = "text"): PdfField => ({ ...makeManualPdfField(pageIndex, [60, 350, 410, 390], label, kind), role: "applicant", required: false,
  requiredSource: { kind: "manual", text: "この架空の原本の追加欄は任意と確認した", pageIndex } });

async function fixture() {
  const doc = await PDFDocument.create(), first = doc.addPage([595, 842]), second = doc.addPage([595, 842]);
  second.setMediaBox(-10, 20, 595, 842); second.setCropBox(-5, 30, 570, 800); second.setRotation(degrees(90));
  first.drawText("FIRST ORIGINAL PAGE", { x: 50, y: 780, size: 12 }); second.drawText("SECOND ORIGINAL PAGE", { x: 50, y: 780, size: 12 });
  for (const [name, page, y] of [["first", first, 650], ["locked", first, 550], ["second", second, 650]] as const) {
    const field = doc.getForm().createTextField(name); field.addToPage(page, { x: 60, y, width: 350, height: 40 });
    if (name === "first") field.setText("First original");
    if (name === "locked") { field.setText("Locked original"); field.enableReadOnly(); }
  }
  return doc.save();
}

async function openFixture() {
  const bytes = await fixture(), session = await PdfSession.open(bytes), analysis = await session.analyze({ ocr: "never" });
  const fields = analysis.fields.filter(field => field.native).map(editable);
  return { bytes, session, fields, first: fields.find(field => field.native?.name === "first")!, locked: fields.find(field => field.native?.name === "locked")!, second: fields.find(field => field.native?.name === "second")! };
}

describe("owned page-review snapshot at the real PdfSession export boundary", () => {
  it("rejects malformed or incomplete supplied snapshots before resource work, with no source mutation", async () => {
    const { bytes, session } = await openFixture(), originalInfo = structuredClone(session.info), progress = vi.fn();
    const invalid: unknown[] = [null, {}, "excluded", [], [{ pageIndex: 0, review: "excluded" }], reviews("excluded").concat({ pageIndex: 2, review: "excluded" }), Array.from({ length: 101 }, (_, pageIndex) => ({ pageIndex, review: "excluded" })), [{ pageIndex: 0, review: "excluded" }, { pageIndex: 0, review: "inputs-confirmed" }], new Array(2), [null, { pageIndex: 1, review: "unseen" }], [false, { pageIndex: 1, review: "unseen" }]];
    for (const pageIndex of [-1, 2, .5, NaN, Infinity, "0", true, null, undefined]) invalid.push([{ pageIndex, review: "unseen" }, { pageIndex: 1, review: "unseen" }]);
    for (const review of ["confirmed", "", false, null, undefined]) invalid.push([{ pageIndex: 0, review }, { pageIndex: 1, review: "unseen" }]);
    try {
      for (const pageReviews of invalid) await expect(session.export({ fields: [], answers: {}, pageReviews: pageReviews as Reviews, onProgress: progress })).rejects.toMatchObject({ code: "INVALID_PAGE_REVIEWS" });
      expect(progress).not.toHaveBeenCalled(); expect(session.info).toEqual(originalInfo); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it.each(["no-inputs-confirmed", "excluded"] as const)("rejects active native and overlay contradictions on %s even when answers are empty or inapplicable", async review => {
    const { bytes, session, first } = await openFixture(), trigger = manual(1, "代理人の有無", "checkbox"), overlay = manual(0, "対象外ページの追加入力"), fontBytes = await font(), originalInfo = structuredClone(session.info);
    try {
      for (const source of [first, overlay]) for (const conditional of [false, true]) {
        const field: PdfField = conditional ? { ...source, conditionStatus: "confirmed", condition: { op: "eq", fieldId: trigger.id, value: true }, conditionSource: { text: "代理人がいる場合のみ記入", pageIndex: 0 } } : source;
        await expect(session.export({ fields: [field, trigger], answers: { [field.id]: "", [trigger.id]: false }, pageReviews: reviews(review), fontBytes, allowIncomplete: true })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "PAGE_CLASSIFICATION_CONFLICT", pageIndex: 0, fieldId: field.id })]) });
      }
      expect(session.info).toEqual(originalInfo); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it.each(["no-inputs-confirmed", "excluded"] as const)("preserves rejected and source-readonly originals on %s while actually writing Japanese on the legal page", async review => {
    const { bytes, session, first, locked, second } = await openFixture(), overlay = manual(1, "別ページの架空メモ"), ignored = { ...manual(0, "対象から外した候補"), mappingState: "rejected" as const }, originalInfo = structuredClone(session.info);
    first.mappingState = "rejected";
    try {
      const answers = { [first.id]: "転記しない回答", [locked.id]: locked.initialValue, [second.id]: "別ページの架空氏名", [overlay.id]: "別ページの架空メモ", [ignored.id]: "転記しないメモ" };
      const output = await session.export({ fields: [first, locked, second, overlay, ignored], answers, pageReviews: reviews(review), fontBytes: await font(), mode: "editable-form" }), actual = await PDFDocument.load(output.bytes);
      expect(output.validated).toBe(true); expect(actual.getForm().getTextField("first").getText()).toBe("First original"); expect(actual.getForm().getTextField("locked").getText()).toBe("Locked original"); expect(actual.getForm().getTextField("locked").isReadOnly()).toBe(true); expect(actual.getForm().getTextField("second").getText()).toBe(answers[second.id]);
      const reopened = await session.openValidatedOutput(output);
      try {
        const evidence = (await reopened.analyze({ ocr: "never" })).evidence;
        expect(evidence.some(item => item.pageIndex === 1 && item.text.includes(answers[overlay.id]))).toBe(true); expect(evidence.some(item => item.pageIndex === 0 && item.text.includes(answers[ignored.id]))).toBe(false);
      } finally { await reopened.dispose(); }
      expect(session.info).toEqual(originalInfo); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it("permits an all-rejected draft on pages confirmed to have no inputs, preserving genuine original values", async () => {
    const { bytes, session, fields } = await openFixture(), originalInfo = structuredClone(session.info);
    try {
      const output = await session.export({ fields: fields.map(field => ({ ...field, mappingState: "rejected" })), answers: Object.fromEntries(fields.map(field => [field.id, "対象外の残存回答"])), pageReviews: reviews("no-inputs-confirmed", "no-inputs-confirmed"), fontBytes: await font() }), actual = await PDFDocument.load(output.bytes);
      expect(output.validated).toBe(true); expect(actual.getForm().getTextField("first").getText()).toBe("First original"); expect(actual.getForm().getTextField("locked").getText()).toBe("Locked original"); expect(actual.getForm().getTextField("second").getText() ?? "").toBe(""); expect(session.info).toEqual(originalInfo); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it("accepts complete unordered reviews but ignores forged geometry/capabilities and keeps omitted-review callers compatible", async () => {
    const { bytes, session, second } = await openFixture(), originalInfo = structuredClone(session.info), sourceDoc = await PDFDocument.load(bytes);
    const extra = { visibleBox: [0, 0, 1, 1], mediaBox: [0, 0, 1, 1], cropBox: [0, 0, 1, 1], rotation: 180, userUnit: 999, widthPt: 1, heightPt: 1, capabilities: { export: { allowed: false, reason: "caller supplied" } } };
    const pageReviews = [{ pageIndex: 1, review: "inputs-confirmed", ...extra }, { pageIndex: 0, review: "excluded", ...extra }] as Reviews, before = structuredClone(pageReviews);
    try {
      const result = await session.export({ fields: [second], answers: { [second.id]: "架空の記入者" }, pageReviews, fontBytes: await font() }), actual = await PDFDocument.load(result.bytes);
      expect(result.validated).toBe(true); expect(actual.getForm().getTextField("second").getText()).toBe("架空の記入者");
      for (const [index, page] of actual.getPages().entries()) { expect(page.getMediaBox()).toEqual(sourceDoc.getPage(index).getMediaBox()); expect(page.getCropBox()).toEqual(sourceDoc.getPage(index).getCropBox()); expect(page.getRotation()).toEqual(sourceDoc.getPage(index).getRotation()); }
      expect(pageReviews).toEqual(before); expect(session.info).toEqual(originalInfo);
      const legacy = await session.export({ fields: [second], answers: { [second.id]: "旧呼出しの架空氏名" }, fontBytes: await font() }); expect(legacy.validated).toBe(true); expect((await PDFDocument.load(legacy.bytes)).getForm().getTextField("second").getText()).toBe("旧呼出しの架空氏名"); expect(session.info).toEqual(originalInfo); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it.each(["excluded", "inputs-confirmed"] as const)("owns %s reviews before awaiting the real export font, despite later caller mutation", async initialReview => {
    const { bytes, session, first } = await openFixture(), originalInfo = structuredClone(session.info), pageReviews = reviews(initialReview), fontBytes = await font();
    let begin!: () => void, release!: (response: Response) => void;
    const started = new Promise<void>(resolve => { begin = resolve; }), response = new Promise<Response>(resolve => { release = resolve; });
    const originalFetch = globalThis.fetch, fetchFont = vi.fn(() => { begin(); return response; });
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => String(input).endsWith("/assets/fonts/NotoSansJP-Regular.ttf") ? fetchFont() : originalFetch(input, init));
    try {
      const writing = session.export({ fields: [first], answers: { [first.id]: "架空の更新氏名" }, pageReviews }), settled = writing.then(value => ({ value }), error => ({ error }));
      await started; pageReviews[0].review = initialReview === "excluded" ? "inputs-confirmed" : "excluded"; pageReviews.splice(1, 1); release(new Response(fontBytes.slice().buffer));
      const result = await settled;
      if (initialReview === "excluded") expect(result).toMatchObject({ error: { code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "PAGE_CLASSIFICATION_CONFLICT", pageIndex: 0 })]) } });
      else { expect(result).toHaveProperty("value.validated", true); if (!("value" in result)) throw Error("Expected validated output"); expect((await PDFDocument.load(result.value.bytes)).getForm().getTextField("first").getText()).toBe("架空の更新氏名"); }
      expect(fetchFont).toHaveBeenCalledTimes(1); expect(session.info).toEqual(originalInfo); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { vi.unstubAllGlobals(); await session.dispose(); }
  });

  it("passes selected option placements into the shared conflict check without treating an unselected page as a write", async () => {
    const { bytes, session, second } = await openFixture(), choice = manual(1, "ページをまたぐ選択", "radio"), fontBytes = await font();
    choice.options = [{ id: "allowed", label: "記入対象", exportValue: "A", placements: makeManualPdfField(1, [60, 200, 78, 218]).placements }, { id: "blocked", label: "対象外", exportValue: "B", placements: makeManualPdfField(0, [60, 200, 78, 218]).placements }];
    try {
      await expect(session.export({ fields: [choice], answers: { [choice.id]: "B" }, pageReviews: reviews("excluded"), fontBytes })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "PAGE_CLASSIFICATION_CONFLICT", fieldId: choice.id, pageIndex: 0 })]) });
      const output = await session.export({ fields: [choice, second], answers: { [choice.id]: "A", [second.id]: "合法ページの架空氏名" }, pageReviews: reviews("excluded"), fontBytes }); expect(output.validated).toBe(true); expect((await PDFDocument.load(output.bytes)).getForm().getTextField("second").getText()).toBe("合法ページの架空氏名"); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });
});
