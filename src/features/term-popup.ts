import { lookupGlossary, type GlossaryMatch } from "./reading/explanation";

const TERM = "data-silver-guide-term";
const POPUP = "data-silver-guide-term-popup";
const STYLE = "data-silver-guide-term-style";
const EXCLUDED = 'a,button,label,input,textarea,select,option,datalist,script,style,noscript,template,code,pre,kbd,samp,svg,math,iframe,object,embed,audio,video,summary,[onclick],[tabindex],[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="spinbutton"],[role="menuitem"],[role="option"],[role="application"],[data-silver-guide-form-tooltip]';
const INLINE_STYLE = `span[${TERM}]{color:inherit!important;cursor:pointer!important;text-decoration-line:underline!important;text-decoration-color:#078196!important;text-decoration-thickness:2px!important;text-underline-offset:3px!important}span[${TERM}]:focus-visible{outline:3px solid #0c75a6!important;outline-offset:3px!important}@media(forced-colors:active){span[${TERM}]{text-decoration-color:LinkText!important}span[${TERM}]:focus-visible{outline-color:Highlight!important}}`;
const POPUP_STYLE = `:host{all:initial}.card{box-sizing:border-box;padding:16px;border:1px solid #078196;border-radius:8px;background:#f0fbfa;color:#102c46;font:400 20px/1.6 system-ui,sans-serif;box-shadow:0 3px 14px #102c4633;overflow-wrap:anywhere}.card h2{margin:0 0 8px;font:700 22px/1.5 system-ui,sans-serif}.card p{margin:0 0 14px}.card button{box-sizing:border-box;display:block;width:100%;min-height:44px;padding:6px 12px;border:1px solid #078196;border-radius:5px;background:#fff;color:#102c46;font:400 20px/1.4 system-ui,sans-serif;cursor:pointer}.card button:focus-visible,:host(:focus-visible) .card{outline:3px solid #0c75a6;outline-offset:3px}@media(forced-colors:active){.card,.card button{color:CanvasText;background:Canvas;border-color:CanvasText}.card button:focus-visible,:host(:focus-visible) .card{outline-color:Highlight}}`;

type Replacement = { original: Text; parent: Node; nodes: Node[]; terms: HTMLElement[]; text: string };
type TermRecord = { match: GlossaryMatch; replacement: Replacement };

function elementOf(target: EventTarget | Node | null): Element | null {
  if (!target || !("nodeType" in target)) return null;
  return target.nodeType === 1 ? target as Element : (target as Node).parentElement;
}

