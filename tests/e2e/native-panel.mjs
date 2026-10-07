import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceDirectory, expect } from "./extension.mjs";

/** Chrome's native pane is a CDP target, rather than a Playwright tab. */
export class NativePanel {
  constructor(browserSession, sessionId, targetId, windowId, opened) {
    Object.assign(this, { browserSession, sessionId, targetId, windowId, opened });
    this.pending = new Map();
    this.nextId = 0;
    this.logs = [];
    this.errors = [];
    this.requests = [];
    this.handleMessage = (event) => {
      if (event.sessionId !== this.sessionId) return;
      const response = JSON.parse(event.message);
      if (response.method === "Runtime.exceptionThrown") this.errors.push(response.params.exceptionDetails.text);
      if (response.method === "Runtime.consoleAPICalled") {
        this.logs.push({ type: response.params.type, text: response.params.args.map((item) => item.value ?? item.description ?? "").join(" ") });
      }
      if (response.method === "Fetch.requestPaused") {
        this.requests.push(response.params.request);
        void this.send("Fetch.failRequest", { requestId: response.params.requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
      }
      const callback = this.pending.get(response.id);
      if (callback === undefined) return;
      this.pending.delete(response.id);
      clearTimeout(callback.timeout);
      if (response.error !== undefined) callback.reject(new Error(response.error.message));
      else callback.resolve(response.result);
    };
    browserSession.on("Target.receivedMessageFromTarget", this.handleMessage);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native panel CDP timeout: ${method}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timeout });
      this.browserSession.send("Target.sendMessageToTarget", {
        sessionId: this.sessionId, message: JSON.stringify({ id, method, params })
      }).catch((error) => {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async evaluate(fn, arg) {
    const expression = `(${fn.toString()})(${JSON.stringify(arg) ?? "undefined"})`;
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails !== undefined) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }

  request(message) {
    return this.evaluate((value) => chrome.runtime.sendMessage(value), message);
  }

  state() {
    return this.request({ type: "silver-guide-state", windowId: this.windowId });
  }

  text() {
    return this.evaluate(() => document.body.innerText);
  }

  async click(selector) {
    await expect.poll(() => this.evaluate((query) => {
      const element = document.querySelector(query);
      return element !== null && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true";
    }, selector)).toBe(true);
    const point = await this.evaluate((query) => {
      const element = document.querySelector(query);
      element.scrollIntoView({ behavior: "instant", block: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  }

  action(name) {
    return this.click(`[data-panel-action="${name}"]`);
  }

  async waitForText(text) {
    await expect.poll(() => this.text()).toContain(text);
  }

  async waitForToggle(active) {
    await expect.poll(() => this.evaluate(() => {
      const button = document.querySelector('[data-panel-action="toggle"]');
      return button === null || button.matches(":disabled") ? "" : button.textContent.trim();
    })).toBe(active ? "支援を停止する" : "このページを支援する");
  }

  async save(name) {
    const directory = path.join(evidenceDirectory, "screenshots");
    await mkdir(directory, { recursive: true });
    const screenshot = await this.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path.join(directory, `${name}.png`), Buffer.from(screenshot.data, "base64"));
  }

  async dispose() {
    for (const callback of this.pending.values()) {
      clearTimeout(callback.timeout);
      callback.reject(new Error("Native panel closed"));
    }
    this.pending.clear();
    this.browserSession.off("Target.receivedMessageFromTarget", this.handleMessage);
    await this.browserSession.send("Target.detachFromTarget", { sessionId: this.sessionId }).catch(() => undefined);
    await this.browserSession.detach().catch(() => undefined);
  }
}

export async function fixtureTab(worker, page) {
  return worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error("The fictional fixture tab was not found.");
    return { tabId: tab.id, windowId: tab.windowId };
  }, page.url());
}

export async function openNativePanel(context, worker, page) {
  const target = await fixtureTab(worker, page);
  const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
  const browserSession = await context.browser().newBrowserCDPSession();
  const before = await browserSession.send("Target.getTargets");
  const previous = new Set(before.targetInfos.map((item) => item.targetId));
  await worker.evaluate(() => {
    self.__silverGuideQaOpened = undefined;
    self.__silverGuideQaOnOpened = (info) => { self.__silverGuideQaOpened = info; };
    chrome.sidePanel.onOpened.addListener(self.__silverGuideQaOnOpened);
  });
  const controlURL = `${origin}/qa-open-panel.html?window=${target.windowId}`;
  const openedPage = context.waitForEvent("page");
  await worker.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: target.windowId, url: controlURL });
  const control = await openedPage;
  await control.waitForURL(controlURL);
  await control.getByRole("button", { name: "テスト用サイドパネルを開く" }).click();
  await expect(control.locator("#open-result")).toHaveText("opened");
  let nativeTarget;
  await expect.poll(async () => {
    const { targetInfos } = await browserSession.send("Target.getTargets");
    nativeTarget = targetInfos.find((item) => !previous.has(item.targetId) && item.url === `${origin}/sidepanel.html`);
    return nativeTarget !== undefined;
  }).toBe(true);
  const opened = await worker.evaluate(() => self.__silverGuideQaOpened);
  expect(opened).toMatchObject({ windowId: target.windowId, path: "/sidepanel.html" });
  await worker.evaluate(() => chrome.sidePanel.onOpened.removeListener(self.__silverGuideQaOnOpened));
  const { sessionId } = await browserSession.send("Target.attachToTarget", { targetId: nativeTarget.targetId, flatten: false });
  const panel = new NativePanel(browserSession, sessionId, nativeTarget.targetId, target.windowId, opened);
  await panel.send("Runtime.enable");
  // The native pane only needs packaged extension assets. Any HTTP request
  // from that target is blocked and retained as test evidence.
  await panel.send("Fetch.enable", { patterns: [{ urlPattern: "http://*" }, { urlPattern: "https://*" }] });
  await page.bringToFront();
  await control.close();
  await panel.waitForToggle(false);
  return panel;
}
