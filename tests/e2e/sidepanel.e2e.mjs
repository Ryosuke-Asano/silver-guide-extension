import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  test, expect, evidenceDirectory, saveEvidence, fieldSnapshot,
  installSensitiveAccessGuard, sensitiveAccessAudit, messagePage, pressFixtureButton
} from "./extension.mjs";
import { openNativePanel, fixtureTab } from "./native-panel.mjs";

async function noDock(page) {
  await expect(page.locator("#silver-guide-dock")).toHaveCount(0);
}

function assertPanelHealthy(panel, audit) {
  expect(panel.errors).toEqual([]);
  expect(panel.logs.filter((entry) => entry.type === "error" || entry.type === "warning")).toEqual([]);
  expect(panel.requests).toEqual([]);
  expect(audit.pageErrors).toEqual([]);
}

async function assertActiveTab(worker, target) {
  const actual = await worker.evaluate(async (windowId) => {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    return { tabId: tab?.id, windowId: tab?.windowId };
  }, target.windowId);
  expect(actual).toEqual(target);
}

function commandRequest(target, state, command) {
  return {
    type: "silver-guide-command", ...target,
    sessionId: state.sessionId, revision: state.snapshot.revision, command
  };
}

async function saveJSON(name, value) {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(path.join(evidenceDirectory, `${name}.json`), JSON.stringify(value, null, 2));
}

function assertNoSensitiveAccess(accesses) {
  expect(Object.values(accesses.reads).every((count) => count === 0), JSON.stringify(accesses.reads)).toBe(true);
  expect(Object.values(accesses.writes).every((count) => count === 0), JSON.stringify(accesses.writes)).toBe(true);
  expect(accesses.attributes).toEqual([]);
  expect(accesses.formOperations).toEqual([]);
}

async function nestedErrorMetadata(panel, page, id, echoedValue) {
  await page.locator(`#${id}`).evaluate((span) => {
    const heading = document.createElement("h2");
    heading.append(document.createTextNode("エラー確認："));
    span.parentElement.replaceWith(heading);
    heading.append(span);
  });
  const heading = await panel.state();
  expect(JSON.stringify(heading)).not.toContain(echoedValue);
  await page.locator(`#${id}`).evaluate((span) => {
    const list = document.createElement("ol");
    const step = document.createElement("li");
    step.setAttribute("aria-current", "step");
    step.append(document.createTextNode("エラー修正の手順："));
    list.append(step);
    span.parentElement.replaceWith(list);
    step.append(span);
  });
  const step = await panel.state();
  expect(step.snapshot.stepText).toBe("");
  expect(JSON.stringify(step)).not.toContain(echoedValue);
  await expect.poll(() => panel.text()).not.toContain(echoedValue);
  // Restore the ordinary paragraph while the error is still notified. The
  // fixture then removes the reference and hides the echo on correction.
  await page.locator(`#${id}`).evaluate((span) => {
    const paragraph = document.createElement("p");
    span.closest("ol").replaceWith(paragraph);
    paragraph.append(span);
  });
  return { heading, step };
}

