import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { makeManualPdfField, PdfSession, type PdfField } from "../../src/adapters/pdf";
import { buildPdfExport } from "../../src/adapters/pdf/export";
import { pdfAnswerTypeCompatible, type PdfAnswer } from "../../src/domain/pdf";
import { validatePdfFields } from "../../src/adapters/pdf/validation";

let fontPromise: Promise<Uint8Array> | undefined;
const font = () => fontPromise ??= readFile(new URL("../../public/assets/fonts/NotoSansJP-Regular.ttf", import.meta.url)).then(bytes => new Uint8Array(bytes));

async function openFixture() {
  const doc = await PDFDocument.create(), page = doc.addPage([595, 842]), form = doc.getForm();
  const name = form.createTextField("name"); name.setText("Original name"); name.addToPage(page, { x: 60, y: 650, width: 350, height: 40 });
  const single = form.createDropdown("single"); single.addOptions(["A", "B"]); single.select("A"); single.addToPage(page, { x: 60, y: 575, width: 200, height: 35 });
  const multi = form.createOptionList("multi"); multi.addOptions(["A", "B"]); multi.enableMultiselect(); multi.select(["A", "B"]); multi.addToPage(page, { x: 60, y: 420, width: 200, height: 100 });
  const radio = form.createRadioGroup("radio"); radio.addOptionToPage("A", page, { x: 350, y: 580, width: 20, height: 20 }); radio.addOptionToPage("B", page, { x: 400, y: 580, width: 20, height: 20 }); radio.select("A");
  const checked = form.createCheckBox("checked"); checked.check(); checked.addToPage(page, { x: 350, y: 500, width: 25, height: 25 });
  const locked = form.createTextField("locked"); locked.setText("Locked original"); locked.enableReadOnly(); locked.addToPage(page, { x: 60, y: 300, width: 350, height: 40 });
  const bytes = await doc.save(), session = await PdfSession.open(bytes), analysis = await session.analyze({ ocr: "never" });
  const fields: PdfField[] = analysis.fields.filter(field => field.native).map(field => ({ ...field, role: "applicant", mappingState: "confirmed" }));
  return { bytes, session, fields, name: fields.find(field => field.native?.name === "name")! };
}

