import { test as base, expect, chromium } from "playwright/test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const evidenceDirectory = process.env.SILVER_GUIDE_QA_DIR ?? path.join(tmpdir(), "silver-guide-qa");
export { expect };
const contextWorkers = new WeakMap();

export const test = base.extend({
  context: async ({ viewport, contextOptions, baseURL }, use, testInfo) => {
    const stagingDirectory = await mkdtemp(path.join(tmpdir(), "silver-guide-e2e-extension-"));
    const profileDirectory = await mkdtemp(path.join(tmpdir(), "silver-guide-e2e-profile-"));
    let context;
    try {
      await cp(path.join(projectRoot, "dist-chromium"), stagingDirectory, { recursive: true });
      const manifestPath = path.join(stagingDirectory, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      // Only the disposable test copy receives access to localhost. The product
      // keeps activeTab; the test opener does not grant activeTab to a fixture.
      manifest.host_permissions = ["http://127.0.0.1/*"];
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      if (manifest.side_panel !== undefined) {
        // A real extension-page click opens Chrome's native panel. These two
        // files exist only in the disposable stage, never in the product.
        await writeFile(path.join(stagingDirectory, "qa-open-panel.html"), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>Native panel QA opener</title><button id="open-native-panel" disabled>テスト用サイドパネルを開く</button><p id="open-result"></p><script src="qa-open-panel.js"></script></html>');
        await writeFile(path.join(stagingDirectory, "qa-open-panel.js"), `chrome.windows.getCurrent().then(win => {
          const button = document.getElementById('open-native-panel');
          button.disabled = false;
          button.addEventListener('click', () => {
            chrome.sidePanel.open({ windowId: win.id }).then(
              () => document.getElementById('open-result').textContent = 'opened',
              error => document.getElementById('open-result').textContent = error.message
            );
          });
        });`);
      }
      context = await chromium.launchPersistentContext(profileDirectory, {
        ...contextOptions,
        channel: "chromium",
        executablePath: process.env.SILVER_GUIDE_CHROMIUM_PATH,
        headless: true,
        viewport,
        baseURL,
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [`--disable-extensions-except=${stagingDirectory}`, `--load-extension=${stagingDirectory}`]
      });
      const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith("/background.js"))
        ?? await context.waitForEvent("serviceworker", { timeout: 10_000 });
      contextWorkers.set(context, worker);
      await context.route(/^https?:\/\//, async (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === "http:" || url.protocol === "https:") {
          if (url.origin !== new URL(baseURL).origin) {
            await route.abort("blockedbyclient");
            return;
          }
        }
        await route.continue();
      });
      await use(context);
    } finally {
      if (context !== undefined) {
        if (testInfo.status !== testInfo.expectedStatus) {
          const page = context.pages().find((candidate) => candidate.url().startsWith(baseURL));
          if (page !== undefined) {
            await page.screenshot({ path: testInfo.outputPath("failure.png") }).catch(() => undefined);
          }
        }
        await context.close();
      }
      await rm(profileDirectory, { recursive: true, force: true });
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
  worker: async ({ context }, use) => {
    const worker = contextWorkers.get(context);
    await use(worker);
  },
  audit: async ({ context }, use) => {
    const audit = { requests: [], logs: [], pageErrors: [] };
    context.on("request", (request) => audit.requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
    context.on("console", (message) => audit.logs.push({ type: message.type(), text: message.text() }));
    context.on("page", (page) => page.on("pageerror", (error) => audit.pageErrors.push(error.message)));
    for (const page of context.pages()) {
      page.on("pageerror", (error) => audit.pageErrors.push(error.message));
    }
    await use(audit);
  }
});

export async function messagePage(worker, page, message, inject = false) {
  return worker.evaluate(async ({ pageUrl, message, inject }) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    if (tab?.id === undefined) throw new Error("The local fixture tab was not found.");
    if (inject) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tab.id, message);
  }, { pageUrl: page.url(), message, inject });
}

export async function activate(worker, page, settings = { fontSize: "medium", showOriginal: true }) {
  const result = await messagePage(worker, page, { type: "silver-guide-enable", settings, presentation: "page" }, true);
  expect(result.active).toBe(true);
  await expect(page.locator("#silver-guide-dock")).toBeVisible();
  return result;
}

export function dockFor(page) {
  return page.locator("#silver-guide-host").locator("#silver-guide-dock");
}

export async function pressFixtureButton(page, selector) {
  // Keyboard activation also works when the fixed assistance panel overlaps a
  // fixture control. These fixture buttons only alter local DOM, never submit.
  await page.locator(selector).focus();
  await page.keyboard.press("Enter");
}

