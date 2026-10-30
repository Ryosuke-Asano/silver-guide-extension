import type { WebExtensionApi } from "../shared/webextension";
import { trustedExtensionSender } from "../shared/protocol";
import { base64ToPdfBytes, bytesToBase64, HANDOFF_MAX_BYTES, isHandoffId, isPdfPageUrl, isPdfHandoffTimings, OPEN_PDF_HANDOFF, PDF_HANDOFF_REQUEST, PDF_HANDOFF_TIMING_EVENT, readPdfResponse, safePdfFileName, type PdfHandoffDestination, type PdfHandoffResult } from "../shared/pdf-handoff";
import { fieldLabel, PDF_ENTRY_HOST, pdfSource, pdfTargets, type PdfSource } from "./pdf/detection";
import { sameSubmissionPlan, submissionPlan, submitAttachedPdf, type SubmissionPlan } from "./pdf/submission";

type Target = { id: string; input: HTMLInputElement; form: HTMLFormElement | null; plan: SubmissionPlan | null; accept: string; multiple: boolean; files: string };
type Pending = { id: string; source: PdfSource; pageUrl: string; targets: Target[]; selected: Target | null; accepted: boolean; submit: boolean; clientId: string | null; workspaceTab: number | null; delivering: boolean; result?: PdfHandoffResult };
const fileSignature = (input: HTMLInputElement) => [...input.files ?? []].map(file => `${file.name}/${file.size}/${file.lastModified}`).join("\n");
const STYLE = `:host{display:inline-block!important;margin:6px 8px!important;max-width:100%;vertical-align:middle}button{box-sizing:border-box;max-width:100%;padding:7px 12px;border:1px solid #078196;border-radius:5px;color:#fff;background:#078196;font:600 15px/1.5 system-ui,sans-serif;cursor:pointer}button:focus-visible{outline:3px solid #102c46;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}p{max-width:34em;margin:5px 0;color:#8f201a;font:14px/1.5 system-ui,sans-serif}p:empty{display:none}@media(forced-colors:active){button{color:ButtonText;background:ButtonFace;border-color:ButtonText}}`;

