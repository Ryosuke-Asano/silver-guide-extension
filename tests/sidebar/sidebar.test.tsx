// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarApp, SidebarView } from "../../src/apps/sidebar/SidebarApp";
import type { PanelContext } from "../../src/shared/v3-protocol";
import type { WebExtensionApi } from "../../src/shared/webextension";

const EXTENSION_ID = "silver-guide-sidebar-test@example.test";
const EXTENSION_ROOT = "moz-extension://sidebar-test/";
const BACKGROUND = { id: EXTENSION_ID, url: `${EXTENSION_ROOT}background.js` };
let container: HTMLDivElement;
let root: Root;

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return { listeners, addListener: vi.fn((listener: (...args: any[]) => void) => listeners.add(listener)), removeListener: vi.fn((listener: (...args: any[]) => void) => listeners.delete(listener)), emit: (...args: any[]) => { for (const listener of listeners) listener(...args); } };
}

function context(overrides: Partial<PanelContext> = {}): PanelContext {
  return { tabId: 7, windowId: 1, documentToken: "document-a", generation: 1, url: "https://example.test/application", title: "架空の申請案内", selection: "支給要件", status: "ready", ...overrides };
}

function mockApi() {
  const runtime = { id: EXTENSION_ID, getURL: (path: string) => EXTENSION_ROOT + path, onMessage: event(), sendMessage: vi.fn(async (_request: unknown) => ({ ok: true, context: context() })) };
  const tabs = { onActivated: event(), onUpdated: event(), onRemoved: event(), create: vi.fn(async (_details: unknown) => ({ id: 19 })) };
  const windows = { getCurrent: vi.fn(async () => ({ id: 1 })) };
  return { runtime, tabs, windows, asApi: () => ({ runtime, tabs, windows } as unknown as WebExtensionApi) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderView(value: PanelContext) {
  await act(async () => root.render(<SidebarView state={{ context: value, loading: false, message: null }} pdfHref={`${EXTENSION_ROOT}workspace.html`} />));
}

describe("simple, source-preserving explanation panel", () => {
  it("shows the instruction before word definitions and retains an expandable, exact original", async () => {
    const original = "PDFをダウンロードし、氏名・フリガナ・電話番号などを記入してください。";
    await renderView(context({ selection: original }));
    const organization = container.querySelector(".sidebar-organization")!, words = container.querySelector<HTMLDetailsElement>(".sidebar-terms")!;
    expect(organization.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(words.open).toBe(false);
    expect(container.querySelector("h1")!.textContent).toBe("文章の説明");
    expect(container.querySelector("dt")!.textContent).toBe("やること");
    expect(container.querySelector("dd")!.textContent).toBe(original);
    expect(container.querySelector(".sidebar-term-original")!.textContent).toBe("PDF");
    expect(container.querySelector(".sidebar-term p")!.textContent).toContain("画面や印刷で書類の形を保ちやすいファイル形式");
    expect(container.querySelector("blockquote")!.textContent).toBe(original);
    expect(container.querySelector<HTMLDetailsElement>(".sidebar-original-details")!.open).toBe(false);
  });
  it("asks for a complete sentence when only an ending and a known word were selected", async () => {
    const original = "してください。申込書";
    await renderView(context({ selection: original }));
    expect(container.querySelector("h1")!.textContent).toBe("前後の文も選んでください");
    expect(container.textContent).toContain("文の途中だけでは、何をするか説明できません。");
    expect(container.querySelector(".sidebar-organization")).toBeNull();
    expect(container.querySelector<HTMLDetailsElement>(".sidebar-terms")!.open).toBe(false);
    expect(container.querySelector(".sidebar-term-original")!.textContent).toBe("申込書");
    expect(container.querySelector(".sidebar-original-details")).toBeNull();
    expect(container.querySelector("blockquote")!.textContent).toBe(original);
    expect(container.textContent).not.toContain("一部を整理しました");
  });
  it("does not claim an unexplained bare ending is an instruction", async () => {
    await renderView(context({ selection: "してください。" }));
    expect(container.querySelector("h1")!.textContent).toBe("前後の文も選んでください");
    expect(container.querySelector(".sidebar-organization")).toBeNull();
    expect(container.querySelector("blockquote")!.textContent).toBe("してください。");
    expect(container.textContent).not.toContain("説明は見つかりません");
  });
  it.each([
    ["原本に記入しないでください。", "してはいけないこと"],
    ["書類を提出する必要はありません。", "しなくてよいこと"],
  ])("distinguishes prohibited and unnecessary actions: %s", async (selection, label) => {
    await renderView(context({ selection }));
    expect(container.querySelector("dt")!.textContent).toBe(label);
    expect(container.querySelector("dd")!.textContent).toBe(selection);
  });
  it("resets expanded details when the selected text changes", async () => {
    await renderView(context({ selection: "氏名を記入してください。" }));
    container.querySelector<HTMLDetailsElement>(".sidebar-terms")!.open = true;
    await renderView(context({ generation: 2, selection: "PDFを保存してください。" }));
    expect(container.querySelector<HTMLDetailsElement>(".sidebar-terms")!.open).toBe(false);
    expect(container.querySelector("blockquote")!.textContent).toBe("PDFを保存してください。");
    expect(container.querySelector(".sidebar-term-original")!.textContent).toBe("PDF");
  });
  it("explains a known term without an input, start button or close button", async () => {
    await renderView(context());
    expect(container.querySelector("blockquote")!.textContent).toBe("支給要件");
    expect(container.querySelector("h1")!.textContent).toBe("支給要件");
    expect(container.textContent).toContain("給付金などを受け取るために、満たす必要がある条件です。");
    expect(container.querySelector<HTMLDetailsElement>(".sidebar-original-details")!.open).toBe(false);
    expect(container.querySelectorAll("button,input,textarea,select")).toHaveLength(0);
    const tools = container.querySelector<HTMLDetailsElement>(".sidebar-tools")!;
    expect(tools.open).toBe(false);
    await act(async () => tools.querySelector("summary")!.click());
    expect(tools.open).toBe(true);
    expect([...container.querySelectorAll("a")].map(link => link.textContent)).toEqual(["PDFを開く↗"]);
  });

  it("shows a term and its full definition without repeated headings or the page title", async () => {
    const original = "在住：横浜市に住んでいる方";
    const definition = "その地域に住んでいることです。勤務先や学校の所在地とは区別します。";
    await renderView(context({ selection: original, title: "利用者情報仮登録｜横浜市立図書館・検証用モック" }));
    expect([...container.querySelectorAll("h1,h2,h3")].map(heading => heading.textContent)).toEqual(["在住"]);
    expect(container.querySelector(".sidebar-explanation")!.textContent).toBe(`在住${definition}`);
    expect(container.textContent).not.toContain("Silver Guide");
    expect(container.textContent).not.toContain("検証用モック");
    expect(container.textContent).not.toContain("別の言葉や文章を選ぶと");
    expect(container.querySelector("blockquote")!.textContent).toBe(original);
    const source = container.querySelector<HTMLDetailsElement>(".sidebar-original-details")!;
    expect(source.open).toBe(false);
    await act(async () => source.querySelector("summary")!.click());
    expect(source.open).toBe(true);
    await renderView(context({ generation: 2, selection: "フリガナ" }));
    expect(container.querySelector<HTMLDetailsElement>(".sidebar-original-details")!.open).toBe(false);
  });

  it("explains furigana without imposing a character format on the original form", async () => {
    await renderView(context({ selection: "フリガナ" }));
    expect(container.querySelector("blockquote")!.textContent).toBe("フリガナ");
    expect(container.textContent).toContain("名前などの読み方");
    expect(container.textContent).toContain("元のページの案内を確認してください");
    expect(container.textContent).not.toContain("カタカナで入力します");
  });

  it("retains every original number, condition and negation while identifying partial assistance", async () => {
    const original = "本人確認書類がない場合は、6月30日までに申請できません。";
    await renderView(context({ selection: original }));
    expect(container.querySelector("blockquote")!.textContent).toBe(original);
    expect(container.textContent).toContain("一部を整理しました");
    expect(container.textContent).toContain("申請できません");
    expect(container.textContent).toContain("6月30日");
    expect(container.textContent).not.toContain("原文に沿って整理しました");
  });

  it("keeps unsupported text as original rather than manufacturing an explanation", async () => {
    const original = "青い机の左側に紙があります。";
    await renderView(context({ selection: original }));
    expect(container.querySelector("blockquote")!.textContent).toBe(original);
    expect(container.textContent).toContain("説明は見つかりません");
    expect(container.querySelector(".sidebar-term")).toBeNull();
    expect(container.querySelector(".sidebar-organization")).toBeNull();
  });

  it("asks for a new selection on an overlong range without presenting a truncated original", async () => {
    await renderView(context({ selection: null, status: "too-long" }));
    expect(container.textContent).toContain("短い範囲を選んでください");
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("window and document-safe panel lifecycle", () => {
  it("discards a slow A response after a newer B selection arrives", async () => {
    const api = mockApi();
    const first = deferred<{ ok: boolean; context: PanelContext }>();
    const next = deferred<{ ok: boolean; context: PanelContext }>();
    api.runtime.sendMessage.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => next.promise);
    await act(async () => root.render(<SidebarApp api={api.asApi()} />));
    await act(async () => api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 1, documentToken: "document-a", generation: 2 }, BACKGROUND));
    await act(async () => next.resolve({ ok: true, context: context({ generation: 2, selection: "必要書類" }) }));
    expect(container.querySelector("blockquote")!.textContent).toBe("必要書類");
    await act(async () => first.resolve({ ok: true, context: context({ selection: "支給要件" }) }));
    expect(container.querySelector("blockquote")!.textContent).toBe("必要書類");
  });

  it("clears the previous original as soon as this window changes tabs or navigates", async () => {
    const api = mockApi();
    await act(async () => root.render(<SidebarApp api={api.asApi()} />));
    expect(container.querySelector("blockquote")!.textContent).toBe("支給要件");
    const switched = deferred<{ ok: boolean; context: PanelContext }>();
    api.runtime.sendMessage.mockImplementationOnce(() => switched.promise);
    await act(async () => api.tabs.onActivated.emit({ tabId: 8, windowId: 1 }));
    expect(container.querySelector("blockquote")).toBeNull();
    await act(async () => switched.resolve({ ok: true, context: context({ tabId: 8, documentToken: "document-b", selection: "必要書類" }) }));
    expect(container.querySelector("blockquote")!.textContent).toBe("必要書類");
    const navigated = deferred<{ ok: boolean; context: PanelContext }>();
    api.runtime.sendMessage.mockImplementationOnce(() => navigated.promise);
    await act(async () => api.tabs.onUpdated.emit(8, { status: "loading", url: "https://example.test/another" }, { id: 8, active: true, windowId: 1 }));
    expect(container.querySelector("blockquote")).toBeNull();
    await act(async () => api.tabs.onUpdated.emit(8, { status: "complete" }, { id: 8, active: true, windowId: 1, status: "complete" }));
    await act(async () => navigated.resolve({ ok: true, context: context({ tabId: 8, documentToken: "document-c", selection: null, status: "empty" }) }));
    expect(container.textContent).toContain("説明したい言葉や文章を選んでください");
    expect(container.textContent).not.toContain("必要書類");
  });

  it("invalidates old responses on a same-URL reload and waits for completion before querying again", async () => {
    const api = mockApi();
    await act(async () => root.render(<SidebarApp api={api.asApi()} />));
    const stale = deferred<{ ok: boolean; context: PanelContext }>();
    api.runtime.sendMessage.mockImplementationOnce(() => stale.promise);
    await act(async () => api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 1 }, BACKGROUND));
    const requestsBeforeReload = api.runtime.sendMessage.mock.calls.length;
    await act(async () => api.tabs.onUpdated.emit(7, { status: "loading" }, { id: 7, active: true, windowId: 1, status: "loading", url: "https://example.test/application" }));
    expect(container.querySelector("blockquote")).toBeNull();
    await act(async () => stale.resolve({ ok: true, context: context({ selection: "古い文書の選択" }) }));
    await act(async () => {
      api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 1 }, BACKGROUND);
      api.tabs.onUpdated.emit(7, { title: "読み込み中" }, { id: 7, active: true, windowId: 1, status: "loading" });
      api.tabs.onActivated.emit({ tabId: 7, windowId: 1 });
    });
    expect(api.runtime.sendMessage).toHaveBeenCalledTimes(requestsBeforeReload);
    expect(container.querySelector("blockquote")).toBeNull();
    api.runtime.sendMessage.mockResolvedValueOnce({ ok: true, context: context({ documentToken: "new-document-same-url", selection: null, status: "empty" }) });
    await act(async () => api.tabs.onUpdated.emit(7, { status: "complete" }, { id: 7, active: true, windowId: 1, status: "complete", url: "https://example.test/application" }));
    expect(api.runtime.sendMessage).toHaveBeenCalledTimes(requestsBeforeReload + 1);
    expect(container.textContent).toContain("説明したい言葉や文章を選んでください");
    expect(container.textContent).not.toContain("古い文書の選択");
  });

  it("ignores other windows and untrusted notifications, and rejects a mismatched response window", async () => {
    const api = mockApi();
    await act(async () => root.render(<SidebarApp api={api.asApi()} />));
    const calls = api.runtime.sendMessage.mock.calls.length;
    await act(async () => {
      api.tabs.onActivated.emit({ tabId: 99, windowId: 2 });
      api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 2 }, BACKGROUND);
      api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 1 }, { ...BACKGROUND, id: "foreign@example.test" });
      api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 1 }, { ...BACKGROUND, tab: { id: 7 } });
    });
    expect(api.runtime.sendMessage).toHaveBeenCalledTimes(calls);
    api.runtime.sendMessage.mockResolvedValueOnce({ ok: true, context: context({ windowId: 2, selection: "他のウィンドウの内容" }) });
    await act(async () => api.runtime.onMessage.emit({ type: "silver-guide-v3-selection-changed", tabId: 7, windowId: 1 }, BACKGROUND));
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.textContent).not.toContain("他のウィンドウの内容");
    expect(container.textContent).toContain("対象ページを確認できませんでした");
  });

  it("opens the PDF tab in the current window and removes subscriptions when closed", async () => {
    const api = mockApi();
    await act(async () => root.render(<SidebarApp api={api.asApi()} />));
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: "silver-guide-v3-panel-context", windowId: 1 });
    await act(async () => container.querySelector<HTMLAnchorElement>(".sidebar-pdf-link")!.click());
    expect(api.tabs.create).toHaveBeenCalledWith({ url: `${EXTENSION_ROOT}workspace.html`, windowId: 1 });
    await act(async () => root.unmount());
    expect(api.tabs.onActivated.listeners.size).toBe(0);
    expect(api.tabs.onUpdated.listeners.size).toBe(0);
    expect(api.tabs.onRemoved.listeners.size).toBe(0);
    expect(api.runtime.onMessage.listeners.size).toBe(0);
    root = createRoot(container);
  });

  it("closes Firefox's sidebar only after the PDF tab has opened successfully", async () => {
    const api = mockApi();
    const pending = deferred<{ id: number }>();
    api.tabs.create.mockImplementationOnce(() => pending.promise);
    const closePanelDocument = vi.spyOn(window, "close").mockImplementation(() => {});
    const sidebarAction = { close: vi.fn(async () => {}) };
    await act(async () => root.render(<SidebarApp api={{ ...api.asApi(), sidebarAction } as unknown as WebExtensionApi} />));
    await act(async () => container.querySelector<HTMLAnchorElement>(".sidebar-pdf-link")!.click());
    expect(closePanelDocument).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ id: 19 }));
    expect(closePanelDocument).toHaveBeenCalledTimes(1);
    // This API requires a live user gesture and must not be called after an await.
    expect(sidebarAction.close).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("hides Chromium's panel only on the newly opened PDF tab without changing the original page", async () => {
    const api = mockApi();
    const sidePanel = { setOptions: vi.fn(async (_options: unknown) => {}) };
    const closePanelDocument = vi.spyOn(window, "close").mockImplementation(() => {});
    await act(async () => root.render(<SidebarApp api={{ ...api.asApi(), sidePanel } as unknown as WebExtensionApi} />));
    await act(async () => container.querySelector<HTMLAnchorElement>(".sidebar-pdf-link")!.click());
    expect(sidePanel.setOptions).toHaveBeenCalledExactlyOnceWith({ tabId: 19, enabled: false });
    expect(closePanelDocument).not.toHaveBeenCalled();
    expect(container.querySelector("blockquote")!.textContent).toBe("支給要件");
  });

  it.each(["gecko", "chromium"])("preserves %s's explanation when opening the PDF tab fails", async target => {
    const api = mockApi();
    api.tabs.create.mockRejectedValueOnce(new Error("tab creation failed"));
    const closePanelDocument = vi.spyOn(window, "close").mockImplementation(() => {});
    const setOptions = vi.fn(async (_options: unknown) => {});
    const panelApi = target === "gecko" ? { sidebarAction: { close: vi.fn(async () => {}) } } : { sidePanel: { setOptions } };
    await act(async () => root.render(<SidebarApp api={{ ...api.asApi(), ...panelApi } as unknown as WebExtensionApi} />));
    await act(async () => container.querySelector<HTMLAnchorElement>(".sidebar-pdf-link")!.click());
    expect(closePanelDocument).not.toHaveBeenCalled();
    expect(setOptions).not.toHaveBeenCalled();
    expect(container.querySelector("blockquote")!.textContent).toBe("支給要件");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("PDFの画面を開けませんでした");
  });

  it("keeps a successfully opened PDF separate from an optional panel-hiding failure", async () => {
    const api = mockApi();
    const sidePanel = { setOptions: vi.fn(async (_options: unknown) => { throw new Error("panel cannot be hidden"); }) };
    await act(async () => root.render(<SidebarApp api={{ ...api.asApi(), sidePanel } as unknown as WebExtensionApi} />));
    await act(async () => container.querySelector<HTMLAnchorElement>(".sidebar-pdf-link")!.click());
    expect(api.tabs.create).toHaveBeenCalledTimes(1);
    expect(sidePanel.setOptions).toHaveBeenCalledExactlyOnceWith({ tabId: 19, enabled: false });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("blockquote")!.textContent).toBe("支給要件");
  });
});