export async function saveEvidence(page, name) {
  await mkdir(path.join(evidenceDirectory, "screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(evidenceDirectory, "screenshots", `${name}.png`) });
}

export async function installSensitiveAccessGuard(worker, page) {
  await worker.evaluate(async ({ pageUrl }) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    if (tab?.id === undefined) throw new Error("The guarded fixture tab was not found.");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // The extension runs in ISOLATED world, so guards must run there too.
      // Page-world snapshots still use the native getters and can compare data.
      world: "ISOLATED",
      func: () => {
        const audit = { reads: {}, writes: {}, attributes: [], messages: [], formOperations: [] };
        window.__silverGuideSensitiveAccess = audit;
        const protectedText = "input, textarea, select, option, output, [contenteditable], [role=textbox], [role=searchbox], [role=listbox], [role=option], [role=alert], [aria-live], [data-fixture-private-echo]";
        const guard = (prototype, property, label) => {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
          if (descriptor === undefined || descriptor.configurable === false) return;
          const key = `${label}.${property}`;
          audit.reads[key] = 0;
          audit.writes[key] = 0;
          Object.defineProperty(prototype, property, {
            ...descriptor,
            get: descriptor.get === undefined ? undefined : function () {
              audit.reads[key] += 1;
              return descriptor.get.call(this);
            },
            set: descriptor.set === undefined ? undefined : function (value) {
              audit.writes[key] += 1;
              return descriptor.set.call(this, value);
            }
          });
        };
        for (const property of ["value", "defaultValue", "checked", "defaultChecked", "files", "valueAsDate", "valueAsNumber", "validity", "validationMessage"]) {
          guard(HTMLInputElement.prototype, property, "input");
        }
        for (const property of ["value", "defaultValue", "validity", "validationMessage"]) guard(HTMLTextAreaElement.prototype, property, "textarea");
        for (const property of ["value", "selectedIndex", "selectedOptions", "validity", "validationMessage"]) guard(HTMLSelectElement.prototype, property, "select");
        for (const property of ["value", "selected", "defaultSelected"]) guard(HTMLOptionElement.prototype, property, "option");
        for (const [prototype, property] of [[Node.prototype, "textContent"], [HTMLElement.prototype, "innerText"]]) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
          if (descriptor?.get === undefined) continue;
          Object.defineProperty(prototype, property, {
            ...descriptor,
            get: function () {
              if (this instanceof Element && this.closest(protectedText) !== null) {
                const key = `editable.${property}`;
                audit.reads[key] = (audit.reads[key] ?? 0) + 1;
              }
              return descriptor.get.call(this);
            }
          });
        }
        for (const [prototype, property] of [[CharacterData.prototype, "data"], [Node.prototype, "nodeValue"]]) {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
          if (descriptor?.get === undefined) continue;
          Object.defineProperty(prototype, property, {
            ...descriptor,
            get: function () {
              if (this instanceof Text && this.parentElement !== null && this.parentElement.closest(protectedText) !== null) {
                const key = `protectedText.${property}`;
                audit.reads[key] = (audit.reads[key] ?? 0) + 1;
              }
              return descriptor.get.call(this);
            }
          });
        }
        const getAttribute = Element.prototype.getAttribute;
        Element.prototype.getAttribute = function (name) {
          if (this.matches("input, select, textarea, option") && /^(value|checked|selected)$/i.test(name)) audit.attributes.push(name);
          return getAttribute.call(this, name);
        };
        for (const method of ["submit", "requestSubmit"]) {
          const original = HTMLFormElement.prototype[method];
          HTMLFormElement.prototype[method] = function (...args) {
            audit.formOperations.push(method);
            return original.apply(this, args);
          };
        }
        for (const prototype of [HTMLFormElement.prototype, HTMLInputElement.prototype, HTMLSelectElement.prototype, HTMLTextAreaElement.prototype]) {
          for (const method of ["checkValidity", "reportValidity"]) {
            const original = prototype[method];
            prototype[method] = function (...args) {
              audit.formOperations.push(method);
              return original.apply(this, args);
            };
          }
        }
        const sendMessage = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = function (...args) {
          audit.messages.push(args);
          return sendMessage.apply(this, args);
        };
      }
    });
  }, { pageUrl: page.url() });
}

export async function sensitiveAccessAudit(worker, page) {
  return worker.evaluate(async ({ pageUrl }) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: () => window.__silverGuideSensitiveAccess
    });
    return result.result;
  }, { pageUrl: page.url() });
}

export async function fieldSnapshot(page) {
  return page.evaluate(() => ({
    fields: Array.from(document.querySelectorAll("input, select, textarea")).map((field) => ({
      id: field.id,
      value: field.value,
      checked: field instanceof HTMLInputElement ? field.checked : undefined,
      selected: field instanceof HTMLSelectElement ? Array.from(field.options).map((option) => option.selected) : undefined,
      files: field instanceof HTMLInputElement && field.type === "file" ? Array.from(field.files).map((file) => ({ name: file.name, size: file.size, type: file.type })) : undefined
    })),
    editable: document.querySelector("#editable")?.textContent,
    protectedText: Array.from(document.querySelectorAll("output, [contenteditable], [role=listbox], [role=alert], [aria-live]")).map((element) => ({ id: element.id, text: element.textContent })),
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
    submissions: window.fixtureSubmissions
  }));
}
