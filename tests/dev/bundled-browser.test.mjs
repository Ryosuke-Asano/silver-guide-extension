import { expect, it } from "vitest";
import { chromium } from "playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromeOptions } from "../../scripts/dev-demo.mjs";
import { nativePanel } from "./native-panel.mjs";

it.skipIf(process.env.SILVERGUIDE_DEMO_SMOKE !== "1")("opens both packaged demo modes without timing controls and completes their PDF workflows offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "silver-guide-bundled-")), errors = [], remote = [];
  let context;
  const launch = async (profile = "profile") => {
    const browser = await chromium.launchPersistentContext(join(directory, profile), chromeOptions({ headless: true, chromeExecutable: process.env.SILVERGUIDE_CHROME_EXECUTABLE }));
    await browser.route(/^https?:\/\//u, route => { remote.push(route.request().url()); return route.abort(); });
    browser.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const cdp = await browser.browser().newBrowserCDPSession();
    const { id } = await cdp.send("Extensions.loadUnpacked", { path: resolve("dist-chromium") });
    await cdp.detach();
    return { browser, id, root: `chrome-extension://${id}/` };
  };
  const fillForm = async page => {
    for (const [id, value] of Object.entries({ "full-name": "桜木 町子", "name-kana": "サクラギ マチコ", "birth-year": "1994",
      "zip-first": "220", "zip-last": "0032", address: "西区みほん町1−2−3", "phone-first": "045", "phone-middle": "0000", "phone-last": "0000" })) await page.locator(`#${id}`).fill(value);
  };
  try {
    let launched = await launch(); context = launched.browser;
    const { root } = launched;
    const setup = await context.newPage(); await setup.setViewportSize({ width: 1366, height: 900 });
    await setup.goto(root + "demo/setup.html");
    await setup.locator("#setup-build").filter({ hasText: "ビルド" }).waitFor();
    await setup.getByRole("link", { name: /^Silver Guideあり/u }).click();
    const source = setup, sourceUrl = source.url();
    await source.getByRole("button", { name: /Silver Guideで記入/u }).first().waitFor();
    expect(await source.title()).toContain("Silver Guideあり");
    expect(await source.locator("#measurement,#measurement-gate,#bundled-mode").count()).toBe(0);
    expect(await source.locator("#input-stage").evaluate(element => element.inert)).toBe(false);
    expect(await source.locator("body").innerText()).not.toMatch(/計測|参加者番号|CSV/u);
    // A second assisted document must not answer the first document's requests.
    const other = await context.newPage(); await other.goto(sourceUrl + "&practice=1&slot=other");
    await other.getByRole("button", { name: /Silver Guideで記入/u }).first().waitFor();
    await source.bringToFront();
    await source.locator(".yk-intro").evaluate(element => {
      const nodes = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const text = nodes.map(node => node.textContent).join(""), start = text.indexOf("してください。");
      const at = offset => { for (const node of nodes) { if (offset <= node.textContent.length) return [node, offset]; offset -= node.textContent.length; } throw new Error("Missing selection"); };
      const range = document.createRange(); range.setStart(...at(start)); range.setEnd(...at(start + "してください。".length));
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    const panel = await nativePanel({ context, extensionId: launched.id, url: sourceUrl, page: source });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await panel.evaluate("document.querySelector('blockquote mark')?.textContent === 'してください。'")) break;
      await source.waitForTimeout(100);
    }
    expect(await panel.evaluate("document.querySelector('blockquote mark')?.textContent")).toBe("してください。");
    expect(await panel.evaluate("document.querySelector('dd')?.textContent")).toBe("利用者情報を入力してください。");
    expect(await source.locator("#input-stage").evaluate(element => element.inert)).toBe(false);
    await fillForm(source);
    const opened = context.waitForEvent("page");
    await source.getByRole("button", { name: /Silver Guideで記入/u }).first().click();
    const pdf = await opened;
    await pdf.getByRole("heading", { name: "手続の内容", exact: true }).waitFor();
    await pdf.locator("[data-pdf-preview-state=ready]").waitFor({ timeout: 60_000 });
    expect(await pdf.locator(".pdf-entry-progress").innerText()).toBe("1 / 14");
    await pdf.getByRole("checkbox", { name: "PDF上の新規登録", exact: true }).click();
    await pdf.getByRole("button", { name: "次へ", exact: true }).click();
    const answers = ["桜木", "町子", "サクラギ", "マチコ", "220", "0032", "西区みほん町1−2−3", "045", "0000", "0000", "000", "0000", "0000"];
    for (let index = 0; index < answers.length; index++) {
      await pdf.locator("[data-pdf-answer]").fill(answers[index]);
      if (index < answers.length - 1) await pdf.getByRole("button", { name: "次へ", exact: true }).click();
    }
    await pdf.getByRole("button", { name: "入力を完了", exact: true }).click();
    await pdf.getByRole("heading", { name: "模擬提出が完了しました", exact: true }).waitFor({ timeout: 60_000 });
    expect(await source.locator("#complete-stage").isVisible()).toBe(true);
    expect(await source.locator("#complete-stage").innerText()).not.toMatch(/計測|参加者|記録しました/u);
    const filled = Buffer.from(await source.locator("#pdf-upload").evaluate(async input => Array.from(new Uint8Array(await input.files[0].arrayBuffer()))));
    const manual = await context.newPage(); await manual.goto(root + "demo/index.html?condition=manual");
    await manual.locator("#full-name").waitFor();
    expect(await manual.title()).toContain("支援なし");
    expect(await manual.locator("#measurement,#measurement-gate,#bundled-mode").count()).toBe(0);
    expect(await manual.locator("#input-stage").evaluate(element => element.inert)).toBe(false);
    expect(await manual.evaluate(() => typeof window.__silverGuideV3Stop)).toBe("undefined");
    expect(await manual.locator("[data-silver-guide-pdf-entry],[data-silver-guide-form-tooltip]").count()).toBe(0);
    await fillForm(manual);
    await manual.locator("#review-button").click();
    expect(await manual.locator("#review-stage").isVisible()).toBe(true);
    await manual.locator("#edit-button").click();
    const download = manual.waitForEvent("download"); await manual.locator("#pdf-download").click();
    const original = await download;
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    expect(sha(await readFile(await original.path()))).toBe(sha(await readFile("demo/assets/library-application-original.pdf")));
    // Exercises the manual attachment path; native PDF editing is a separate
    // on-device rehearsal, not a simulated claim about human completion time.
    await manual.locator("#pdf-upload").setInputFiles({ name: "fictional-filled.pdf", mimeType: "application/pdf", buffer: filled });
    await manual.locator("#pdf-upload-status").filter({ hasText: "を添付しました" }).waitFor();
    await manual.locator("#review-button").click(); await manual.locator("#complete-button").click();
    expect(await manual.locator("#complete-stage").isVisible()).toBe(true);
    expect(await source.evaluate(async () => (await indexedDB.databases()).map(item => item.name))).toEqual([]);
    expect(await source.evaluate(() => localStorage.length)).toBe(0);
    const guide = await context.newPage(); await guide.goto(root + "demo/guide.html");
    expect(await guide.locator("body").innerText()).not.toMatch(/計測|参加者番号|CSV/u);
    await manual.getByRole("button", { name: "最初から試す", exact: true }).click();
    expect(await manual.locator("#full-name").inputValue()).toBe("");
    expect(await manual.locator("#input-stage").evaluate(element => element.inert)).toBe(false);
    await manual.getByRole("link", { name: "デモの開始画面へ", exact: true }).click();
    expect(await manual.locator(".yk-demo-choice").count()).toBe(2);
    expect(remote).toEqual([]); expect(errors).toEqual([]);
  } finally { await context?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}, 120_000);
