import {
  test, expect, activate, dockFor, messagePage, pressFixtureButton,
  saveEvidence, installSensitiveAccessGuard, sensitiveAccessAudit, fieldSnapshot
} from "./extension.mjs";

test("legacy page presentation activates, updates settings, stops and resumes", async ({ page, worker, audit }) => {
  await page.goto("/semantic.html");
  await expect(page).toHaveTitle("架空の証明書申請 — Semantic fixture");
  await expect(page.locator("h1")).toHaveText("架空の証明書申請");
  await expect(page.locator("#silver-guide-host")).toHaveCount(0);
  await activate(worker, page);
  await expect(dockFor(page)).toBeVisible();
  await messagePage(worker, page, { type: "silver-guide-update-settings", settings: { fontSize: "large", showOriginal: true } });
  await expect(dockFor(page)).toHaveClass(/font-large/);
  await saveEvidence(page, "legacy-page-large-settings");
  await messagePage(worker, page, { type: "silver-guide-disable" });
  await expect(page.locator("#silver-guide-host")).toHaveCount(0);
  await expect(page.locator("[data-silver-guide-generated=true]")).toHaveCount(0);
  await activate(worker, page, { fontSize: "large", showOriginal: true });
  await expect(page.locator("#silver-guide-host")).toHaveCount(1);
  await expect(dockFor(page)).toHaveClass(/font-large/);
  expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
  expect(audit.pageErrors).toEqual([]);
  expect(audit.logs.filter((entry) => entry.type === "error" || entry.type === "warning")).toEqual([]);
});

test("native forms group radio choices and navigate only editable fields in the same form", async ({ page, worker, audit }) => {
  await page.goto("/semantic.html");
  const activation = await activate(worker, page);
  expect(activation.capabilities).toMatchObject({ canInput: true, hasVerifiedGuide: false, canProceed: false });
  const dock = dockFor(page);
  await expect(dock).toContainText("この画面の入力項目：8 項目。");
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#full-name")).toBeFocused();
  await expect(dock).toContainText("現在の項目：1 / 8");
  await expect(dock).toContainText("氏名");
  await expect(dock).toContainText("この項目は必須");
  await expect(dock).toContainText("証明書に記載する名前を確認してください。");
  await expect(dock.getByRole("button", { name: "前の項目へ" })).toHaveCount(0);
  const expectedFields = ["#birth-date", "#phone", "#purpose-school", "#copies", "#notification", "#attachment", "#notes"];
  for (let index = 0; index < expectedFields.length; index += 1) {
    await dock.getByRole("button", { name: "次の項目へ" }).click();
    await expect(page.locator(expectedFields[index])).toBeFocused();
    await expect(dock).toContainText(`現在の項目：${index + 2} / 8`);
    if (expectedFields[index] === "#purpose-school") {
      await expect(dock).toContainText("項目のまとまり：証明書の使用目的");
      await expect(dock).toContainText("同じ項目の選択肢から、1つをご自身で選びます。");
    }
  }
  await expect(dock.getByRole("button", { name: "次の項目へ" })).toHaveCount(0);
  await expect(dock).toContainText("次の画面への移動や送信は、ページのボタンをご自身で確認してください。");
  await saveEvidence(page, "desktop-last-field");
  await dock.getByRole("button", { name: "前の項目へ" }).click();
  await expect(page.locator("#attachment")).toBeFocused();
  await page.locator("#purpose-work").focus();
  await expect(dock).toContainText("現在の項目：4 / 8");
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#copies")).toBeFocused();
  await dock.getByRole("button", { name: "前の項目へ" }).click();
  await expect(page.locator("#purpose-school")).toBeFocused();
  await expect(page.locator("#purpose-school")).not.toBeChecked();
  await expect(page.locator("#purpose-work")).not.toBeChecked();
  await page.locator("#search-field").focus();
  await expect(dock).toContainText("ページ共通の入力欄（検索など）");
  await expect(dock).toContainText("現在の項目：1 / 1");
  await expect(dock.getByRole("button", { name: "次の項目へ" })).toHaveCount(0);
  await expect(dock.getByRole("button", { name: "前の項目へ" })).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
  expect(audit.pageErrors).toEqual([]);
});

