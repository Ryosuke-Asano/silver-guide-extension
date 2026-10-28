import { describe, expect, it, vi } from "vitest";
import { startBackground } from "../../src/background/v3";
import { base64ToPdfBytes, bytesToBase64, HANDOFF_MAX_BYTES, isPdfPageUrl, OPEN_PDF_HANDOFF, readPdfResponse } from "../../src/shared/pdf-handoff";
import type { WebExtensionApi } from "../../src/shared/webextension";

const id = "82e239a5-4270-4fdb-b373-f868cf1ec156";
const source = "https://service.example/apply?case=123";
const sender = { id: "handoff@example.test", url: source, frameId: 0, tab: { id: 3, windowId: 1, url: source } };

describe("generic PDF handoff routing", () => {
  it("supports ordinary HTTP(S) pages without a demo URL allowlist", () => {
    for (const value of [source, "http://localhost:4288/application", "https://example.test/form"]) expect(isPdfPageUrl(value)).toBe(true);
    for (const value of ["file:///form.pdf", "chrome://settings", "javascript:alert(1)", "https://user:pass@example.test/form"]) expect(isPdfPageUrl(value)).toBe(false);
  });
  it("round-trips binary PDF data and rejects oversized or non-PDF payloads", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n\x00漢字\n%%EOF\n");
    expect(base64ToPdfBytes(bytesToBase64(bytes))).toEqual(bytes);
    for (const value of ["", "####", "bm90IGEgcGRm", "JVBERi0xLjcKbm8gZW5k"]) expect(() => base64ToPdfBytes(value)).toThrow();
    expect(() => bytesToBase64(new Uint8Array(HANDOFF_MAX_BYTES + 1))).toThrow("20MB");
  });
  it("opens a workspace bound to the authenticated source tab, not caller-supplied destinations", async () => {
    const listeners: Function[] = [];
    const create = vi.fn(async () => ({ id: 9 }));
    const api = { runtime: { id: sender.id, getURL: (path: string) => "chrome-extension://handoff/" + path, onMessage: { addListener: (listener: Function) => listeners.push(listener) } }, action: { onClicked: { addListener: vi.fn() } }, tabs: { create } } as unknown as WebExtensionApi;
    startBackground(api);
    const respond = vi.fn();
    const result = listeners[0]({ type: OPEN_PDF_HANDOFF, requestId: id, documentToken: "aaaaaaaa-bbbbbbbb", sourceTab: 999, destination: "https://other.test" }, sender, respond);
    expect(result).toBe(true); await Promise.resolve();
    const url = new URL(create.mock.calls[0][0].url);
    const params = new URLSearchParams(url.hash.slice(1));
    expect(url.pathname).toBe("/workspace.html"); expect(params.get("sourceTab")).toBe("3");
    expect(params.get("handoff")).toBe(id); expect(respond).toHaveBeenCalledWith({ ok: true, tabId: 9 });
  });
  it("does not open tabs for foreign extensions, subframes or mismatched pages", () => {
    const listeners: Function[] = [], create = vi.fn();
    const api = { runtime: { id: sender.id, getURL: (path: string) => "chrome-extension://handoff/" + path, onMessage: { addListener: (listener: Function) => listeners.push(listener) } }, action: { onClicked: { addListener: vi.fn() } }, tabs: { create } } as unknown as WebExtensionApi;
    startBackground(api);
    for (const untrusted of [{ ...sender, id: "other" }, { ...sender, frameId: 1 }, { ...sender, url: source + "guide.html" }, { ...sender, tab: { ...sender.tab, url: "https://other.test" } }]) listeners[0]({ type: OPEN_PDF_HANDOFF, requestId: id, documentToken: "aaaaaaaa-bbbbbbbb" }, untrusted, vi.fn());
    expect(create).not.toHaveBeenCalled();
  });
  it("bounds streamed PDF responses and refuses HTML login responses", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nexample\n%%EOF\n");
    expect(await readPdfResponse(new Response(bytes))).toEqual(bytes);
    await expect(readPdfResponse(new Response("<html>login</html>"))).rejects.toThrow("PDFではありません");
    await expect(readPdfResponse(new Response(bytes, { headers: { "content-length": String(HANDOFF_MAX_BYTES + 1) } }))).rejects.toThrow("20MB");
  });
});
