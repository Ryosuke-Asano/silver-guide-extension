// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://example.test/application"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePanelContext, startBackground } from "../../src/background/v3";
import { selectedPublicText } from "../../src/features/selected-text";
import { GET_SELECTION, PANEL_CONTEXT, SELECTION_CHANGED, type SelectionSnapshot } from "../../src/shared/v3-protocol";
import type { WebExtensionApi } from "../../src/shared/webextension";

const EXTENSION_ID = "silver-guide-v3-integration@example.test";
const ROOT = "moz-extension://silver-guide-v3-integration/";
const SOURCE = { id: 7, windowId: 1, active: true, incognito: false, url: "https://example.test/application", title: "架空の申請案内" };
const BACKGROUND = { id: EXTENSION_ID, url: `${ROOT}background.js` };
const SIDEBAR = { id: EXTENSION_ID, url: `${ROOT}sidebar.html` };
type Listener = (value: unknown, sender: any, respond?: (value: unknown) => void) => unknown;

function event() {
  const listeners = new Set<Listener>();
  return { listeners, addListener: vi.fn((listener: Listener) => listeners.add(listener)), removeListener: vi.fn((listener: Listener) => listeners.delete(listener)) };
}
function snapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return { documentToken: "qa-document-a", generation: 1, pageUrl: SOURCE.url, title: SOURCE.title, text: "申請", status: "ready", ...overrides };
}
function mockApi() {
  const api = {
    runtime: { id: EXTENSION_ID, getURL: (path: string) => ROOT + path, onMessage: event(), sendMessage: vi.fn(async (_value: unknown) => undefined) },
    action: { onClicked: event() },
    tabs: { query: vi.fn(async (_query: unknown) => [SOURCE]), sendMessage: vi.fn(async (_tabId: number, _request: unknown, _options: unknown) => snapshot()) }
  };
  return { api, asApi: () => api as unknown as WebExtensionApi, listener: () => [...api.runtime.onMessage.listeners].at(-1)! };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function selectText(node: Node) {
  const range = document.createRange(); range.selectNodeContents(node);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return selection;
}
function protectValues() {
  const reads = vi.fn(() => { throw new Error("Private form value must not be read"); });
  for (const field of document.querySelectorAll("input,textarea,select")) Object.defineProperty(field, "value", { configurable: true, get: reads, set: reads });
  return reads;
}
async function mountContent() {
  const mock = mockApi();
  vi.stubGlobal("browser", mock.api);
  await import("../../src/page-content");
  return { ...mock, read: (): SelectionSnapshot => {
    const respond = vi.fn();
    expect(mock.listener()({ type: GET_SELECTION }, BACKGROUND, respond)).toBeUndefined();
    // Chrome versions before Promise-listener support must receive this reply
    // synchronously through sendResponse, without observing the return value.
    expect(respond).toHaveBeenCalledTimes(1);
    return respond.mock.calls[0][0] as SelectionSnapshot;
  } };
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  document.title = SOURCE.title;
  document.designMode = "off";
  history.replaceState(null, "", SOURCE.url);
  window.getSelection()?.removeAllRanges();
});
afterEach(() => {
  window.__silverGuideV3Stop?.();
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public selection boundary", () => {
  it("rejects a range crossing any form or editable region before reading the selection or field values", () => {
    const editors = [
      '<input value="private value">', '<input type="password" value="private password">',
      '<textarea>private draft</textarea>', '<select><option>private choice</option></select>',
      '<div contenteditable="true">private draft</div>', '<div role="textbox">private draft</div>'
    ];
    for (const editor of editors) {
      document.body.innerHTML = `<p id="start">公開の説明</p>${editor}<p id="end">公開の続き</p>`;
      const range = document.createRange();
      range.setStart(document.getElementById("start")!.firstChild!, 0);
      const end = document.getElementById("end")!.firstChild!;
      range.setEnd(end, end.textContent!.length);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      const values = protectValues();
      const selectedText = vi.spyOn(selection, "toString").mockImplementation(() => { throw new Error("Unsafe range must be rejected before reading"); });
      expect(selectedPublicText(document), editor).toEqual({ text: null, status: "empty" });
      expect(selectedText).not.toHaveBeenCalled();
      expect(values).not.toHaveBeenCalled();
      selectedText.mockRestore();
    }
  });

  it("rejects editable endpoints, an active form editor and document editing mode", () => {
    document.body.innerHTML = '<p id="public">公開の説明</p><div contenteditable="true" id="editor">個人の下書き</div><input id="input" value="private">';
    const values = protectValues();
    selectText(document.getElementById("editor")!);
    expect(selectedPublicText(document)).toEqual({ text: null, status: "empty" });
    document.getElementById("input")!.focus();
    selectText(document.getElementById("public")!);
    expect(selectedPublicText(document)).toEqual({ text: null, status: "empty" });
    (document.activeElement as HTMLElement).blur();
    document.designMode = "on";
    expect(selectedPublicText(document)).toEqual({ text: null, status: "empty" });
    expect(values).not.toHaveBeenCalled();
  });

  it("returns exact public conditions and negation but refuses an overlong range without truncation", () => {
    const original = "本人確認書類がない場合は、6月30日までに申請できません。";
    document.body.innerHTML = '<p id="public"></p>';
    const paragraph = document.getElementById("public")!;
    paragraph.textContent = original;
    selectText(paragraph);
    expect(selectedPublicText(document)).toEqual({ text: original, status: "ready" });
    paragraph.textContent = "あ".repeat(5001) + "ただし、申請できません。";
    selectText(paragraph);
    expect(selectedPublicText(document)).toEqual({ text: null, status: "too-long" });
  });
});