test("ARIA references, table row headers and definition lists provide Japanese names and input facts", async ({ page, worker, audit }) => {
  await page.goto("/aria-table.html");
  await expect(page).toHaveTitle("架空の届出 — ARIA and table fixture");
  await activate(worker, page);
  const dock = dockFor(page);
  await expect(dock).toContainText("この画面の入力項目：5 項目。");
  await page.locator("#email").focus();
  await expect(dock.getByRole("heading", { name: "「申請者の 電子メール」について" })).toBeVisible();
  await expect(dock).toContainText("メールアドレスの形式で入力します。");
  await expect(dock).toContainText("この項目は必須");
  await expect(dock).toContainText("連絡を受け取れるメールアドレスを確認します。");
  await expect(page.getByRole("status")).toContainText("入力のヒント：申請者の 電子メール。");
  await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#postal")).toBeFocused();
  await expect(dock.getByRole("heading", { name: "「郵便番号」について" })).toBeVisible();
  await expect(dock).toContainText("数字用の入力方法");
  await expect(dock).toContainText("7文字以上");
  await expect(dock).toContainText("8文字まで");
  await expect(dock).toContainText("数字とハイフンで入力します。");
  await saveEvidence(page, "desktop-table-field");
  await page.locator("#address").focus();
  await expect(dock.getByRole("heading", { name: "「住所」について" })).toBeVisible();
  await expect(dock).toContainText("複数行の文章を入力できる欄です。");
  await page.locator("#contact-time").focus();
  await expect(dock.getByRole("heading", { name: "「連絡する時間帯」について" })).toBeVisible();
  expect(audit.pageErrors).toEqual([]);
  expect(audit.logs.filter((entry) => entry.type === "error" || entry.type === "warning")).toEqual([]);
});

test("page-declared and native errors support recovery without copying an echoed input value", async ({ page, worker }) => {
  await page.goto("/aria-table.html");
  await activate(worker, page);
  const dock = dockFor(page);
  await expect(dock.getByRole("button", { name: "最初のエラー項目へ" })).toHaveCount(0);
  await pressFixtureButton(page, "#show-errors");
  await expect(dock).toContainText("確認が必要な項目：1 件。");
  await dock.getByRole("button", { name: "最初のエラー項目へ" }).click();
  await expect(page.locator("#email")).toBeFocused();
  await expect(dock).toContainText("ページから入力エラーが通知されています。");
  await expect(dock).not.toContainText("FAKE-PRIVATE-EMAIL");
  await saveEvidence(page, "desktop-error-recovery");
  await pressFixtureButton(page, "#clear-errors");
  await expect(dock.getByRole("button", { name: "最初のエラー項目へ" })).toHaveCount(0);
  await expect(dock).not.toContainText("ページから入力エラーが通知されています。");
  await pressFixtureButton(page, "#check-native");
  await expect(dock).toContainText("確認が必要な項目：1 件。");
  await dock.getByRole("button", { name: "最初のエラー項目へ" }).click();
  await expect(page.locator("#native-required")).toBeFocused();
  await expect(dock).toContainText("ページから入力エラーが通知されています。");
  // Only the test/user fills a fake value; the assistant merely observes input.
  await page.locator("#native-required").fill("架空の確認内容");
  await expect(dock.getByRole("button", { name: "最初のエラー項目へ" })).toHaveCount(0);
  await expect(dock).not.toContainText("架空の確認内容");
  expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
});

test("dynamic controls, required attributes and replaced steps update without choosing the site's next step", async ({ page, worker }) => {
  await page.goto("/dynamic.html");
  await expect(page).toHaveTitle("架空の多段階フォーム — Dynamic fixture");
  await activate(worker, page);
  const dock = dockFor(page);
  await expect(dock).toContainText("この画面の入力項目：1 項目。");
  await expect(dock).toContainText("ページが示す現在の手順：1. 申請者の情報");
  await pressFixtureButton(page, "#reveal");
  await expect(dock).toContainText("この画面の入力項目：2 項目。");
  await expect(page.locator("#stage-title")).toHaveText("1. 申請者の情報");
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#stage-one")).toBeFocused();
  await expect(dock).toContainText("現在の項目：1 / 2");
  await page.locator("#stage-one").evaluate((field) => field.setAttribute("required", ""));
  await expect(dock).toContainText("この項目は必須");
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#conditional")).toBeFocused();
  await pressFixtureButton(page, "#next-stage");
  await expect(page.locator("#stage-one")).toHaveCount(0);
  await expect(dock).toContainText("この画面の入力項目：2 項目。");
  await expect(dock).not.toContainText("申請者の氏名");
  await expect(dock).toContainText("ページが示す現在の手順：2. 届出内容");
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#stage-two")).toBeFocused();
  await expect(dock).toContainText("届出内容");
  await expect(dock).toContainText("表示された内容を確認して、ご自身で記入します。");
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#stage-two-date")).toBeFocused();
  await expect(dock.getByRole("button", { name: "次の項目へ" })).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
  await saveEvidence(page, "desktop-dynamic-stage-two");
});

