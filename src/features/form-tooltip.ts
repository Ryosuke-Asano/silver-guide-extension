type Field = HTMLInputElement | HTMLTextAreaElement;
type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const PRIVATE_TEXT = 'input,textarea,select,option,datalist,script,style,noscript,template,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]';
const INPUT_TYPES = new Set(["text", "email", "tel", "url", "number"]);
const AUTH = /パスワード|暗証|認証|個人番号|マイナンバー|カード番号|口座番号|password|\botp\b|\bcvv\b|\bcvc\b/iu;
const STYLE = `:host{all:initial} .hint{box-sizing:border-box;padding:9px 13px;border:1px solid #078196;border-radius:6px;background:#f0fbfa;color:#102c46;font:400 20px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px #102c461a;overflow-wrap:anywhere;white-space:pre-line} .hint:after{content:"";position:absolute;width:9px;height:9px;background:#f0fbfa;border-right:1px solid #078196;border-bottom:1px solid #078196;bottom:-5px;left:calc(50% - 5px);transform:rotate(45deg)} :host([data-placement="bottom"]) .hint:after{bottom:auto;top:-5px;transform:rotate(225deg)} @media(forced-colors:active){.hint{color:CanvasText;background:Canvas;border-color:CanvasText}.hint:after{background:Canvas;border-color:CanvasText}}`;

function visible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute("hidden") || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true") return false;
    if (node.tagName === "DETAILS" && !node.hasAttribute("open") && ![...node.children].find(child => child.tagName === "SUMMARY")?.contains(element)) return false;
    const css = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (css?.display === "none" || css?.visibility === "hidden" || css?.visibility === "collapse" || css?.contentVisibility === "hidden") return false;
  }
  return true;
}

/** Collect label text without touching values or default text inside controls. */
function publicText(element: Element | null): string {
  if (!element || element.matches(PRIVATE_TEXT) || !visible(element)) return "";
  const chunks: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) { chunks.push((node as Text).data); return; }
    if (node.nodeType !== 1 || (node as Element).matches(PRIVATE_TEXT) || !visible(node as Element)) return;
    node.childNodes.forEach(visit);
  };
  element.childNodes.forEach(visit);
  return chunks.join(" ").replace(/\s+/gu, " ").trim().slice(0, 600);
}

function fieldHint(field: Field, ownId: string): string | null {
  const doc = field.ownerDocument;
  const tokens = (attribute: string): string[] => (field.getAttribute(attribute) ?? "").trim().split(/\s+/u).filter(Boolean);
  // The site's own descriptions and errors take priority, even when they use
  // visually hidden accessible text. Never repeat them in another bubble.
  if (field.getAttribute("aria-description")?.trim() || tokens("aria-describedby").some(id => id !== ownId && doc.getElementById(id)) || ["true", "grammar", "spelling"].includes(field.getAttribute("aria-invalid") ?? "")) return null;
  const label = tokens("aria-labelledby").map(id => publicText(doc.getElementById(id))).filter(Boolean).join(" ") || field.getAttribute("aria-label")?.trim() || [...field.labels ?? []].map(publicText).filter(Boolean).join(" ");
  const autocomplete = field.getAttribute("autocomplete") ?? "";
  if (AUTH.test(`${label} ${field.getAttribute("name") ?? ""} ${field.id}`) || /(?:^|\s)(?:cc-[\w-]+|one-time-code|current-password|new-password)(?:\s|$)/iu.test(autocomplete)) return null;
  // An explicit script instruction wins over the label's spelling. Other
  // unknown patterns/length limits are deliberately left to the original site.
  const format = `${label} ${field.getAttribute("placeholder") ?? ""}`;
  if (/カタカナ|片仮名|全角カナ/u.test(format)) return "カタカナで入力します。\n例：ヤマダ ハナコ";
  if (/ひらがな|平仮名/u.test(format)) return "ひらがなで入力します。\n例：やまだ はなこ";
  if (/フリガナ/u.test(label)) return "カタカナで入力します。\n例：ヤマダ ハナコ";
  if (/ふりがな|振り仮名|振仮名/u.test(label)) return "名前の読み方を入力します。";
  if (field.tagName === "TEXTAREA") return null;
  return ({ email: "メールアドレスを入力します。\n例：name@example.invalid", tel: "電話番号を入力します。", url: "ウェブページのアドレスを入力します。", number: "数字を入力します。" } as Record<string, string>)[(field as HTMLInputElement).type] ?? null;
}

