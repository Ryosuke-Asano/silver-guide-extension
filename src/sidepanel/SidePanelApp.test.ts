// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import type { AssistanceCommand, AssistanceResult, AssistanceSnapshot, AssistanceState } from "../shared/assistant";
import type { SilverGuideSettings } from "../shared/settings";
import { SidePanelApp } from "./SidePanelApp";

type Request = {
  type: string;
  windowId?: number;
  tabId?: number;
  sessionId?: string;
  command?: AssistanceCommand;
  revision?: number;
  settings?: SilverGuideSettings;
};
type Listener = (...args: unknown[]) => unknown;

let root: Root | undefined;
let container: HTMLDivElement;
let activeTab: number;
let activeStatus: "loading" | "complete";
let serverState: AssistanceState;
let nextStateRead: (() => AssistanceState | Promise<AssistanceState>) | undefined;
let nextCommand: (() => AssistanceResult | Promise<AssistanceResult>) | undefined;
let sent: Request[];
let saved: unknown[];
let scroll: MockInstance<HTMLElement["scrollIntoView"]>;
let listeners: Record<string, Set<Listener>> = {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function event(name: string) {
  const collection = new Set<Listener>();
  listeners[name] = collection;
  return { addListener: (callback: Listener) => collection.add(callback), removeListener: (callback: Listener) => collection.delete(callback) };
}

function snapshot(revision = 1, label = "電話番号", position = 1): AssistanceSnapshot {
  return {
    revision, inputCount: 2, visibleCount: 3, errorCount: 0, stepText: "1. 連絡先", hasTerms: true,
    field: {
      label, accessibleLabel: "入力例：0123456789", facts: ["ページでは20文字までと指定されています。"],
      descriptions: ["電話番号の区切り方を確認してください。"], purpose: "連絡先の確認", position, total: 2,
      hasError: false, utility: false, canPrevious: position > 1, canNext: position < 2
    }
  };
}

function button(label: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
  if (result === undefined) throw new Error(`Missing button: ${label}`);
  return result;
}

async function fire(name: string, ...values: unknown[]): Promise<void> {
  await act(async () => { for (const callback of listeners[name]) callback(...values); });
}

async function wake(): Promise<void> {
  await fire("message", { type: "silver-guide-panel-update", windowId: 7, tabId: activeTab });
}

async function start(): Promise<void> {
  await act(async () => { button("このページを支援する").click(); });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  activeTab = 101;
  activeStatus = "complete";
  serverState = { active: false, tabId: 101 };
  nextStateRead = undefined;
  nextCommand = undefined;
  sent = [];
  saved = [];
  listeners = {};
  // jsdom has no layout/scroll implementation. Browser E2E measures geometry;
  // this spy verifies which document/element is requested to scroll.
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("browser", {
    runtime: {
      onMessage: event("message"),
      sendMessage: vi.fn(async (request: Request) => {
        sent.push(request);
        if (request.type === "silver-guide-state") return nextStateRead ? nextStateRead() : serverState;
        if (request.type === "silver-guide-enable") {
          serverState = { active: true, tabId: activeTab, sessionId: "session-A", snapshot: snapshot() };
          return { ...serverState, success: true, message: "このページの支援を開始しました。" };
        }
        if (request.type === "silver-guide-command") {
          if (nextCommand) return nextCommand();
          if (serverState.snapshot === undefined) throw new Error("Missing test snapshot");
          serverState = { ...serverState, snapshot: snapshot(serverState.snapshot.revision + 1, "メールアドレス", 2) };
          return { ...serverState, success: true, message: "項目へ移動しました。" };
        }
        if (request.type === "silver-guide-disable") {
          serverState = { active: false, tabId: activeTab };
          return { ...serverState, success: true, message: "支援を停止しました。" };
        }
        if (request.type === "silver-guide-update-settings") return { ...serverState, success: true, message: "設定を更新しました。" };
        throw new Error("Unknown test request");
      })
    },
    storage: { local: { get: async () => ({}), set: async (value: unknown) => { saved.push(value); } } },
    windows: { getCurrent: async () => ({ id: 7 }) },
    tabs: {
      query: async (query: unknown) => {
        expect(query).toEqual({ active: true, windowId: 7 });
        return [{
          id: activeTab, windowId: 7, status: activeStatus,
          get url() { throw new Error("Tab URL must not be read"); },
          get title() { throw new Error("Tab title must not be read"); }
        }];
      },
      onActivated: event("activated"), onUpdated: event("updated"), onRemoved: event("removed")
    }
  });
  container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  await act(async () => { root?.render(createElement(SidePanelApp)); });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  for (const set of Object.values(listeners)) expect(set.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("starts explicitly, sends the exact document target/revision and keeps live status short", async () => {
  expect(sent.filter((request) => request.type === "silver-guide-enable")).toHaveLength(0);
  await start();
  expect(container.textContent).toContain("「電話番号」について");
  expect(container.textContent).toContain("ページが設定した読み上げ名：入力例：0123456789");
  expect(container.querySelector('[role="status"]')?.textContent).not.toContain("電話番号");
  await act(async () => { button("次の項目へ").click(); });
  expect(sent.find((request) => request.type === "silver-guide-command")).toEqual({
    type: "silver-guide-command", windowId: 7, tabId: 101, sessionId: "session-A", command: "next-field", revision: 1
  });
  expect(container.textContent).toContain("「メールアドレス」について");
  for (const set of Object.values(listeners)) expect(set.size).toBe(1);
});

it("clears on tab switch and rejects an old delayed state response", async () => {
  await start();
  const old = deferred<AssistanceState>();
  nextStateRead = () => old.promise;
  await wake();
  nextStateRead = undefined;
  activeTab = 202;
  serverState = { active: false, tabId: 202 };
  await fire("activated", { windowId: 7, tabId: 202 });
  expect(container.textContent).not.toContain("「電話番号」について");
  await act(async () => { old.resolve({ active: true, tabId: 101, sessionId: "OLD_SESSION", snapshot: snapshot(99, "古いタブの項目") }); });
  expect(container.textContent).not.toContain("古いタブの項目");
  expect(button("このページを支援する").disabled).toBe(false);
});

it("ignores other-window/tab notifications and lower revisions from the same session", async () => {
  await start();
  serverState = { ...serverState, snapshot: snapshot(10, "現在の項目") };
  await wake();
  const reads = sent.length;
  await fire("activated", { windowId: 9, tabId: 999 });
  await fire("message", { type: "silver-guide-panel-update", windowId: 9, tabId: 101 });
  await fire("message", { type: "silver-guide-panel-update", windowId: 7, tabId: 999 });
  expect(sent).toHaveLength(reads);
  serverState = { ...serverState, snapshot: snapshot(9, "古い項目") };
  await wake();
  expect(container.textContent).toContain("「現在の項目」について");
  expect(container.textContent).not.toContain("「古い項目」について");
});

it("never restores a delayed old command reply after same-tab navigation", async () => {
  await start();
  const old = deferred<AssistanceResult>();
  nextCommand = () => old.promise;
  await act(async () => { button("次の項目へ").click(); });
  activeStatus = "loading";
  serverState = { active: false, tabId: 101 };
  await fire("updated", 101, { status: "loading" }, { windowId: 7 });
  expect(container.textContent).not.toContain("「電話番号」について");
  expect(button("このページを支援する").disabled).toBe(true);
  await act(async () => {
    old.resolve({ active: true, tabId: 101, sessionId: "OLD_DOCUMENT", snapshot: snapshot(99, "前の画面の項目"), success: true, message: "古い操作の成功" });
  });
  expect(container.textContent).not.toContain("前の画面の項目");
  expect(container.textContent).not.toContain("古い操作の成功");
  activeStatus = "complete";
  await fire("updated", 101, { status: "complete" }, { windowId: 7 });
  expect(button("このページを支援する").disabled).toBe(false);
});

it("clears stale metadata and commands after an authoritative read error", async () => {
  await start();
  nextStateRead = () => { throw new Error("Lost runtime reply"); };
  await wake();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("このタブの状態を確認できませんでした");
  expect(container.textContent).not.toContain("「電話番号」について");
  expect(container.querySelector('[data-panel-action="next-field"]')).toBeNull();
  expect(button("このページを支援する").disabled).toBe(false);
});

it("invalidates a pending control reply when an authoritative read fails", async () => {
  await start();
  const old = deferred<AssistanceResult>();
  nextCommand = () => old.promise;
  await act(async () => { button("次の項目へ").click(); });
  nextStateRead = () => { throw new Error("Lost runtime reply"); };
  await wake();
  await act(async () => {
    old.resolve({ active: true, tabId: 101, sessionId: "session-A", snapshot: snapshot(99, "古い操作の項目"), success: true, message: "古い操作の成功" });
  });
  expect(container.textContent).not.toContain("古い操作の項目");
  expect(container.textContent).not.toContain("古い操作の成功");
  expect(container.querySelector('[data-panel-action="next-field"]')).toBeNull();
  expect(button("このページを支援する").disabled).toBe(false);
});

it("scrolls only the panel heading and preserves settings focus without scrolling", async () => {
  await start();
  expect(scroll).toHaveBeenCalledWith({ block: "nearest", behavior: "instant" });
  expect(scroll.mock.contexts.at(-1)).toBe(container.querySelector("#panel-field-heading"));
  expect(document.activeElement).toBe(document.body);
  vi.mocked(document.hasFocus).mockReturnValue(true);
  const radio = container.querySelector<HTMLInputElement>('input[type="radio"][value="large"]');
  if (radio === null) throw new Error("Missing large font radio");
  radio.focus();
  await act(async () => { radio.click(); });
  expect(container.querySelector("main")?.getAttribute("data-font-size")).toBe("large");
  expect(saved.at(-1)).toEqual({ silverGuideSettings: { fontSize: "large", showOriginal: true } });
  const count = scroll.mock.calls.length;
  serverState = { ...serverState, snapshot: snapshot(2, "新しい項目", 2) };
  await wake();
  expect(document.activeElement).toBe(radio);
  expect(scroll).toHaveBeenCalledTimes(count);
  expect(sent.find((request) => request.type === "silver-guide-update-settings")).toMatchObject({ windowId: 7, tabId: 101, sessionId: "session-A" });
});
