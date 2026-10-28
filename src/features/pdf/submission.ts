import { elementVisible, publicLabel } from "./detection";
import type { PdfHandoffResult } from "../../shared/pdf-handoff";
import { findPdfSiteAdapter } from "../../adapters/sites";
import type { PdfSiteSubmissionAdapter } from "../../adapters/sites/types";

export type SubmissionPlan = { form: HTMLFormElement; button: HTMLButtonElement | HTMLInputElement; label: string; action: string; method: string; defaultSubmit: boolean; adapter: PdfSiteSubmissionAdapter | null };

/** Submission steps live in the extension; websites do not implement a bridge. */
export function submissionPlan(target: HTMLInputElement): SubmissionPlan | null {
  const form = target.form; if (!form) return null;
  const buttons = [...form.elements].filter((element): element is HTMLButtonElement | HTMLInputElement => ["BUTTON", "INPUT"].includes(element.tagName) && ["submit", "image"].includes((element as HTMLInputElement).type) && !(element as HTMLInputElement).disabled && elementVisible(element));
  if (buttons.length !== 1) return null;
  const button = buttons[0], adapter = findPdfSiteAdapter({ document: form.ownerDocument, form, button });
  const action = new URL(button.getAttribute("formaction") ?? form.getAttribute("action") ?? form.ownerDocument.location.href, form.ownerDocument.baseURI).href;
  return { form, button, label: publicLabel(button) || button.getAttribute("aria-label") || "フォームの送信", action, method: (button.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get").toLowerCase(), defaultSubmit: adapter?.defaultSubmit ?? false, adapter };
}
export function sameSubmissionPlan(before: SubmissionPlan | null, target: HTMLInputElement): boolean {
  if (!before) return !submissionPlan(target);
  const after = submissionPlan(target);
  return !!after && before.form === after.form && before.button === after.button && before.action === after.action && before.method === after.method;
}
const wait = (doc: Document, ms: number) => new Promise<void>(resolve => doc.defaultView!.setTimeout(resolve, ms));

export async function submitAttachedPdf(target: HTMLInputElement, plan: SubmissionPlan | null, submit: boolean, live: () => boolean): Promise<PdfHandoffResult> {
  if (!submit || !plan) return { status: "attached", message: "記入済みPDFを元の添付欄に戻しました。提出操作は元のページで続けられます。" };
  const doc = target.ownerDocument;
  // Give the site's ordinary change handlers time to validate the attachment.
  for (let count = 0; target.getAttribute("aria-busy") === "true" && count < 100; count++) { await wait(doc, 50); if (!live()) throw new Error("提出先が変わりました。PDFの回答は残っています。"); }
  if (!live() || !sameSubmissionPlan(plan, target)) throw new Error("フォームの送信先や操作が変わりました。元のページを確認してください。");
  if (target.getAttribute("aria-busy") === "true") return { status: "attached", message: "PDFを添付しました。サイトのファイル確認が続いているため、提出操作は元のページで続けてください。" };
  if (!plan.form.noValidate && !plan.button.formNoValidate && !HTMLFormElement.prototype.checkValidity.call(plan.form)) {
    HTMLFormElement.prototype.reportValidity.call(plan.form); return { status: "needs-input", message: "PDFを添付しました。元のフォームの未入力や入力形式を確認してください。" };
  }
  HTMLFormElement.prototype.requestSubmit.call(plan.form, plan.button);
  if (plan.adapter) return plan.adapter.afterInitialSubmit({ document: doc, form: plan.form, button: plan.button }, live);
  return { status: "submission-requested", message: "PDFを添付し、指定したフォームの操作を行いました。提出・受理の結果は元のページで確認してください。" };
}
