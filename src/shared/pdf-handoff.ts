export const OPEN_PDF_HANDOFF = "silver-guide-pdf-open-v1";
export const PDF_HANDOFF_REQUEST = "silver-guide-pdf-request-v1";
export const PDF_HANDOFF_TIMING_EVENT = "silver-guide-pdf-timing";
export type PdfHandoffTimings = { sourceMs: number; prepareMs: number; outputMs: number };
export function isPdfHandoffTimings(value: unknown): value is PdfHandoffTimings {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfHandoffTimings>;
  return [item.sourceMs, item.prepareMs, item.outputMs].every(time => Number.isSafeInteger(time) && Number(time) >= 0 && Number(time) <= 86_400_000);
}
export const HANDOFF_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_HANDOFF_STATUSES = ["attached", "submitted", "submission-requested", "needs-input"] as const;
export type PdfHandoffResult = { status: typeof PDF_HANDOFF_STATUSES[number]; message: string };
export type PdfHandoffDestination = { id: string; title: string; label: string; url: string; fileName: string; submitLabel: string | null; defaultSubmit: boolean; replacesFile: boolean };

export function isPdfPageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
export function safePdfFileName(value: string): string {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").slice(0, 230).trim() || "申込書.pdf";
  return /\.pdf$/iu.test(name) ? name : name + ".pdf";
}
/** Bounded reads are shared by page-origin fetches and permitted extension fetches. */
export async function readPdfResponse(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error("PDFを取得できませんでした。元のページで閲覧できるか確認してください。"); }
  if (Number(response.headers.get("content-length")) > HANDOFF_MAX_BYTES) { await response.body.cancel().catch(() => {}); throw new Error("連携できるPDFは20MBまでです。"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > HANDOFF_MAX_BYTES) throw new Error("連携できるPDFは20MBまでです。");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (bytes.length < 12 || !/^%PDF-(?:1\.[0-9]|2\.0)[\r\n\s]/u.test(new TextDecoder("latin1").decode(bytes.subarray(0, 12))) || !/%%EOF[\x00\t\n\f\r ]*$/u.test(new TextDecoder("latin1").decode(bytes.subarray(-2048)))) throw new Error("取得したファイルはPDFではありません。ログイン画面などに変わっていないか確認してください。");
    return bytes;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function isHandoffId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
}
export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length > HANDOFF_MAX_BYTES) throw new Error("この提出先のPDFは20MB以内にしてください。");
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  return btoa(chunks.join(""));
}
export function base64ToPdfBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(HANDOFF_MAX_BYTES / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new Error("PDFの受け渡しデータを確認できません。");
  const binary = atob(value);
  if (binary.length < 12 || binary.length > HANDOFF_MAX_BYTES || !/^%PDF-(?:1\.[0-9]|2\.0)[\r\n\s]/u.test(binary.slice(0, 12)) || !/%%EOF[\x00\t\n\f\r ]*$/u.test(binary.slice(-2048))) throw new Error("PDFの形式を確認できません。");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