/** Detects ordinary web PDF sources. No website message bridge or page IDs. */
export function startPdfHandoff(api: WebExtensionApi, doc: Document, documentToken: string, bundledTabId?: number): { stop(): void } {
  const view = doc.defaultView;
  if (!view || !isPdfPageUrl(doc.location.href, api.runtime.getURL(""))) return { stop() {} };
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const entries = new Map<Element, { host: HTMLElement; signature: string }>(), pending = new Map<string, Pending>();
  const live = (item: Pending) => !stopped && pending.get(item.id) === item && doc.location.href === item.pageUrl;
  const targetLive = (target: Target) => target.input.isConnected && target.input.ownerDocument === doc && !target.input.disabled && !target.input.matches(":disabled") && !target.input.closest('[inert],[aria-disabled="true"]') && target.input.form === target.form && target.input.accept === target.accept && target.input.multiple === target.multiple && fileSignature(target.input) === target.files;
  const describe = (target: Target, fileName: string): PdfHandoffDestination => ({ id: target.id, title: doc.title.slice(0, 200), label: fieldLabel(target.input), url: bundledTabId === undefined ? doc.location.origin + doc.location.pathname : doc.location.href, fileName, submitLabel: target.plan?.label ?? null, defaultSubmit: target.plan?.defaultSubmit ?? false, replacesFile: !!target.files && !target.multiple });
  const readSource = async (item: Pending) => {
    if (item.source.file) {
      if (item.source.file.size > HANDOFF_MAX_BYTES) throw new Error("連携できるPDFは20MBまでです。");
      const bytes = new Uint8Array(await item.source.file.arrayBuffer());
      const pdf = bytesToBase64(bytes); bytes.fill(0); base64ToPdfBytes(pdf).fill(0); return { pdf };
    }
    const url = item.source.url!;
    if (!item.source.element.isConnected || pdfSource(item.source.element)?.signature !== item.source.signature) throw new Error("元のPDFリンクが変わりました。元のページから開き直してください。");
    // Same-origin requests keep the page's authenticated session. Cross-origin
    // fetches run only in the authenticated extension workspace with host access.
    if (new URL(url).origin !== doc.location.origin) return { sourceUrl: url };
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const bytes = await readPdfResponse(await fetch(url, { credentials: "include", redirect: "error", signal: controller.signal }));
      const pdf = bytesToBase64(bytes); bytes.fill(0); return { pdf };
    } catch (error) {
      if (new URL(url).protocol === "blob:") throw error;
      return { sourceUrl: url };
    } finally { clearTimeout(timeout); }
  };
  const openSource = async (source: PdfSource) => {
    const targets = pdfTargets(doc, source).map(input => ({ id: crypto.randomUUID(), input, form: input.form, plan: submissionPlan(input), accept: input.accept, multiple: input.multiple, files: fileSignature(input) }));
    const sourceForm = source.element.tagName === "INPUT" ? (source.element as HTMLInputElement).form : source.element.closest("form");
    const selected = targets.length === 1 && (!sourceForm || sourceForm === targets[0].form) && (!targets[0].files || source.file && source.element === targets[0].input) ? targets[0] : null;
    const item: Pending = { id: crypto.randomUUID(), source, pageUrl: doc.location.href, targets, selected, accepted: false, submit: selected?.plan?.defaultSubmit ?? false, clientId: null, workspaceTab: null, delivering: false };
    // Keep independent sources usable, without an unbounded queue of PDFs.
    for (const [id, old] of pending) if (old.source.element === source.element) pending.delete(id);
    if (pending.size >= 4) pending.delete(pending.keys().next().value!);
    pending.set(item.id, item);
    try {
      const reply = await api.runtime.sendMessage({ type: OPEN_PDF_HANDOFF, requestId: item.id, documentToken,
        ...(bundledTabId === undefined ? {} : { bundledTabId }) });
      if (!live(item)) return;
      if (!reply?.ok || !Number.isSafeInteger(reply.tabId)) throw new Error("Silver Guideの記入画面を開けませんでした。");
      if (item.workspaceTab !== null && item.workspaceTab !== reply.tabId) throw new Error("記入画面との接続が変わりました。");
      item.workspaceTab = reply.tabId;
    } catch (error) { pending.delete(item.id); throw error; }
  };
  const scan = () => {
    clearTimeout(timer); timer = undefined; if (stopped) return;
    const sources = new Map<Element, PdfSource>();
    for (const element of doc.querySelectorAll('a[href],object[data],embed[src],iframe[src],input[type="file"]')) {
      if (sources.size >= 100) break;
      const source = pdfSource(element); if (source) sources.set(element, source);
    }
    for (const [element, entry] of entries) {
      if (!sources.has(element) || entry.signature !== sources.get(element)!.signature || !entry.host.isConnected) { entry.host.remove(); entries.delete(element); }
    }
    for (const [element, source] of sources) {
      if (entries.has(element)) continue;
      const host = doc.createElement("span"); host.setAttribute(PDF_ENTRY_HOST, "");
      const shadow = host.attachShadow({ mode: "open" }), style = doc.createElement("style"), button = doc.createElement("button"), status = doc.createElement("p");
      style.textContent = STYLE; button.type = "button"; button.textContent = source.file ? "選択したPDFに記入" : "Silver Guideで記入";
      button.setAttribute("aria-label", `${button.textContent}：${source.fileName}`); status.setAttribute("role", "alert");
      button.addEventListener("click", event => {
        event.preventDefault(); event.stopPropagation(); if (button.disabled) return;
        button.disabled = true; status.textContent = "";
        void openSource(source).catch(error => { status.textContent = error instanceof Error ? error.message : "PDFを開けませんでした。"; }).finally(() => { button.disabled = false; });
      });
      // A control inside the file input's label can activate the native picker
      // through shadow-event retargeting. Keep our action outside that label.
      shadow.append(style, button, status); (element.closest("label") ?? element).after(host); entries.set(element, { host, signature: source.signature });
    }
  };
  const schedule = () => { if (timer === undefined) timer = setTimeout(scan, 80); };
  const changed = (event: Event) => {
    for (const [id, item] of pending) if (!item.delivering && (item.selected?.input === event.target || item.source.element === event.target)) pending.delete(id);
    schedule();
  };
  const reset = (event: Event) => {
    const form = event.target;
    if (!(form instanceof view.HTMLFormElement)) return;
    // Native reset does not emit a file change. A workspace opened before the
    // reset must never submit its previous answers into the next form attempt.
    for (const [id, item] of pending) {
      const sourceForm = item.source.element.tagName === "INPUT" ? (item.source.element as HTMLInputElement).form : item.source.element.closest("form");
      if (sourceForm === form || item.targets.some(target => target.form === form)) pending.delete(id);
    }
    schedule();
  };
  const observer = new view.MutationObserver(records => {
    if (records.some(record => !(record.target.nodeType === 1 ? record.target as Element : record.target.parentElement)?.closest(`[${PDF_ENTRY_HOST}]`))) schedule();
  });
  const listener = (message: unknown, sender: browser.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (!message || typeof message !== "object" || !trustedExtensionSender(sender, api.runtime.getURL(""), api.runtime.id, ["workspace.html"])) return;
    const value = message as Record<string, unknown>;
    if (value.type !== PDF_HANDOFF_REQUEST) return;
    // Extension pages share runtime messages. Only the addressed demo tab may
    // answer; an unrelated tab must never win sendResponse's first-reply race.
    if (bundledTabId !== undefined && value.bundledTabId !== bundledTabId) return;
    const item = pending.get(String(value.requestId)), address = new URLSearchParams(new URL(sender.url!).hash.slice(1));
    if (bundledTabId !== undefined && (address.get("sourceTab") !== String(bundledTabId) || address.get("bundled") !== "1")) return;
    if (!item || !live(item) || value.documentToken !== documentToken || address.get("handoff") !== item.id || address.get("document") !== documentToken || !isHandoffId(value.clientId) || item.clientId !== null && item.clientId !== value.clientId || sender.tab?.id !== undefined && item.workspaceTab !== null && item.workspaceTab !== sender.tab.id) { respond({ ok: false, message: "元のページとの接続が変わりました。PDFから開き直してください。" }); return; }
    if (item.clientId === null && value.action !== "get") { respond({ ok: false, message: "先に元のPDFを確認してください。" }); return; }
    item.clientId = value.clientId; if (sender.tab?.id !== undefined) item.workspaceTab = sender.tab.id;
    if (value.action === "get") {
      if (item.result) { respond({ ok: false, message: "この記入は完了しています。元のページからPDFを開き直してください。" }); return; }
      void readSource(item).then(data => {
        if (!live(item)) throw new Error("元のページが変わりました。");
        respond({ ok: true, ...data, sourceOrigin: doc.location.origin, fileName: item.source.fileName, destinations: item.targets.filter(targetLive).map(target => describe(target, item.source.fileName)), destination: item.selected && targetLive(item.selected) ? describe(item.selected, item.source.fileName) : null, directEntry: !!item.selected || !item.targets.length });
      }).catch(error => respond({ ok: false, message: error instanceof Error ? error.message : "PDFを読み込めませんでした。" }));
      return true;
    }
    if (value.action === "accept") {
      const target = item.targets.find(target => target.id === value.destinationId);
      if (!target || !targetLive(target)) { respond({ ok: false, message: "添付先の欄が変わりました。元のページから開き直してください。" }); return; }
      item.selected = target; item.accepted = true; respond({ ok: true }); return;
    }
    if (value.action !== "deliver") return;
    if (!item.accepted || !item.selected) { respond({ ok: false, message: "先に添付先を選んでください。" }); return; }
    if (item.result) { respond({ ok: true, result: item.result }); return; }
    const target = item.selected;
    if (!targetLive(target) || !sameSubmissionPlan(target.plan, target.input)) { respond({ ok: false, message: "添付欄・選択済みファイル・送信先が変わりました。回答は残っています。" }); return; }
    if (item.delivering) { respond({ ok: false, message: "PDFを添付しています。" }); return; }
    item.delivering = true;
    void (async () => {
      const bytes = base64ToPdfBytes(value.pdf), file = new File([bytes.slice().buffer], safePdfFileName(typeof value.fileName === "string" ? value.fileName : "記入済み.pdf"), { type: "application/pdf" }); bytes.fill(0);
      const transfer = new DataTransfer();
      // An opt-in collector may observe numeric durations, never PDF answers.
      // JSON detail also crosses Firefox's isolated content-script boundary.
      if (doc.documentElement.hasAttribute("data-silver-guide-measure") && isPdfHandoffTimings(value.timings))
        doc.dispatchEvent(new CustomEvent(PDF_HANDOFF_TIMING_EVENT, { detail: JSON.stringify({ id: item.id, sourceMs: value.timings.sourceMs, prepareMs: value.timings.prepareMs, outputMs: value.timings.outputMs }) }));
      if (target.multiple) for (const old of target.input.files ?? []) if (old !== item.source.file) transfer.items.add(old);
      transfer.items.add(file); target.input.files = transfer.files; target.files = fileSignature(target.input);
      if (![...target.input.files ?? []].some(current => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified)) throw new Error("サイトの添付欄へPDFを設定できませんでした。回答は残っています。");
      target.input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      target.input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      if (!live(item) || !targetLive(target)) throw new Error("サイトが添付欄を変更しました。元のページを確認してください。PDFの回答は残っています。");
      const result = await submitAttachedPdf(target.input, target.plan, value.submit === true, () => live(item) && targetLive(target));
      item.result = result; item.source.file = null;
      respond({ ok: true, result });
    })().catch(error => respond({ ok: false, message: error instanceof Error ? error.message : "PDFを添付できませんでした。" })).finally(() => { item.delivering = false; });
    return true;
  };
  api.runtime.onMessage.addListener(listener);
  doc.addEventListener("change", changed, true);
  doc.addEventListener("reset", reset, true);
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src", "data", "type", "accept", "download", "hidden", "inert", "disabled", "class", "style", "multiple"] });
  scan();
  return { stop() { stopped = true; clearTimeout(timer); observer.disconnect(); doc.removeEventListener("change", changed, true); doc.removeEventListener("reset", reset, true); api.runtime.onMessage.removeListener(listener); for (const entry of entries.values()) entry.host.remove(); entries.clear(); pending.clear(); } };
}