test("actual Chrome native panel opens on a user gesture, navigates the page without a dock, persists settings and resumes", async ({ page, context, worker, audit }) => {
  await page.goto("/semantic.html");
  const before = await fieldSnapshot(page);
  const target = await fixtureTab(worker, page);
  const productManifest = JSON.parse(await readFile(new URL("../../dist-chromium/manifest.json", import.meta.url), "utf8"));
  expect(productManifest.side_panel).toEqual({ default_path: "sidepanel.html" });
  expect(productManifest.action.default_popup).toBeUndefined();
  expect(productManifest.minimum_chrome_version).toBe("114");
  expect(productManifest.permissions).toContain("sidePanel");
  expect(productManifest.host_permissions).toBeUndefined();
  const api = await worker.evaluate(async () => ({ behavior: await chrome.sidePanel.getPanelBehavior(), options: await chrome.sidePanel.getOptions({}) }));
  expect(api.behavior.openPanelOnActionClick).toBe(true);
  expect(api.options).toMatchObject({ path: "sidepanel.html", enabled: true });
  const panel = await openNativePanel(context, worker, page);
  try {
    await noDock(page);
    await panel.action("toggle");
    await panel.waitForToggle(true);
    await panel.waitForText("この画面の入力項目：8 項目。");
    const firstSession = await panel.state();
    expect(firstSession).toMatchObject({ active: true, tabId: target.tabId });
    expect(firstSession.sessionId).toBeTruthy();
    await assertActiveTab(worker, target);
    await noDock(page);
    await panel.action("first-field");
    await expect(page.locator("#full-name")).toBeFocused();
    await panel.waitForText("現在の項目：1 / 8");
    await panel.waitForText("氏名");
    expect(await panel.evaluate(() => document.querySelector('[data-panel-action="previous-field"]').disabled)).toBe(true);
    await panel.evaluate(() => document.querySelector("#panel-field-heading").scrollIntoView({ block: "start", behavior: "instant" }));
    await panel.save("native-panel-first-field");
    await panel.action("next-field");
    await expect(page.locator("#birth-date")).toBeFocused();
    await panel.waitForText("現在の項目：2 / 8");
    await panel.action("previous-field");
    await expect(page.locator("#full-name")).toBeFocused();
    await assertActiveTab(worker, target);
    await panel.click(".panel-font-radio:last-child");
    await expect.poll(() => panel.evaluate(() => document.querySelector("main").dataset.fontSize)).toBe("large");
    await panel.click(".panel-original-switch");
    await expect.poll(() => worker.evaluate(() => chrome.storage.local.get(null))).toEqual({ silverGuideSettings: { fontSize: "large", showOriginal: false } });
    await noDock(page);
    await panel.save("native-panel-large-settings");
    await saveEvidence(page, "native-assisted-page-no-dock");
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(path.join(evidenceDirectory, "native-panel-api.json"), JSON.stringify({ browser: context.browser().version(), api, opened: panel.opened, targetId: panel.targetId, target, presentation: "native Chrome pane, CDP target; not an extension tab" }, null, 2));
    await panel.action("toggle");
    await panel.waitForToggle(false);
    await expect(page.locator("#silver-guide-host")).toHaveCount(0);
    await panel.action("toggle");
    await panel.waitForToggle(true);
    const resumed = await panel.state();
    expect(resumed.sessionId).not.toBe(firstSession.sessionId);
    expect(await fieldSnapshot(page)).toEqual(before);
    await noDock(page);
    assertPanelHealthy(panel, audit);
  } finally {
    await panel.dispose();
  }
});

