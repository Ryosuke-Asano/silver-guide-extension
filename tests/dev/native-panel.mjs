/** Attach to Chrome's native extension panel, which is not a Playwright tab. */
export async function nativePanel(demo) {
  const root = `chrome-extension://${demo.extensionId}/`;
  const worker = demo.context.serviceWorkers().find(value => value.url() === root + "background.js")
    ?? await demo.context.waitForEvent("serviceworker", { predicate: value => value.url() === root + "background.js" });
  // Content scripts can finish before the worker has configured the native
  // panel. Wait for its API round trip before sending the synthetic action.
  await worker.evaluate(async () => {
    await chrome.sidePanel.getPanelBehavior();
    globalThis.__silverGuideSmokeAction = null;
    chrome.action.onClicked.addListener(tab => { globalThis.__silverGuideSmokeAction = { id: tab.id, windowId: tab.windowId, url: tab.url }; });
  });
  // Installation may open the bundled launcher after the local form loads.
  // A native panel belongs to the active tab in the window being exercised.
  await demo.page.bringToFront();
  const cdp = await demo.context.browser().newBrowserCDPSession();
  const tabs = (await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] })).targetInfos;
  await cdp.send("Extensions.triggerAction", { id: demo.extensionId, targetId: tabs.find(tab => tab.url === demo.url).targetId });
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    target = (await cdp.send("Target.getTargets")).targetInfos.find(candidate => candidate.url.startsWith(root) && new URL(candidate.url).pathname === "/sidebar.html");
    if (!target) await demo.page.waitForTimeout(100);
  }
  if (!target) {
    const state = await worker.evaluate(async () => ({ action: globalThis.__silverGuideSmokeAction, behavior: await chrome.sidePanel.getPanelBehavior(), options: await chrome.sidePanel.getOptions({}), tabs: (await chrome.tabs.query({})).map(tab => ({ id: tab.id, windowId: tab.windowId, active: tab.active, url: tab.url })) }));
    throw new Error(`Native extension panel did not open: ${JSON.stringify(state)}`);
  }
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", event => {
    if (event.sessionId !== sessionId) return;
    const reply = JSON.parse(event.message), callbacks = pending.get(reply.id);
    if (!callbacks) return;
    pending.delete(reply.id);
    reply.error ? callbacks.reject(new Error(reply.error.message)) : callbacks.resolve(reply.result);
  });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: reply => reply.exceptionDetails ? reject(new Error(JSON.stringify(reply.exceptionDetails))) : resolve(reply.result.value), reject });
    void cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }) }).catch(reject);
  });
  return { evaluate };
}
