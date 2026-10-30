import { getWebExtensionApi, type WebExtensionApi } from "../shared/webextension";
import { publicHttpUrl, trustedExtensionSender } from "../shared/protocol";
import { assistedDemoUrl } from "../shared/bundled-demo";
import { isPdfPageUrl, isHandoffId, OPEN_PDF_HANDOFF } from "../shared/pdf-handoff";
import { GET_SELECTION, PANEL_CONTEXT, SELECTION_CHANGED, isSelectionSnapshot, type PanelContextReply, type PanelContext } from "../shared/v3-protocol";

function unavailable(windowId: number, tab?: browser.tabs.Tab): PanelContext {
  return { windowId, tabId: tab?.id ?? null, documentToken: null, generation: 0,
    url: publicHttpUrl(tab?.url) ?? "", title: tab?.title?.slice(0, 500) ?? "現在のページ", selection: null, status: "restricted",
    notice: "このページの文章は読み取れません。サイトへのアクセス許可、または対応する通常のウェブページを確認してください。" };
}
export async function resolvePanelContext(api: WebExtensionApi, windowId: number): Promise<PanelContextReply> {
  const pageUrl = (value: unknown) => publicHttpUrl(value) ?? assistedDemoUrl(value, api.runtime.getURL(""));
  const [tab] = await api.tabs.query({ windowId, active: true });
  const url = pageUrl(tab?.url);
  if (tab?.id === undefined || !url || tab.status === "loading") return { ok: true, context: unavailable(windowId, tab) };
  let value: unknown;
  try { value = assistedDemoUrl(url, api.runtime.getURL(""))
    ? await api.runtime.sendMessage({ type: GET_SELECTION, bundledTabId: tab.id })
    : await api.tabs.sendMessage(tab.id, { type: GET_SELECTION }, { frameId: 0 }); }
  catch { return { ok: true, context: unavailable(windowId, tab) }; }
  const [active] = await api.tabs.query({ windowId, active: true });
  if (active?.id !== tab.id || active.status === "loading" || pageUrl(active.url) !== url || !isSelectionSnapshot(value) || pageUrl(value.pageUrl) !== url)
    return { ok: true, context: unavailable(windowId, active) };
  return { ok: true, context: { windowId, tabId: tab.id, url, title: value.title,
    documentToken: value.documentToken, generation: value.generation, selection: value.text, status: value.status,
    ...(value.selectionContext ? { selectionContext: { text: value.selectionContext.text, start: value.selectionContext.start, end: value.selectionContext.end } } : {}),
    ...(value.status === "too-long" ? { notice: "文章が長いため、短い範囲を選んでください。" } : {}) } };
}
export function startBackground(api: WebExtensionApi): void {
  const bundled = api.runtime.getManifest?.().options_ui?.page === "demo/setup.html";
  if (api.sidePanel) void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: !bundled }).catch(() => {});
  api.action.onClicked.addListener(tab => {
    if (bundled && !assistedDemoUrl(tab.url, api.runtime.getURL("")) && !publicHttpUrl(tab.url)) {
      void api.tabs.create({ url: api.runtime.getURL("demo/setup.html") }).catch(() => {});
      return;
    }
    // Open inside the gesture handler, before any asynchronous page work.
    // This also covers a first click before Chrome persists setPanelBehavior.
    if (api.sidePanel && typeof tab.windowId === "number" && Number.isSafeInteger(tab.windowId) && tab.windowId >= 0) void api.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    else if (!api.sidePanel && api.sidebarAction?.open) void api.sidebarAction.open().catch(() => {});
  });
  if (bundled) api.runtime.onInstalled?.addListener(details => {
    if (details.reason === "install") void api.tabs.create({ url: api.runtime.getURL("demo/setup.html") }).catch(() => {});
  });
  api.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== "object") return;
    const value = message as Record<string, unknown>;
    // Packaged demo pages are extension documents, not content scripts. Bind
    // their explicit tab ID to the browser's current tab URL before using it.
    if ([OPEN_PDF_HANDOFF, SELECTION_CHANGED].includes(String(value.type)) && sender.id === api.runtime.id
      && assistedDemoUrl(sender.url, api.runtime.getURL("")) && (sender.frameId === undefined || sender.frameId === 0)
      && Number.isSafeInteger(value.bundledTabId) && Number(value.bundledTabId) >= 0) {
      if (typeof value.documentToken !== "string" || !/^[a-f0-9-]{8,100}$/iu.test(value.documentToken)) return;
      if (value.type === OPEN_PDF_HANDOFF && !isHandoffId(value.requestId) || value.type === SELECTION_CHANGED && !Number.isSafeInteger(value.generation)) return;
      void api.tabs.get(Number(value.bundledTabId)).then(async tab => {
        if (tab.url !== sender.url || !assistedDemoUrl(tab.url, api.runtime.getURL("")) || tab.status === "loading"
          || sender.tab?.id !== undefined && sender.tab.id !== tab.id) { respond({ ok: false }); return; }
        if (value.type === SELECTION_CHANGED) {
          void api.runtime.sendMessage({ type: SELECTION_CHANGED, tabId: tab.id, windowId: tab.windowId,
            documentToken: value.documentToken, generation: value.generation }).catch(() => {});
          respond({ ok: true }); return;
        }
        const fragment = new URLSearchParams({ handoff: String(value.requestId), sourceTab: String(tab.id), document: String(value.documentToken), bundled: "1" });
        const workspace = await api.tabs.create({ url: api.runtime.getURL("workspace.html") + "#" + fragment, windowId: tab.windowId });
        if (api.sidePanel && workspace.id !== undefined) void api.sidePanel.setOptions({ tabId: workspace.id, enabled: false }).catch(() => {});
        respond({ ok: true, tabId: workspace.id });
      }).catch(() => respond({ ok: false }));
      return true;
    }
    if (value.type === OPEN_PDF_HANDOFF && sender.id === api.runtime.id && sender.frameId === 0 && sender.tab?.id !== undefined && isPdfPageUrl(sender.url) && isPdfPageUrl(sender.tab.url) && sender.url === sender.tab.url) {
      if (!isHandoffId(value.requestId) || typeof value.documentToken !== "string" || !/^[a-f0-9-]{8,100}$/iu.test(value.documentToken)) { respond({ ok: false }); return; }
      const fragment = new URLSearchParams({ handoff: value.requestId, sourceTab: String(sender.tab.id), document: value.documentToken });
      void api.tabs.create({ url: api.runtime.getURL("workspace.html") + "#" + fragment, windowId: sender.tab.windowId }).then(tab => {
        if (api.sidePanel && tab.id !== undefined) void api.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => {});
        respond({ ok: true, tabId: tab.id });
      }, () => respond({ ok: false }));
      return true;
    }
    if (value.type === PANEL_CONTEXT && trustedExtensionSender(sender, api.runtime.getURL(""), api.runtime.id, ["sidebar.html"])) {
      if (!Number.isSafeInteger(value.windowId) || Number(value.windowId) < 0) { respond({ ok: false, message: "対象のウィンドウを確認できませんでした。" }); return; }
      void resolvePanelContext(api, Number(value.windowId)).then(respond, () => respond({ ok: false, message: "ページを確認できませんでした。" }));
      return true;
    }
    if (value.type === SELECTION_CHANGED && sender.id === api.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0
      && publicHttpUrl(sender.url) && publicHttpUrl(sender.url) === publicHttpUrl(sender.tab.url)
      && typeof value.documentToken === "string" && value.documentToken.length <= 100 && Number.isSafeInteger(value.generation)) {
      void api.runtime.sendMessage({ type: SELECTION_CHANGED, tabId: sender.tab.id, windowId: sender.tab.windowId,
        documentToken: value.documentToken, generation: value.generation }).catch(() => {});
    }
  });
}
const api = getWebExtensionApi();
if (api) startBackground(api);