test("native panel snapshots and messages never read, modify or expose fictional values, selection, files or private text", async ({ page, context, worker, audit }) => {
  await page.goto("/privacy.html");
  await page.locator("#private-file").setInputFiles({ name: "FAKE-SECRET-ATTACHMENT-44072.txt", mimeType: "text/plain", buffer: Buffer.from("FAKE-SECRET-FILE-CONTENT-17489") });
  const before = await fieldSnapshot(page);
  const target = await fixtureTab(worker, page);
  await installSensitiveAccessGuard(worker, page);
  // Ordinary HTTP pages need not provide randomUUID. This change affects only
  // the disposable isolated extension world, never the fixture's data.
  await worker.evaluate(async (tabId) => chrome.scripting.executeScript({
    target: { tabId }, world: "ISOLATED",
    func: () => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true })
  }), target.tabId);
  const panel = await openNativePanel(context, worker, page);
  try {
    await panel.evaluate(() => {
      window.__silverGuideQaNotifications = [];
      chrome.runtime.onMessage.addListener((message) => {
        window.__silverGuideQaNotifications.push(message);
        return undefined;
      });
    });
    await panel.action("toggle");
    await panel.waitForToggle(true);
    const initial = await panel.state();
    expect(initial.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(initial.snapshot.hasTerms).toBe(false);
    for (const id of ["private-name", "private-notes", "private-choice", "private-check", "private-radio-a", "private-file", "private-described", "private-password", "editable", "private-searchbox"]) {
      await page.locator(`#${id}`).focus();
      const current = await panel.state();
      expect(JSON.stringify(current)).not.toContain("FAKE-SECRET");
      expect(current.snapshot.hasTerms).toBe(false);
    }
    await panel.action("first-field");
    await expect(page.locator("#private-name")).toBeFocused();
    await panel.action("next-field");
    await expect(page.locator("#private-notes")).toBeFocused();
    await panel.click(".panel-font-radio:last-child");
    await expect.poll(() => panel.evaluate(() => document.querySelector("main").dataset.fontSize)).toBe("large");
    await expect.poll(() => worker.evaluate(() => chrome.storage.local.get(null))).toEqual({ silverGuideSettings: { fontSize: "large", showOriginal: true } });
    const accesses = await sensitiveAccessAudit(worker, page);
    assertNoSensitiveAccess(accesses);
    const notifications = await panel.evaluate(() => window.__silverGuideQaNotifications);
    const wakeups = notifications.filter((message) => message.type === "silver-guide-panel-update");
    expect(wakeups.length).toBeGreaterThan(0);
    expect(wakeups.every((message) => Object.keys(message).sort().join(",") === "tabId,type,windowId")).toBe(true);
    const extensionStorage = await worker.evaluate(() => chrome.storage.local.get(null));
    const exposed = { snapshot: await panel.state(), panelText: await panel.text(), accesses, notifications, logs: [...audit.logs, ...panel.logs], requests: [...audit.requests, ...panel.requests], extensionStorage };
    expect(JSON.stringify(exposed)).not.toContain("FAKE-SECRET");
    expect(await fieldSnapshot(page)).toEqual(before);
    expect(audit.requests.every((request) => request.method === "GET" && request.body === null)).toBe(true);
    await noDock(page);
    await panel.save("native-panel-private-values-excluded");
    await saveJSON("native-privacy-audit", { reads: accesses.reads, writes: accesses.writes, attributes: accesses.attributes, formOperations: accesses.formOperations, publicSnapshot: exposed.snapshot, notificationCount: notifications.length, wakeups, extensionStorage, valueSnapshotUnchanged: true, submissions: 0 });
    assertPanelHealthy(panel, audit);
  } finally {
    await panel.dispose();
  }
});

test("native panel follows dynamic and multiple-stage forms, rejecting stale revisions without advancing a stage", async ({ page, context, worker, audit }) => {
  await page.goto("/dynamic.html");
  const target = await fixtureTab(worker, page);
  const panel = await openNativePanel(context, worker, page);
  try {
    await panel.action("toggle");
    await panel.waitForToggle(true);
    await panel.waitForText("この画面の入力項目：1 項目。");
    await panel.waitForText("ページが示す現在の手順：1. 申請者の情報");
    await panel.action("first-field");
    await expect(page.locator("#stage-one")).toBeFocused();
    const old = await panel.state();
    await pressFixtureButton(page, "#reveal");
    await panel.waitForText("この画面の入力項目：2 項目。");
    const stale = await panel.request(commandRequest(target, old, "next-field"));
    expect(stale.success).toBe(false);
    await expect(page.locator("#conditional")).not.toBeFocused();
    await panel.action("next-field");
    await expect(page.locator("#conditional")).toBeFocused();
    await panel.waitForText("現在の項目：2 / 2");
    expect(await panel.evaluate(() => document.querySelector('[data-panel-action="next-field"]').disabled)).toBe(true);
    await expect(page.locator("#stage-title")).toHaveText("1. 申請者の情報");
    await pressFixtureButton(page, "#next-stage");
    await panel.waitForText("ページが示す現在の手順：2. 届出内容");
    await expect(page.locator("#stage-one")).toHaveCount(0);
    expect((await panel.state()).snapshot.field).toBeUndefined();
    await panel.action("first-field");
    await expect(page.locator("#stage-two")).toBeFocused();
    await panel.waitForText("「届出内容」について");
    await panel.action("next-field");
    await expect(page.locator("#stage-two-date")).toBeFocused();
    await panel.waitForText("次の画面への移動や送信は、ページのボタンをご自身で確認してください。");
    expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
    await noDock(page);
    await panel.save("native-panel-dynamic-second-stage");
    await saveJSON("native-dynamic-stale-revision", { staleRevision: old.snapshot.revision, rejected: stale.success === false, current: await panel.state(), submissions: 0 });
    assertPanelHealthy(panel, audit);
  } finally {
    await panel.dispose();
  }
});

