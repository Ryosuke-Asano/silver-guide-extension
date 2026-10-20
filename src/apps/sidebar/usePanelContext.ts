import { useEffect, useState } from "react";
import { trustedBackgroundSender } from "../../shared/protocol";
import type { PanelContext, PanelContextReply } from "../../shared/v3-protocol";
import type { WebExtensionApi } from "../../shared/webextension";

export type PanelState = {
  context: PanelContext | null;
  loading: boolean;
  message: string | null;
};

const INITIAL_STATE: PanelState = { context: null, loading: true, message: null };
const UNAVAILABLE = "対象ページを確認できませんでした。元のページで拡張アイコンを開き直してください。";

function validContext(value: unknown, windowId: number): value is PanelContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<PanelContext>;
  return context.windowId === windowId &&
    (context.tabId === null || Number.isSafeInteger(context.tabId) && Number(context.tabId) >= 0) &&
    (context.documentToken === null || typeof context.documentToken === "string") &&
    Number.isSafeInteger(context.generation) && Number(context.generation) >= 0 &&
    typeof context.url === "string" && typeof context.title === "string" &&
    ["ready", "empty", "restricted", "too-long"].includes(String(context.status)) &&
    (context.status === "ready"
      ? typeof context.selection === "string" && context.selection.trim().length > 0 && context.selection.length <= 5000 && context.tabId !== null && context.documentToken !== null
      : context.selection === null);
}

/** Each response belongs to this panel's window and to its latest request. */
export function usePanelContext(api: WebExtensionApi | undefined): PanelState {
  const [state, setState] = useState<PanelState>(INITIAL_STATE);

  useEffect(() => {
    if (!api) {
      setState({ context: null, loading: false, message: "ブラウザーの拡張機能として開いてください。" });
      return;
    }
    let disposed = false;
    let windowId: number | null = null;
    let activeTabId: number | null = null;
    let requestGeneration = 0;
    const navigatingTabs = new Set<number>();

    const refresh = (clear = false) => {
      if (disposed || windowId === null) return;
      if (clear) {
        requestGeneration++;
        setState(INITIAL_STATE);
      }
      if (activeTabId !== null && navigatingTabs.has(activeTabId)) return;
      const expectedWindow = windowId;
      const generation = ++requestGeneration;
      void api.runtime.sendMessage({ type: "silver-guide-v3-panel-context", windowId: expectedWindow })
        .then((reply: PanelContextReply | undefined) => {
          if (disposed || generation !== requestGeneration) return;
          if (!reply?.ok || !validContext(reply.context, expectedWindow)) {
            setState({ context: null, loading: false, message: UNAVAILABLE });
            return;
          }
          activeTabId = reply.context.tabId;
          setState({ context: reply.context, loading: false, message: null });
        })
        .catch(() => {
          if (!disposed && generation === requestGeneration) setState({ context: null, loading: false, message: UNAVAILABLE });
        });
    };

    const onActivated = (info: browser.tabs._OnActivatedActiveInfo) => {
      if (info.windowId === windowId) {
        activeTabId = info.tabId;
        refresh(true);
      }
    };
    const onUpdated = (tabId: number, change: browser.tabs._OnUpdatedChangeInfo, tab: browser.tabs.Tab) => {
      if (tab.windowId !== windowId) return;
      if (change.status === "loading" || change.url !== undefined && tab.status === "loading") {
        navigatingTabs.add(tabId);
        if (tab.active || tabId === activeTabId) {
          activeTabId = tabId;
          requestGeneration++;
          setState(INITIAL_STATE);
        }
        return;
      }
      if (change.status === "complete") navigatingTabs.delete(tabId);
      if (!tab.active && tabId !== activeTabId) return;
      if (change.status === "complete" || change.url !== undefined) {
        activeTabId = tabId;
        refresh(true);
      } else if (change.title !== undefined) refresh();
    };
    const onRemoved = (tabId: number) => {
      navigatingTabs.delete(tabId);
      if (tabId === activeTabId) {
        activeTabId = null;
        refresh(true);
      }
    };
    const onMessage = (value: unknown, sender: browser.runtime.MessageSender) => {
      if (!trustedBackgroundSender(sender, api.runtime.getURL(""), api.runtime.id) || !value || typeof value !== "object") return;
      const message = value as Record<string, unknown>;
      if (message.type === "silver-guide-v3-selection-changed" && message.windowId === windowId &&
        (activeTabId === null || message.tabId === activeTabId)) refresh();
    };

    api.tabs.onActivated.addListener(onActivated);
    api.tabs.onUpdated.addListener(onUpdated);
    api.tabs.onRemoved.addListener(onRemoved);
    api.runtime.onMessage.addListener(onMessage);
    void api.windows.getCurrent().then(current => {
      if (disposed) return;
      if (!Number.isSafeInteger(current.id) || Number(current.id) < 0) {
        setState({ context: null, loading: false, message: UNAVAILABLE });
        return;
      }
      windowId = current.id!;
      refresh();
    }).catch(() => {
      if (!disposed) setState({ context: null, loading: false, message: UNAVAILABLE });
    });

    return () => {
      disposed = true;
      requestGeneration++;
      api.tabs.onActivated.removeListener(onActivated);
      api.tabs.onUpdated.removeListener(onUpdated);
      api.tabs.onRemoved.removeListener(onRemoved);
      api.runtime.onMessage.removeListener(onMessage);
    };
  }, [api]);

  return state;
}