describe("raw PDF writer preserves incompatible retained answers instead of coercing them", () => {
  it("rejects unconfirmed requiredness for writable native and overlay fields before empty, conditional or incomplete-export skips", async () => {
    const { bytes, session, name } = await openFixture(), fontBytes = await font();
    const native: PdfField = { ...name, required: "unknown" }, overlay: PdfField = { ...makeManualPdfField(0, [60, 480, 410, 520], "未確認の任意指定"), role: "applicant", mappingState: "confirmed", required: "unknown" };
    const trigger: PdfField = { ...makeManualPdfField(0, [60, 220, 85, 245], "条件の選択", "checkbox"), role: "applicant", mappingState: "confirmed", required: false, requiredSource: { kind: "manual", text: "原本で任意と確認" } };
    try {
      for (const source of [native, overlay]) for (const allowIncomplete of [false, true]) for (const value of ["保持する回答", "", null]) for (const conditional of [false, true]) {
        const field: PdfField = conditional ? { ...source, conditionStatus: "confirmed", condition: { op: "eq", fieldId: trigger.id, value: true }, conditionSource: { text: "選択時に記入" } } : source;
        const fields = conditional ? [field, trigger] : [field], answers = { [field.id]: value, ...(conditional ? { [trigger.id]: false } : {}) }, before = structuredClone(answers), status = { [field.id]: "deferred" };
        expect(validatePdfFields(fields, answers, session.info.pages, { allowIncomplete, answerStatus: status })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "REQUIRED_UNCONFIRMED", fieldId: field.id })]));
        await expect(buildPdfExport({ original: bytes, pages: session.info.pages, fields, answers, answerStatus: status, allowIncomplete, fontBytes, mode: "editable-form", actionRemovalConfirmed: false })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "REQUIRED_UNCONFIRMED", fieldId: field.id })]) });
        await expect(session.export({ fields, answers, answerStatus: status, allowIncomplete, fontBytes })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "REQUIRED_UNCONFIRMED", fieldId: field.id })]) });
        expect(answers).toEqual(before); expect(session.getOriginalBytes()).toEqual(bytes);
      }
      const excluded: PdfField = { ...native, mappingState: "rejected" }, locked: PdfField = { ...native, readOnly: true };
      expect(validatePdfFields([excluded, locked], { [name.id]: "" }, session.info.pages, { allowIncomplete: true })).toEqual([]);
    } finally { await session.dispose(); }
  });
  it("rejects a deferred array in a plain text field even when incomplete export is allowed", async () => {
    const { bytes, session, name } = await openFixture(), answers = { [name.id]: ["KEEP", "SECOND"] }, before = structuredClone(answers);
    try {
      let failure: unknown, written: string | undefined;
      try {
        const output = await buildPdfExport({ original: bytes, pages: session.info.pages, fields: [name], answers, answerStatus: { [name.id]: "deferred" }, allowIncomplete: true, fontBytes: await font(), mode: "editable-form", actionRemovalConfirmed: false });
        written = (await PDFDocument.load(output.bytes)).getForm().getTextField("name").getText();
      } catch (cause) { failure = cause; }
      // The pre-fix run reached this branch and proved the actual PDF was joined.
      if (!failure) expect(written).toBe("KEEP、SECOND");
      expect(failure).toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "ANSWER_TYPE", fieldId: name.id })]) });
      expect(answers).toEqual(before); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });
  it("rejects an overlay array before the independently validated full export can join it", async () => {
    const { bytes, session } = await openFixture(), field: PdfField = { ...makeManualPdfField(0, [60, 480, 410, 520], "Synthetic overlay"), role: "applicant", required: false,
      requiredSource: { kind: "manual", text: "Confirmed optional field on the original", pageIndex: 0 }, mappingState: "confirmed" };
    const answers = { [field.id]: ["KEEP", "SECOND"] }, before = structuredClone(answers);
    try {
      let failure: unknown, validated = false;
      try { validated = (await session.export({ fields: [field], answers, answerStatus: { [field.id]: "deferred" }, allowIncomplete: true, fontBytes: await font() })).validated; }
      catch (cause) { failure = cause; }
      if (!failure) expect(validated).toBe(true);
      expect(failure).toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "ANSWER_TYPE", fieldId: field.id })]) });
      expect(answers).toEqual(before); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });
  it("permits a valid explicitly deferred string under the legacy incomplete-export contract", async () => {
    const { bytes, session, name } = await openFixture(), answers = { [name.id]: "Retained valid string" };
    try {
      const output = await session.export({ fields: [name], answers, answerStatus: { [name.id]: "deferred" }, allowIncomplete: true, fontBytes: await font() });
      expect(output.validated).toBe(true); expect((await PDFDocument.load(output.bytes)).getForm().getTextField("name").getText()).toBe(answers[name.id]);
      expect(answers[name.id]).toBe("Retained valid string"); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it("permits explicit overlay multi-choice answers without weakening native or single-choice types", () => {
    const field = { ...makeManualPdfField(0, [60, 220, 85, 245], "手続の内容", "select"), multiple: true };
    expect(pdfAnswerTypeCompatible(field, ["new", "renew"])).toBe(true);
    expect(pdfAnswerTypeCompatible(field, [])).toBe(true);
    expect(pdfAnswerTypeCompatible(field, "new")).toBe(false);
    expect(pdfAnswerTypeCompatible({ ...field, multiple: false }, ["new"])).toBe(false);
    expect(pdfAnswerTypeCompatible({ ...field, kind: "text" }, ["new"])).toBe(false);
    expect(pdfAnswerTypeCompatible({ ...field, native: { multiSelect: false } as NonNullable<PdfField["native"]> }, ["new"])).toBe(false);
  });
  it("rejects incompatible retained types, including empty arrays, before blank/condition/incomplete skips", async () => {
    const { bytes, session, fields, name } = await openFixture(), fontBytes = await font();
    const find = (label: string) => fields.find(field => field.native?.name === label)!;
    const cases: Array<[PdfField, PdfAnswer]> = [
      [name, []], [name, false], [{ ...name, kind: "multiline" }, ["KEEP"]], [{ ...name, kind: "date" }, true], [{ ...name, kind: "number" }, ["12"]],
      [find("single"), ["A"]], [find("single"), []], [find("radio"), ["A"]], [find("radio"), []],
      [find("multi"), "A"], [find("multi"), false], [find("multi"), new Array<string>(1)], [find("checked"), "true"], [find("checked"), []]
    ];
    try {
      for (const [field, value] of cases) for (const conditional of [false, true]) {
        // A known-false condition cannot sanitize a wrong raw type into a blank.
        const trigger = { ...find("checked"), id: "condition-trigger" }, target: PdfField = conditional ? { ...field, conditionStatus: "confirmed", condition: { op: "eq", fieldId: trigger.id, value: true },
          conditionSource: { text: "Only if the synthetic checkbox is checked", pageIndex: 0 } } : field;
        const answers = { [target.id]: structuredClone(value), ...(conditional ? { [trigger.id]: false } : {}) }, before = structuredClone(answers);
        await expect(session.export({ fields: conditional ? [target, trigger] : [target], answers, answerStatus: { [target.id]: "deferred", ...(conditional ? { [trigger.id]: "entered" } : {}) },
          allowIncomplete: true, fontBytes })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "ANSWER_TYPE", fieldId: target.id })]) });
        expect(answers).toEqual(before); expect(session.getOriginalBytes()).toEqual(bytes);
      }
    } finally { await session.dispose(); }
  });

  it("writes compatible checkbox/single choices/native multi-select arrays and reads their actual values back", async () => {
    const { bytes, session, fields, name } = await openFixture(), find = (label: string) => fields.find(field => field.native?.name === label)!, fontBytes = await font();
    const targets = [name, find("single"), find("multi"), find("radio"), find("checked")], answers = Object.fromEntries(targets.map(field => [field.id,
      field === name ? "New name" : field.native?.name === "multi" ? ["B", "A"] : field.native?.name === "checked" ? false : "B"]));
    try {
      const output = await session.export({ fields: targets, answers, answerStatus: Object.fromEntries(targets.map(field => [field.id, "entered"])), fontBytes }), form = (await PDFDocument.load(output.bytes)).getForm();
      expect(output.validated).toBe(true); expect(form.getTextField("name").getText()).toBe("New name"); expect(form.getDropdown("single").getSelected()).toEqual(["B"]);
      expect(form.getOptionList("multi").getSelected().sort()).toEqual(["A", "B"]); expect(form.getRadioGroup("radio").getSelected()).toBe("B"); expect(form.getCheckBox("checked").isChecked()).toBe(false);
      const cleared = await session.export({ fields: [name, find("single"), find("multi")], answers: { [name.id]: null, [find("single").id]: "", [find("multi").id]: [] },
        answerStatus: { [name.id]: "empty", [find("single").id]: "empty", [find("multi").id]: "empty" }, allowIncomplete: true, fontBytes }), clearedForm = (await PDFDocument.load(cleared.bytes)).getForm();
      expect(cleared.validated).toBe(true); expect(clearedForm.getTextField("name").getText() ?? "").toBe(""); expect(clearedForm.getDropdown("single").getSelected()).toEqual([]); expect(clearedForm.getOptionList("multi").getSelected()).toEqual([]);
      expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it("requires explicit review even for a retained blank, unchecked checkbox or empty multi-select", async () => {
    const { bytes, session, fields, name } = await openFixture(), fontBytes = await font(), find = (label: string) => fields.find(field => field.native?.name === label)!;
    const cases: Array<[PdfField, PdfAnswer]> = [[name, "Valid retained string"], [name, null], [name, ""], [find("checked"), false], [find("multi"), []]];
    try {
      for (const [field, value] of cases) {
        const answers = { [field.id]: value }, before = structuredClone(answers);
        await expect(session.export({ fields: [field], answers, answerStatus: { [field.id]: "needs-review" }, allowIncomplete: true, fontBytes })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "ANSWER_REVIEW_REQUIRED", fieldId: field.id })]) });
        expect(answers).toEqual(before); expect(session.getOriginalBytes()).toEqual(bytes);
      }
    } finally { await session.dispose(); }
  });

  it("keeps rejected answers and read-only original values without treating them as writable type/review failures", async () => {
    const { bytes, session, fields, name } = await openFixture(), locked = fields.find(field => field.native?.name === "locked")!, rejected = { ...name, mappingState: "rejected" as const };
    const answers = { [rejected.id]: ["KEEP", "SECOND"], [locked.id]: locked.initialValue }, before = structuredClone(answers);
    try {
      expect(validatePdfFields([rejected, locked], { [rejected.id]: [], [locked.id]: [] }, session.info.pages, { allowIncomplete: true, answerStatus: { [rejected.id]: "needs-review", [locked.id]: "needs-review" } })).toEqual([]);
      const output = await session.export({ fields: [rejected, locked], answers, answerStatus: { [rejected.id]: "needs-review", [locked.id]: "needs-review" }, allowIncomplete: true, fontBytes: await font() }), form = (await PDFDocument.load(output.bytes)).getForm();
      expect(output.validated).toBe(true); expect(form.getTextField("name").getText()).toBe("Original name"); expect(form.getTextField("locked").getText()).toBe("Locked original"); expect(form.getTextField("locked").isReadOnly()).toBe(true);
      // Skipping read-only type/review checks does not relax immutable native guards.
      await expect(session.export({ fields: [locked], answers: { [locked.id]: ["cannot write"] }, answerStatus: { [locked.id]: "deferred" }, allowIncomplete: true, fontBytes: await font() })).rejects.toMatchObject({ code: "ANSWERS_INVALID", issues: expect.arrayContaining([expect.objectContaining({ code: "READ_ONLY_FIELD" })]) });
      expect(answers).toEqual(before); expect(session.getOriginalBytes()).toEqual(bytes);
    } finally { await session.dispose(); }
  });

  it("preserves original-value callers without status metadata and shares blank compatibility with UI confirmation", async () => {
    const { bytes, session, fields, name } = await openFixture();
    try {
      const output = await session.export({ fields: [name], answers: {}, fontBytes: await font() }); expect(output.validated).toBe(true);
      expect((await PDFDocument.load(output.bytes)).getForm().getTextField("name").getText()).toBe("Original name"); expect(session.getOriginalBytes()).toEqual(bytes);
      for (const field of fields) for (const blank of [undefined, null, ""]) expect(pdfAnswerTypeCompatible(field, blank)).toBe(true);
      expect(pdfAnswerTypeCompatible(name, [])).toBe(false); expect(pdfAnswerTypeCompatible(name, false)).toBe(false);
      const multi = fields.find(field => field.native?.name === "multi")!; expect(pdfAnswerTypeCompatible(multi, [])).toBe(true); expect(pdfAnswerTypeCompatible(multi, ["A", 1])).toBe(false);
    } finally { await session.dispose(); }
  });
});
