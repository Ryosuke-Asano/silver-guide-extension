import { expect, it } from "vitest";
import { chromium } from "playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromeOptions } from "../../scripts/dev-demo.mjs";
import { nativePanel } from "./native-panel.mjs";

it.skipIf(process.env.SILVERGUIDE_DEMO_SMOKE !== "1")("runs the packaged comparison offline, isolates assistance, persists records and merges another device without duplicates", async () => {
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
    await setup.locator("#setup-participant").fill("07");
    expect(await setup.locator("#setup-order").innerText()).toContain("参加者7：支援なし → Silver Guideあり");
    await setup.getByRole("link", { name: /記録せずに練習する.*Silver Guideあり/u }).click();
    expect(await setup.locator("#bundled-mode").innerText()).toContain("練習（記録しません）");
    await setup.getByRole("button", { name: /Silver Guideで記入/u }).first().waitFor();
    expect(await setup.locator("#measurement").isVisible()).toBe(false);
    expect(await setup.locator("#input-stage").evaluate(element => element.inert)).toBe(false);
    await fillForm(setup);
    await setup.locator("#review-button").click(); await setup.locator("#complete-button").click();
    expect(await setup.locator("#complete-stage").isVisible()).toBe(true);
    expect(await setup.locator("html").getAttribute("data-silver-guide-measure")).toBe(null);
    const practiceResults = await context.newPage(); await practiceResults.goto(root + "demo/results.html");
    await practiceResults.locator("#results-status").filter({ hasText: "まだありません" }).waitFor();
    expect(await practiceResults.locator("#results-runs tr").count()).toBe(0);
    await practiceResults.close();
    await setup.getByRole("link", { name: "練習を終えて開始画面へ", exact: true }).click();
    await setup.locator("#setup-build").filter({ hasText: "ビルド" }).waitFor();
    expect(await setup.locator("#setup-participant").inputValue()).toBe("7");
    await setup.getByRole("link", { name: /^Silver Guideあり/u }).click();
    const source = setup, sourceUrl = source.url();
    await source.getByRole("button", { name: "入力をクリアして計測開始", exact: true }).waitFor();
    await source.locator("#measurement-start:not([disabled])").waitFor();
    expect(await source.locator("#bundled-mode").innerText()).toContain("Silver Guideあり");
    expect(await source.locator("#measurement-participant").inputValue()).toBe("7");
    expect(await source.locator("#input-stage").evaluate(element => element.inert)).toBe(true);
    expect(await source.locator("#measurement-gate").isVisible()).toBe(true);
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
    await source.locator("#measurement-start").click();
    await source.locator("#measurement-status").filter({ hasText: "計測中：参加者" }).waitFor();
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
    await source.locator("#measurement-status").filter({ hasText: "記録しました" }).waitFor();
    expect(await source.locator("#complete-stage").isVisible()).toBe(true);
    expect(await source.locator("#complete-measurement-status").innerText()).toContain("記録しました");
    expect(await source.locator("#measurement-next-condition").getAttribute("href")).toContain("condition=manual&participant=7");
    expect(await source.locator("#measurement-next-participant").getAttribute("href")).toBe("setup.html?participant=8");
    const filled = Buffer.from(await source.locator("#pdf-upload").evaluate(async input => Array.from(new Uint8Array(await input.files[0].arrayBuffer()))));
    const manual = await context.newPage(); await manual.goto(new URL(await source.locator("#measurement-next-condition").getAttribute("href"), source.url()).href);
    await manual.locator("#measurement-start:not([disabled])").waitFor();
    expect(await manual.evaluate(() => typeof window.__silverGuideV3Stop)).toBe("undefined");
    expect(await manual.locator("[data-silver-guide-pdf-entry],[data-silver-guide-form-tooltip]").count()).toBe(0);
    await manual.locator("#measurement-start").click();
    await manual.locator("#measurement-status").filter({ hasText: "計測中：参加者" }).waitFor();
    await fillForm(manual);
    await manual.locator("#review-button").click();
    expect(await manual.locator("#form-errors").innerText()).toContain("比較の計測にはPDFが必要です");
    expect(await manual.locator("#review-stage").isVisible()).toBe(false);
    const download = manual.waitForEvent("download"); await manual.locator("#pdf-download").click();
    const original = await download;
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    expect(sha(await readFile(await original.path()))).toBe(sha(await readFile("demo/assets/library-application-original.pdf")));
    // Exercises the manual attachment path; native PDF editing is a separate
    // on-device rehearsal, not a simulated claim about human completion time.
    await manual.locator("#pdf-upload").setInputFiles({ name: "fictional-filled.pdf", mimeType: "application/pdf", buffer: filled });
    await manual.locator("#pdf-upload-status").filter({ hasText: "を添付しました" }).waitFor();
    await manual.locator("#review-button").click(); await manual.locator("#complete-button").click();
    await manual.locator("#measurement-status").filter({ hasText: "記録しました" }).waitFor();
    const results = await context.newPage(); await results.goto(root + "demo/results.html");
    await results.locator("#results-pairs").filter({ hasText: "1人・1組" }).waitFor();
    expect(await results.locator("#results-runs tr").count()).toBe(2);
    const exportDownload = results.waitForEvent("download"); await results.locator("#results-export").click();
    const file = await exportDownload, exported = await readFile(await file.path(), "utf8"), parsed = JSON.parse(exported);
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0]).toMatchObject({ participant: 7, condition: "silver-guide", status: "completed", measurements: { pdfAttached: true, pdfOpens: 1 } });
    expect(parsed.runs[0].measurements.prepareMs).toBeGreaterThan(0); expect(parsed.runs[0].measurements.outputMs).toBeGreaterThan(0);
    expect(parsed.runs[1]).toMatchObject({ participant: 7, condition: "manual", measurements: { prepareMs: null, outputMs: null, sourceMs: null, validationFailures: 1 } });
    expect(exported).not.toMatch(/桜木|fictional-filled|userAgent/u);
    const csvDownload = results.waitForEvent("download"); await results.locator("#results-csv").click();
    expect(await readFile(await (await csvDownload).path(), "utf8")).toContain('"total_seconds"');
    await context.close(); context = undefined;
    // Same installed package/profile: durable records survive Chrome restart.
    launched = await launch(); context = launched.browser;
    const restarted = await context.newPage(); await restarted.goto(launched.root + "demo/results.html");
    await restarted.locator("#results-pairs").filter({ hasText: "1人・1組" }).waitFor();
    expect(await restarted.locator("#results-runs tr").count()).toBe(2);
    await context.close(); context = undefined;
    // A different device/profile imports both conditions, then imports again.
    launched = await launch("other-device"); context = launched.browser;
    const merged = await context.newPage(); await merged.goto(launched.root + "demo/results.html");
    for (let attempt = 0; attempt < 2; attempt++) {
      await merged.locator("#results-import").setInputFiles({ name: "silver-guide-records.json", mimeType: "application/json", buffer: Buffer.from(exported) });
      await merged.locator("#results-import-status").filter({ hasText: `${attempt ? 0 : 2}件を追加` }).waitFor();
      expect(await merged.locator("#results-runs tr").count()).toBe(2);
    }
    const before = await merged.locator("#results-runs").innerText();
    await merged.locator("#results-import").setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...parsed, answers: "private" })) });
    await merged.locator("#results-import-status").filter({ hasText: "取り込めません" }).waitFor();
    expect(await merged.locator("#results-runs").innerText()).toBe(before);
    expect(remote).toEqual([]); expect(errors).toEqual([]);
  } finally { await context?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}, 120_000);
