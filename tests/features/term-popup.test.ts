// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTermPopup } from "../../src/features/term-popup";
import { selectedPublicText } from "../../src/features/selected-text";

let assistance: ReturnType<typeof startTermPopup> | undefined;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
let roots: WeakMap<Element, ShadowRoot>;
const rectangles = new Map<string, DOMRect>();
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} });
const terms = (element: ParentNode = document): HTMLElement[] => [...element.querySelectorAll<HTMLElement>("[data-silver-guide-term]")];
const popup = (): HTMLElement | null => document.querySelector("[data-silver-guide-term-popup]");
const showing = (): boolean => !!popup() && popup()!.style.display !== "none" && !popup()!.hidden;
const flush = async (): Promise<void> => {
  for (let round = 0; round < 12; round++) {
    await Promise.resolve();
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
  }
};
async function start(markup = '<p id="reading">本人以外が手続きする場合は、委任状が必要です。</p><input id="field"><button id="site-next">次へ</button>'): Promise<void> {
  document.body.innerHTML = markup;
  assistance = startTermPopup({ document }); await flush();
}
async function open(term = terms().find(element => element.textContent === "委任状")!): Promise<HTMLElement> {
  term.click(); await flush(); expect(showing()).toBe(true); return popup()!;
}

beforeEach(() => {
  document.head.innerHTML = ""; document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
  frames = new Map(); nextFrame = 0; rectangles.clear(); roots = new WeakMap();
  const attachShadow = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function(this: HTMLElement, init: ShadowRootInit) {
    const root = attachShadow.call(this, init); roots.set(this, root); return root;
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.hasAttribute("data-silver-guide-term-popup")) return rect(0, 0, Number.parseFloat(this.style.width) || 360, Math.min(180, Number.parseFloat(this.style.maxHeight) || 180));
    return rectangles.get(this.id) ?? (this.hasAttribute("data-silver-guide-term") ? rect(200, 240, 70, 24) : rect(0, 0, 200, 30));
  });
  vi.stubGlobal("innerWidth", 1024); vi.stubGlobal("innerHeight", 768);
});
afterEach(() => { assistance?.stop(); assistance = undefined; window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("clickable dictionary terms", () => {
  it("underlines dictionary words without changing the source text and opens the matching local explanation", async () => {
    await start();
    expect(document.getElementById("reading")!.textContent).toBe("本人以外が手続きする場合は、委任状が必要です。");
    expect(showing()).toBe(false);
    const term = terms().find(element => element.textContent === "委任状")!;
    expect(term.getAttribute("role")).toBe("button"); expect(term.tabIndex).toBe(0);
    expect(window.getComputedStyle(term).textDecorationLine).toBe("underline");
    const host = await open(term);
    expect(host.getAttribute("role")).toBe("dialog"); expect(host.shadowRoot).toBeNull();
    expect(term.getAttribute("aria-haspopup")).toBe("dialog"); expect(term.getAttribute("aria-expanded")).toBe("true");
    expect(host.getAttribute("aria-label")).toContain("委任状");
    expect(host.getAttribute("aria-label")).toContain("本人が、ほかの人に手続きを頼んだことを示す書類です。");
    expect(roots.get(host)!.querySelectorAll("button")).toHaveLength(1);
    expect(terms()).not.toContain(host); expect(document.querySelectorAll("[data-silver-guide-term-popup]")).toHaveLength(1);
  });

  it.each(["Enter", " "])("opens a focused term with %j and prevents that activation key's default action", async key => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    term.focus(); const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }); term.dispatchEvent(event); await flush();
    expect(showing()).toBe(true); expect(event.defaultPrevented).toBe(true);
    expect(popup()!.getAttribute("aria-label")).toContain("委任状");
  });

  it("keeps the longest dictionary match intact and preserves context-dependent meanings", async () => {
    await start('<p id="reading">住民票の世帯主と世帯を確認します。</p><p id="story">物語のアプリの通知</p>');
    expect(terms(document.getElementById("reading")!).map(element => element.textContent)).toEqual(["住民票", "世帯主", "世帯"]);
    expect(document.querySelectorAll("[data-silver-guide-term] [data-silver-guide-term]")).toHaveLength(0);
    await open(terms().find(element => element.textContent === "世帯主")!);
    expect(popup()!.getAttribute("aria-label")).toContain("その世帯の代表として登録されている人です。");
    await open(terms(document.getElementById("story")!)[0]);
    expect(popup()!.getAttribute("aria-label")).toContain("文脈によって意味が変わる言葉です。");
    expect(popup()!.getAttribute("aria-label")).not.toContain("役所が、手続きの結果");
  });

  it("uses the same public paragraph as context when inline markup splits a dictionary term from its context", async () => {
    await start('<p id="reading">住民票の<strong>世帯主</strong>を確認します。</p><p>物語のアプリの通知</p>');
    await open(terms().find(element => element.textContent === "世帯主")!);
    expect(popup()!.getAttribute("aria-label")).toContain("その世帯の代表として登録されている人です。");
  });

  it("leaves site links, buttons, labels, controls, editors and code unchanged and never touches control values", async () => {
    document.body.innerHTML = '<p id="reading">委任状</p><div id="protected"><a href="#destination">必要書類</a><button>委任状</button><label>フリガナ<input id="secret" value="委任状"></label><textarea>世帯主</textarea><select><option>申請</option></select><div contenteditable>代理人</div><div role="textbox">証明書</div><div role="button" tabindex="0">期限</div><pre>住民税</pre><code>年金</code><script>const x="通知";</script><style>.委任状{color:red}</style><template>申請</template></div>';
    const protectedArea = document.getElementById("protected")!, markup = protectedArea.innerHTML;
    for (const control of document.querySelectorAll("input,textarea,select")) {
      for (const property of ["value", "defaultValue", "checked"]) Object.defineProperty(control, property, { configurable: true, get() { throw Error(`read ${property}`); }, set() { throw Error(`write ${property}`); } });
    }
    const link = document.querySelector("a")!, click = vi.fn(); link.addEventListener("click", click);
    assistance = startTermPopup({ document }); await flush();
    expect(terms()).toHaveLength(1); expect(protectedArea.innerHTML).toBe(markup);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(click).toHaveBeenCalledOnce(); expect(showing()).toBe(false);
    document.getElementById("secret")!.focus(); await flush(); expect(showing()).toBe(false);
  });

  it("still explains public page paragraphs when the site wraps the whole page in a form", async () => {
    await start('<form><p id="reading">本人確認には委任状が必要です。</p><label>フリガナ<input id="field" value="private"></label></form><section role="form"><p>必要書類</p><textarea>private</textarea></section>');
    expect(terms().map(element => element.textContent)).toEqual(["本人確認", "委任状", "必要書類"]);
    expect(document.querySelectorAll("label [data-silver-guide-term], input [data-silver-guide-term], textarea [data-silver-guide-term]")).toHaveLength(0);
    await open(); expect(popup()!.getAttribute("aria-label")).toContain("委任状");
  });

  it("never uses private controls, editor text, labels or hidden text as the meaning of a public word", async () => {
    document.body.innerHTML = '<div>物語のアプリの<span>通知</span><input value="住民票"><textarea>住民票</textarea><label>住民票<input></label><div contenteditable>役所</div><span hidden>自治体</span></div>';
    for (const control of document.querySelectorAll("input,textarea")) Object.defineProperty(control, "value", { configurable: true, get() { throw Error("Private value read"); }, set() { throw Error("Private value write"); } });
    const privateText = document.querySelector("textarea")!.firstChild!;
    Object.defineProperty(privateText, "data", { configurable: true, get() { throw Error("Private default text read"); } });
    assistance = startTermPopup({ document }); await flush();
    expect(terms().map(element => element.textContent)).toEqual(["通知"]);
    await open(terms()[0]); expect(popup()!.getAttribute("aria-label")).toContain("文脈によって意味が変わる言葉です。");
  });

  it("does not annotate hidden, inert, aria-hidden or closed-details text", async () => {
    await start('<p>委任状</p><div hidden>必要書類</div><div inert>代理人</div><div aria-hidden="true">申請</div><p style="display:none">証明書</p><p style="visibility:hidden">手数料</p><details><summary>見出し</summary><p>世帯主</p></details>');
    expect(terms().map(element => element.textContent)).toEqual(["委任状"]);
  });

  it("does not open while the user selects or drags the original text", async () => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    const range = document.createRange(); range.selectNodeContents(document.getElementById("reading")!);
    window.getSelection()!.addRange(range);
    term.dispatchEvent(new MouseEvent("mousedown", { clientX: 210, clientY: 250, button: 0, bubbles: true }));
    term.dispatchEvent(new MouseEvent("mousemove", { clientX: 260, clientY: 250, buttons: 1, bubbles: true }));
    term.dispatchEvent(new MouseEvent("mouseup", { clientX: 260, clientY: 250, button: 0, bubbles: true }));
    term.click(); await flush(); expect(showing()).toBe(false);
    window.getSelection()!.removeAllRanges();
    term.dispatchEvent(new MouseEvent("mousedown", { clientX: 210, clientY: 250, button: 0, bubbles: true }));
    term.dispatchEvent(new MouseEvent("mouseup", { clientX: 210, clientY: 250, button: 0, bubbles: true }));
    await open(term);
  });

  it("does not turn a double-click used for selecting a word into popup activation", async () => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    term.dispatchEvent(new MouseEvent("click", { detail: 2, button: 0, bubbles: true, cancelable: true }));
    await flush(); expect(showing()).toBe(false);
  });

  it("rejects a pointer drag even when the browser has collapsed the selection before the click", async () => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    term.dispatchEvent(new MouseEvent("pointerdown", { clientX: 210, clientY: 250, button: 0, bubbles: true }));
    term.dispatchEvent(new MouseEvent("pointermove", { clientX: 245, clientY: 250, buttons: 1, bubbles: true }));
    term.click(); await flush(); expect(showing()).toBe(false);
  });

  it("closes with Escape and restores keyboard focus to its original term", async () => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    term.focus(); await open(term);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await flush();
    expect(showing()).toBe(false); expect(document.activeElement).toBe(term); expect(term.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes with its sole close button and on outside click without stealing the new focus", async () => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    const host = await open(term), close = roots.get(host)!.querySelector("button")!;
    close.click(); await flush(); expect(showing()).toBe(false);
    await open(term); const next = document.getElementById("site-next")!;
    next.focus(); next.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); next.click(); await flush();
    expect(showing()).toBe(false); expect(document.activeElement).toBe(next);
  });

  it("closes when an original form field gains focus and preserves the field's focus", async () => {
    await start(); await open(); const field = document.getElementById("field")!;
    field.focus(); await flush(); expect(showing()).toBe(false); expect(document.activeElement).toBe(field);
  });

  it("rejects selection of the popup host before reading it as public source text for the sidebar", async () => {
    await start(); const host = await open();
    const range = document.createRange(); range.selectNode(host);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const read = vi.spyOn(selection, "toString").mockImplementation(() => { throw Error("Popup explanation must not become page source"); });
    expect(selectedPublicText(document)).toEqual({ text: null, status: "empty" }); expect(read).not.toHaveBeenCalled();
  });

  it("dismisses on an outside text click without programmatically restoring term focus", async () => {
    await start(); const term = terms().find(element => element.textContent === "委任状")!;
    await open(term); const focus = vi.spyOn(term, "focus"), outside = document.createElement("p");
    outside.textContent = "元ページの続きです。"; document.body.append(outside); await flush();
    outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); outside.click(); await flush();
    expect(showing()).toBe(false); expect(focus).not.toHaveBeenCalled();
  });

  it("annotates newly inserted and replaced public text once without observer feedback loops", async () => {
    await start('<section id="dynamic"><p id="reading">委任状</p></section>');
    const initial = terms()[0], dynamic = document.getElementById("dynamic")!;
    dynamic.insertAdjacentHTML("beforeend", '<p id="extra">必要書類を準備してください。</p>'); await flush();
    expect(terms().map(element => element.textContent)).toEqual(["委任状", "必要書類"]); expect(terms()[0]).toBe(initial);
    document.getElementById("extra")!.textContent = "代理人が来ます。"; await flush();
    expect(terms().map(element => element.textContent)).toEqual(["委任状", "代理人"]);
    expect(document.querySelectorAll("[data-silver-guide-term] [data-silver-guide-term]")).toHaveLength(0);
    const settled = nextFrame; await flush(); expect(nextFrame).toBe(settled); expect(frames.size).toBe(0);
    await open(initial); initial.closest("p")!.remove(); await flush(); expect(showing()).toBe(false);
  });

  it("bounds the popup within a narrow viewport and repositions or closes after scrolling", async () => {
    vi.stubGlobal("innerWidth", 320); vi.stubGlobal("innerHeight", 480);
    await start(); const term = terms().find(element => element.textContent === "委任状")!; term.id = "edge";
    rectangles.set("edge", rect(282, 430, 30, 24)); const host = await open(term);
    const left = Number.parseFloat(host.style.left), top = Number.parseFloat(host.style.top);
    expect(left).toBeGreaterThanOrEqual(0); expect(top).toBeGreaterThanOrEqual(0);
    expect(left + Number.parseFloat(host.style.width)).toBeLessThanOrEqual(320);
    expect(top + 180).toBeLessThanOrEqual(480);
    rectangles.set("edge", rect(282, -100, 30, 24)); document.dispatchEvent(new Event("scroll")); await flush();
    if (showing()) {
      expect(Number.parseFloat(host.style.top)).toBeGreaterThanOrEqual(0);
      expect(Number.parseFloat(host.style.top) + 180).toBeLessThanOrEqual(480);
    }
  });

  it("stops idempotently, restores the original text, and cannot revive on queued mutations", async () => {
    await start(); const reading = document.getElementById("reading")!, original = reading.textContent;
    await open(); reading.append("必要書類"); assistance!.stop(); assistance!.stop(); await flush();
    expect(terms()).toHaveLength(0); expect(popup()).toBeNull(); expect(reading.textContent).toBe(`${original}必要書類`);
    reading.append("委任状"); document.dispatchEvent(new Event("scroll")); await flush(); expect(terms()).toHaveLength(0); expect(popup()).toBeNull();
  });
});