test("native panel uses ARIA, table and definition-list labels and recovers from page and native errors without echoed values", async ({ page, context, worker, audit }) => {
  await page.goto("/aria-table.html");
  await installSensitiveAccessGuard(worker, page);
  const panel = await openNativePanel(context, worker, page);
  try {
    await panel.action("toggle");
    await panel.waitForToggle(true);
    await panel.action("first-field");
    await expect(page.locator("#email")).toBeFocused();
    await panel.waitForText("「申請者の 電子メール」について");
    await panel.waitForText("連絡を受け取れるメールアドレスを確認します。");
    await panel.action("next-field");
    await expect(page.locator("#postal")).toBeFocused();
    await panel.waitForText("「郵便番号」について");
    await panel.action("next-field");
    await expect(page.locator("#address")).toBeFocused();
    await panel.waitForText("「住所」について");
    await panel.action("next-field");
    await expect(page.locator("#contact-time")).toBeFocused();
    await panel.waitForText("「連絡する時間帯」について");
    await pressFixtureButton(page, "#show-errors");
    await panel.waitForText("確認が必要な項目：1 件。");
    await panel.action("first-error");
    await expect(page.locator("#email")).toBeFocused();
    await panel.waitForText("ページから入力エラーが通知されています。");
    expect(await panel.text()).not.toContain("FAKE-PRIVATE-EMAIL");
    await panel.save("native-panel-error-recovery");
    await pressFixtureButton(page, "#clear-errors");
    await expect.poll(() => panel.state().then((state) => state.snapshot.errorCount)).toBe(0);
    await panel.waitForText("連絡を受け取れるメールアドレスを確認します。");
    await pressFixtureButton(page, "#show-unmarked-error");
    await panel.waitForText("確認が必要な項目：1 件。");
    await panel.action("first-error");
    await expect(page.locator("#email")).toBeFocused();
    const unmarkedAriaError = await panel.state();
    expect(JSON.stringify(unmarkedAriaError)).not.toContain("FAKE-PRIVATE-UNMARKED-EMAIL");
    await expect.poll(() => panel.text()).not.toContain("FAKE-PRIVATE-UNMARKED-EMAIL");
    const ariaErrorTerms = await page.locator("#unmarked-email-echo [data-silver-guide-term]").count();
    const nestedAriaError = await nestedErrorMetadata(panel, page, "unmarked-email-echo", "FAKE-PRIVATE-UNMARKED-EMAIL");
    await panel.save("native-panel-unmarked-aria-error-excluded");
    await pressFixtureButton(page, "#clear-errors");
    await expect.poll(() => panel.state().then((state) => state.snapshot.errorCount)).toBe(0);
    await panel.waitForText("連絡を受け取れるメールアドレスを確認します。");
    await page.locator("#native-required").focus();
    await panel.waitForText("確認用の説明を読み、ご自身で入力してください。");
    await pressFixtureButton(page, "#check-native");
    await panel.waitForText("確認が必要な項目：1 件。");
    await page.locator("#contact-time").focus();
    await panel.waitForText("「連絡する時間帯」について");
    await panel.action("first-error");
    await expect(page.locator("#native-required")).toBeFocused();
    const unmarkedNativeError = await panel.state();
    expect(JSON.stringify(unmarkedNativeError)).not.toContain("FAKE-PRIVATE-NATIVE-ECHO");
    await expect.poll(() => panel.text()).not.toContain("FAKE-PRIVATE-NATIVE-ECHO");
    const nativeErrorTerms = await page.locator("#unmarked-native-echo [data-silver-guide-term]").count();
    const nestedNativeError = await nestedErrorMetadata(panel, page, "unmarked-native-echo", "FAKE-PRIVATE-NATIVE-ECHO");
    await panel.save("native-panel-unmarked-native-error-excluded");
    await page.locator("#native-required").fill("架空の確認内容");
    await expect.poll(() => panel.state().then((state) => state.snapshot.errorCount)).toBe(0);
    await panel.waitForText("確認用の説明を読み、ご自身で入力してください。");
    expect(await panel.text()).not.toContain("架空の確認内容");
    const accesses = await sensitiveAccessAudit(worker, page);
    await saveJSON("native-unmarked-error-suppression", { unmarkedAriaError, unmarkedNativeError, nestedAriaError, nestedNativeError, recovered: await panel.state(), normalHelpRestored: true, ariaErrorTerms, nativeErrorTerms, reads: accesses.reads, writes: accesses.writes, attributes: accesses.attributes, formOperations: accesses.formOperations });
    assertNoSensitiveAccess(accesses);
    expect(JSON.stringify(accesses.messages)).not.toContain("FAKE-PRIVATE");
    expect(ariaErrorTerms).toBe(0);
    expect(nativeErrorTerms).toBe(0);
    expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
    await noDock(page);
    assertPanelHealthy(panel, audit);
  } finally {
    await panel.dispose();
  }
});

