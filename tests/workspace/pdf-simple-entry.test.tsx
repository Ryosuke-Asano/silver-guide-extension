// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeManualPdfField, type PdfAnalysis, type PdfAnswers } from "../../src/domain/pdf";
import { PdfWorkspace } from "../../src/apps/workspace/PdfWorkspace";
import { usePdfWorkspace } from "../../src/apps/workspace/usePdfWorkspace";
import { createPdfTask, getDirectPdfTaskIssues, getPdfTaskIssues, isPdfTask, type PdfTask } from "../../src/apps/workspace/task-model";
import { extractNativeFields } from "../../src/adapters/pdf/native";
import type { PdfSession } from "../../src/adapters/pdf";

// Only the canvas rendering is replaced. Inputs, FieldTools, the task controller,
// task update and answer constraints all use their production code.
vi.mock("../../src/apps/workspace/PdfPreview", () => ({
  PdfPreview: (props: {pageIndex:number;selectedId:string|null;selectionPurpose?:string;title:string;drawing?:boolean;preview?:{answers:PdfAnswers;answerStatus?:Record<string,string>;paused?:boolean}}) => <div data-testid="pdf-canvas-rendering" data-page-index={props.pageIndex} data-selected-id={props.selectedId??""} data-selection-purpose={props.selectionPurpose??"question"} data-title={props.title} data-drawing={String(Boolean(props.drawing))} data-preview-answers={props.preview?JSON.stringify(props.preview.answers):""} data-preview-paused={String(Boolean(props.preview?.paused))} />
}));

let root: Root | null;
let container: HTMLDivElement;
let controller: ReturnType<typeof usePdfWorkspace>;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

function fixture(stage: PdfTask["stage"] = "filling"): PdfTask {
  const field = makeManualPdfField(0, [80, 620, 360, 665], "氏名");
  field.role = "applicant";
  field.mappingState = "confirmed";
  field.required = false;
  const capability = { allowed: true, reason: null };
  const analysis: PdfAnalysis = {
    document: {
      id: crypto.randomUUID(), hash: "a".repeat(64), name: "架空の申請書.pdf",
      byteLength: 1024, pageCount: 1,
      pages: [{
        index: 0, label: "1", mediaBox: [0, 0, 595, 842], cropBox: [0, 0, 595, 842],
        visibleBox: [0, 0, 595, 842], rotation: 0, userUnit: 1, widthPt: 595,
        heightPt: 842, extraction: "native", review: "inputs-confirmed"
      }],
      capabilities: { read: capability, analyze: capability, nativeWrite: capability, overlayWrite: capability, export: capability },
      issues: [], actionDependent: false
    },
    fields: [field],
    evidence: [{ id: "source-text", pageIndex: 0, text: "原書類の氏名", quad: field.placements[0].quad, method: "native", rawOcrConfidence: null }],
    issues: [], complete: true
  };
  const task = createPdfTask(analysis);
  task.stage = stage;
  expect(isPdfTask(task)).toBe(true);
  expect(() => JSON.stringify(task)).not.toThrow();
  return task;
}


const savePdf = vi.fn(async () => {});
async function mount(task: PdfTask) {
  savePdf.mockClear();
  function Harness() {
    controller = usePdfWorkspace();
    return <PdfWorkspace controller={{ ...controller, savePdfDirect: savePdf }} />;
  }
  await act(async () => root!.render(<Harness />));
  await act(async () => controller.setTask(task));
}
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>(".pdf-entry-navigation button")];
const answer = () => container.querySelector<HTMLInputElement>("[data-pdf-answer]")!;
async function click(text: string) { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
async function enter(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(answer(),value);answer().dispatchEvent(new Event("input",{bubbles:true})); }); }
const preview=()=>container.querySelector<HTMLElement>('[data-testid="pdf-canvas-rendering"]')!;
const previewAnswers=():PdfAnswers=>JSON.parse(preview().dataset.previewAnswers!);

function uncertainTask() { const task=fixture("mapping"), field=task.fields[0];field.role="unknown";field.required="unknown";delete field.requiredSource;field.mappingState="needs-review";task.pages[0].review="unseen";return task; }
function twoFields() { const task=uncertainTask();const field=makeManualPdfField(0,[80,500,360,545],"住所");task.fields.push(field);task.answers[field.id]=null;task.answerStatus[field.id]="empty";return task; }