describe("content lifetime and current document", () => {
  it("retains the last public selection while the panel is read, without collecting an editor", async () => {
    document.body.innerHTML = '<p id="public">必要書類</p><input id="input" value="private">';
    const values = protectValues();
    const mock = await mountContent();
    selectText(document.getElementById("public")!);
    const first = await mock.read();
    expect(first).toMatchObject({ text: "必要書類", status: "ready", pageUrl: SOURCE.url });
    window.getSelection()!.removeAllRanges();
    expect(await mock.read()).toEqual(first);
    document.getElementById("input")!.focus();
    expect(await mock.read()).toEqual(first);
    expect(values).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement).blur();
    history.replaceState(null, "", "/new-document");
    const moved = await mock.read();
    expect(moved).toMatchObject({ status: "empty", text: null, pageUrl: "https://example.test/new-document", documentToken: first.documentToken });
    expect(moved.generation).toBeGreaterThan(first.generation);
  });

  it("sends only selection identity in a debounced notification and cleans up on page exit", async () => {
    document.body.innerHTML = '<p id="public">申請できません。</p>';
    const mock = await mountContent();
    expect(mock.api.runtime.sendMessage).toHaveBeenCalledWith({ type: SELECTION_CHANGED, documentToken: expect.any(String), generation: 0 });
    mock.api.runtime.sendMessage.mockClear();
    vi.useFakeTimers();
    selectText(document.getElementById("public")!);
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(121);
    expect(mock.api.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(mock.api.runtime.sendMessage.mock.calls[0][0]).toEqual({ type: SELECTION_CHANGED, documentToken: expect.any(String), generation: 1 });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(mock.api.runtime.onMessage.listeners.size).toBe(0);
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(121);
    expect(mock.api.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps selection and form assistance alive after a persisted pagehide and pageshow", async () => {
    document.body.innerHTML = '<p id="public">必要書類</p><input aria-label="フリガナ" id="kana" value="private">';
    const values = protectValues();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.id === "kana") return { left: 20, right: 300, top: 180, bottom: 222, width: 280, height: 42, x: 20, y: 180, toJSON() {} };
      if (this.hasAttribute("data-silver-guide-form-tooltip")) return { left: 0, right: 260, top: 0, bottom: 82, width: 260, height: 82, x: 0, y: 0, toJSON() {} };
      return originalRect.call(this);
    });
    const mock = await mountContent();
    selectText(document.getElementById("public")!);
    const first = await mock.read();
    const field = document.getElementById("kana")!;
    field.focus();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-silver-guide-form-tooltip]")?.dataset.placement).toBe("top"));
    const stop = window.__silverGuideV3Stop;
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(window.__silverGuideV3Stop).toBe(stop);
    expect(mock.api.runtime.onMessage.listeners.size).toBe(2);
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    field.blur();
    field.focus();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("[data-silver-guide-form-tooltip]")?.dataset.placement).toBe("top"));
    field.blur();
    document.getElementById("public")!.textContent = "本人確認";
    selectText(document.getElementById("public")!);
    const restored = await mock.read();
    expect(restored).toMatchObject({ text: "本人確認", status: "ready", documentToken: first.documentToken });
    expect(restored.generation).toBeGreaterThan(first.generation);
    expect(values).not.toHaveBeenCalled();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(window.__silverGuideV3Stop).toBeUndefined();
    expect(mock.api.runtime.onMessage.listeners.size).toBe(0);
    expect(document.querySelector("[data-silver-guide-form-tooltip]")).toBeNull();
  });

  it("does not expose selected text to foreign senders, page senders or legacy v2 requests", async () => {
    document.body.innerHTML = '<p id="public">公開の選択</p>';
    const mock = await mountContent();
    selectText(document.getElementById("public")!);
    const request = { type: GET_SELECTION };
    const respond = vi.fn();
    expect(mock.listener()(request, { ...BACKGROUND, id: "foreign@example.test" }, respond)).toBeUndefined();
    expect(mock.listener()(request, { ...BACKGROUND, tab: SOURCE }, respond)).toBeUndefined();
    expect(mock.listener()({ type: "silver-guide-v2-content", command: "capture" }, BACKGROUND, respond)).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
    expect(mock.read()).toMatchObject({ text: "公開の選択" });
  });
});