test("native panel clears another tab and reloaded page, rejecting stale tab, session and revision commands", async ({ page, context, worker, audit }) => {
  await page.goto("/semantic.html?tab=A");
  const targetA = await fixtureTab(worker, page);
  const panel = await openNativePanel(context, worker, page);
  let second;
  try {
    await panel.action("toggle");
    await panel.waitForToggle(true);
    await panel.action("first-field");
    await expect(page.locator("#full-name")).toBeFocused();
    const stateA = await panel.state();
    second = await context.newPage();
    await second.goto("/public-contact.html?tab=B");
    const targetB = await fixtureTab(worker, second);
    expect(targetB.windowId).toBe(targetA.windowId);
    await panel.waitForToggle(false);
    await expect.poll(() => panel.state().then((state) => state.tabId)).toBe(targetB.tabId);
    expect(await panel.text()).not.toContain("現在の項目：");
    const wrongTab = await panel.request(commandRequest(targetA, stateA, "next-field"));
    expect(wrongTab).toMatchObject({ success: false, active: false });
    expect(wrongTab.snapshot).toBeUndefined();
    expect(wrongTab.sessionId).toBeUndefined();
    await panel.action("toggle");
    await panel.waitForToggle(true);
    await panel.waitForText("この画面の入力項目：3 項目。");
    await panel.action("first-field");
    await expect(second.locator("#contact-name")).toBeFocused();
    const stateB = await panel.state();
    await second.locator("#contact-phone").focus();
    await panel.waitForText("「電話番号」について");
    const wrongRevision = await panel.request(commandRequest(targetB, stateB, "next-field"));
    expect(wrongRevision.success).toBe(false);
    await expect(second.locator("#contact-phone")).toBeFocused();
    await panel.action("toggle");
    await panel.waitForToggle(false);
    await panel.action("toggle");
    await panel.waitForToggle(true);
    const resumed = await panel.state();
    expect(resumed.sessionId).not.toBe(stateB.sessionId);
    const wrongSession = await panel.request(commandRequest(targetB, stateB, "first-field"));
    expect(wrongSession).toMatchObject({ success: false, active: true, sessionId: resumed.sessionId });
    const rejectedSettings = await panel.request({ type: "silver-guide-update-settings", ...targetB, sessionId: stateB.sessionId, settings: { fontSize: "large", showOriginal: false } });
    expect(rejectedSettings.success).toBe(false);
    expect(await worker.evaluate(() => chrome.storage.local.get(null))).toEqual({});
    await second.reload();
    await panel.waitForToggle(false);
    const afterReload = await panel.state();
    expect(afterReload).toEqual({ active: false, tabId: targetB.tabId });
    expect(await panel.text()).not.toContain("現在の項目：");
    const oldDocument = await panel.request(commandRequest(targetB, resumed, "first-field"));
    expect(oldDocument).toMatchObject({ success: false, active: false });
    await noDock(second);
    await expect(second.locator("#silver-guide-host")).toHaveCount(0);
    await panel.action("toggle");
    await panel.waitForToggle(true);
    const newDocument = await panel.state();
    expect(newDocument.sessionId).not.toBe(resumed.sessionId);
    await page.bringToFront();
    await panel.waitForToggle(true);
    await expect.poll(() => panel.state().then((state) => state.tabId)).toBe(targetA.tabId);
    expect((await panel.state()).sessionId).toBe(stateA.sessionId);
    const wrongDisable = await panel.request({ type: "silver-guide-disable", ...targetB, sessionId: newDocument.sessionId });
    expect(wrongDisable.success).toBe(false);
    expect((await messagePage(worker, second, { type: "silver-guide-state" })).active).toBe(true);
    await noDock(page);
    await noDock(second);
    expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
    expect(await second.evaluate(() => window.fixtureSubmissions)).toBe(0);
    await panel.save("native-panel-restored-original-tab");
    await saveJSON("native-stale-target-rejections", { wrongTab, wrongRevision, wrongSession, rejectedSettings, oldDocument, wrongDisable, afterReload, newDocument, restoredTab: await panel.state() });
    assertPanelHealthy(panel, audit);
  } finally {
    await panel.dispose();
    await second?.close();
  }
});

