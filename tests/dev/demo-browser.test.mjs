import { expect, it } from "vitest";
import { startDemo } from "../../scripts/dev-demo.mjs";
import { nativePanel } from "./native-panel.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The desktop CI matrix builds the extension and uses its installed Chrome.
// Ordinary unit tests do not launch an additional browser or claim port 4287.
it.skipIf(process.env.SILVERGUIDE_DEMO_SMOKE !== "1")("measures assisted and manual PDF workflows and preserves their comparison across Chrome restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "silver-guide-demo-smoke-")), resultsFile = join(directory, "runs.json");
  let demo;
  try { demo = await startDemo({ headless: true, resultsFile,
    chromeExecutable: process.env.SILVERGUIDE_CHROME_EXECUTABLE,
  }, { build: async () => {} }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const errors = [];
  demo.context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  demo.page.on("pageerror", error => errors.push(error.message));
  try {
    expect(await demo.page.title()).toContain("利用者情報仮登録");
    await demo.page.locator(".yk-intro").evaluate(element => {
      const nodes = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const full = nodes.map(node => node.textContent).join(""), selected = "してください。申込書", start = full.indexOf(selected);
      const at = offset => { for (const node of nodes) { if (offset <= node.textContent.length) return [node, offset]; offset -= node.textContent.length; } throw new Error("Missing selection"); };
      const range = document.createRange(); range.setStart(...at(start)); range.setEnd(...at(start + selected.length));
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    const panel = await nativePanel(demo);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await panel.evaluate("document.querySelector('blockquote mark')?.textContent === 'してください。申込書'")) break;
      await demo.page.waitForTimeout(100);
    }
    expect(await panel.evaluate("document.querySelector('h1')?.textContent")).toBe("文章の説明");
    expect(await panel.evaluate("document.querySelector('dd')?.textContent")).toBe("利用者情報を入力してください。");
    expect(await panel.evaluate("document.querySelector('blockquote mark')?.textContent")).toBe("してください。申込書");
    expect(await panel.evaluate("document.querySelector('blockquote')?.textContent")).toContain("E-mail欄の下から試せます。");
    expect(await panel.evaluate("document.body.innerText")).not.toContain("前後の文も選んでください");
    await demo.page.locator("#measurement > summary").click();
    await demo.page.getByRole("button", { name: "入力をクリアして計測開始", exact: true }).click();
    await demo.page.getByRole("status").filter({ hasText: "計測中：参加者" }).waitFor();
    for (const [id, value] of Object.entries({ "full-name": "桜木 町子", "name-kana": "サクラギ マチコ", "birth-year": "1994",
      "zip-first": "220", "zip-last": "0032", address: "西区みほん町1−2−3", "phone-first": "045", "phone-middle": "0000", "phone-last": "0000" }))
      await demo.page.locator(`#${id}`).fill(value);
    const opened = demo.context.waitForEvent("page");
    await demo.page.getByRole("button", { name: /Silver Guideで記入/ }).first().click();
    const pdf = await opened;
    await pdf.getByRole("heading", { name: "手続の内容", exact: true }).waitFor();
    await pdf.locator("[data-pdf-preview-state=ready]").waitFor({ timeout: 60_000 });
    expect(await pdf.locator(".pdf-entry-progress").innerText()).toBe("1 / 14");
    await pdf.getByRole("checkbox", { name: "PDF上の新規登録", exact: true }).click();
    expect(await pdf.locator(".pdf-entry-options").getByRole("checkbox", { name: "新規登録", exact: true }).isChecked()).toBe(true);
    await pdf.getByRole("button", { name: "次へ", exact: true }).click();
    const values = ["桜木", "町子", "サクラギ", "マチコ", "220", "0032", "西区みほん町1−2−3", "045", "0000", "0000", "000", "0000", "0000"];
    for (let index = 0; index < values.length; index++) {
      await pdf.locator("[data-pdf-answer]").fill(values[index]);
      if (index < values.length - 1) await pdf.getByRole("button", { name: "次へ", exact: true }).click();
    }
    await pdf.getByRole("button", { name: "入力を完了", exact: true }).click();
    await pdf.getByRole("heading", { name: "模擬提出が完了しました", exact: true }).waitFor({ timeout: 60_000 });
    expect(await demo.page.locator("#complete-stage").isVisible()).toBe(true);
    expect(await demo.page.locator("#pdf-upload").evaluate(input => input.files[0].type)).toBe("application/pdf");
    await demo.page.locator("#measurement-status").filter({ hasText: "記録しました" }).waitFor();
    const assisted = (await (await fetch(demo.url + "api/measurement/results")).json()).runs[0];
    expect(assisted).toMatchObject({ condition: "silver-guide", status: "completed", participant: 1, measurements: { pdfAttached: true, pdfOpens: 1, validationFailures: 0 } });
    expect(assisted.measurements.totalMs).toBeGreaterThanOrEqual(assisted.measurements.pdfMs);
    expect(assisted.measurements.pdfMs).toBeGreaterThan(0);
    expect(assisted.measurements.prepareMs).toBeGreaterThan(0);
    expect(assisted.measurements.outputMs).toBeGreaterThan(0);
    const filledPdf = Buffer.from(await demo.page.locator("#pdf-upload").evaluate(async input => Array.from(new Uint8Array(await input.files[0].arrayBuffer()))));
    await demo.close();
    demo = await startDemo({ headless: true, manual: true, resultsFile, chromeExecutable: process.env.SILVERGUIDE_CHROME_EXECUTABLE }, { build: async () => {} });
    demo.page.on("pageerror", error => errors.push(error.message));
    expect(demo.extensionId).toBeUndefined();
    expect(await demo.page.getByRole("button", { name: /Silver Guideで記入/ }).count()).toBe(0);
    await demo.page.locator("#measurement > summary").click();
    await demo.page.getByRole("button", { name: "入力をクリアして計測開始", exact: true }).click();
    await demo.page.getByRole("status").filter({ hasText: "計測中：参加者" }).waitFor();
    for (const [id, value] of Object.entries({ "full-name": "桜木 町子", "name-kana": "サクラギ マチコ", "birth-year": "1994", "zip-first": "220", "zip-last": "0032", address: "西区みほん町1−2−3", "phone-first": "045", "phone-middle": "0000", "phone-last": "0000" }))
      await demo.page.locator(`#${id}`).fill(value);
    const cdp = await demo.context.browser().newBrowserCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
    await demo.page.locator("#pdf-download").click();
    await demo.page.locator("#pdf-upload").setInputFiles({ name: "fictional-filled.pdf", mimeType: "application/pdf", buffer: filledPdf });
    await demo.page.locator("#pdf-upload-status").filter({ hasText: "を添付しました" }).waitFor();
    await demo.page.getByRole("button", { name: "入力内容を確認する", exact: true }).click();
    await demo.page.getByRole("button", { name: "この内容で完了（模擬）", exact: true }).click();
    await demo.page.locator("#measurement-status").filter({ hasText: "記録しました" }).waitFor();
    const runs = (await (await fetch(demo.url + "api/measurement/results")).json()).runs;
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ condition: "manual", status: "completed", measurements: { pdfAttached: true, sourceMs: null, prepareMs: null, outputMs: null } });
    expect(JSON.stringify(runs)).not.toContain("桜木"); expect(JSON.stringify(runs)).not.toContain("fictional-filled.pdf");
    await demo.page.goto(demo.url + "results.html");
    await demo.page.locator("#results-pairs").filter({ hasText: "1人・1組" }).waitFor();
    expect(await demo.page.locator("#results-runs tr").count()).toBe(2);
    expect(await (await fetch(demo.url + "api/measurement/results.csv")).text()).toContain('"total_seconds"');
    expect(errors).toEqual([]);
  } finally { await demo.close(); await rm(directory, { recursive: true, force: true }); }
}, 120_000);
