import { expect, it } from "vitest";
import { startDemo } from "../../scripts/dev-demo.mjs";

// The desktop CI matrix builds the extension and uses its installed Chrome.
// Ordinary unit tests do not launch an additional browser or claim port 4287.
it.skipIf(process.env.SILVERGUIDE_DEMO_SMOKE !== "1")("starts the desktop demo, fills a PDF, and completes the original form", async () => {
  const demo = await startDemo({ headless: true,
    chromeExecutable: process.env.SILVERGUIDE_CHROME_EXECUTABLE,
  }, { build: async () => {} });
  const errors = [];
  demo.context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  demo.page.on("pageerror", error => errors.push(error.message));
  try {
    expect(await demo.page.title()).toContain("利用者情報仮登録");
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
    expect(errors).toEqual([]);
  } finally { await demo.close(); }
}, 120_000);