function editing(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const flag = current.getAttribute("contenteditable")?.toLowerCase();
    if (flag === "false") return false;
    if (flag === "" || flag === "true" || flag === "plaintext-only") return true;
    if ((current as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function hidden(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden") || current.hasAttribute("inert") || current.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;
    if (current.tagName === "DETAILS" && !current.hasAttribute("open") && ![...current.children].find(child => child.tagName === "SUMMARY")?.contains(element)) return true;
    const css = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (css?.display === "none" || css?.visibility === "hidden" || css?.visibility === "collapse" || css?.contentVisibility === "hidden") return true;
  }
  return false;
}

/** Bundled word explanations on public page text. Never reads or changes form values. */
export function startTermPopup(options: { document?: Document } = {}): { stop(): void } {
  const doc = options.document ?? document, view = doc.defaultView;
  if (!view) return { stop() {} };
  let stopped = false, frame: number | null = null, anchor: HTMLElement | null = null, maintenance = false;
  let pointer: { x: number; y: number; dragged: boolean } | null = null;
  const replacements = new Set<Replacement>(), terms = new Map<HTMLElement, TermRecord>(), pending = new Set<Node>();
  const style = doc.createElement("style"); style.setAttribute(STYLE, ""); style.textContent = INLINE_STYLE;
  const host = doc.createElement("div"); host.setAttribute(POPUP, ""); host.setAttribute("role", "dialog"); host.tabIndex = -1;
  host.setAttribute("popover", "manual");
  host.style.setProperty("all", "initial", "important");
  for (const [name, value] of Object.entries({ position: "fixed", inset: "auto", margin: "0", padding: "0", border: "0", background: "transparent", height: "auto", overflow: "auto", "z-index": "2147483647", display: "none" })) host.style.setProperty(name, value, "important");
  const shadow = host.attachShadow({ mode: "closed" }), popupStyle = doc.createElement("style"), card = doc.createElement("section");
  popupStyle.textContent = POPUP_STYLE; card.className = "card";
  const title = doc.createElement("h2"), explanation = doc.createElement("p"), close = doc.createElement("button");
  close.type = "button"; close.textContent = "閉じる"; card.append(title, explanation, close); shadow.append(popupStyle, card);

  const own = (node: Node): boolean => node === style || node === host || host.contains(node) || !!elementOf(node)?.closest("[data-silver-guide-form-tooltip]");
  const eligible = (parent: Element): boolean => doc.designMode?.toLowerCase() !== "on" && !own(parent) && !parent.closest(EXCLUDED) && !parent.closest(`[${TERM}]`) && !editing(parent) && !hidden(parent);
  const termText = (term: HTMLElement): string | undefined => term.childNodes.length === 1 && term.firstChild?.nodeType === 3 ? (term.firstChild as Text).data : undefined;
  const hide = (restoreFocus = false): void => {
    const previous = anchor; anchor = null;
    previous?.setAttribute("aria-expanded", "false");
    try { host.hidePopover?.(); } catch { /* Already hidden, or no popover support. */ }
    host.style.setProperty("display", "none", "important");
    if (restoreFocus && previous?.isConnected && terms.has(previous) && previous.parentElement && eligible(previous.parentElement)) previous.focus({ preventScroll: true });
  };
  const restore = (replacement: Replacement): void => {
    const { original, parent, nodes, terms: ownedTerms, text } = replacement;
    const parentElement = elementOf(parent);
    const publicParent = !!parentElement && eligible(parentElement);
    const intact = publicParent && nodes.length > 0 && nodes.every((node, index) => node.parentNode === parent && (index === 0 || nodes[index - 1].nextSibling === node))
      && ownedTerms.every(term => !editing(term) && term.getAttribute("role") === "button" && !term.hasAttribute("onclick") && termText(term) === terms.get(term)?.match.term)
      && nodes.map(node => node.nodeType === 3 ? (node as Text).data : termText(node as HTMLElement)).join("") === text;
    if (anchor && ownedTerms.includes(anchor)) hide();
    if (intact) {
      parent.replaceChild(original, nodes[0]); nodes.slice(1).forEach(node => parent.removeChild(node));
    } else {
      // A framework may have edited or moved a wrapped node. Keep its current
      // children and order, rather than replacing them with a saved old string.
      ownedTerms.forEach(term => {
        if (!term.parentNode) return;
        const editable = term.getAttribute("contenteditable")?.toLowerCase();
        const repurposed = editable === "" || editable === "true" || editable === "plaintext-only" || term.getAttribute("role") !== "button" || term.tabIndex !== 0 || term.hasAttribute("onclick");
        if (repurposed) {
          // Preserve a page-owned action/editor created from our span. Only
          // remove our marker and descriptions; its new behavior belongs to the site.
          term.removeAttribute(TERM);
          if (term.getAttribute("aria-label") === `${terms.get(term)?.match.term}の説明を開く`) term.removeAttribute("aria-label");
          if (term.getAttribute("aria-haspopup") === "dialog") term.removeAttribute("aria-haspopup");
          if (["true", "false"].includes(term.getAttribute("aria-expanded") ?? "")) term.removeAttribute("aria-expanded");
        } else term.replaceWith(...term.childNodes);
      });
    }
    ownedTerms.forEach(term => terms.delete(term)); replacements.delete(replacement);
  };
  const valid = (term: HTMLElement): boolean => {
    const record = terms.get(term);
    return !!record && term.isConnected && !!term.parentElement && eligible(term.parentElement) && !editing(term) && !hidden(term)
      && term.getAttribute("role") === "button" && term.tabIndex === 0 && !term.hasAttribute("onclick") && termText(term) === record.match.term;
  };
  const publicContext = (term: HTMLElement): string => {
    const root = term.parentElement?.closest("p,li,dt,dd,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6,div,section,article") ?? term.parentElement;
    if (!root || own(root) || editing(root) || hidden(root)) return "";
    const chunks: string[] = []; let length = 0;
    const visit = (node: Node): void => {
      if (length >= 5000) return;
      if (node.nodeType === 3) { const text = (node as Text).data.slice(0, 5000 - length); chunks.push(text); length += text.length; return; }
      if (node.nodeType !== 1) return;
      const element = node as HTMLElement;
      if (own(element) || editing(element) || hidden(element) || element.matches(EXCLUDED) && !(terms.has(element) && valid(element))) return;
      element.childNodes.forEach(visit);
    };
    visit(root); return chunks.join("");
  };
  const place = (): void => {
    if (!anchor) return;
    if (!valid(anchor)) { hide(); return; }
    const viewport = view.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 8, topEdge = (viewport?.offsetTop ?? 0) + 8;
    const width = Math.max(0, (viewport?.width ?? view.innerWidth) - 16), height = Math.max(0, (viewport?.height ?? view.innerHeight) - 16);
    const rightEdge = leftEdge + width, bottomEdge = topEdge + height, word = anchor.getBoundingClientRect();
    if (width < 1 || height < 1 || word.bottom < topEdge || word.top > bottomEdge || word.right < leftEdge || word.left > rightEdge) { hide(); return; }
    host.style.setProperty("width", `${Math.min(360, width)}px`, "important");
    host.style.setProperty("max-height", `${height}px`, "important");
    const bounds = host.getBoundingClientRect();
    const left = Math.max(leftEdge, Math.min(word.left, rightEdge - bounds.width));
    const below = word.bottom + 8, above = word.top - bounds.height - 8;
    const top = Math.max(topEdge, Math.min(below + bounds.height <= bottomEdge ? below : above >= topEdge ? above : below, bottomEdge - bounds.height));
    host.style.setProperty("left", `${left}px`, "important"); host.style.setProperty("top", `${top}px`, "important");
  };
  const activate = (term: HTMLElement): void => {
    if (stopped || !valid(term)) return;
    const record = terms.get(term)!;
    const match = lookupGlossary(record.match.term, { url: doc.location?.href, surroundingText: publicContext(term) })[0] ?? record.match;
    hide(); anchor = term; term.setAttribute("aria-expanded", "true");
    title.textContent = match.term; explanation.textContent = match.explanation;
    host.setAttribute("aria-label", `${match.term}：${match.explanation}`);
    if (!host.isConnected) doc.documentElement.append(host);
    host.style.setProperty("display", "block", "important");
    try { if (!host.matches(":popover-open")) host.showPopover?.(); } catch { /* Fixed-position fallback. */ }
    place(); if (anchor) host.focus({ preventScroll: true });
  };
  const wrap = (node: Text): void => {
    if (!node.parentElement || !eligible(node.parentElement)) return;
    const text = node.data;
    if (!text.trim()) return;
    const matches = lookupGlossary(text, { url: doc.location?.href });
    if (!matches.length) return;
    const fragment = doc.createDocumentFragment(), nodes: Node[] = [], ownedTerms: HTMLElement[] = [];
    const replacement: Replacement = { original: node, parent: node.parentNode!, nodes, terms: ownedTerms, text };
    let offset = 0;
    const appendText = (value: string): void => { if (value) { const part = doc.createTextNode(value); fragment.append(part); nodes.push(part); } };
    for (const match of matches) {
      appendText(text.slice(offset, match.span.start));
      const term = doc.createElement("span"); term.setAttribute(TERM, match.id); term.setAttribute("role", "button"); term.tabIndex = 0;
      term.setAttribute("aria-label", `${match.term}の説明を開く`); term.setAttribute("aria-haspopup", "dialog"); term.setAttribute("aria-expanded", "false");
      term.textContent = match.term; terms.set(term, { match, replacement }); ownedTerms.push(term); nodes.push(term); fragment.append(term); offset = match.span.end;
    }
    appendText(text.slice(offset)); replacement.parent.replaceChild(fragment, node); replacements.add(replacement);
  };
  const scan = (root: Node): void => {
    if (!root.isConnected || own(root)) return;
    if (root.nodeType === 3) { wrap(root as Text); return; }
    const parent = elementOf(root);
    if (parent && !eligible(parent)) return;
    // Reject editors before visiting their text nodes. In particular, a
    // textarea's default text is never collected through an ancestor's textContent.
    const walker = doc.createTreeWalker(root, 1 | 4, { acceptNode(node) {
      if (node.nodeType === 1) return eligible(node as Element) ? 3 : 2;
      return 1;
    } });
    const candidates: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) candidates.push(node as Text);
    candidates.forEach(wrap);
  };
  const observer = new view.MutationObserver(records => {
    for (const record of records) {
      if (own(record.target)) continue;
      if (record.type === "childList") {
        if ([...record.addedNodes, ...record.removedNodes].every(own)) continue;
        record.addedNodes.forEach(node => { if (!own(node)) pending.add(node); });
        maintenance = true;
      } else pending.add(record.type === "characterData" ? record.target.parentNode ?? record.target : record.target);
    }
    if (pending.size || maintenance) schedule();
  });
  const observe = (): void => observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden", "open", "contenteditable", "role", "tabindex", "onclick"] });
  const refresh = (): void => {
    frame = null; if (stopped) return;
    if (pending.size || maintenance) {
      observer.disconnect();
      const roots = [...pending]; pending.clear(); maintenance = false;
      try {
        if (!style.isConnected) (doc.head ?? doc.documentElement).append(style);
        for (const replacement of [...replacements]) {
          if (replacement.terms.some(term => !valid(term)) || replacement.nodes.some((node, index) => node.parentNode !== replacement.parent || index > 0 && replacement.nodes[index - 1].nextSibling !== node)
            || replacement.nodes.map(node => node.nodeType === 3 ? (node as Text).data : termText(node as HTMLElement)).join("") !== replacement.text) {
            const parent = replacement.parent; restore(replacement); roots.push(parent);
          }
        }
        const unique = [...new Set(roots)];
        unique.filter(root => !unique.some(other => other !== root && other.contains(root))).forEach(scan);
      } finally { observe(); }
    }
    place();
  };
  const schedule = (root?: Node): void => { if (root) pending.add(root); if (!stopped && frame === null) frame = view.requestAnimationFrame(refresh); };
  const termFor = (target: EventTarget | null): HTMLElement | null => {
    const term = elementOf(target)?.closest<HTMLElement>(`[${TERM}]`); return term && terms.has(term) ? term : null;
  };
  const onClick = (event: MouseEvent): void => {
    const term = termFor(event.target);
    if (term) {
      if (event.button !== 0 || event.detail > 1 || pointer?.dragged || view.getSelection()?.isCollapsed === false) { hide(); pointer = null; return; }
      event.preventDefault(); event.stopPropagation(); activate(term);
    } else if (event.target !== host && !event.composedPath().includes(host)) hide();
    pointer = null;
  };
  const onPointerDown = (event: PointerEvent): void => { pointer = { x: event.clientX, y: event.clientY, dragged: event.button !== 0 }; };
  const onPointerMove = (event: PointerEvent): void => { if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.dragged = true; };
  const onPointerCancel = (): void => { if (pointer) pointer.dragged = true; };
  const onKey = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === "Escape" && anchor) { event.preventDefault(); event.stopPropagation(); hide(true); return; }
    const term = termFor(event.target);
    if (term && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) activate(term); }
  };
  const onFocus = (event: FocusEvent): void => { if (anchor && event.target !== anchor && event.target !== host && !event.composedPath().includes(host)) hide(); };
  const onScroll = (event: Event): void => { if (event.target !== host && !event.composedPath().includes(host)) schedule(); };
  const onResize = (): void => schedule(doc.body ?? doc.documentElement);
  const onClose = (): void => hide(true);
  close.addEventListener("click", onClose);
  doc.addEventListener("click", onClick, true); doc.addEventListener("keydown", onKey, true); doc.addEventListener("focusin", onFocus, true);
  doc.addEventListener("pointerdown", onPointerDown, true); doc.addEventListener("pointermove", onPointerMove, true); doc.addEventListener("pointercancel", onPointerCancel, true);
  doc.addEventListener("scroll", onScroll, true); view.addEventListener("resize", onResize);
  view.visualViewport?.addEventListener("resize", onResize); view.visualViewport?.addEventListener("scroll", onScroll);
  pending.add(doc.body ?? doc.documentElement); refresh();
  return { stop() {
    if (stopped) return;
    stopped = true; if (frame !== null) view.cancelAnimationFrame(frame); observer.disconnect(); pending.clear(); hide();
    doc.removeEventListener("click", onClick, true); doc.removeEventListener("keydown", onKey, true); doc.removeEventListener("focusin", onFocus, true);
    doc.removeEventListener("pointerdown", onPointerDown, true); doc.removeEventListener("pointermove", onPointerMove, true); doc.removeEventListener("pointercancel", onPointerCancel, true);
    doc.removeEventListener("scroll", onScroll, true); view.removeEventListener("resize", onResize);
    view.visualViewport?.removeEventListener("resize", onResize); view.visualViewport?.removeEventListener("scroll", onScroll);
    close.removeEventListener("click", onClose); [...replacements].forEach(restore); style.remove(); host.remove(); pointer = null;
  } };
}
