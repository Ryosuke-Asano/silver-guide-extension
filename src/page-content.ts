import { startFormTooltip } from "./features/form-tooltip";
import { startTermPopup } from "./features/term-popup";
import { selectedPublicText } from "./features/selected-text";
import { startPdfHandoff } from "./features/pdf-handoff";
import { getWebExtensionApi } from "./shared/webextension";
import { trustedBackgroundSender } from "./shared/protocol";
import { GET_SELECTION, SELECTION_CHANGED, type SelectionSnapshot } from "./shared/v3-protocol";

declare global { interface Window { __silverGuideV3Stop?: () => void } }

const api = getWebExtensionApi();
if (api && !window.__silverGuideV3Stop && ["http:", "https:"].includes(location.protocol)) {
  const tooltip = startFormTooltip({ document });
  const termPopup = startTermPopup({ document });
  const entropy = new Uint32Array(4);
  crypto.getRandomValues(entropy);
  const documentToken = Array.from(entropy, value => value.toString(16)).join("-");
  const handoff = startPdfHandoff(api, document, documentToken);
  let pageUrl = location.href;
  let generation = 0;
  let last: Pick<SelectionSnapshot, "text" | "status"> = { text: null, status: "empty" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = (): SelectionSnapshot => {
    if (pageUrl !== location.href) { pageUrl = location.href; last = { text: null, status: "empty" }; generation++; }
    const selected = selectedPublicText(document);
    // Keep the last public selection when clicking the native panel collapses it.
    if (selected.status !== "empty" && (selected.text !== last.text || selected.status !== last.status)) {
      last = selected;
      generation++;
    }
    return { documentToken, generation, pageUrl, title: document.title.slice(0, 500), ...last };
  };
  const notify = () => {
    const current = snapshot();
    void api.runtime.sendMessage({ type: SELECTION_CHANGED, documentToken, generation: current.generation }).catch(() => {});
  };
  const changed = () => { clearTimeout(timer); timer = setTimeout(notify, 120); };
  const listener = (message: unknown, sender: browser.runtime.MessageSender, respond: (value: SelectionSnapshot) => void) => {
    if (!trustedBackgroundSender(sender, api.runtime.getURL(""), api.runtime.id)
      || !message || typeof message !== "object" || (message as { type?: unknown }).type !== GET_SELECTION) return;
    respond(snapshot());
  };
  document.addEventListener("selectionchange", changed);
  window.addEventListener("popstate", changed);
  window.addEventListener("hashchange", changed);
  api.runtime.onMessage.addListener(listener);
  const onPageHide = (event: PageTransitionEvent) => {
    // A cached document resumes with the same listeners and form elements.
    if (!event.persisted) stop();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) notify();
  };
  const stop = () => {
    clearTimeout(timer);
    tooltip.stop();
    termPopup.stop();
    handoff.stop();
    document.removeEventListener("selectionchange", changed);
    window.removeEventListener("popstate", changed);
    window.removeEventListener("hashchange", changed);
    api.runtime.onMessage.removeListener(listener);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    delete window.__silverGuideV3Stop;
  };
  window.__silverGuideV3Stop = stop;
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  // Access may have been granted after the panel's first context request.
  notify();
}