describe("background context integrity", () => {
  it("opens Chromium's native panel within the first click even while panel behavior setup is pending", async () => {
    const mock = mockApi();
    const setup = deferred<void>();
    let insideGesture = false;
    const sidePanel = {
      setPanelBehavior: vi.fn(() => setup.promise),
      open: vi.fn((_options: { windowId: number }) => {
        expect(insideGesture).toBe(true);
        return Promise.resolve();
      })
    };
    startBackground({ ...mock.api, sidePanel } as unknown as WebExtensionApi);
    expect(sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    const click = [...mock.api.action.onClicked.listeners][0];
    insideGesture = true;
    click({ ...SOURCE, windowId: 0 }, undefined);
    insideGesture = false;
    // No microtask or settings completion has run yet: the user gesture is live.
    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: 0 });
    expect(mock.api.tabs.query).not.toHaveBeenCalled();
    setup.resolve();
    await setup.promise;
    expect(sidePanel.open).toHaveBeenCalledTimes(1);
  });

  it("opens Firefox's native sidebar synchronously without requiring a clicked tab window ID", () => {
    const mock = mockApi();
    let insideGesture = false;
    const sidebarAction = { open: vi.fn(() => {
      expect(insideGesture).toBe(true);
      return Promise.resolve();
    }) };
    startBackground({ ...mock.api, sidebarAction } as unknown as WebExtensionApi);
    insideGesture = true;
    [...mock.api.action.onClicked.listeners][0]({ id: SOURCE.id }, undefined);
    insideGesture = false;
    expect(sidebarAction.open).toHaveBeenCalledExactlyOnceWith();
    expect(mock.api.tabs.query).not.toHaveBeenCalled();
  });

  it("resolves the sidebar's requested window and preserves the content document identity", async () => {
    const mock = mockApi();
    startBackground(mock.asApi());
    const respond = vi.fn();
    expect(mock.listener()({ type: PANEL_CONTEXT, windowId: 1 }, SIDEBAR, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond).toHaveBeenCalledWith({ ok: true, context: {
      windowId: 1, tabId: 7, url: SOURCE.url, title: SOURCE.title,
      documentToken: "qa-document-a", generation: 1, selection: "申請", status: "ready"
    } });
    expect(mock.api.tabs.query.mock.calls).toEqual([[{ windowId: 1, active: true }], [{ windowId: 1, active: true }]]);
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledWith(7, { type: GET_SELECTION }, { frameId: 0 });
  });

  it("discards a source response if the active tab or its URL changes during the await", async () => {
    for (const moved of [{ ...SOURCE, id: 8 }, { ...SOURCE, url: "https://example.test/other" }]) {
      const mock = mockApi();
      const waiting = deferred<SelectionSnapshot>();
      mock.api.tabs.query.mockResolvedValueOnce([SOURCE]).mockResolvedValueOnce([moved]);
      mock.api.tabs.sendMessage.mockImplementationOnce(() => waiting.promise);
      const reply = resolvePanelContext(mock.asApi(), 1);
      await vi.waitFor(() => expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(1));
      waiting.resolve(snapshot());
      expect(await reply).toMatchObject({ ok: true, context: { tabId: moved.id, selection: null, status: "restricted" } });
    }
  });

  it("does not read an already loading document or accept a reply after a same-URL reload begins", async () => {
    const initial = mockApi();
    initial.api.tabs.query.mockResolvedValueOnce([{ ...SOURCE, status: "loading" }]);
    expect(await resolvePanelContext(initial.asApi(), 1)).toMatchObject({ ok: true, context: { selection: null, status: "restricted" } });
    expect(initial.api.tabs.sendMessage).not.toHaveBeenCalled();
    const reloading = mockApi();
    const waiting = deferred<SelectionSnapshot>();
    reloading.api.tabs.query.mockResolvedValueOnce([SOURCE]).mockResolvedValueOnce([{ ...SOURCE, status: "loading" }]);
    reloading.api.tabs.sendMessage.mockImplementationOnce(() => waiting.promise);
    const reply = resolvePanelContext(reloading.asApi(), 1);
    await vi.waitFor(() => expect(reloading.api.tabs.sendMessage).toHaveBeenCalledTimes(1));
    waiting.resolve(snapshot());
    expect(await reply).toMatchObject({ ok: true, context: { selection: null, status: "restricted" } });
  });

  it("does not accept a stale content URL or a truncated ready payload, and distinguishes a long selection", async () => {
    const mock = mockApi();
    for (const invalid of [snapshot({ pageUrl: "https://example.test/old" }), snapshot({ text: "あ".repeat(5001) })]) {
      mock.api.tabs.sendMessage.mockResolvedValueOnce(invalid);
      expect(await resolvePanelContext(mock.asApi(), 1)).toMatchObject({ ok: true, context: { selection: null, status: "restricted" } });
    }
    mock.api.tabs.sendMessage.mockResolvedValueOnce(snapshot({ text: null, status: "too-long" }));
    expect(await resolvePanelContext(mock.asApi(), 1)).toMatchObject({ ok: true, context: { selection: null, status: "too-long", documentToken: "qa-document-a" } });
  });

  it("rejects foreign pages, foreign extensions and removed v2 entry points without touching a tab", () => {
    const mock = mockApi();
    startBackground(mock.asApi());
    const respond = vi.fn();
    const request = { type: PANEL_CONTEXT, windowId: 1 };
    expect(mock.listener()(request, { ...SIDEBAR, id: "foreign@example.test" }, respond)).toBeUndefined();
    expect(mock.listener()(request, { ...SIDEBAR, url: "https://example.test/sidebar.html" }, respond)).toBeUndefined();
    expect(mock.listener()(request, { ...SIDEBAR, url: `${ROOT}workspace.html` }, respond)).toBeUndefined();
    for (const type of ["silver-guide-v2-open", "silver-guide-v2-page", "silver-guide-v2-explain", "silver-guide-enable"])
      expect(mock.listener()({ type, command: "apply", view: "drafts", windowId: 1 }, SIDEBAR, respond)).toBeUndefined();
    expect(respond).not.toHaveBeenCalled();
    expect(mock.api.tabs.query).not.toHaveBeenCalled();
    expect(mock.api.tabs.sendMessage).not.toHaveBeenCalled();
    expect(mock.api.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("relays only top-frame notifications bound to their actual sender tab and URL", async () => {
    const mock = mockApi();
    startBackground(mock.asApi());
    const changed = { type: SELECTION_CHANGED, documentToken: "qa-document-a", generation: 4, tabId: 99, windowId: 99, text: "must not relay" };
    const sender = { id: EXTENSION_ID, frameId: 0, url: SOURCE.url, tab: SOURCE };
    mock.listener()(changed, sender, vi.fn());
    expect(mock.api.runtime.sendMessage).toHaveBeenCalledWith({ type: SELECTION_CHANGED, tabId: SOURCE.id, windowId: SOURCE.windowId, documentToken: "qa-document-a", generation: 4 });
    mock.api.runtime.sendMessage.mockClear();
    for (const invalid of [{ ...sender, frameId: 1 }, { ...sender, id: "foreign@example.test" }, { ...sender, url: "https://example.test/old" }]) mock.listener()(changed, invalid, vi.fn());
    expect(mock.api.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
