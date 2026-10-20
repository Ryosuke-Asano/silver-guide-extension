// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFormTooltip } from "../../src/features/form-tooltip";

let assistance: ReturnType<typeof startFormTooltip> | undefined;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const rectangles = new Map<string, DOMRect>();
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} });
const tooltip = (): HTMLElement | null => document.querySelector("[data-silver-guide-form-tooltip]");
const showing = (): boolean => !!tooltip() && tooltip()!.style.display !== "none";
const flush = async (): Promise<void> => {
  for (let round = 0; round < 6; round++) {
    await Promise.resolve();
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
  }
};
const field = (id = "kana"): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
async function start(markup = '<label for="kana">フリガナ</label><input id="kana"><button id="site-next">確認画面へ</button>'): Promise<void> {
  document.body.innerHTML = markup;
  assistance = startFormTooltip({ document });
  field().focus(); await flush();
}

beforeEach(() => {
  document.head.innerHTML = ""; document.body.innerHTML = "";
  frames = new Map(); nextFrame = 0; rectangles.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    if (this.hasAttribute("data-silver-guide-form-tooltip")) return rect(0, 0, Math.min(320, Number.parseFloat(this.style.maxWidth) || 320), 76);
    return rectangles.get(this.id) ?? (this.tagName === "INPUT" || this.tagName === "TEXTAREA" ? rect(100, 300, 500, 44) : rect(0, 0, 0, 0));
  });
  vi.stubGlobal("innerWidth", 1024); vi.stubGlobal("innerHeight", 768);
});
afterEach(() => { assistance?.stop(); assistance = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("focus-only form tooltip", () => {
  it("starts on an already focused original input without adding buttons, moving focus or layout", async () => {
    document.body.innerHTML = '<label for="kana">フリガナ</label><input id="kana" value="ヤマダ ハナコ"><button>確認画面へ</button>';
    field().focus(); const focus = vi.spyOn(field(), "focus"), input = vi.fn(), change = vi.fn();
    document.addEventListener("input", input); document.addEventListener("change", change);
    assistance = startFormTooltip({ document }); await flush();
    expect(showing()).toBe(true); expect(tooltip()!.dataset.placement).toBe("top");
    expect(tooltip()!.getAttribute("aria-label")).toBe("カタカナで入力します。 例：ヤマダ ハナコ");
    expect(field().getAttribute("aria-describedby")).toBe(tooltip()!.id);
    expect(tooltip()!.getAttribute("role")).toBe("tooltip"); expect(tooltip()!.shadowRoot).toBeNull();
    expect(document.querySelectorAll("button")).toHaveLength(1); expect(tooltip()!.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(field()); expect(field().value).toBe("ヤマダ ハナコ"); expect(focus).not.toHaveBeenCalled();
    expect(tooltip()!.style.position).toBe("fixed"); expect(tooltip()!.style.pointerEvents).toBe("none");
    expect(input).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    document.removeEventListener("input", input); document.removeEventListener("change", change);
  });

  it("never reads or writes current/default values, checked state or validation, including controls inside labels", async () => {
    document.body.innerHTML = '<label>フリガナ<input id="kana"><textarea>private default</textarea><span contenteditable>private editing</span></label>';
    for (const control of document.querySelectorAll("input,textarea")) {
      for (const property of ["value", "defaultValue", "checked"]) Object.defineProperty(control, property, { configurable: true, get() { throw Error(`read ${property}`); }, set() { throw Error(`write ${property}`); } });
    }
    const check = vi.spyOn(field(), "checkValidity"), report = vi.spyOn(field(), "reportValidity");
    assistance = startFormTooltip({ document }); field().focus(); await flush();
    expect(showing()).toBe(true); expect(tooltip()!.getAttribute("aria-label")).not.toContain("private");
    field().dispatchEvent(new Event("input", { bubbles: true })); await flush();
    expect(check).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  });

  it("prioritizes the site's descriptions and explicit errors without overwriting their ARIA associations", async () => {
    await start('<label for="kana">フリガナ</label><input id="kana" aria-describedby="original-help"><span id="original-help" hidden>カタカナで入力してください。</span>');
    expect(showing()).toBe(false); expect(field().getAttribute("aria-describedby")).toBe("original-help");
    field().removeAttribute("aria-describedby"); await flush(); expect(showing()).toBe(true);
    field().setAttribute("aria-invalid", "true"); field().setAttribute("aria-errormessage", "site-error"); await flush();
    expect(showing()).toBe(false); expect(field().hasAttribute("aria-describedby")).toBe(false);
    field().removeAttribute("aria-invalid"); await flush(); expect(showing()).toBe(true);
    field().dispatchEvent(new Event("invalid")); expect(showing()).toBe(false);
    field().dispatchEvent(new Event("input", { bubbles: true })); await flush(); expect(showing()).toBe(true);
    field().setAttribute("aria-description", "サイトの説明です。"); await flush(); expect(showing()).toBe(false);
  });

  it("uses explicit script instructions, refuses unknown formats, and never helps password/authentication fields", async () => {
    await start('<label for="kana">ふりがな（カタカナ）</label><input id="kana"><input id="unknown" aria-label="受付番号"><input id="auth" aria-label="フリガナ 認証コード"><input id="password" type="password" aria-label="フリガナ"><input id="otp" autocomplete="one-time-code" aria-label="フリガナ">');
    expect(tooltip()!.getAttribute("aria-label")).toContain("カタカナ");
    field().setAttribute("aria-label", "ふりがな（ひらがな）"); await flush(); expect(tooltip()!.getAttribute("aria-label")).toContain("ひらがなで");
    for (const id of ["unknown", "auth", "password", "otp"]) { field(id).focus(); await flush(); expect(showing(), id).toBe(false); }
  });

  it("prefers above, falls below only for collisions or viewport space, and hides when both are blocked", async () => {
    await start('<label for="kana">フリガナ</label><input id="kana"><label id="previous">前の項目</label><input id="next-field" type="email">');
    // Keep this unrelated field outside the candidate bubbles initially.
    rectangles.set("next-field", rect(100, 600, 500, 44)); window.dispatchEvent(new Event("resize")); await flush();
    expect(tooltip()!.dataset.placement).toBe("top"); expect(Number.parseFloat(tooltip()!.style.top)).toBe(214);
    rectangles.set("previous", rect(250, 220, 250, 60)); window.dispatchEvent(new Event("resize")); await flush();
    expect(tooltip()!.dataset.placement).toBe("bottom"); expect(Number.parseFloat(tooltip()!.style.top)).toBe(354);
    rectangles.set("next-field", rect(100, 360, 500, 44)); window.dispatchEvent(new Event("resize")); await flush();
    expect(showing()).toBe(false); expect(field().hasAttribute("aria-describedby")).toBe(false);
    rectangles.delete("previous"); rectangles.set("kana", rect(100, 30, 500, 44)); rectangles.set("next-field", rect(100, 600, 500, 44)); window.dispatchEvent(new Event("resize")); await flush();
    expect(tooltip()!.dataset.placement).toBe("bottom");
  });

  it("tracks scrolling and narrow/zoomed visual viewports without placing the bubble at either side", async () => {
    const viewport = new EventTarget() as VisualViewport;
    Object.assign(viewport, { offsetTop: 0, offsetLeft: 0, width: 360, height: 640 });
    vi.stubGlobal("visualViewport", viewport);
    rectangles.set("kana", rect(12, 200, 336, 44)); await start();
    expect(showing()).toBe(true); expect(tooltip()!.dataset.placement).toBe("top");
    expect(Number.parseFloat(tooltip()!.style.left)).toBeGreaterThanOrEqual(8);
    rectangles.set("kana", rect(12, 100, 336, 44)); document.dispatchEvent(new Event("scroll")); await flush();
    expect(Number.parseFloat(tooltip()!.style.top)).toBe(14);
    Object.assign(viewport, { offsetTop: 90, offsetLeft: 0, width: 360, height: 300 }); viewport.dispatchEvent(new Event("resize")); await flush();
    expect(tooltip()!.dataset.placement).toBe("bottom");
    rectangles.set("kana", rect(12, -100, 336, 44)); document.dispatchEvent(new Event("scroll")); await flush(); expect(showing()).toBe(false);
  });

  it("dismisses on Escape until the next focus without consuming the site's keyboard event", async () => {
    await start(); const siteKey = vi.fn(); field().addEventListener("keydown", siteKey);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); field().dispatchEvent(escape);
    expect(showing()).toBe(false); expect(escape.defaultPrevented).toBe(false); expect(siteKey).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("resize")); field().dispatchEvent(new Event("input", { bubbles: true })); await flush(); expect(showing()).toBe(false);
    document.getElementById("site-next")!.focus(); field().focus(); await flush(); expect(showing()).toBe(true);
    document.getElementById("site-next")!.focus(); expect(showing()).toBe(false);
  });

  it("temporarily hides during IME composition and lets Escape handle the candidate without dismissing help", async () => {
    await start(); field().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); expect(showing()).toBe(false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }); field().dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    field().dispatchEvent(new Event("input", { bubbles: true })); window.dispatchEvent(new Event("resize")); await flush(); expect(showing()).toBe(false);
    field().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); await flush();
    expect(showing()).toBe(true); expect(document.activeElement).toBe(field());
  });

  it("ends help on dynamic hiding, readonly/disabled state and removal, and works for a replacement field", async () => {
    await start();
    for (const attribute of ["hidden", "readonly", "disabled", "aria-readonly", "aria-disabled"]) {
      field().setAttribute(attribute, attribute.startsWith("aria-") ? "true" : ""); await flush(); expect(showing(), attribute).toBe(false);
      field().removeAttribute(attribute); field().focus(); await flush(); expect(showing(), attribute).toBe(true);
    }
    const old = field(); old.remove(); await flush(); expect(showing()).toBe(false); expect(old.hasAttribute("aria-describedby")).toBe(false);
    const replacement = document.createElement("input"); replacement.id = "kana"; document.body.append(replacement); replacement.focus(); await flush(); expect(showing()).toBe(true);
  });

  it("preserves site changes to aria-describedby when stopping, and does not revive on queued changes", async () => {
    await start(); const target = field(), ownId = tooltip()!.id;
    target.setAttribute("aria-describedby", `site-before ${ownId} site-after`);
    assistance!.stop(); assistance!.stop(); await flush();
    expect(target.getAttribute("aria-describedby")).toBe("site-before site-after"); expect(tooltip()).toBeNull();
    target.focus(); window.dispatchEvent(new Event("resize")); await flush(); expect(tooltip()).toBeNull();
  });

  it("does not take an existing page id and leaves unresolved site ARIA tokens intact", async () => {
    await start('<div id="silver-guide-form-tooltip">元ページの要素</div><label for="kana">フリガナ</label><input id="kana" aria-describedby="unresolved-site-help">');
    expect(tooltip()!.id).not.toBe("silver-guide-form-tooltip"); expect(field().getAttribute("aria-describedby")).toContain("unresolved-site-help");
    assistance!.stop(); expect(field().getAttribute("aria-describedby")).toBe("unresolved-site-help");
    expect(document.getElementById("silver-guide-form-tooltip")!.textContent).toBe("元ページの要素");
  });
});
