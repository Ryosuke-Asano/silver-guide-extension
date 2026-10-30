import { expect, it, vi } from "vitest";
import { assistedDemoUrl } from "../../src/shared/bundled-demo";
import { isPdfPageUrl, OPEN_PDF_HANDOFF } from "../../src/shared/pdf-handoff";
import { GET_SELECTION } from "../../src/shared/v3-protocol";
import { resolvePanelContext, startBackground } from "../../src/background/v3";
import type { WebExtensionApi } from "../../src/shared/webextension";

const root = "chrome-extension://own-demo/", url = root + "demo/index.html?condition=silver-guide";
it("adds only the own assisted demo and the two packaged PDFs to the HTTP(S) boundary", () => {
  expect(assistedDemoUrl(url, root)).toBe(url);
  expect(isPdfPageUrl(root + "demo/assets/library-application-original.pdf", root)).toBe(true);
  for (const value of [url.replace("own-demo", "foreign-demo"), url.replace("silver-guide", "manual"), root + "workspace.html", root + "demo/private.pdf", "file:///demo/index.html?condition=silver-guide"])
    expect(isPdfPageUrl(value, root)).toBe(false);
});
it("uses runtime routing for an addressed internal tab and keeps active URL verification", async () => {
  const tab = { id: 7, windowId: 1, url }, value = { documentToken: "aaaaaaaa-bbbbbbbb", generation: 1, pageUrl: url, title: "Demo", text: "申込書", status: "ready" };
  const api = { runtime: { getURL: (path: string) => root + path, sendMessage: vi.fn(async () => value) },
    tabs: { query: vi.fn(async () => [tab]), sendMessage: vi.fn() } };
  expect(await resolvePanelContext(api as unknown as WebExtensionApi, 1)).toMatchObject({ context: { selection: "申込書", url } });
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: GET_SELECTION, bundledTabId: 7 });
  expect(api.tabs.sendMessage).not.toHaveBeenCalled();
  api.tabs.query.mockResolvedValueOnce([tab]).mockResolvedValueOnce([{ ...tab, url: url.replace("silver-guide", "manual") }]);
  expect(await resolvePanelContext(api as unknown as WebExtensionApi, 1)).toMatchObject({ context: { status: "restricted", selection: null } });
});
it("verifies an internal page's claimed source tab before opening a PDF workspace", async () => {
  let listener: Function = () => {};
  const api = { runtime: { id: "own-demo", getURL: (path: string) => root + path, onMessage: { addListener: (value: Function) => { listener = value; } } },
    action: { onClicked: { addListener: vi.fn() } }, tabs: { get: vi.fn(async () => ({ id: 7, windowId: 1, url })), create: vi.fn(async () => ({ id: 9 })) } };
  startBackground(api as unknown as WebExtensionApi);
  const request = { type: OPEN_PDF_HANDOFF, requestId: "82e239a5-4270-4fdb-b373-f868cf1ec156", documentToken: "aaaaaaaa-bbbbbbbb", bundledTabId: 7 };
  const respond = vi.fn();
  expect(listener(request, { id: "own-demo", url }, respond)).toBe(true);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, tabId: 9 }));
  expect(api.tabs.create.mock.calls[0][0].url).toContain("bundled=1");
  api.tabs.create.mockClear(); respond.mockClear();
  api.tabs.get.mockResolvedValueOnce({ id: 7, windowId: 1, url: root + "demo/index.html?condition=manual" });
  listener(request, { id: "own-demo", url }, respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: false }));
  expect(api.tabs.create).not.toHaveBeenCalled();
  listener(request, { id: "foreign", url }, respond);
  listener(request, { id: "own-demo", url, frameId: 1 }, respond);
  expect(api.tabs.get).toHaveBeenCalledTimes(2);
});