test("stopping restores page markup and resuming installs one keyboard-accessible assistant", async ({ page, worker, audit }) => {
  await page.goto("/semantic.html");
  const before = await page.locator("main").innerHTML();
  await activate(worker, page);
  await expect(page.locator("[data-silver-guide-generated=true]").first()).toBeVisible();
  const dock = dockFor(page);
  await dock.getByRole("button", { name: "最初の説明を読む" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-silver-guide-generated=true]").first()).toBeFocused();
  await dock.getByRole("button", { name: "閉じる", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#silver-guide-host")).toHaveCount(0);
  await expect(page.locator("#silver-guide-inline-style")).toHaveCount(0);
  expect(await page.locator("main").innerHTML()).toBe(before);
  await activate(worker, page);
  await activate(worker, page);
  await expect(page.locator("#silver-guide-host")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveCount(1);
  await dockFor(page).getByRole("button", { name: "最初の入力項目へ" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#full-name")).toBeFocused();
  await expect(page.getByRole("status")).toContainText("氏名");
  expect(audit.pageErrors).toEqual([]);
  expect(audit.logs.filter((entry) => entry.type === "error" || entry.type === "warning")).toEqual([]);
});

test("hidden previous stages and regions that become editable cannot retain glossary actions or dialogs", async ({ page, worker, audit }) => {
  await page.goto("/dynamic-information.html");
  await expect(page).toHaveTitle("架空の案内 — Hidden stages fixture");
  await installSensitiveAccessGuard(worker, page);
  await activate(worker, page);
  const dock = dockFor(page);
  await dock.getByRole("button", { name: "最初の説明を読む" }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "住民票 の説明");
  // Simulate the site's asynchronous DOM update while the dialog keeps focus;
  // moving focus to the fixture button would close it before the mutation.
  await page.locator("#change-screen").evaluate((button) => button.click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#old-stage")).toBeHidden();
  await dock.getByRole("button", { name: "最初の説明を読む" }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "年金 の説明");
  await page.locator("#make-editable").evaluate((button) => button.click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#new-explanation [data-silver-guide-generated]")).toHaveCount(0);
  await expect(page.locator("#new-explanation")).toHaveText("年金を確認します。");
  await expect(dock.getByRole("button", { name: "最初の説明を読む" })).toHaveCount(0);
  const accesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(accesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(accesses.reads)).toBe(0);
  expect(audit.pageErrors).toEqual([]);
});

test("a centered desktop form remains uncovered and a changed field reveals the start of its hint", async ({ page, worker, audit }) => {
  await page.setViewportSize({ width: 1280, height: 680 });
  await page.goto("/semantic.html");
  await activate(worker, page, { fontSize: "large", showOriginal: true });
  const dock = dockFor(page);
  await dock.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await dock.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#full-name")).toBeFocused();
  await expect.poll(() => dock.evaluate((element) => element.scrollTop)).toBe(0);
  let dockBounds = await dock.boundingBox();
  let fieldBounds = await page.locator("#full-name").boundingBox();
  const overlaps = (left, right) => left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
  expect(overlaps(fieldBounds, dockBounds)).toBe(false);
  await expect(dock.getByRole("heading", { name: "Silver Guide", exact: true })).toBeVisible();
  const position = await dock.getByText("現在の項目：1 / 8", { exact: true }).boundingBox();
  expect(position.y).toBeGreaterThanOrEqual(dockBounds.y);
  expect(position.y + position.height).toBeLessThanOrEqual(dockBounds.y + dockBounds.height);
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#birth-date")).toBeFocused();
  await expect.poll(() => dock.evaluate((element) => element.scrollTop)).toBe(0);
  dockBounds = await dock.boundingBox();
  fieldBounds = await page.locator("#birth-date").boundingBox();
  expect(overlaps(fieldBounds, dockBounds)).toBe(false);
  await saveEvidence(page, "desktop-centered-field-visible");
  expect(audit.pageErrors).toEqual([]);
});

test("390px viewport with large text keeps the dock and glossary dialog within the screen", async ({ page, worker, audit }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/semantic.html");
  await activate(worker, page, { fontSize: "large", showOriginal: true });
  const dock = dockFor(page);
  await expect(dock).toHaveClass(/font-large/);
  const bounds = await dock.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  const dimensions = await dock.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#full-name")).toBeFocused();
  await expect(dock).toContainText("現在の項目：1 / 8");
  await expect.poll(() => dock.evaluate((element) => element.scrollTop)).toBe(0);
  const fieldBounds = await page.locator("#full-name").boundingBox();
  const dockBounds = await dock.boundingBox();
  expect(fieldBounds.y).toBeGreaterThanOrEqual(12);
  expect(fieldBounds.y + fieldBounds.height).toBeLessThanOrEqual(dockBounds.y);
  await saveEvidence(page, "mobile-large-field");
  await dock.getByRole("button", { name: "項目の案内に戻る" }).click();
  await dock.getByRole("button", { name: "最初の説明を読む" }).click();
  const tooltip = page.getByRole("dialog");
  await expect(tooltip).toBeVisible();
  const tooltipBounds = await tooltip.boundingBox();
  expect(tooltipBounds.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(390);
  expect(tooltipBounds.y).toBeGreaterThanOrEqual(0);
  expect(tooltipBounds.y + tooltipBounds.height).toBeLessThanOrEqual(844);
  await saveEvidence(page, "mobile-large-glossary");
  await page.keyboard.press("Escape");
  expect(audit.pageErrors).toEqual([]);
  expect(audit.logs.filter((entry) => entry.type === "error" || entry.type === "warning")).toEqual([]);
});

test("native Tab exposes a mobile select and keeps visible fields in place without changing data", async ({ page, worker, audit }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/semantic.html");
  const before = await fieldSnapshot(page);
  await installSensitiveAccessGuard(worker, page);
  await activate(worker, page);
  const dock = dockFor(page);
  await dock.getByRole("button", { name: "最初の入力項目へ" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#full-name")).toBeFocused();
  const initialScroll = await page.evaluate(() => window.scrollY);
  let reachedSelect = false;
  let checkedVisibleField = false;
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const fieldId = await page.evaluate(() => document.activeElement?.id);
    if (fieldId === "phone") {
      // A native field already above the panel should not jump on focus.
      expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
      checkedVisibleField = true;
    }
    if (fieldId === "copies") {
      reachedSelect = true;
      break;
    }
  }
  expect(checkedVisibleField).toBe(true);
  expect(reachedSelect).toBe(true);
  await expect(page.locator("#copies")).toBeFocused();
  await expect.poll(async () => {
    const field = await page.locator("#copies").boundingBox();
    const panel = await dock.boundingBox();
    return field.y >= 12 && field.y + field.height <= panel.y;
  }).toBe(true);
  expect(await page.locator("#copies").evaluate((field) => {
    const rect = field.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === field;
  })).toBe(true);
  await expect(dock).toContainText("現在の項目：5 / 8");
  expect(await fieldSnapshot(page)).toEqual(before);
  const accesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(accesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(accesses.reads)).toBe(0);
  expect(Object.values(accesses.writes).reduce((total, count) => total + count, 0), JSON.stringify(accesses.writes)).toBe(0);
  expect(accesses.formOperations).toEqual([]);
  expect(audit.pageErrors).toEqual([]);
  await saveEvidence(page, "mobile-native-tab-select-visible");
});

test("resizing an active dock preserves visible controls and resets desktop placement for mobile", async ({ page, worker, audit }) => {
  await page.goto("/semantic.html");
  await activate(worker, page);
  const dock = dockFor(page);
  const field = page.locator("#full-name");
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(field).toBeFocused();
  const initialScroll = await page.evaluate(() => window.scrollY);
  await page.setViewportSize({ width: 650, height: 900 });
  await expect.poll(async () => {
    const panel = await dock.boundingBox();
    const control = await field.boundingBox();
    return panel.x >= 0 && panel.x + panel.width <= 650 &&
      !(control.x < panel.x + panel.width && control.x + control.width > panel.x && control.y < panel.y + panel.height && control.y + control.height > panel.y);
  }).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const panel = await dock.boundingBox();
    return panel.x === 0 && panel.x + panel.width === 390;
  }).toBe(true);
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScroll);
  await saveEvidence(page, "active-dock-resized-to-mobile");
  await messagePage(worker, page, { type: "silver-guide-disable" });
  await page.setViewportSize({ width: 650, height: 900 });
  await expect(page.locator("#silver-guide-host")).toHaveCount(0);
  expect(audit.pageErrors).toEqual([]);
});

test("a short mobile step exposes its focused date even when the page cannot scroll", async ({ page, worker, audit }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dynamic.html");
  await installSensitiveAccessGuard(worker, page);
  await activate(worker, page);
  const dock = dockFor(page);
  await pressFixtureButton(page, "#next-stage");
  await expect(dock).toContainText("ページが示す現在の手順：2. 届出内容");
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  const before = await fieldSnapshot(page);
  await dock.getByRole("button", { name: "最初の入力項目へ" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#stage-two")).toBeFocused();
  await dock.getByRole("button", { name: "次の項目へ" }).focus();
  await page.keyboard.press("Enter");
  const field = page.locator("#stage-two-date");
  await expect(field).toBeFocused();
  await expect.poll(async () => {
    const control = await field.boundingBox();
    const panel = await dock.boundingBox();
    return control.y >= 12 && control.y + control.height <= 844 &&
      !(control.x < panel.x + panel.width && control.x + control.width > panel.x && control.y < panel.y + panel.height && control.y + control.height > panel.y);
  }).toBe(true);
  expect(await field.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === element;
  })).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await fieldSnapshot(page)).toEqual(before);
  const accesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(accesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(accesses.reads)).toBe(0);
  expect(accesses.formOperations).toEqual([]);
  expect(audit.pageErrors).toEqual([]);
  await saveEvidence(page, "mobile-short-form-field-visible");
});

test("public utility fields stay outside the initial body guide while visible labels and required badges explain contact fields", async ({ page, worker, audit }) => {
  await page.goto("/public-contact.html");
  const before = await fieldSnapshot(page);
  await installSensitiveAccessGuard(worker, page);
  await activate(worker, page);
  const dock = dockFor(page);
  await expect(dock).toContainText("この画面の入力項目：3 項目。");
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#contact-name")).toBeFocused();
  await expect(dock).toContainText("現在の項目：1 / 3");
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#contact-phone")).toBeFocused();
  await expect(dock.getByRole("heading", { name: "「電話番号」について", exact: true })).toBeVisible();
  await expect(dock).toContainText("ページが設定した読み上げ名：入力例：09012345678");
  await expect(dock).toContainText("必須");
  await expect(dock).toContainText("連絡できる電話番号を確認してください。");
  await expect(page.getByRole("status")).toContainText("入力のヒント：電話番号。");
  await expect(page.getByRole("status")).not.toContainText("入力のヒント：入力例");
  await saveEvidence(page, "public-contact-visible-label");
  await dock.getByRole("button", { name: "次の項目へ" }).click();
  await expect(page.locator("#contact-email")).toBeFocused();
  await expect(dock).toContainText("必須");
  await expect(dock.getByRole("button", { name: "次の項目へ" })).toHaveCount(0);
  for (const selector of ["#header-search", "#nav-filter", "#body-search"]) {
    await page.locator(selector).focus();
    await expect(dock).toContainText("ページ共通の入力欄（検索など）");
    await expect(dock).toContainText("現在の項目：1 / 1");
    await expect(dock.getByRole("button", { name: "次の項目へ" })).toHaveCount(0);
    await expect(dock).not.toContainText("次の画面への移動や送信");
  }
  await saveEvidence(page, "public-utility-explicit-focus");
  await dock.getByRole("button", { name: "項目の案内に戻る" }).click();
  await expect(dock).toContainText("この画面の入力項目：3 項目。");
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  await expect(page.locator("#contact-name")).toBeFocused();
  await page.locator("#contact").evaluate((form) => { form.hidden = true; });
  await expect(dock).toContainText("この画面には本文の入力欄がありません。");
  await expect(dock).toContainText("検索などページ共通の入力欄は、欄を選ぶと案内します。");
  await expect(dock.getByRole("button", { name: "最初の入力項目へ" })).toHaveCount(0);
  await expect(dock).not.toContainText("この画面には支援できる入力欄がありません。");
  await saveEvidence(page, "public-utility-only-overview");
  expect(await fieldSnapshot(page)).toEqual(before);
  const accesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(accesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(accesses.reads)).toBe(0);
  expect(Object.values(accesses.writes).reduce((total, count) => total + count, 0), JSON.stringify(accesses.writes)).toBe(0);
  expect(accesses.attributes).toEqual([]);
  expect(accesses.formOperations).toEqual([]);
  expect(audit.pageErrors).toEqual([]);
  expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
});

test("unsupported page controls clear an old input hint while the assistant's own controls preserve it", async ({ page, worker, audit }) => {
  await page.goto("/public-contact.html");
  const before = await fieldSnapshot(page);
  await installSensitiveAccessGuard(worker, page);
  await activate(worker, page);
  const dock = dockFor(page);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const selector of ["#readonly-number", "#readonly-notes", "#readonly-select", "#contact-password", "#custom-editor", "#custom-textbox", "#custom-combo", "#custom-listbox"]) {
      await page.locator("#contact-name").focus();
      await expect(dock.getByRole("heading", { name: "「お名前」について", exact: true })).toBeVisible();
      await dock.getByRole("button", { name: "次の項目へ" }).focus();
      await expect(dock.getByRole("heading", { name: "「お名前」について", exact: true })).toBeVisible();
      const field = page.locator(selector);
      await field.focus();
      await expect(field).toBeFocused();
      await expect(dock.getByRole("heading", { name: "「お名前」について", exact: true })).toHaveCount(0);
      await expect(dock).toContainText("このページの案内");
      await expect(page.getByRole("status")).toContainText("この欄は入力支援の対象外です。");
      await expect.poll(async () => {
        const control = await field.boundingBox();
        const panel = await dock.boundingBox();
        return control.y >= 12 && control.y + control.height <= viewport.height &&
          !(control.x < panel.x + panel.width && control.x + control.width > panel.x && control.y < panel.y + panel.height && control.y + control.height > panel.y);
      }).toBe(true);
      expect(await field.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return target !== null && (target === element || element.contains(target));
      })).toBe(true);
      if (selector === "#contact-password") await saveEvidence(page, `unsupported-password-visible-${viewport.width}`);
    }
  }
  await expect(dock).not.toContainText("FAKE-PRIVATE");
  expect(await fieldSnapshot(page)).toEqual(before);
  const accesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(accesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(accesses.reads)).toBe(0);
  expect(Object.values(accesses.writes).reduce((total, count) => total + count, 0), JSON.stringify(accesses.writes)).toBe(0);
  expect(accesses.formOperations).toEqual([]);
  expect(audit.pageErrors).toEqual([]);
  await saveEvidence(page, "unsupported-control-clears-old-hint");
});

test("an open glossary reflects changed settings while its focused close and listen controls stay in place", async ({ page, worker, audit }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/public-contact.html");
  // A public explanation at the lower-right edge exercises box placement
  // again after its height changes, without touching a value control.
  await page.locator("#contact-explanation").evaluate((paragraph) => {
    paragraph.style.cssText = "position:fixed;right:12px;bottom:12px;width:150px";
  });
  await activate(worker, page);
  const anchor = page.locator("#contact-explanation [data-silver-guide-generated=true]").first();
  await anchor.focus();
  await page.keyboard.press("Enter");
  const tooltip = page.getByRole("dialog");
  const withinViewport = async () => {
    const bounds = await tooltip.boundingBox();
    return bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844;
  };
  await expect(tooltip).toHaveClass(/font-medium/);
  await expect(tooltip).toContainText("元の言葉:");
  const close = tooltip.getByRole("button", { name: "閉じる", exact: true });
  await close.focus();
  await messagePage(worker, page, { type: "silver-guide-update-settings", settings: { fontSize: "large", showOriginal: false } });
  await expect(tooltip).toHaveClass(/font-large/);
  await expect(tooltip).not.toContainText("元の言葉:");
  await expect(close).toBeFocused();
  expect(await withinViewport()).toBe(true);
  const listen = tooltip.getByRole("button", { name: "声で聞く", exact: true });
  if (await listen.count() > 0) {
    await listen.focus();
    await messagePage(worker, page, { type: "silver-guide-update-settings", settings: { fontSize: "small", showOriginal: true } });
    await expect(tooltip).toHaveClass(/font-small/);
    await expect(tooltip).toContainText("元の言葉:");
    await expect(listen).toBeFocused();
    expect(await withinViewport()).toBe(true);
  }
  // Chrome background/UI integration is exercised through the actual native
  // side panel in sidepanel.e2e.mjs. Keep this page fallback test independent.
  await messagePage(worker, page, { type: "silver-guide-update-settings", settings: { fontSize: "large", showOriginal: true } });
  await expect(tooltip).toHaveClass(/font-large/);
  await messagePage(worker, page, { type: "silver-guide-update-settings", settings: { fontSize: "large", showOriginal: false } });
  await expect(tooltip).not.toContainText("元の言葉:");
  await expect(tooltip).toBeVisible();
  expect(await withinViewport()).toBe(true);
  if (await listen.count() > 0) await expect(listen).toBeFocused();
  await saveEvidence(page, "open-glossary-settings-updated");
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(anchor).toBeFocused();
  expect(audit.pageErrors).toEqual([]);
});

test("input values, selected/checked states and attachments are neither read nor changed or leaked", async ({ page, worker, audit }) => {
  await page.goto("/privacy.html");
  await page.locator("#private-file").setInputFiles({ name: "FAKE-SECRET-ATTACHMENT-44072.txt", mimeType: "text/plain", buffer: Buffer.from("FAKE-SECRET-FILE-CONTENT-17489") });
  const before = await fieldSnapshot(page);
  await installSensitiveAccessGuard(worker, page);
  const requestStart = audit.requests.length;
  await activate(worker, page);
  const initialAccesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(initialAccesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(initialAccesses.reads)).toBe(0);
  const dock = dockFor(page);
  await dock.getByRole("button", { name: "最初の入力項目へ" }).click();
  while (await dock.getByRole("button", { name: "次の項目へ" }).count() > 0) {
    await dock.getByRole("button", { name: "次の項目へ" }).click();
  }
  await expect(page.locator("#private-described")).toBeFocused();
  await expect(dock).not.toContainText("FAKE-SECRET");
  await page.locator("#private-name").evaluate((field) => field.setAttribute("aria-invalid", "true"));
  await dock.getByRole("button", { name: "最初のエラー項目へ" }).click();
  await expect(page.locator("#private-name")).toBeFocused();
  await messagePage(worker, page, { type: "silver-guide-update-settings", settings: { fontSize: "large", showOriginal: false } });
  await expect(dock).toHaveClass(/font-large/);
  await dock.getByRole("button", { name: "表示を小さくする" }).click();
  await dock.getByRole("button", { name: "開く", exact: true }).click();
  await dock.getByRole("button", { name: "項目の案内に戻る" }).click();
  await expect(page.locator("#silver-guide-host")).not.toContainText("FAKE-SECRET");
  expect(await page.locator("#editable [data-silver-guide-generated]").count()).toBe(0);
  await expect(page.locator("output [data-silver-guide-generated], [role=listbox] [data-silver-guide-generated], [role=searchbox] [data-silver-guide-generated], [role=alert] [data-silver-guide-generated], [aria-live] [data-silver-guide-generated]")).toHaveCount(0);
  await messagePage(worker, page, { type: "silver-guide-disable" });
  await expect(page.locator("#silver-guide-host")).toHaveCount(0);
  const accesses = await sensitiveAccessAudit(worker, page);
  expect(Object.values(accesses.reads).reduce((total, count) => total + count, 0), JSON.stringify(accesses.reads)).toBe(0);
  expect(Object.values(accesses.writes).reduce((total, count) => total + count, 0), JSON.stringify(accesses.writes)).toBe(0);
  expect(accesses.attributes).toEqual([]);
  expect(accesses.formOperations).toEqual([]);
  expect(accesses.messages).toEqual([]);
  expect(await fieldSnapshot(page)).toEqual(before);
  const extensionStorage = await worker.evaluate(() => chrome.storage.local.get(null));
  expect(extensionStorage).toEqual({});
  expect(audit.requests.slice(requestStart)).toEqual([]);
  expect(JSON.stringify({ logs: audit.logs, requests: audit.requests, extensionStorage })).not.toContain("FAKE-SECRET");
  expect(audit.pageErrors).toEqual([]);
  expect(audit.logs.filter((entry) => entry.type === "error" || entry.type === "warning")).toEqual([]);
});
