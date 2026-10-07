import { describe, expect, it, vi } from "vitest";
import { createBackgroundController } from "./controller";
import type { WebExtensionApi } from "../shared/webextension";

function setup(sidePanel = true) {
  const active = new Map([[7, 12], [9, 31]]);
  const current = { active: true, sessionId: "session-a", snapshot: { revision: 2 } };
  const query = vi.fn(async (options: { windowId?: number }) => [{ id: active.get(options.windowId ?? 7) }]);
  const pageMessage = vi.fn(async (tabId: number, message: { type: string }) =>
    message.type === "silver-guide-disable" ? { active: false } : { ...current, tabId });
  const injection = [{ frameId: 0, documentId: "document-a" }];
  const inject = vi.fn(async () => injection);
  const notify = vi.fn(async () => undefined);
  let updated: ((tabId: number, change: { status: string }) => void) | undefined;
  const api = { tabs: { query, sendMessage: pageMessage,
    onUpdated: { addListener: (listener: typeof updated) => { updated = listener; } }
  }, scripting: { executeScript: inject }, runtime: { sendMessage: notify } };
  const controller = createBackgroundController(api as unknown as WebExtensionApi, sidePanel);
  const handle = (message: unknown, sender: browser.runtime.MessageSender = {}) => controller.handle(message, sender);
  const target = { windowId: 7, tabId: 12, sessionId: "session-a" };
  return { handle, active, current, query, pageMessage, inject, notify, target, navigate: () => updated?.(12, { status: "loading" }) };
}

function senderTab(id: number, windowId = 7): browser.tabs.Tab {
  return { id, windowId, index: 0, highlighted: true, active: true, pinned: false, incognito: false };
}

describe("side panel tab and document boundaries", () => {
  it("uses the panel's window, without requiring URLs or browsing-history permission", async () => {
    const test = setup();
    expect(await test.handle({ type: "silver-guide-state", windowId: 9 })).toMatchObject({ tabId: 31, sessionId: "session-a" });
    expect(test.query).toHaveBeenCalledWith({ active: true, windowId: 9 });
    expect(test.inject).not.toHaveBeenCalled();
  });

  it("does not apply a command to a different active tab", async () => {
    const test = setup();
    test.active.set(7, 99);
    expect(await test.handle({ type: "silver-guide-command", ...test.target, command: "next-field", revision: 2 })).toMatchObject({ success: false });
    expect(test.pageMessage).not.toHaveBeenCalled();
  });

  it("requires an explicit window and tab for panel activation", async () => {
    const test = setup();
    expect(await test.handle({ type: "silver-guide-enable" })).toMatchObject({ success: false });
    expect(test.inject).not.toHaveBeenCalled();
  });

  it("injects the local content script with sidepanel presentation", async () => {
    const test = setup();
    expect(await test.handle({ type: "silver-guide-enable", ...test.target })).toMatchObject({ active: true, tabId: 12, success: true });
    expect(test.inject).toHaveBeenCalledWith({ target: { tabId: 12 }, files: ["content.js"] });
    expect(test.pageMessage).toHaveBeenCalledWith(12, expect.objectContaining({ type: "silver-guide-enable", presentation: "sidepanel" }),
      { frameId: 0, documentId: "document-a" });
  });

  it("does not activate without an injected top-level document ID", async () => {
    const test = setup();
    test.inject.mockResolvedValueOnce([]);
    expect(await test.handle({ type: "silver-guide-enable", ...test.target })).toMatchObject({ success: false, active: false, tabId: 12 });
    expect(test.pageMessage).not.toHaveBeenCalled();
  });

  it("rechecks the active tab after asynchronous injection", async () => {
    const test = setup();
    let finish!: () => void;
    test.inject.mockImplementation(() => new Promise((resolve) => { finish = () => resolve([{ frameId: 0, documentId: "document-a" }]); }));
    const pending = test.handle({ type: "silver-guide-enable", ...test.target });
    await vi.waitFor(() => expect(test.inject).toHaveBeenCalled());
    test.active.set(7, 99);
    finish();
    expect(await pending).toMatchObject({ success: false });
    expect(test.pageMessage).not.toHaveBeenCalled();
  });

  it("does not start assistance in a replacement document after asynchronous injection", async () => {
    const test = setup();
    let finish!: () => void;
    test.inject.mockImplementation(() => new Promise((resolve) => { finish = () => resolve([{ frameId: 0, documentId: "document-a" }]); }));
    const pending = test.handle({ type: "silver-guide-enable", ...test.target });
    await vi.waitFor(() => expect(test.inject).toHaveBeenCalled());
    test.navigate();
    finish();
    expect(await pending).toMatchObject({ success: false, tabId: 12 });
    expect(test.pageMessage).not.toHaveBeenCalled();
  });

  it.each(["silver-guide-command", "silver-guide-disable", "silver-guide-update-settings"])("rejects a stale session for %s", async (type) => {
    const test = setup();
    expect(await test.handle({ type, ...test.target, sessionId: "old-document", command: "next-field", revision: 2 })).toMatchObject({ success: false, sessionId: "session-a" });
    expect(test.pageMessage.mock.calls.map((call) => call[1].type)).toEqual(["silver-guide-state"]);
  });

  it("forwards commands with the document revision for content-side validation", async () => {
    const test = setup();
    await test.handle({ type: "silver-guide-command", ...test.target, command: "first-field", revision: 2 });
    expect(test.pageMessage).toHaveBeenLastCalledWith(12, { type: "silver-guide-command", command: "first-field", revision: 2, sessionId: "session-a" });
  });

  it("rejects invalid commands without forwarding them", async () => {
    const test = setup();
    expect(await test.handle({ type: "silver-guide-command", ...test.target, command: "submit", revision: 2 })).toMatchObject({ success: false });
    expect(test.pageMessage).toHaveBeenCalledTimes(1);
  });

  it("clears state after navigation rather than retrieving a cached snapshot", async () => {
    const test = setup();
    await test.handle({ type: "silver-guide-state", windowId: 7 });
    test.pageMessage.mockRejectedValueOnce(new Error("No content script in the new document"));
    expect(await test.handle({ type: "silver-guide-state", windowId: 7 })).toEqual({ active: false, tabId: 12 });
  });

  it("content contexts cannot request privileged activation", () => {
    const test = setup();
    expect(test.handle({ type: "silver-guide-enable", ...test.target }, { tab: senderTab(12), frameId: 0 })).toBeUndefined();
    expect(test.inject).not.toHaveBeenCalled();
  });

  it("sends only a wake-up for the active top-level content context", async () => {
    const test = setup();
    await test.handle({ type: "silver-guide-page-updated", state: { snapshot: "ignored payload" } }, { tab: senderTab(12), frameId: 0 });
    expect(test.notify).toHaveBeenCalledWith({ type: "silver-guide-panel-update", tabId: 12, windowId: 7 });
  });

  it("ignores update notifications from inactive tabs and frames", async () => {
    const test = setup();
    await test.handle({ type: "silver-guide-page-updated" }, { tab: senderTab(99), frameId: 0 });
    await test.handle({ type: "silver-guide-page-updated" }, { tab: senderTab(12), frameId: 1 });
    expect(test.notify).not.toHaveBeenCalled();
  });

  it("keeps Firefox's current-tab activation and page presentation", async () => {
    const test = setup(false);
    expect(await test.handle({ type: "silver-guide-enable" })).toMatchObject({ success: true, tabId: 12 });
    expect(test.pageMessage).toHaveBeenCalledWith(12, expect.objectContaining({ presentation: "page" }));
  });
});
