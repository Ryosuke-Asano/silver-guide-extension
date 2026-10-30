import type { PdfSiteSubmissionAdapter } from "./types";
import { elementVisible } from "../../features/pdf/detection";
import { assistedDemoUrl } from "../../shared/bundled-demo";

/** An example multi-step site adapter. The demo page remains ordinary HTML/JS. */
export const libraryDemoAdapter: PdfSiteSubmissionAdapter = {
  id: "library-demo", defaultSubmit: true,
  matches({ document: doc, form, button }) {
    const url = new URL(doc.location.href);
    return (url.hostname === "127.0.0.1" && ["4187", "4287"].includes(url.port) || !!assistedDemoUrl(url.href)) && form.id === "registration-form" && button.id === "review-button" && !!doc.getElementById("complete-button") && !!doc.getElementById("complete-stage");
  },
  async afterInitialSubmit({ document: doc }, live) {
    const errors = doc.getElementById("form-errors");
    if (errors && elementVisible(errors)) return { status: "needs-input", message: "PDFを添付しました。元のフォームの入力エラーを確認してください。" };
    const review = doc.getElementById("review-stage"), complete = doc.getElementById("complete-button");
    if (!live() || !review || !elementVisible(review) || !complete || !elementVisible(complete)) return { status: "submission-requested", message: "PDFを添付し、内容確認へ進む操作を行いました。元のページを確認してください。" };
    complete.click();
    if (doc.getElementById("complete-stage") && elementVisible(doc.getElementById("complete-stage")!)) return { status: "submitted", message: "記入済みPDFを添付し、模擬提出の完了画面を確認しました。" };
    return { status: "submission-requested", message: "元のページで模擬提出の結果を確認してください。" };
  },
};
