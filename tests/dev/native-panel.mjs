/** Attach to Chrome's native extension panel, which is not a Playwright tab. */
export async function nativePanel(demo) {
  const cdp = await demo.context.browser().newBrowserCDPSession();
  const tabs = (await cdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] })).targetInfos;
  await cdp.send("Extensions.triggerAction", { id: demo.extensionId, targetId: tabs.find(tab => tab.url === demo.url).targetId });
  let target;
  for (let attempt = 0; attempt < 100 && !target; attempt++) {
    target = (await cdp.send("Target.getTargets")).targetInfos.find(candidate => candidate.url.endsWith("/sidebar.html"));
    if (!target) await demo.page.waitForTimeout(100);
  }
  if (!target) throw new Error("Native extension panel did not open");
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
