import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const firefox = process.env.SILVER_GUIDE_FIREFOX_PATH;
const geckodriver = process.env.SILVER_GUIDE_GECKODRIVER_PATH ?? "geckodriver";
const evidence = process.env.SILVER_GUIDE_FIREFOX_QA_DIR ?? path.join(tmpdir(), "silver-guide-qa/firefox");
const temporary = await mkdtemp(path.join(tmpdir(), "silver-guide-firefox-smoke-"));
const report = { startedAt: new Date().toISOString(), browser: undefined, manifestPermissions: [], contentSha256: undefined, checks: [], limitations: ["Firefox UI / Marionette actor bridge tested on Firefox 157; older Firefox / Floorp UI versions may differ.", "Screen-reader speech and extension store packaging are not covered."] };
let driver;
let server;
let session;
let endpoint;
let capabilities;
let driverLog = "";

function launch(command, args, env) {
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (error) => { child.launchError = error; });
  return child;
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitFor(read, accept = Boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Firefox: ${JSON.stringify(last)}`);
}

async function request(method, route, body, sessionRoute = true) {
  const response = await fetch(`${endpoint}${sessionRoute ? `/session/${session}` : ""}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000)
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(`${method} ${route}: ${JSON.stringify(result.value)}`);
  return result.value;
}