test("two actual native panels isolate their own Chrome windows and reject a mismatched window and tab", async ({ page, context, worker, audit }) => {
  await page.goto("/semantic.html?window=A");
  const targetA = await fixtureTab(worker, page);
  const panelA = await openNativePanel(context, worker, page);
  let second;
  let panelB;
  let windowB;
  try {
    await panelA.action("toggle");
    await panelA.waitForToggle(true);
    await panelA.action("first-field");
    const firstStateA = await panelA.state();
    const secondURL = new URL("/public-contact.html?window=B", page.url()).href;
    const secondPage = context.waitForEvent("page");
    windowB = await worker.evaluate((url) => chrome.windows.create({ url, type: "normal", focused: true }), secondURL);
    second = await secondPage;
    await second.waitForURL(secondURL);
    const targetB = await fixtureTab(worker, second);
    expect(targetB.windowId).not.toBe(targetA.windowId);
    expect(targetB.windowId).toBe(windowB.id);
    panelB = await openNativePanel(context, worker, second);
    expect(panelB.targetId).not.toBe(panelA.targetId);
    await panelB.action("toggle");
    await panelB.waitForToggle(true);
    await panelB.waitForText("この画面の入力項目：3 項目。");
    await panelB.action("first-field");
    await expect(second.locator("#contact-name")).toBeFocused();
    const firstStateB = await panelB.state();
    expect(firstStateB.tabId).toBe(targetB.tabId);
    expect((await panelA.state()).tabId).toBe(targetA.tabId);
    expect((await panelA.state()).sessionId).toBe(firstStateA.sessionId);
    const mismatch = await panelA.request(commandRequest({ windowId: targetA.windowId, tabId: targetB.tabId }, firstStateB, "next-field"));
    expect(mismatch).toMatchObject({ success: false, active: false });
    expect(mismatch.snapshot).toBeUndefined();
    await expect(second.locator("#contact-name")).toBeFocused();
    await panelA.action("next-field");
    await expect(page.locator("#birth-date")).toBeFocused();
    expect((await panelB.state()).snapshot.field.label).toBe("お名前");
    await panelA.action("toggle");
    await panelA.waitForToggle(false);
    await panelB.waitForToggle(true);
    expect((await panelB.state()).sessionId).toBe(firstStateB.sessionId);
    await panelB.action("next-field");
    await expect(second.locator("#contact-phone")).toBeFocused();
    await panelB.waitForText("「電話番号」について");
    await noDock(page);
    await noDock(second);
    expect(await page.evaluate(() => window.fixtureSubmissions)).toBe(0);
    expect(await second.evaluate(() => window.fixtureSubmissions)).toBe(0);
    await panelB.save("native-panel-isolated-window-B");
    await saveJSON("native-window-isolation", { targetA, targetB, openedA: panelA.opened, openedB: panelB.opened, rejectedMismatchedWindowAndTab: mismatch, stateA: await panelA.state(), stateB: await panelB.state() });
    assertPanelHealthy(panelA, audit);
    assertPanelHealthy(panelB, audit);
  } finally {
    await panelB?.dispose();
    await panelA.dispose();
    if (windowB?.id !== undefined) await worker.evaluate((id) => chrome.windows.remove(id), windowB.id).catch(() => undefined);
  }
});