describe("ordinary PDF entry: input at left, original at right, back and next", () => {
  it("passes all current answers into the preview on every edit and clear without a preview button or navigation", async()=>{
    const task=twoFields(),first=task.fields[0].id,second=task.fields[1].id;await mount(task);
    await enter("山田 花子");expect(previewAnswers()[first]).toBe("山田 花子");expect(document.activeElement).toBe(answer());
    await click("次へ");await enter("東京都北区");expect(previewAnswers()).toEqual({[first]:"山田 花子",[second]:"東京都北区"});
    await click("戻る");await enter("修正した氏名");expect(previewAnswers()).toEqual({[first]:"修正した氏名",[second]:"東京都北区"});
    await enter("");expect(previewAnswers()).toEqual({[first]:"",[second]:"東京都北区"});expect(savePdf).not.toHaveBeenCalled();
    expect(buttons().map(button=>button.textContent)).toEqual(["戻る","次へ"]);
  });
  it("keeps Japanese composition in the original input, pauses only preview rendering, and resumes with the committed answer",async()=>{
    const task=twoFields(),first=task.fields[0].id;await mount(task);const input=answer();
    await act(async()=>{input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:""}));});
    await enter("やまだ");expect(answer()).toBe(input);expect(input.value).toBe("やまだ");expect(preview().dataset.previewPaused).toBe("true");
    await enter("山田");await act(async()=>{input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"山田"}));});
    expect(preview().dataset.previewPaused).toBe("false");expect(previewAnswers()[first]).toBe("山田");expect(input.value).toBe("山田");expect(document.activeElement).toBe(input);
    expect(savePdf).not.toHaveBeenCalled();
  });
  it("opens an uncertain parsed field directly for typing with only the two navigation buttons", async () => {
    const task=uncertainTask();await mount(task);expect(answer()).not.toBeNull();expect(answer().disabled).toBe(false);
    expect(buttons().map(button=>button.textContent)).toEqual(["戻る","PDFを保存"]);
    expect(container.querySelector(".pdf-entry-progress")!.textContent).toBe("1 / 1");
    expect(container.querySelector(".pdf-entry-tools")).toBeNull();expect(container.querySelector(".workflow-steps")).toBeNull();
    expect(container.querySelector('[data-title="記入プレビュー"]')).not.toBeNull();
    await enter("山田 花子");expect(controller.task!.answers[task.fields[0].id]).toBe("山田 花子");
    expect(controller.task!.fields[0].role).toBe("unknown");expect(controller.task!.fields[0].mappingState).toBe("needs-review");expect(controller.task!.pages[0].review).toBe("unseen");
  });
  it("moves forward and back without confirmation, preserves answers, and focuses the next input", async () => {
    const task=twoFields();await mount(task);await enter("山田 花子");await click("次へ");
    expect(document.activeElement).toBe(answer());expect(container.querySelector("h2")!.textContent).toBe("住所");
    await enter("東京都北区");await click("戻る");expect(answer().value).toBe("山田 花子");await click("次へ");expect(answer().value).toBe("東京都北区");
    await click("PDFを保存");expect(savePdf).toHaveBeenCalledTimes(1);expect(getDirectPdfTaskIssues(controller.task!)).toEqual([]);
  });
  it("allows an unfinished native-required answer to be saved without changing its required flag", async () => {
    const task=fixture();task.fields[0].required=true;await mount(task);await click("PDFを保存");expect(savePdf).toHaveBeenCalledTimes(1);expect(controller.task!.fields[0].required).toBe(true);
  });
  it("keeps an explicit cleared answer empty instead of resurrecting the original value", async () => {
    const task=fixture();task.fields[0].initialValue="原本の氏名";task.answers[task.fields[0].id]=null;await mount(task);expect(answer().value).toBe("");await click("PDFを保存");expect(controller.task!.answers[task.fields[0].id]).toBeNull();
  });
  it("accepts a visible retained answer through Next without an extra confirmation button", async () => {
    const task=twoFields();task.answers[task.fields[0].id]="保持した氏名";task.answerStatus[task.fields[0].id]="needs-review";await mount(task);await click("次へ");expect(controller.task!.answerStatus[task.fields[0].id]).toBe("entered");expect(controller.task!.fields[0].mappingState).toBe("needs-review");
  });
  it("refuses an incompatible retained array and preserves the original value for repair", async () => {
    const task=fixture();task.answers[task.fields[0].id]=["保持値"];task.answerStatus[task.fields[0].id]="needs-review";await mount(task);await click("PDFを保存");expect(savePdf).not.toHaveBeenCalled();expect(container.querySelector('[role="alert"]')!.textContent).toContain("種類");expect(controller.task!.answers[task.fields[0].id]).toEqual(["保持値"]);
  });
  it("keeps actual length and page placement validation while removing semantic confirmation gates", async () => {
    const task=fixture();task.fields[0].maxGraphemes=2;await mount(task);await enter("長すぎる氏名");await click("PDFを保存");expect(savePdf).not.toHaveBeenCalled();expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(getDirectPdfTaskIssues(controller.task!).length).toBeGreaterThan(0);
  });
  it("editing a formatted answer deactivates its in-memory formatting record", async () => {
    const task=fixture(), id=task.fields[0].id;task.answers[id]="123";task.answerFormats={[id]:{raw:"１２３",formatted:"123",formatId:"halfwidth",appliedAt:new Date().toISOString(),active:true}};await mount(task);await enter("456");expect(controller.task!.answerFormats![id].active).toBe(false);expect(()=>JSON.stringify(controller.task)).not.toThrow();
    expect(controller.task!.answers[id]).toBe("456");expect(container.textContent).not.toMatch(/下書き|保管庫|詳細編集/);
  });
  it("stages a correction and returns to the same answer when cancelled", async () => {
    const task=twoFields();await mount(task);await enter("保持した氏名");const before=structuredClone(controller.task!);
    await click("この項目を直す");const label=container.querySelector<HTMLInputElement>(".field-inspector input")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(label,"修正中の名前");label.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(controller.task).toEqual(before);await click("取消");expect(answer().value).toBe("保持した氏名");expect(container.querySelector("h2")!.textContent).toBe("氏名");expect(controller.task).toEqual(before);
  });
  it("adopts only the current correction and retains the answer and original position", async () => {
    const task=twoFields();await mount(task);await enter("保持した氏名");await click("この項目を直す");
    const label=container.querySelector<HTMLInputElement>(".field-inspector input")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(label,"書類の氏名");label.dispatchEvent(new Event("input",{bubbles:true}));});await click("修正を採用");
    expect(controller.task!.fields[0].label).toBe("書類の氏名");expect(answer().value).toBe("保持した氏名");expect(controller.task!.selectedFieldId).toBe(task.fields[0].id);expect(controller.task!.fields[0].placements).toEqual(task.fields[0].placements);
    expect(container.querySelector(".pdf-entry-tools")).toBeNull();expect(container.querySelector('[data-page-index="0"]')).not.toBeNull();
    await click("次へ");await click("戻る");expect(answer().value).toBe("保持した氏名");
  });
  it("excludes a field only on adoption, keeps its answer, and supports undo without retyping", async () => {
    const task=twoFields(),id=task.fields[0].id;task.answers[id]="保持氏名";await mount(task);await click("この項目を直す");
    const exclude=[...container.querySelectorAll<HTMLLabelElement>("label")].find(label=>label.textContent?.includes("今回はこの項目を記入しない"))!.querySelector<HTMLInputElement>("input")!;
    await act(async()=>exclude.click());expect(controller.task!.fields[0].mappingState).not.toBe("rejected");await click("修正を採用");
    expect(controller.task!.answers[id]).toBe("保持氏名");expect(container.querySelector(".pdf-entry-progress")!.textContent).toBe("1 / 1");
    await click("この項目を直す");await click("直前の修正を元に戻す");expect(controller.task!.fields[0].mappingState).not.toBe("rejected");expect(controller.task!.answers[id]).toBe("保持氏名");
  });
  it("refuses a stale correction without overwriting a newer answer", async () => {
    const task=fixture();await mount(task);await click("この項目を直す");await act(async()=>controller.update(current=>({answers:{...current.answers,[task.fields[0].id]:"新しい回答"}})));await click("修正を採用");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("入力内容が変わりました");expect(controller.task!.answers[task.fields[0].id]).toBe("新しい回答");await click("取消");expect(answer().value).toBe("新しい回答");
  });
  it("keeps a document's read-only restriction and does not offer writing", async () => {
    const task=fixture(),reason="このPDFは閲覧のみです。";task.analysis.document.capabilities.export={allowed:false,reason};await mount(task);expect(answer()).toBeNull();expect(buttons()[1].disabled).toBe(true);await click("次へ");expect(savePdf).not.toHaveBeenCalled();expect(container.textContent).toContain(reason);
  });
  it("does not restore rejected fields into ordinary navigation", async () => {
    const task=twoFields();task.fields[1].mappingState="rejected";await mount(task);expect(container.querySelector(".pdf-entry-progress")!.textContent).toBe("1 / 1");expect(buttons()[1].textContent).toBe("PDFを保存");
  });
  it("shows no vault or alternate editor and states when the saved PDF will have blank answers", async () => {
    await mount(fixture());expect(container.querySelector(".pdf-entry-menu")).toBeNull();expect(container.textContent).not.toMatch(/下書き|保管庫|詳細編集/);expect(container.querySelector(".pdf-entry-footnote")!.textContent).toContain("未入力の1項目");
  });
  it("does not add a missing field until its correction is adopted", async () => {
    const task=fixture();task.fields=[];task.answers={};task.answerStatus={};task.selectedFieldId=null;await mount(task);await click("入力欄を追加");expect(controller.task!.fields).toHaveLength(0);await click("取消");expect(controller.task!.fields).toHaveLength(0);await click("入力欄を追加");await click("修正を採用");expect(controller.task!.fields).toHaveLength(1);expect(answer()).not.toBeNull();
  });
});