/** Focus-only help. No form-value reads, writes, copies, storage, or messages. */
export function startFormTooltip(options: { document?: Document } = {}): { stop(): void } {
  const doc = options.document ?? document, view = doc.defaultView;
  if (!view) return { stop() {} };
  let ownId = "silver-guide-form-tooltip";
  while (doc.getElementById(ownId)) ownId += "-hint";
  const host = doc.createElement("div");
  host.id = ownId; host.setAttribute("role", "tooltip"); host.setAttribute("data-silver-guide-form-tooltip", "");
  host.setAttribute("popover", "manual");
  host.style.setProperty("all", "initial", "important");
  for (const [name, value] of Object.entries({ position: "fixed", inset: "auto", margin: "0", padding: "0", border: "0", background: "transparent", width: "max-content", height: "auto", overflow: "visible", "z-index": "2147483647", "pointer-events": "none", display: "none" })) host.style.setProperty(name, value, "important");
  const shadow = host.attachShadow({ mode: "closed" }), style = doc.createElement("style"), content = doc.createElement("div");
  style.textContent = STYLE; content.className = "hint"; shadow.append(style, content);
  let active: Field | null = null, described: Field | null = null, dismissed: Field | null = null;
  let composing = false, stopped = false, frame: number | null = null;
  const invalid = new WeakSet<Element>();
  const eligible = (element: Element | null): element is Field => !!element && element.ownerDocument === doc && element.isConnected && (element.tagName === "TEXTAREA" || element.tagName === "INPUT" && INPUT_TYPES.has((element as HTMLInputElement).type)) && !(element as Field).disabled && !element.matches(":disabled") && !(element as Field).readOnly && element.getAttribute("aria-disabled") !== "true" && element.getAttribute("aria-readonly") !== "true" && !element.closest('[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]') && visible(element);
  const removeDescription = (): void => {
    if (!described) return;
    const tokens = (described.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(id => id && id !== ownId);
    if (tokens.length) described.setAttribute("aria-describedby", tokens.join(" "));
    else described.removeAttribute("aria-describedby");
    described = null;
  };
  const hide = (): void => {
    removeDescription();
    try { host.hidePopover?.(); } catch { /* Already closed or unsupported. */ }
    host.style.setProperty("display", "none", "important");
    host.removeAttribute("data-placement");
  };
  const intersects = (a: Rect, b: Rect): boolean => b.width > 0 && b.height > 0 && a.left < b.right + 3 && a.right > b.left - 3 && a.top < b.bottom + 3 && a.bottom > b.top - 3;
  const blocked = (candidate: Rect): boolean => {
    for (const element of doc.querySelectorAll("input,textarea,select,label,[role=alert],[aria-live]")) {
      if (element === active || host.contains(element) || !visible(element)) continue;
      if (element.tagName !== "LABEL") {
        if (intersects(candidate, element.getBoundingClientRect())) return true;
        continue;
      }
      // A block label can have empty space across the entire input width; a
      // wrapping label also contains its input. Protect the actual public text.
      const walker = doc.createTreeWalker(element, 4);
      let textRects = false;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement || node.parentElement.closest(PRIVATE_TEXT) || !node.textContent?.trim() || !visible(node.parentElement)) continue;
        const range = doc.createRange(); range.selectNodeContents(node);
        if (typeof range.getClientRects === "function") {
          const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
          textRects ||= rects.length > 0;
          if (rects.some(rect => intersects(candidate, rect))) return true;
        }
      }
      if (!textRects && !element.contains(active) && intersects(candidate, element.getBoundingClientRect())) return true;
    }
    return false;
  };
  const refresh = (): void => {
    frame = null;
    if (stopped) return;
    if (!eligible(active) || doc.activeElement !== active || active === dismissed || composing || invalid.has(active)) { hide(); return; }
    const hint = fieldHint(active, ownId);
    if (!hint) { hide(); return; }
    const fieldRect = active.getBoundingClientRect(), viewport = view.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8;
    const rightEdge = leftEdge + (viewport?.width ?? view.innerWidth) - 16, bottomEdge = topEdge + (viewport?.height ?? view.innerHeight) - 16;
    if (fieldRect.width <= 0 || fieldRect.height <= 0 || fieldRect.left < leftEdge || fieldRect.right > rightEdge || fieldRect.top < topEdge || fieldRect.bottom > bottomEdge) { hide(); return; }
    if (!host.isConnected) doc.documentElement.append(host);
    content.textContent = hint;
    // The referenced id is on the light-DOM host, not inside a shadow root.
    host.setAttribute("aria-label", hint.replace(/\n/gu, " "));
    host.style.setProperty("max-width", `${Math.min(360, fieldRect.width, rightEdge - leftEdge)}px`, "important");
    host.style.setProperty("display", "block", "important");
    try { if (!host.matches(":popover-open")) host.showPopover?.(); } catch { /* Fixed-position fallback on older browsers. */ }
    const bounds = host.getBoundingClientRect();
    const left = Math.max(leftEdge, Math.min(fieldRect.right - bounds.width, rightEdge - bounds.width));
    let placement: "top" | "bottom" | null = null, top = 0;
    for (const side of ["top", "bottom"] as const) {
      const y = side === "top" ? fieldRect.top - bounds.height - 10 : fieldRect.bottom + 10;
      const candidate = { left, right: left + bounds.width, top: y, bottom: y + bounds.height, width: bounds.width, height: bounds.height };
      if (bounds.width > 0 && bounds.height > 0 && y >= topEdge && candidate.bottom <= bottomEdge && !blocked(candidate)) { placement = side; top = y; break; }
    }
    if (!placement) { hide(); return; }
    host.dataset.placement = placement;
    host.style.setProperty("left", `${left}px`, "important"); host.style.setProperty("top", `${top}px`, "important");
    if (described !== active) removeDescription();
    const ids = (active.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    if (!ids.includes(ownId)) active.setAttribute("aria-describedby", [...ids, ownId].join(" "));
    described = active;
  };
  const schedule = (): void => { if (!stopped && frame === null) frame = view.requestAnimationFrame(refresh); };
  const focus = (): void => { const next = eligible(doc.activeElement) ? doc.activeElement : null; if (next !== active) { hide(); active = next; dismissed = null; composing = false; } schedule(); };
  const focusOut = (): void => { hide(); active = null; composing = false; };
  const key = (event: KeyboardEvent): void => { if (event.key === "Escape" && !event.isComposing && !composing && active) { dismissed = active; hide(); } };
  const compositionStart = (event: Event): void => { if (event.target === active) { composing = true; hide(); } };
  const compositionEnd = (event: Event): void => { if (event.target === active) { composing = false; schedule(); } };
  const onInvalid = (event: Event): void => { if (event.target === active && active) { invalid.add(active); hide(); } };
  const onInput = (event: Event): void => { if (event.target === active && active) { invalid.delete(active); schedule(); } };
  const observer = new view.MutationObserver(records => { if (records.some(record => record.target !== host && !host.contains(record.target) && (record.type !== "childList" || [...record.addedNodes, ...record.removedNodes].some(node => node !== host)))) schedule(); });
  observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "open", "disabled", "readonly", "aria-hidden", "aria-disabled", "aria-readonly", "aria-invalid", "aria-description", "aria-describedby", "aria-labelledby", "aria-label", "aria-errormessage", "type", "id", "for", "name", "autocomplete", "placeholder", "contenteditable", "role"] });
  const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(schedule) : null;
  resize?.observe(doc.documentElement);
  doc.addEventListener("focusin", focus, true); doc.addEventListener("focusout", focusOut, true);
  doc.addEventListener("keydown", key, true); doc.addEventListener("compositionstart", compositionStart, true); doc.addEventListener("compositionend", compositionEnd, true);
  doc.addEventListener("invalid", onInvalid, true); doc.addEventListener("input", onInput, true); doc.addEventListener("scroll", schedule, true); doc.addEventListener("load", schedule, true);
  view.addEventListener("resize", schedule); view.visualViewport?.addEventListener("resize", schedule); view.visualViewport?.addEventListener("scroll", schedule);
  focus();
  return { stop() {
    if (stopped) return;
    stopped = true; if (frame !== null) view.cancelAnimationFrame(frame); observer.disconnect(); resize?.disconnect(); hide(); host.remove(); active = null; dismissed = null;
    doc.removeEventListener("focusin", focus, true); doc.removeEventListener("focusout", focusOut, true);
    doc.removeEventListener("keydown", key, true); doc.removeEventListener("compositionstart", compositionStart, true); doc.removeEventListener("compositionend", compositionEnd, true);
    doc.removeEventListener("invalid", onInvalid, true); doc.removeEventListener("input", onInput, true); doc.removeEventListener("scroll", schedule, true); doc.removeEventListener("load", schedule, true);
    view.removeEventListener("resize", schedule); view.visualViewport?.removeEventListener("resize", schedule); view.visualViewport?.removeEventListener("scroll", schedule);
  } };
}