test("native panel distinguishes public labels and utility fields, clears unsupported focus, and keeps large text usable", async ({ page, context, worker, audit }) => {
  await page.goto("/public-contact.html");
  const before = await fieldSnapshot(page);
  await installSensitiveAccessGuard(worker, page);
  const panel = await openNativePanel(context, worker, page);
  try {
    await panel.action("toggle");
    await panel.waitForToggle(true);
    await panel.waitForText("この画面の入力項目：3 項目。");
    await panel.action("first-field");
    await expect(page.locator("#contact-name")).toBeFocused();
    await panel.action("next-field");
    await expect(page.locator("#contact-phone")).toBeFocused();
    await panel.waitForText("「電話番号」について");
    await panel.waitForText("ページが設定した読み上げ名：入力例：09012345678");
    await panel.waitForText("ページの項目名や見出しに「必須」と表示されています。");
    await panel.action("next-field");
    await expect(page.locator("#contact-email")).toBeFocused();
    expect((await panel.state()).snapshot.field.facts.join(" ")).toContain("「必須」");
    for (const id of ["readonly-number", "readonly-notes", "readonly-select", "contact-password", "custom-editor", "custom-textbox", "custom-combo", "custom-listbox"]) {
      await page.locator(`#${id}`).focus();
      await expect.poll(() => panel.state().then((state) => state.snapshot.field)).toBeUndefined();
      await expect.poll(() => panel.text()).not.toContain("「電子メール 必須」について");
    }
    await page.locator("#header-search").focus();
    await panel.waitForText("ページ共通の入力欄（検索など）");
    expect((await panel.state()).snapshot.field).toMatchObject({ label: "サイト内検索", utility: true, total: 1 });
    await panel.action("first-field");
    await expect(page.locator("#contact-name")).toBeFocused();
    await panel.action("first-term");
    const tooltip = page.getByRole("dialog");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("元の言葉:");
    await panel.click(".panel-font-radio:last-child");
    await expect(tooltip).toHaveClass(/font-large/);
    await panel.click(".panel-original-switch");
    await expect(tooltip).not.toContainText("元の言葉:");
    await expect(tooltip).toBeVisible();
    await tooltip.getByRole("button", { name: "閉じる", exact: true }).click();
    // 320 px is a pane viewport emulation; the earlier cases retain Chrome's
    // real 360 px native pane. This is not a standalone extension-page test.
    await panel.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 765, deviceScaleFactor: 1, mobile: false });
    await panel.evaluate(() => {
      window.__silverGuideQaFocusEvents = [];
      for (const type of ["focus", "blur"]) window.addEventListener(type, () => window.__silverGuideQaFocusEvents.push(type));
    });
    await panel.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.bringToFront();
    const pageSession = await context.newCDPSession(page);
    const mainTarget = await pageSession.send("Target.getTargetInfo");
    await panel.browserSession.send("Target.activateTarget", { targetId: mainTarget.targetInfo.targetId });
    await pageSession.send("Page.bringToFront");
    await page.locator("#contact-phone").click();
    const mainScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await panel.waitForText("「電話番号」について");
    const focusBoundary = {
      main: await page.evaluate(() => ({ hasFocus: document.hasFocus(), activeId: document.activeElement?.id })),
      native: await panel.evaluate(() => ({ hasFocus: document.hasFocus(), activeTag: document.activeElement?.tagName, events: window.__silverGuideQaFocusEvents }))
    };
    if (focusBoundary.native.hasFocus) {
      // Headless CDP can deliver clicks to the page while Chrome keeps the
      // native pane focused. Do not change production focus policy to mask it.
      // Verify readable geometry after explicitly scrolling the actual pane;
      // preserve this automatic-scroll limitation in the evidence.
      await panel.evaluate(() => document.querySelector("#panel-field-heading").scrollIntoView({ block: "start", behavior: "instant" }));
    }
    await pageSession.detach();
    const visibility = await panel.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      };
      return {
        heading: rect("#panel-field-heading"), purpose: rect(".panel-field > p:not(.panel-position):not(.panel-error)"), firstFact: rect(".panel-facts li"),
        width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
        pageFieldSelected: !document.hasFocus(), scrollY
      };
    });
    await saveJSON("native-large-field-visibility", {
      viewport: "320px native-target emulation", visibility, mainScroll, focusBoundary,
      automaticHeadingScrollVerified: !focusBoundary.native.hasFocus,
      positioning: focusBoundary.native.hasFocus ? "explicit scroll within the real native pane; headless focus boundary did not blur it" : "automatic native-pane heading scroll after page click"
    });
    await panel.save("native-panel-large-phone-hint-320");
    expect(visibility.scrollWidth).toBeLessThanOrEqual(visibility.width);
    expect(visibility.heading.top).toBeGreaterThanOrEqual(0);
    expect(visibility.heading.bottom).toBeLessThanOrEqual(visibility.height);
    expect(visibility.purpose.bottom).toBeLessThanOrEqual(visibility.height);
    expect(visibility.firstFact.bottom).toBeLessThanOrEqual(visibility.height);
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(mainScroll);
    // Keep a real pane setting focused while a public metadata update arrives.
    await panel.click(".panel-font-radio:last-child");
    await panel.evaluate(() => {
      window.__silverGuideQaHeadingScrolls = 0;
      const original = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = function (...args) {
        if (this.id === "panel-field-heading") window.__silverGuideQaHeadingScrolls += 1;
        return original.apply(this, args);
      };
    });
    const settingFocus = await panel.evaluate(() => {
      const rect = document.querySelector(".panel-font-radio:last-child").getBoundingClientRect();
      return { hasFocus: document.hasFocus(), focused: document.activeElement?.outerHTML, top: rect.top, bottom: rect.bottom, scrollY };
    });
    expect(settingFocus.hasFocus).toBe(true);
    await page.locator("#contact-phone").evaluate((element) => element.setAttribute("maxlength", "15"));
    await expect.poll(() => panel.state().then((state) => state.snapshot.field.facts.join(" "))).toContain("15");
    await page.locator('label[for="contact-phone"]').evaluate((element) => { element.textContent = "連絡先の電話番号"; });
    await panel.waitForText("「連絡先の電話番号」について");
    const settingAfter = await panel.evaluate(() => {
      const rect = document.querySelector(".panel-font-radio:last-child").getBoundingClientRect();
      return { hasFocus: document.hasFocus(), focused: document.activeElement?.outerHTML, top: rect.top, bottom: rect.bottom, scrollY, headingScrolls: window.__silverGuideQaHeadingScrolls };
    });
    expect(settingAfter.hasFocus).toBe(true);
    expect(settingAfter.focused).toBe(settingFocus.focused);
    // Browser scroll anchoring may adjust scrollY when facts grow above the
    // settings. The focused control must stay in place; the app must not jump.
    expect(Math.abs(settingAfter.top - settingFocus.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(settingAfter.bottom - settingFocus.bottom)).toBeLessThanOrEqual(1);
    expect(settingAfter.headingScrolls).toBe(0);
    await saveJSON("native-settings-focus-preserved", { before: settingFocus, after: settingAfter });
    await panel.save("native-panel-large-settings-320");
    await panel.send("Emulation.clearDeviceMetricsOverride");
    await page.locator("#contact").evaluate((element) => { element.hidden = true; });
    await panel.waitForText("本文の入力欄がありません。");
    expect(await panel.evaluate(() => document.querySelector('[data-panel-action="first-field"]').disabled)).toBe(true);
    expect(await fieldSnapshot(page)).toEqual(before);
    const accesses = await sensitiveAccessAudit(worker, page);
    assertNoSensitiveAccess(accesses);
    expect(JSON.stringify({ state: await panel.state(), text: await panel.text(), accesses, logs: [...audit.logs, ...panel.logs], storage: await worker.evaluate(() => chrome.storage.local.get(null)) })).not.toContain("FAKE-PRIVATE");
    await noDock(page);
    assertPanelHealthy(panel, audit);
  } finally {
    await panel.dispose();
  }
});
