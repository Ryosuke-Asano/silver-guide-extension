import { isPdfPageUrl, safePdfFileName } from "../../shared/pdf-handoff";

export type PdfSource = { element: Element; url: string | null; file: File | null; fileName: string; signature: string };
export const PDF_ENTRY_HOST = "data-silver-guide-pdf-entry";

export function publicLabel(element: Element | null): string {
  if (!element) return "";
  const visit = (node: Node): string => node.nodeType === 3 ? node.textContent ?? "" : node.nodeType === 1 && (node as Element).matches('input,textarea,select,script,style,[contenteditable]:not([contenteditable="false"])') ? "" : [...node.childNodes].map(visit).join(" ");
  return visit(element).replace(/\s+/gu, " ").trim().slice(0, 200);
}
export function fieldLabel(input: HTMLInputElement): string {
  return input.getAttribute("aria-label")?.slice(0, 200) || [...input.labels ?? []].map(publicLabel).filter(Boolean).join(" ") || input.name || input.id || "PDFの添付欄";
}
export function elementVisible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    if (node.tagName === "DETAILS" && !node.hasAttribute("open") && !node.querySelector(":scope > summary")?.contains(element)) return false;
    const css = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (css?.display === "none" || css?.visibility === "hidden") return false;
  }
  return true;
}
export function pdfSource(element: Element): PdfSource | null {
  if (element.closest(`[${PDF_ENTRY_HOST}], [contenteditable]:not([contenteditable="false"])`)) return null;
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement, file = [...input.files ?? []].find(value => /\.pdf$/iu.test(value.name) || value.type === "application/pdf");
    if (input.type !== "file" || input.disabled || !file || !/\.pdf$/iu.test(file.name) && file.type !== "application/pdf") return null;
    return { element, url: null, file, fileName: safePdfFileName(file.name), signature: `${file.name}/${file.size}/${file.lastModified}` };
  }
  const raw = element.getAttribute(element.tagName === "OBJECT" ? "data" : element.tagName === "A" ? "href" : "src");
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw, element.ownerDocument.baseURI); } catch { return null; }
  const typed = element.getAttribute("type")?.split(";")[0].trim().toLowerCase() === "application/pdf";
  const download = element.getAttribute("download") ?? "";
  if (!typed && !/\.pdf$/iu.test(url.pathname) && !/\.pdf$/iu.test(download)) return null;
  if (!elementVisible(element)) return null;
  const doc = element.ownerDocument;
  if (!isPdfPageUrl(url.href) && !(url.protocol === "blob:" && url.origin === doc.location.origin)) return null;
  let name = url.pathname.split("/").pop() || "申込書.pdf";
  try { name = decodeURIComponent(name); } catch { /* A malformed filename must not stop detection on the page. */ }
  return { element, url: url.href, file: null, fileName: safePdfFileName(download || name), signature: url.href };
}
export function pdfTargets(doc: Document, source: PdfSource): HTMLInputElement[] {
  const all = [...doc.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(input => {
    if (input.disabled || input.matches(":disabled") || input.closest('[inert],[aria-disabled="true"]')) return false;
    const accept = input.accept.trim().toLowerCase();
    return !accept || accept.split(",").some(value => [".pdf", "application/pdf", "application/*", "*/*"].includes(value.trim()));
  });
  const sourceForm = source.element.tagName === "INPUT" ? (source.element as HTMLInputElement).form : source.element.closest("form");
  const sameForm = sourceForm ? all.filter(input => input.form === sourceForm) : [];
  return sameForm.length ? sameForm : all;
}
