import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromiumBuild = path.join(projectRoot, "dist-chromium");
const demoDirectory = path.join(projectRoot, "demo");
const targetUrl = process.env.SILVER_GUIDE_DEMO_URL ?? "http://127.0.0.1:4174/test-page.html";
const edgeExecutable =
  process.env.SILVER_GUIDE_EDGE_PATH ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ffmpegExecutable = process.env.SILVER_GUIDE_FFMPEG_PATH ?? "ffmpeg";
const videoPath = path.join(demoDirectory, "silver-guide-demo.mp4");
const legacyVideoPath = path.join(demoDirectory, "silver-guide-demo.webm");
const summaryPath = path.join(demoDirectory, "silver-guide-demo-summary.json");
const browserFramePath = path.join(projectRoot, "scripts", "browser-frame.svg");
const browserFrameImagePath = path.join(demoDirectory, "silver-guide-browser-frame.png");

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

async function composeBrowserRecording(recordingPath) {
  const recording = spawn(
    ffmpegExecutable,
    [
      "-y",
      "-loop",
      "1",
      "-i",
      browserFrameImagePath,
      "-i",
      recordingPath,
      "-filter_complex",
      "[1:v]scale=1268:740[page];[0:v][page]overlay=6:106:shortest=1[composite]",
      "-map",
      "[composite]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-shortest",
      videoPath
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
  );
  let errors = "";
  recording.stderr.on("data", (chunk) => {
    errors += chunk.toString();
  });
  await once(recording, "spawn");
  const [code] = await once(recording, "exit");
  if (code !== 0) {
    throw new Error(`ブラウザ枠を含む動画の合成に失敗しました。${errors}`);
  }
}

async function createBrowserFrame() {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: edgeExecutable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 852 } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(browserFramePath).href);
    await page.screenshot({ path: browserFrameImagePath });
  } finally {
    await browser?.close();
  }
}

async function main() {
  console.log("Preparing the recording environment.");
  await mkdir(demoDirectory, { recursive: true });
  await rm(videoPath, { force: true });
  await rm(legacyVideoPath, { force: true });
  await rm(browserFrameImagePath, { force: true });
  const extensionDirectory = await createRecordingExtension();
  const profileDirectory = await mkdtemp(path.join(tmpdir(), "silver-guide-demo-profile-"));
  const recordingDirectory = await mkdtemp(path.join(tmpdir(), "silver-guide-demo-video-"));
  const consoleMessages = [];
  let context;

  try {
    console.log("Launching isolated Edge.");
    context = await chromium.launchPersistentContext(profileDirectory, {
      executablePath: edgeExecutable,
      headless: false,
      viewport: { width: 1280, height: 740 },
      recordVideo: { dir: recordingDirectory, size: { width: 1280, height: 740 } },
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
    await wait(1_700);
    console.log("Starting Silver Guide.");
    const worker = await getExtensionWorker(context);
    const activation = await enableAssistant(worker, targetUrl);
    await page.waitForFunction(() =>
      Boolean(document.querySelector("#silver-guide-host")?.shadowRoot?.querySelector("#silver-guide-dock"))
    );
    await page.waitForFunction(
      () => document.querySelectorAll("[data-silver-guide-generated=true]").length > 0,
      { timeout: 10_000 }
    );
    await wait(900);

    const dock = page.locator("#silver-guide-host").locator("#silver-guide-dock");
    const dockBounds = await dock.boundingBox();
    const terms = page.locator("[data-silver-guide-generated=true]");
    const termCount = await terms.count();
    let visibleTermIndex = -1;
    let visibleTerm = null;
    for (let index = 0; index < termCount; index += 1) {
      const term = terms.nth(index);
      const bounds = await term.boundingBox();
      if (
        bounds !== null &&
        (dockBounds === null ||
          bounds.x + bounds.width / 2 < dockBounds.x ||
          bounds.x + bounds.width / 2 > dockBounds.x + dockBounds.width ||
          bounds.y + bounds.height / 2 < dockBounds.y ||
          bounds.y + bounds.height / 2 > dockBounds.y + dockBounds.height)
      ) {
        visibleTermIndex = index;
        visibleTerm = await term.textContent();
        break;
      }
    }
    const beforeInteraction = {
      termCount,
      dockLeft: dockBounds?.x ?? null,
      dockTop: dockBounds?.y ?? null,
      visibleTermIndex,
      visibleTerm
    };
    if (
      beforeInteraction.termCount < 1 ||
      beforeInteraction.dockLeft !== 18 ||
      beforeInteraction.dockTop !== 18 ||
      beforeInteraction.visibleTermIndex < 0
    ) {
      throw new Error(`初期支援状態が想定と異なります: ${JSON.stringify(beforeInteraction)}`);
    }
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-dock.png") });
    await wait(2_300);

    await terms.nth(beforeInteraction.visibleTermIndex).click();
    await page.locator("#silver-guide-host").evaluate((host) => {
      const tooltip = host.shadowRoot?.querySelector("#silver-guide-tooltip");
      if (tooltip?.getAttribute("data-open") !== "true") {
        throw new Error("用語説明が開きませんでした。");
      }
    });
    await wait(2_600);
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-tooltip.png") });

    await page.keyboard.press("Escape");
    await page.locator("#name").click();
    await page.locator("#silver-guide-host").evaluate((host) => {
      if (!host.shadowRoot?.textContent?.includes("入力のヒント")) {
        throw new Error("入力補助が表示されませんでした。");
      }
    });
    await wait(2_600);
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-input-help.png") });

    await shadowClick(page, "button.next");
    await page.locator("#contact").evaluate((field) => {
      if (document.activeElement !== field) {
        throw new Error("次の入力欄へ移動できませんでした。");
      }
    });
    await wait(2_600);
    await page.screenshot({ path: path.join(demoDirectory, "silver-guide-next-field.png") });

    const recordedVideo = page.video();
    if (recordedVideo === null) {
      throw new Error("ページ録画を開始できませんでした。");
    }
    await page.close();
    const recordingPath = await recordedVideo.path();
    await context.close();
    context = undefined;
    await createBrowserFrame();
    await composeBrowserRecording(recordingPath);
    await rm(recordingPath, { force: true });
    await rm(browserFrameImagePath, { force: true });

    await writeFile(
      summaryPath,
      `${JSON.stringify(
        {
          targetUrl,
          activation,
          beforeInteraction,
          consoleMessages,
          recording: "Chromium recording composited into a browser frame",
          videoPath
        },
        null,
        2
      )}\n`
    );
    console.log(JSON.stringify({ videoPath, summaryPath, beforeInteraction, consoleMessages }, null, 2));
  } finally {
    await context?.close();
    await rm(profileDirectory, { recursive: true, force: true });
    await rm(recordingDirectory, { recursive: true, force: true });
    await rm(extensionDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
