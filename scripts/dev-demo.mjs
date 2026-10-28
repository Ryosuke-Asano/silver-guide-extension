import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { listenDemoServer } from "../demo/server.mjs";
import { lockMeasurements } from "../demo/measurement-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function demoOptions(args = [], env = process.env) {
  const { values } = parseArgs({ args, options: {
    port: { type: "string" }, chrome: { type: "string" }, manual: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  const port = Number(values.port ?? env.SILVERGUIDE_DEMO_PORT ?? 4287);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("ポート番号は1024〜65535を指定してください。");
  return { port, chromeExecutable: values.chrome ?? env.SILVERGUIDE_CHROME_EXECUTABLE, manual: values.manual ?? false, help: values.help };
}

export function chromeOptions({ chromeExecutable, headless = false } = {}) {
  return {
    ...(chromeExecutable ? { executablePath: resolve(chromeExecutable) } : { channel: "chrome" }),
    headless, viewport: null, chromiumSandbox: true, timeout: 30_000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    // Playwright uses a private debugging pipe, with a new temporary profile.
    // Installed Chrome no longer supports --load-extension on its command line.
    args: ["--enable-unsafe-extension-debugging", "--no-default-browser-check"],
  };
}

function runNode(args, signal) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", shell: false, windowsHide: true, signal });
    child.once("error", reject);
    child.once("exit", (code, exitSignal) => code === 0 ? resolveRun() : reject(new Error(`ビルドに失敗しました（${exitSignal ?? code}）。`)));
  });
}

async function buildLatest(signal) {
  await runNode([join(root, "node_modules/typescript/bin/tsc"), "--noEmit"], signal);
  await runNode([join(root, "scripts/build-extension.mjs"), "--chromium"], signal);
}

export async function startDemo(options = {}, dependencies = {}) {
  const { port = 4287, signal, manual = false, resultsFile = join(root, ".demo-results", "runs.json") } = options;
  const build = dependencies.build ?? buildLatest;
  const launch = dependencies.launch ?? ((profile, settings) => chromium.launchPersistentContext(profile, settings));
  let server, context, profile, closing, releaseMeasurements;
  let finish;
  const closed = new Promise(resolveClosed => { finish = resolveClosed; });
  const onAbort = () => { void close().catch(error => { console.error(`デモの終了処理に失敗しました: ${error.message}`); process.exitCode = 1; }); };
  // Defer cleanup until the shared promise is assigned: context.close() may
  // synchronously emit another close event while a shutdown is in progress.
  const close = () => closing ??= Promise.resolve().then(async () => {
    signal?.removeEventListener("abort", onAbort);
    try { await context?.close(); }
    finally {
      try {
        if (server?.listening) await new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); });
        await server?.flushMeasurements?.();
      } finally {
        try { await releaseMeasurements?.(); }
        finally {
          try { if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
          finally { finish(); }
        }
      }
    }
  });
  try {
    signal?.throwIfAborted();
    try { server = await listenDemoServer(port, { measurement: { filename: resultsFile, condition: manual ? "manual" : "silver-guide",
      getBuildId: async () => JSON.parse(await readFile(join(root, "dist-chromium", "build-info.json"), "utf8")).sourceHash } }); }
    catch (error) {
      if (error.code === "EADDRINUSE") throw new Error(`${port}番ポートは使用中です。先に起動したデモサーバーを終了してから再実行してください。`, { cause: error });
      throw error;
    }
    releaseMeasurements = await lockMeasurements(resultsFile);
    if (!manual) { console.log("最新の拡張をビルドしています…"); await build(signal); }
    signal?.throwIfAborted();
    profile = await mkdtemp(join(tmpdir(), "silver-guide-demo-"));
    try { context = await launch(profile, chromeOptions(options)); }
    catch (error) {
      throw new Error("Chromeを起動できませんでした。最新版のGoogle Chromeをインストールしてください。標準以外の場所にある場合は npm run dev:demo -- --chrome \"実行ファイルのパス\" を使えます。\n" + error.message, { cause: error });
    }
    signal?.throwIfAborted();
    const cdp = await context.browser().newBrowserCDPSession();
    let extensionId;
    try { if (!manual) ({ id: extensionId } = await cdp.send("Extensions.loadUnpacked", { path: join(root, "dist-chromium") })); }
    catch (error) { throw new Error("拡張を自動で読み込めませんでした。Google Chromeを最新版に更新してください。\n" + error.message, { cause: error }); }
    // Preserve Chrome's normal save dialog and permanent Downloads folder.
    // Playwright's default download directory is deleted when the browser closes.
    await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
    await cdp.detach();
    const page = context.pages()[0] ?? await context.newPage();
    const url = `http://127.0.0.1:${port}/`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (!manual) await page.getByRole("button", { name: /Silver Guideで記入/ }).first().waitFor({ state: "visible", timeout: 15_000 });
    await page.bringToFront();
    signal?.throwIfAborted();
    context.once("close", onAbort);
    const watchPage = tab => tab.once("close", () => { if (!context.pages().length) onAbort(); });
    context.pages().forEach(watchPage);
    context.on("page", watchPage);
    signal?.addEventListener("abort", onAbort, { once: true });
    return { url, context, page, extensionId, profile, resultsFile, close, closed };
  } catch (error) {
    await close();
    throw error;
  }
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  signals.forEach(signal => process.once(signal, stop));
  try {
    const options = demoOptions(process.argv.slice(2));
    if (options.help) {
      console.log("npm run dev:demo [-- --manual] [-- --port 4287] [-- --chrome \"実行ファイルのパス\"]\nWindows・macOS・LinuxのGoogle Chromeで、最新版の拡張とデモを起動します。\n--manual: 拡張を読み込まず、通常の手作業を計測します。\n終了: Ctrl+C またはデモ用Chromeのウィンドウを閉じる。");
      return;
    }
    const demo = await startDemo({ ...options, signal: controller.signal });
    console.log(`\nデモの準備ができました: ${demo.url}\n${options.manual ? "拡張なしのChromeで、通常の手作業を比較できます。" : "最新版のSilver Guideを読み込んだChromeが開いています。"}\n計測結果: ${demo.url}results.html\n保存先: ${demo.resultsFile}\n終了: Ctrl+C またはデモ用Chromeのウィンドウを閉じる。`);
    await demo.closed;
  } catch (error) {
    if (!controller.signal.aborted) { console.error(error.message); process.exitCode = 1; }
  } finally { signals.forEach(signal => process.off(signal, stop)); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
