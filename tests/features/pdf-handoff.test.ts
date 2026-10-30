// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://service.example/apply?case=123"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPdfHandoff } from "../../src/features/pdf-handoff";
import { bytesToBase64, PDF_HANDOFF_REQUEST } from "../../src/shared/pdf-handoff";
import { pdfSource, pdfTargets } from "../../src/features/pdf/detection";
import type { WebExtensionApi } from "../../src/shared/webextension";

const token = "aaaaaaaa-bbbbbbbb", bytes = new TextEncoder().encode("%PDF-1.7\nexample\n%%EOF\n");
let stop: () => void, listeners: Function[], opening: ReturnType<typeof vi.fn>, requestId: string, selected: string;
const fixture = '<form><a href="/documents/form.pdf?version=2">申込書</a><label for="application">申込書の添付</label><input type="file" id="application" accept=".pdf"></form>';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const button = () => document.querySelector('[data-silver-guide-pdf-entry]')!.shadowRoot!.querySelector('button')!;
const request = (action: string, extra: Record<string, unknown> = {}, sender: Partial<browser.runtime.MessageSender> = {}) => new Promise<any>(resolve => {
  let answered = false;
  const result = listeners[0]({ type: PDF_HANDOFF_REQUEST, action, requestId, documentToken: token, clientId: requestId, ...extra }, { id: "handoff@example.test", url: `chrome-extension://handoff/workspace.html#handoff=${requestId}&document=${token}`, ...sender }, (value: unknown) => { answered = true; resolve(value); });
  if (result !== true && !answered) resolve(undefined);
});
const begin = async () => { button().click(); await flush(); requestId = opening.mock.calls.at(-1)![0].requestId; const reply = await request("get"); selected = reply.destination?.id; return reply; };
beforeEach(() => {
  document.body.innerHTML = fixture; listeners = [];
  opening = vi.fn(async () => ({ ok: true, tabId: 9 }));
  const api = { runtime: { id: "handoff@example.test", getURL: (path: string) => "chrome-extension://handoff/" + path, sendMessage: opening, onMessage: { addListener: (listener: Function) => listeners.push(listener), removeListener: vi.fn() } } } as unknown as WebExtensionApi;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "Content-Type": "application/pdf" } })));
  stop = startPdfHandoff(api, document, token).stop;
});
afterEach(() => { stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("extension-owned PDF workflow", () => {
  it("detects a normal link and binds its ordinary form without page cooperation", async () => {
    const reply = await begin();
    expect(reply.pdf).toBe(bytesToBase64(bytes)); expect(reply.directEntry).toBe(true);
    expect(reply.destination.label).toBe("申込書の添付");
    expect(reply.destination.url).toBe("https://service.example/apply");
    expect(reply.destination.defaultSubmit).toBe(false);
    expect(fetch).toHaveBeenCalledWith("https://service.example/documents/form.pdf?version=2", expect.objectContaining({ credentials: "include", redirect: "error" }));
  });
  it("requires an authenticated destination binding before delivery", async () => {
    await begin();
    expect((await request("deliver", { pdf: bytesToBase64(bytes) })).ok).toBe(false);
    expect((await request("accept", { destinationId: "forged" })).ok).toBe(false);
    expect((await request("accept", { destinationId: selected })).ok).toBe(true);
  });
  it("locks a job to one workspace client and exact extension page", async () => {
    await begin();
    expect((await request("get", { clientId: crypto.randomUUID() })).ok).toBe(false);
    expect((await request("get", {}, { url: "chrome-extension://handoff/workspace.html" })).ok).toBe(false);
    expect(await request("get", {}, { id: "other-extension" })).toBeUndefined();
    expect(await request("get", {}, { url: "chrome-extension://handoff/sidebar.html" })).toBeUndefined();
    expect((await request("get", { documentToken: "wrong-document" })).ok).toBe(false);
    expect((await request("get", {}, { tab: { id: 99 } })).ok).toBe(false);
  });
  it("returns multiple targets without silently choosing one", async () => {
    document.querySelector("form")!.insertAdjacentHTML("beforeend", '<label for="second">証明書</label><input id="second" type="file" accept="application/pdf">');
    const reply = await begin();
    expect(reply.destinations).toHaveLength(2); expect(reply.destination).toBeNull(); expect(reply.directEntry).toBe(false);
  });
  it("can open a PDF for saving when the page has no attachment field", async () => {
    document.getElementById("application")!.remove();
    const reply = await begin(); expect(reply.destinations).toEqual([]); expect(reply.directEntry).toBe(true);
  });
  it("does not fetch a cross-origin resource from the content script", async () => {
    document.querySelector("a")!.href = "https://files.example/document.pdf";
    stop();
    // Reinitialize so the offered resource matches the user's click.
    listeners = []; const api = { runtime: { id: "handoff@example.test", getURL: (path: string) => "chrome-extension://handoff/" + path, sendMessage: opening, onMessage: { addListener: (listener: Function) => listeners.push(listener), removeListener: vi.fn() } } } as unknown as WebExtensionApi;
    stop = startPdfHandoff(api, document, token).stop;
    expect((await begin()).sourceUrl).toBe("https://files.example/document.pdf"); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a replaced destination, selected-file changes, and a changed form action", async () => {
    await begin(); await request("accept", { destinationId: selected });
    document.getElementById("application")!.outerHTML = '<input type="file" id="application" accept=".pdf">';
    expect((await request("deliver", { pdf: bytesToBase64(bytes) })).ok).toBe(false);
    await begin(); await request("accept", { destinationId: selected });
    Object.defineProperty(document.getElementById("application"), "files", { configurable: true, value: [new File([bytes], "another.pdf")] });
    expect((await request("deliver", { pdf: bytesToBase64(bytes) })).ok).toBe(false);
  });
  it("invalidates an old workspace on native form reset even when its file input stays empty", async () => {
    await begin(); await request("accept", { destinationId: selected });
    const field = document.getElementById("application") as HTMLInputElement;
    const changed = vi.fn(); field.addEventListener("change", changed);
    document.querySelector("form")!.reset();
    expect(changed).not.toHaveBeenCalled();
    expect((await request("deliver", { pdf: bytesToBase64(bytes), submit: true })).ok).toBe(false);
    expect(field.files).toHaveLength(0);
    // The next attempt must open a fresh workspace, which remains usable.
    expect((await begin()).destination).not.toBeNull();
    expect((await request("accept", { destinationId: selected })).ok).toBe(true);
  });
  it.each(["source", "destination"])("invalidates a cross-form workspace when its %s form resets", async role => {
    const sourceForm = document.querySelector("form")!;
    const destinationForm = document.createElement("form"); document.body.append(destinationForm);
    destinationForm.append(document.getElementById("application")!);
    const reply = await begin();
    expect(reply.destination).toBeNull();
    selected = reply.destinations[0].id;
    expect((await request("accept", { destinationId: selected })).ok).toBe(true);
    (role === "source" ? sourceForm : destinationForm).reset();
    expect((await request("deliver", { pdf: bytesToBase64(bytes), submit: true })).ok).toBe(false);
  });
  it("keeps a workspace usable when an unrelated form resets", async () => {
    const other = document.createElement("form"); document.body.append(other);
    await begin(); other.reset();
    expect((await request("get")).destination.id).toBe(selected);
    expect((await request("accept", { destinationId: selected })).ok).toBe(true);
  });
  it("rejects delivery into an inert form and updates its PDF entry when the gate changes", async () => {
    await begin(); await request("accept", { destinationId: selected });
    const form = document.querySelector("form")!;
    form.setAttribute("inert", "");
    expect((await request("deliver", { pdf: bytesToBase64(bytes), submit: true })).ok).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(document.querySelector('[data-silver-guide-pdf-entry]')).toBeNull();
    form.removeAttribute("inert");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(document.querySelector('[data-silver-guide-pdf-entry]')).not.toBeNull();
  });
  it("assigns a PDF and dispatches native input/change events only once on retries", async () => {
    const field = document.getElementById("application") as HTMLInputElement;
    let files: File[] = []; Object.defineProperty(field, "files", { configurable: true, get: () => files, set: value => { files = value; } });
    vi.stubGlobal("DataTransfer", class { files: File[] = []; items = { add: (file: File) => this.files.push(file) }; });
    const changed = vi.fn(); field.addEventListener("change", changed);
    await begin(); await request("accept", { destinationId: selected });
    const payload = { pdf: bytesToBase64(bytes), fileName: "記入済み.pdf", submit: false };
    expect((await request("deliver", payload)).result.status).toBe("attached");
    expect(files[0].name).toBe("記入済み.pdf"); expect(changed).toHaveBeenCalledTimes(1);
    expect((await request("deliver", payload)).result.status).toBe("attached"); expect(changed).toHaveBeenCalledTimes(1);
  });
  it("detects dynamic links, updates changed URLs, and removes its controls on stop", async () => {
    document.body.insertAdjacentHTML("beforeend", '<a href="/second.pdf">別紙</a>');
    await new Promise(resolve => setTimeout(resolve, 150)); expect(document.querySelectorAll('[data-silver-guide-pdf-entry]')).toHaveLength(2);
    document.querySelector("a")!.href = "/not-a-pdf";
    await new Promise(resolve => setTimeout(resolve, 150)); expect(document.querySelectorAll('[data-silver-guide-pdf-entry]')).toHaveLength(1);
    stop(); expect(document.querySelector('[data-silver-guide-pdf-entry]')).toBeNull();
  });
  it("keeps its action outside wrapping labels so clicking it does not open a file picker", async () => {
    document.body.insertAdjacentHTML("beforeend", '<label id="wrapper">別の申込書<input id="selected-pdf" type="file"></label>');
    const input = document.getElementById("selected-pdf")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([bytes], "original.pdf", { type: "application/pdf" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 150));
    const wrapper = document.getElementById("wrapper")!;
    expect(wrapper.querySelector('[data-silver-guide-pdf-entry]')).toBeNull();
    expect(wrapper.nextElementSibling?.hasAttribute('data-silver-guide-pdf-entry')).toBe(true);
  });
  it("offers PDFs revealed by a style change and rejects a job after file reselection", async () => {
    const link = document.querySelector("a")!; link.style.display = "none";
    await new Promise(resolve => setTimeout(resolve, 150)); expect(document.querySelector('[data-silver-guide-pdf-entry]')).toBeNull();
    link.style.display = "inline";
    await new Promise(resolve => setTimeout(resolve, 150)); expect(document.querySelector('[data-silver-guide-pdf-entry]')).not.toBeNull();
    await begin(); await request("accept", { destinationId: selected });
    document.getElementById("application")!.dispatchEvent(new Event("change", { bubbles: true }));
    expect((await request("deliver", { pdf: bytesToBase64(bytes) })).ok).toBe(false);
  });
});

describe("PDF source and target detection", () => {
  it("supports MIME-typed endpoints, embedded PDFs and download filenames", () => {
    for (const html of ['<a href="/download?id=123" type="application/pdf">PDF</a>', '<a href="/download" download="申込.pdf">PDF</a>', '<object data="/form.pdf" type="application/pdf"></object>', '<embed src="/form.pdf">', '<iframe src="/form.pdf"></iframe>']) {
      const holder = document.createElement("div"); holder.innerHTML = html; document.body.append(holder);
      expect(pdfSource(holder.firstElementChild!)).not.toBeNull(); holder.remove();
    }
  });
  it("rejects scripts, credentials, hidden resources and unrelated images", () => {
    for (const html of ['<a href="javascript:alert(1)" download="x.pdf">PDF</a>', '<a href="https://user:pass@example.test/x.pdf">PDF</a>', '<a href="/x.pdf" hidden>PDF</a>', '<a href="/x.png">image</a>']) {
      const holder = document.createElement("div"); holder.innerHTML = html; document.body.append(holder);
      expect(pdfSource(holder.firstElementChild!)).toBeNull(); holder.remove();
    }
  });
  it("prefers eligible fields in the source form and excludes image-only fields", () => {
    document.body.insertAdjacentHTML("beforeend", '<form><input type="file" accept=".pdf"></form>');
    document.querySelector("form")!.insertAdjacentHTML("beforeend", '<input type="file" accept="image/*">');
    expect(pdfTargets(document, pdfSource(document.querySelector("a")!)!)).toEqual([document.getElementById("application")]);
  });
  it("does not require a .pdf extension when a selected file has a PDF MIME type", () => {
    const input = document.getElementById("application") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([bytes], "download", { type: "application/pdf" })] });
    expect(pdfSource(input)?.fileName).toBe("download.pdf");
  });
});
