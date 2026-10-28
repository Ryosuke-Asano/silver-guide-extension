import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromeOptions, demoOptions, startDemo } from "../../scripts/dev-demo.mjs";
import { listenDemoServer } from "../../demo/server.mjs";

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); });
const closeServer = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await closeServer(server);
  return port;
}
function fakeChrome() {
  const callbacks = new Map();
  const page = { goto: vi.fn().mockResolvedValue(undefined), bringToFront: vi.fn(), once: vi.fn(),
    getByRole: vi.fn(() => ({ first: () => ({ waitFor: vi.fn() }) })) };
  const cdp = { send: vi.fn(async method => method === "Extensions.loadUnpacked" ? { id: "demo-extension" } : {}), detach: vi.fn() };
  const context = { close: vi.fn(async () => callbacks.get("close")?.()), once: vi.fn((event, callback) => callbacks.set(event, callback)), on: vi.fn(),
    pages: vi.fn(() => [page]), newPage: vi.fn(), browser: () => ({ newBrowserCDPSession: async () => cdp }) };
  return { page, context, cdp };
}

describe("desktop demo launcher", () => {
  it("accepts the same npm arguments on all platforms, including paths with spaces", () => {
    expect(demoOptions([], {})).toMatchObject({ port: 4287, chromeExecutable: undefined });
    const executable = join(tmpdir(), "Chrome with spaces", "chrome.exe");
    expect(demoOptions(["--port", "4187", "--chrome", executable], {})).toMatchObject({ port: 4187, chromeExecutable: executable });
    expect(demoOptions([], { SILVERGUIDE_DEMO_PORT: "4187", SILVERGUIDE_CHROME_EXECUTABLE: executable })).toMatchObject({ port: 4187, chromeExecutable: executable });
    expect(chromeOptions({ chromeExecutable: executable })).toMatchObject({ executablePath: executable, headless: false });
    expect(chromeOptions()).toMatchObject({ channel: "chrome", chromiumSandbox: true, viewport: null });
    for (const port of ["0", "80", "65536", "NaN", "4287.5"]) expect(() => demoOptions(["--port", port], {})).toThrow("1024〜65535");
    expect(() => demoOptions(["--unknown"], {})).toThrow();
  });

  it("keeps the standalone mock local, serves the PDF, and rejects writes", async () => {
    const server = await listenDemoServer(0);
    cleanups.push(() => closeServer(server));
    expect(server.address().address).toBe("127.0.0.1");
    const url = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("registration-form");
    expect(page.headers.get("content-security-policy")).toContain("form-action 'none'");
    const pdf = await fetch(url + "/assets/library-application-original.pdf?download=1");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
  });

  it("loads the built extension before navigation and removes only its own resources on stop", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort(), { page, context, cdp } = fakeChrome();
    const build = vi.fn(), launch = vi.fn(async () => context), controller = new AbortController();
    const demo = await startDemo({ port, signal: controller.signal }, { build, launch });
    cleanups.push(() => demo.close());
    expect(build).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledWith(demo.profile, expect.objectContaining({ channel: "chrome", args: expect.arrayContaining(["--enable-unsafe-extension-debugging"]) }));
    expect(cdp.send).toHaveBeenCalledWith("Extensions.loadUnpacked", { path: expect.stringContaining("dist-chromium") });
    expect(cdp.send).toHaveBeenCalledWith("Browser.setDownloadBehavior", { behavior: "default" });
    expect(cdp.send.mock.invocationCallOrder[0]).toBeLessThan(page.goto.mock.invocationCallOrder[0]);
    expect(page.goto).toHaveBeenCalledWith(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    expect((await fetch(demo.url)).status).toBe(200);
    controller.abort();
    await demo.closed;
    await demo.close();
    expect(context.close).toHaveBeenCalledOnce();
    await expect(access(demo.profile)).rejects.toThrow();
    const restarted = await listenDemoServer(port);
    await closeServer(restarted);
  });

  it("does not replace or stop another process occupying the port", async () => {
    const server = await listenDemoServer(0);
    cleanups.push(() => closeServer(server));
    const port = server.address().port, build = vi.fn(), launch = vi.fn();
    await expect(startDemo({ port }, { build, launch })).rejects.toThrow("使用中");
    expect(build).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled();
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });

  it.each(["build", "browser", "extension", "navigation"])("releases the port and temporary profile after %s failure", async stage => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort(), { context, cdp, page } = fakeChrome();
    let profile;
    const fail = () => { throw new Error("test failure"); };
    const launch = async directory => { profile = directory; if (stage === "browser") fail(); return context; };
    if (stage === "extension") cdp.send.mockImplementation(fail);
    if (stage === "navigation") page.goto.mockImplementation(fail);
    await expect(startDemo({ port }, { build: stage === "build" ? fail : vi.fn(), launch })).rejects.toThrow();
    if (profile) await expect(access(profile)).rejects.toThrow();
    if (["extension", "navigation"].includes(stage)) expect(context.close).toHaveBeenCalledOnce();
    const restarted = await listenDemoServer(port);
    await closeServer(restarted);
  });

  it("honors cancellation while building before opening Chrome", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort(), controller = new AbortController(), launch = vi.fn();
    await expect(startDemo({ port, signal: controller.signal }, { build: () => controller.abort(), launch })).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
    const restarted = await listenDemoServer(port);
    await closeServer(restarted);
  });

  it("stops when the final demo tab closes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const port = await freePort(), { context, page } = fakeChrome();
    const demo = await startDemo({ port }, { build: vi.fn(), launch: async () => context });
    cleanups.push(() => demo.close());
    const onClose = page.once.mock.calls.find(([event]) => event === "close")[1];
    context.pages.mockReturnValue([]);
    onClose();
    await demo.closed;
    expect(context.close).toHaveBeenCalledOnce();
  });
});
