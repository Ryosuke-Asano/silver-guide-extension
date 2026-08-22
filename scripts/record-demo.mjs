import { chromium } from "playwright";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromiumBuild = path.join(projectRoot, "dist-chromium");
const demoDirectory = path.join(projectRoot, "demo");
const targetUrl = process.env.SILVER_GUIDE_DEMO_URL ?? "http://127.0.0.1:4174/test-page.html";
const edgeExecutable =
  process.env.SILVER_GUIDE_EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const videoPath = path.join(demoDirectory, "silver-guide-demo.webm");
const summaryPath = path.join(demoDirectory, "silver-guide-demo-summary.json");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createRecordingExtension() {
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), "silver-guide-demo-extension-"));
  await cp(chromiumBuild, stagingDirectory, { recursive: true });
  const manifestPath = path.join(stagingDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return stagingDirectory;
}

async function getExtensionWorker(context) {
  const existing = context.serviceWorkers().find((worker) => worker.url().endsWith("/background.js"));
  return existing ?? context.waitForEvent("serviceworker", { timeout: 15_000 });
}

async function enableAssistant(worker, url) {
  return worker.evaluate(async ({ pageUrl }) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    if (tab?.id === undefined) {
      throw new Error("録画対象のタブを見つけられませんでした。");
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tab.id, {
      type: "silver-guide-enable",
      settings: { fontSize: "medium", showOriginal: true }
    });
  }, { pageUrl: url });
}

async function shadowClick(page, selector) {
  await page.locator("#silver-guide-host").evaluate((host, buttonSelector) => {
    const button = host.shadowRoot?.querySelector(buttonSelector);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`支援パネル内の ${buttonSelector} を見つけられませんでした。`);
    }
    button.click();
  }, selector);
}

async function main() {
  console.log("Preparing the recording environment.");
  await mkdir(demoDirectory, { recursive: true });
  await rm(videoPath, { force: true });
  const extensionDirectory = await createRecordingExtension();
  const profileDirectory = await mkdtemp(path.join(tmpdir(), "silver-guide-demo-profile-"));
  const consoleMessages = [];
  let context;

  try {
    console.log("Launching isolated Edge.");
    context = await chromium.launchPersistentContext(profileDirectory, {
      executablePath: edgeExecutable,
      headless: false,
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: demoDirectory, size: { width: 1280, height: 720 } },
      args: [
        `--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleMessages.push({ type: message.type(), text: message.text() });
      }
    });

    console.log("Loading the demonstration page.");
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.bringToFront();
    console.log("Starting Silver Guide.");
    const worker = await getExtensionWorker(context);
    const activation = await enableAssistant(worker, targetUrl);
    await page.waitForFunction(() =>
      Boolean(document.querySelector("#silver-guide-host")?.shadowRoot?.querySelector("#silver-guide-dock"))
    );
    await wait(900);

    const beforeInteraction = await page.evaluate(() => {
      const dock = document.querySelector("#silver-guide-host")?.shadowRoot?.querySelector("#silver-guide-dock");
      const bounds = dock?.getBoundingClientRect();
      return {
        termCount: document.querySelectorAll("[data-silver-guide-generated=true]").length,
        dockLeft: bounds?.left ?? null,
        dockTop: bounds?.top ?? null
      };
    });
    if (beforeInteraction.termCount < 1 || beforeInteraction.dockLeft !== 18 || beforeInteraction.dockTop !== 18) {
      throw new Error(`初期支援状態が想定と異なります: ${JSON.stringify(beforeInteraction)}`);
    }
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-dock.png") });

    await shadowClick(page, "button.next");
    await page.locator("#silver-guide-host").evaluate((host) => {
      const tooltip = host.shadowRoot?.querySelector("#silver-guide-tooltip");
      if (tooltip?.getAttribute("data-open") !== "true") {
        throw new Error("用語説明が開きませんでした。");
      }
    });
    await wait(1_200);
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-tooltip.png") });

    await page.keyboard.press("Escape");
    await page.locator("#name").click();
    await page.locator("#silver-guide-host").evaluate((host) => {
      if (!host.shadowRoot?.textContent?.includes("入力のヒント")) {
        throw new Error("入力補助が表示されませんでした。");
      }
    });
    await wait(1_000);
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-input-help.png") });

    await shadowClick(page, "button.next");
    await page.locator("#contact").evaluate((field) => {
      if (document.activeElement !== field) {
        throw new Error("次の入力欄へ移動できませんでした。");
      }
    });
    await wait(1_000);
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-next-field.png") });

    const video = page.video();
    if (video === null) {
      throw new Error("動画録画が開始されませんでした。");
    }
    await page.close();
    const generatedVideoPath = await video.path();
    await context.close();
    context = undefined;
    await rename(generatedVideoPath, videoPath);

    await writeFile(
      summaryPath,
      `${JSON.stringify({ targetUrl, activation, beforeInteraction, consoleMessages, videoPath }, null, 2)}\n`
    );
    console.log(JSON.stringify({ videoPath, summaryPath, beforeInteraction, consoleMessages }, null, 2));
  } finally {
    await context?.close();
    await rm(profileDirectory, { recursive: true, force: true });
    await rm(extensionDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