const context = (name) => request("POST", "/moz/context", { context: name });
const evaluate = (script, args = []) => request("POST", "/execute/sync", { script, args });
const click = (element) => request("POST", `/element/${element["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
const dock = () => evaluate("return document.getElementById('silver-guide-host')?.shadowRoot?.getElementById('silver-guide-dock')?.textContent ?? null;");

async function popupCommand(operation, script) {
  await context("chrome");
  // Firefox's remote extension popup is not an HTML iframe. Use the same
  // native Marionette commands in its browsing context, with default click
  // interactability checks. This never substitutes the extension's APIs.
  return request("POST", "/execute/async", {
    script: `const [operation,script,caps,done]=arguments;
      const popup=document.querySelector('browser.webextension-popup-browser');
      if(!popup){done({error:'Extension popup missing'});return;}
      const actor=popup.browsingContext.currentWindowGlobal.getActor('MarionetteCommands');
      const result=operation==='click'
        ? actor.findElement('css selector',script,{}).then(e=>actor.clickElement(e,{toJSON:()=>caps}))
        : actor.executeScript(script,[],{});
      result.then(value=>done({value:value??null}),e=>done({error:String(e)}));`,
    args: [operation, script, capabilities]
  }).then((result) => {
    if (result.error) throw new Error(result.error);
    return result.value;
  });
}

async function openPopup() {
  await context("chrome");
  await click(await evaluate("return document.getElementById('unified-extensions-button');"));
  const action = await waitFor(() => evaluate("return document.querySelector('.webextension-browser-action[data-extensionid=\"silver-guide@example.invalid\"]');"));
  await click(action); // Trusted browser action grants activeTab for this tab.
  await waitFor(() => evaluate("return document.querySelector('browser.webextension-popup-browser')?.browsingContext?.currentURI?.spec ?? null;"), (url) => url?.endsWith("/popup.html"));
  await waitFor(() => popupCommand("script", "return document.querySelector('.primary-action')?.textContent ?? null;"));
}

async function enable() {
  await openPopup();
  assert.equal(await popupCommand("script", "return document.querySelector('.primary-action').textContent;"), "このページを支援する");
  await popupCommand("click", ".primary-action");
  await waitFor(() => popupCommand("script", "return document.querySelector('.status-message')?.textContent;"), (text) => text === "このページの支援を開始しました。");
  // Close the browser UI popup, then continue in the original fixture tab.
  await request("POST", "/actions", { actions: [{ type: "key", id: "close-popup", actions: [{ type: "keyDown", value: "\uE00C" }, { type: "keyUp", value: "\uE00C" }] }] });
  await request("DELETE", "/actions");
  await context("content");
  await waitFor(dock);
}

async function pressDock(label) {
  const button = await evaluate("return [...document.getElementById('silver-guide-host').shadowRoot.querySelectorAll('#silver-guide-dock button')].find(e=>e.textContent===arguments[0]);", [label]);
  assert.ok(button, `Dock button missing: ${label}`);
  await click(button);
}

async function pressFixture(selector) {
  await evaluate("document.querySelector(arguments[0]).focus();", [selector]);
  await request("POST", "/actions", { actions: [{ type: "key", id: "fixture-control", actions: [{ type: "keyDown", value: "\uE007" }, { type: "keyUp", value: "\uE007" }] }] });
  await request("DELETE", "/actions");
}

async function screenshot(name) {
  const data = await request("GET", "/screenshot");
  await writeFile(path.join(evidence, `${name}.png`), Buffer.from(data, "base64"));
}

async function check(name, run) {
  await run();
  assert.equal(await evaluate("return window.fixtureSubmissions;"), 0);
  report.checks.push({ name, result: "passed" });
  process.stdout.write(`PASS ${name}\n`);
}

try {
  await mkdir(evidence, { recursive: true });
  const env = { ...process.env };
  for (const [variable, directory] of [["XDG_CONFIG_HOME", "config"], ["XDG_CACHE_HOME", "cache"], ["XDG_DATA_HOME", "data"]]) {
    env[variable] = path.join(temporary, directory);
    await mkdir(env[variable], { recursive: true });
  }
  await mkdir(path.join(temporary, "profiles"));
  const staging = path.join(temporary, "extension");
  await cp(path.join(root, "dist"), staging, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(staging, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  report.manifestPermissions = manifest.permissions;
  report.contentSha256 = createHash("sha256").update(await readFile(path.join(staging, "content.js"))).digest("hex");

  const fixturePort = await freePort();
  server = launch(process.execPath, ["tests/e2e/server.mjs"], { ...env, SILVER_GUIDE_TEST_PORT: String(fixturePort) });
  server.stderr.on("data", (chunk) => { process.stderr.write(chunk); });
  await waitFor(async () => {
    if (server.launchError) throw server.launchError;
    return fetch(`http://127.0.0.1:${fixturePort}/health`).then((res) => res.ok).catch(() => false);
  });
  driver = launch(geckodriver, ["--host", "127.0.0.1", "--port", "0", "--profile-root", path.join(temporary, "profiles"), "--allow-system-access", "--log", "info"], env);
  const readLog = (chunk) => { driverLog += chunk.toString(); };
  driver.stdout.on("data", readLog);
  driver.stderr.on("data", readLog);
  await waitFor(() => {
    if (driver.launchError) throw driver.launchError;
    endpoint = driverLog.match(/Listening on (http:\/\/)?(127\.0\.0\.1:\d+)/)?.[2];
    if (endpoint) endpoint = `http://${endpoint}`;
    return endpoint;
  });
  const started = await request("POST", "/session", { capabilities: { alwaysMatch: {
    browserName: "firefox", acceptInsecureCerts: false,
    "moz:firefoxOptions": { ...(firefox ? { binary: firefox } : {}), args: ["-headless", "--no-remote"], prefs: { "browser.shell.checkDefaultBrowser": false, "browser.startup.homepage": "about:blank", "browser.startup.page": 0 } }
  } } }, false);
  session = started.sessionId;
  capabilities = started.capabilities;
  report.browser = capabilities.browserVersion;
  assert.equal(capabilities["moz:webdriverClick"], true);
  assert.equal(await request("POST", "/moz/addon/install", { path: staging, temporary: true }), manifest.browser_specific_settings.gecko.id);
  await request("POST", "/window/rect", { width: 1280, height: 900 });
  const visit = (file) => request("POST", "/url", { url: `http://127.0.0.1:${fixturePort}/${file}` });

  await check("real toolbar activeTab grant and popup startup", async () => {
    await visit("semantic.html");
    assert.equal(await dock(), null);
    await enable();
    assert.match(await dock(), /この画面の入力項目：9 項目/);
  });
  await check("form navigation without changing values or radio choices", async () => {
    const before = await evaluate("return [...document.querySelectorAll('input,textarea,select')].map(e=>({id:e.id,value:e.value,checked:e.checked}));");
    await pressDock("最初の入力項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "full-name");
    await pressDock("次の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "birth-date");
    await pressDock("次の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "phone");
    await pressDock("次の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "purpose-school");
    await pressDock("前の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "phone");
    await pressDock("前の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "birth-date");
    await pressDock("次の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "phone");
    assert.match(await dock(), /現在の項目：3 \/ 8/);
    assert.deepEqual(await evaluate("return [...document.querySelectorAll('input,textarea,select')].map(e=>({id:e.id,value:e.value,checked:e.checked}));"), before);
    await screenshot("native-form-navigation");
  });
  await check("stop and restart through the real popup without duplicate injection", async () => {
    await pressDock("閉じる");
    assert.equal(await dock(), null);
    await enable();
    assert.equal(await evaluate("return document.querySelectorAll('#silver-guide-host').length;"), 1);
    await pressDock("最初の入力項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "full-name");
  });
  await check("ARIA error recovery without copying the error text", async () => {
    await visit("aria-table.html");
    await enable();
    await pressFixture("#show-errors");
    await waitFor(dock, (text) => text.includes("確認が必要な項目：1 件"));
    await pressDock("最初のエラー項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "email");
    assert.ok(!(await dock()).includes("FAKE-PRIVATE-EMAIL"));
    await screenshot("declared-error-recovery");
  });
  await check("native invalid notification and safe recovery", async () => {
    await pressFixture("#clear-errors");
    await pressFixture("#check-native");
    await waitFor(dock, (text) => text.includes("確認が必要な項目：1 件"));
    await pressDock("最初のエラー項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "native-required");
  });
  await check("dynamic local step replacement and mobile field visibility", async () => {
    await request("POST", "/window/rect", { width: 390, height: 844 });
    await visit("dynamic.html");
    await enable();
    await pressFixture("#next-stage");
    await waitFor(dock, (text) => text.includes("2. 届出内容"));
    await pressDock("最初の入力項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "stage-two");
    await pressDock("次の項目へ");
    assert.equal(await evaluate("return document.activeElement.id;"), "stage-two-date");
    const layout = await evaluate("const field=document.activeElement.getBoundingClientRect(),panel=document.getElementById('silver-guide-host').shadowRoot.getElementById('silver-guide-dock').getBoundingClientRect(); return {viewport:{width:innerWidth,height:innerHeight},visible:field.top>=0&&field.bottom<=innerHeight&&! (field.left<panel.right&&field.right>panel.left&&field.top<panel.bottom&&field.bottom>panel.top)};");
    report.mobileViewport = layout.viewport;
    assert.equal(layout.visible, true);
    await screenshot("dynamic-mobile-stage");
  });
  assert.equal(await evaluate("return window.fixtureSubmissions;"), 0);
  assert.ok(!driverLog.includes("[silver-guide] Unable to start assistance"));
} catch (error) {
  report.checks.push({ name: "smoke run", result: "failed", error: String(error) });
  if (session) await screenshot("failure").catch(() => undefined);
  process.exitCode = 1;
  process.stderr.write(`${error.stack ?? error}\n`);
} finally {
  if (session) await request("DELETE", "").catch(() => undefined);
  for (const child of [driver, server]) if (child && child.exitCode === null) child.kill("SIGTERM");
  report.finishedAt = new Date().toISOString();
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, "smoke-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(evidence, "smoke-geckodriver.log"), driverLog);
  await rm(temporary, { recursive: true, force: true });
}
