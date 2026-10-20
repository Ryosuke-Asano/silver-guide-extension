import { getWebExtensionApi, type WebExtensionApi } from "../shared/webextension";
import { publicHttpUrl, trustedExtensionSender } from "../shared/protocol";
import { GET_SELECTION, PANEL_CONTEXT, SELECTION_CHANGED, isSelectionSnapshot, type PanelContextReply, type PanelContext } from "../shared/v3-protocol";

function unavailable(windowId: number, tab?: browser.tabs.Tab): PanelContext {
  return { windowId, tabId: tab?.id ?? null, documentToken: null, generation: 0,
    url: publicHttpUrl(tab?.url) ?? "", title: tab?.title?.slice(0, 500) ?? "現在のページ", selection: null, status: "restricted",
    notice: "このページの文章は読み取れません。サイトへのアクセス許可、または対応する通常のウェブページを確認してください。" };
}
export async function resolvePanelContext(api: WebExtensionApi, windowId: number): Promise<PanelContextReply> {
  const [tab] = await api.tabs.query({ windowId, active: true });
  const url = publicHttpUrl(tab?.url);
  if (tab?.id === undefined || !url || tab.status === "loading") return { ok: true, context: unavailable(windowId, tab) };
  let value: unknown;
  try { value = await api.tabs.sendMessage(tab.id, { type: GET_SELECTION }, { frameId: 0 }); }
  catch { return { ok: true, context: unavailable(windowId, tab) }; }
  const [active] = await api.tabs.query({ windowId, active: true });
  if (active?.id !== tab.id || active.status === "loading" || publicHttpUrl(active.url) !== url || !isSelectionSnapshot(value) || publicHttpUrl(value.pageUrl) !== url)
    return { ok: true, context: unavailable(windowId, active) };
  return { ok: true, context: { windowId, tabId: tab.id, url, title: value.title,
    documentToken: value.documentToken, generation: value.generation, selection: value.text, status: value.status,
    ...(value.status === "too-long" ? { notice: "文章が長いため、短い範囲を選んでください。" } : {}) } };
}
export function startBackground(api: WebExtensionApi): void {
  if (api.sidePanel) void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  api.action.onClicked.addListener(tab => {
    // Open inside the gesture handler, before any asynchronous page work.
    // This also covers a first click before Chrome persists setPanelBehavior.
    if (api.sidePanel && typeof tab.windowId === "number" && Number.isSafeInteger(tab.windowId) && tab.windowId >= 0) void api.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    else if (!api.sidePanel && api.sidebarAction?.open) void api.sidebarAction.open().catch(() => {});
  });
  api.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== "object") return;
    const value = message as Record<string, unknown>;
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
