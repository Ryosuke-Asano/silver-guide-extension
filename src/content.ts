import { GLOSSARY, type GlossaryEntry } from "./data/glossary";
import { guidePackFor, type GuideField, type GuidePack } from "./data/guide-packs";
import type { PageCapabilities } from "./shared/capabilities";
import type { SilverGuideSettings } from "./shared/settings";

type ContentMessage =
  | { type: "silver-guide-enable"; settings: SilverGuideSettings }
  | { type: "silver-guide-disable" }
  | { type: "silver-guide-state" }
  | { type: "silver-guide-update-settings"; settings: SilverGuideSettings };

type SupportedField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type ContentState = {
  active: boolean;
  capabilities?: PageCapabilities;
};

declare const chrome: typeof browser;

type AssistantState = {
  activeField?: SupportedField;
  dock: HTMLElement;
  guidePack?: GuidePack;
  host: HTMLElement;
  inlineStyle: HTMLStyleElement;
  observer: MutationObserver;
  settings: SilverGuideSettings;
  tooltip: HTMLElement;
  onFocusIn: (event: FocusEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

declare global {
  interface Window {
    __silverGuideContentReady?: boolean;
  }
}

const HOST_ID = "silver-guide-host";
const TERM_ATTRIBUTE = "data-silver-guide-term";
const GENERATED_ATTRIBUTE = "data-silver-guide-generated";
const EXCLUDED_TERM_CONTAINERS = [
  "a",
  "button",
  "code",
  "input",
  "select",
  "textarea",
  "[contenteditable=true]",
  "[role=application]",
  `#${HOST_ID}`,
  `[${TERM_ATTRIBUTE}]`
].join(",");
const TERM_CONTAINER_SELECTOR = "p, li, dd, td, th, h1, h2, h3, h4";
const GLOSSARY_BY_ID = new Map(GLOSSARY.map((entry) => [entry.id, entry]));
const TERM_PATTERN = new RegExp(
  GLOSSARY.map((entry) => entry.term).sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"),
  "g"
);

let state: AssistantState | undefined;
/**
 * `scripting.executeScript` injects a classic script in Chromium. Keep this
 * small adapter in this entry file so Vite does not emit an ES-module import
 * into the injected bundle. A normal web page's `window.chrome` is rejected.
 */
function getContentExtensionApi(): typeof browser | undefined {
  const candidate = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : undefined;

  if (candidate === undefined || typeof candidate.runtime?.sendMessage !== "function") {
    return undefined;
  }

  return candidate;
}

const extensionApi = getContentExtensionApi();

const ASSISTANT_STYLE = `
  :host { all: initial; color-scheme: light; }
  *, *::before, *::after { box-sizing: border-box; }
  #silver-guide-dock, #silver-guide-tooltip {
    --body-size: 20px;
    --heading-size: 28px;
    color: #0f2747;
    color-scheme: light;
    font-family: "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif;
    line-height: 1.7;
  }
  .font-small { --body-size: 18px; --heading-size: 26px; }
  .font-medium { --body-size: 20px; --heading-size: 28px; }
  .font-large { --body-size: 24px; --heading-size: 30px; }
  #silver-guide-dock {
    background: #ffffff;
    border: 1px solid #cad3df;
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(15, 39, 71, .24);
    max-height: calc(100vh - 36px);
    overflow: auto;
    padding: 24px;
    position: fixed;
    right: 18px;
    top: 18px;
    width: min(380px, calc(100vw - 36px));
    z-index: 2147483647;
  }
  #silver-guide-tooltip {
    background: #ffffff;
    border: 2px solid #a8cfab;
    border-radius: 10px;
    box-shadow: 0 12px 30px rgba(15, 39, 71, .2);
    display: none;
    max-width: min(360px, calc(100vw - 24px));
    padding: 16px;
    position: fixed;
    width: 340px;
    z-index: 2147483647;
  }
  #silver-guide-tooltip[data-open] { display: block; }
  .dock-header, .tooltip-header { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
  .title { align-items: center; display: flex; font-size: var(--heading-size); font-weight: 700; gap: 10px; line-height: 1.3; margin: 0; }
  .book { color: #076c78; font-size: 32px; font-weight: 700; line-height: 1; }
  .close {
    background: #ffffff;
    border: 3px solid #0f2747;
    border-radius: 8px;
    color: #0f2747;
    cursor: pointer;
    font-size: 18px;
    font-weight: 700;
    min-height: 44px;
    min-width: 44px;
    padding: 5px 10px;
  }
  .close:hover { background: #edf7f8; }
  button:focus-visible, a:focus-visible { outline: 3px solid #0c75a6; outline-offset: 3px; }
  .lead { border-bottom: 2px solid #cad3df; font-size: var(--body-size); font-weight: 600; margin: 18px 0 20px; padding-bottom: 16px; }
  .section-title { font-size: 21px; line-height: 1.4; margin: 0 0 8px; }
  .detail { background: #f3fbf0; border: 2px solid #a8cfab; border-radius: 10px; font-size: var(--body-size); margin: 0 0 16px; padding: 14px; }
  .detail p { margin: 0; }
  .detail p + p { margin-top: 8px; }
  .detail ul { margin: 8px 0 0; padding-left: 1.3em; }
  .detail li + li { margin-top: 4px; }
  .next {
    align-items: center;
    background: #076c78;
    border: 2px solid #076c78;
    border-radius: 10px;
    color: #ffffff;
    cursor: pointer;
    display: flex;
    font-size: 21px;
    font-weight: 700;
    gap: 10px;
    justify-content: center;
    min-height: 58px;
    padding: 12px 16px;
    width: 100%;
  }
  .next:hover { background: #055b65; border-color: #055b65; }
  .route-list { display: grid; gap: 10px; }
  .route {
    align-items: center;
    border: 2px solid #b5d5ec;
    border-radius: 8px;
    color: #0f2747;
    display: flex;
    font-size: var(--body-size);
    font-weight: 700;
    min-height: 52px;
    padding: 10px 12px;
    text-decoration: none;
  }
  .route:hover { background: #edf7f8; }
  .privacy { align-items: flex-start; border-top: 2px solid #cad3df; display: flex; font-size: 18px; font-weight: 700; gap: 8px; margin: 20px 0 0; padding-top: 16px; }
  .privacy-mark { color: #076c78; }
  .tooltip-title { font-size: 24px; line-height: 1.35; margin: 0; }
  .original { color: #39556f; font-size: 18px; margin: 8px 0 0; }
  .explanation { background: #f3fbf0; border: 2px solid #a8cfab; border-radius: 8px; font-size: var(--body-size); margin: 12px 0 0; padding: 12px; }
  .explanation p { margin: 0; }
  @media (max-width: 620px) {
    #silver-guide-dock { bottom: 0; left: 0; max-height: 82vh; right: 0; top: auto; width: 100vw; }
  }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
`;

const INLINE_TERM_STYLE = `
  [data-silver-guide-generated="true"] {
    color: inherit !important;
    cursor: pointer !important;
    text-decoration-color: #076c78 !important;
    text-decoration-line: underline !important;
    text-decoration-thickness: 2px !important;
    text-underline-offset: 3px !important;
  }
  [data-silver-guide-generated="true"]:focus-visible {
    outline: 3px solid #0c75a6 !important;
    outline-offset: 3px !important;
  }
`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isContentMessage(message: unknown): message is ContentMessage {
  return message !== null && typeof message === "object" && "type" in message;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className !== undefined) {
    element.className = className;
  }
  return element;
}

function createButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = createElement("button", className);
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function rootForTerms(): HTMLElement {
  return document.querySelector<HTMLElement>("main, article, [role=main]") ?? document.body;
}

function isEligibleTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (parent === null || node.data.trim().length === 0) {
    return false;
  }

  return parent.closest(EXCLUDED_TERM_CONTAINERS) === null && parent.closest(TERM_CONTAINER_SELECTOR) !== null;
}

function wrapGlossaryTerms(): void {
  const walker = document.createTreeWalker(rootForTerms(), NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node instanceof Text && isEligibleTextNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
  });
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current !== null) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const value = textNode.data;
    TERM_PATTERN.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let didMatch = false;
    let match = TERM_PATTERN.exec(value);

    while (match !== null) {
      didMatch = true;
      const matchedIndex = match.index;
      const matchedText = match[0];
      fragment.append(value.slice(lastIndex, matchedIndex));
      const entry = GLOSSARY.find((candidate) => candidate.term === matchedText);
      if (entry === undefined) {
        fragment.append(matchedText);
      } else {
        const term = createElement("span", "silver-guide-term");
        term.setAttribute(TERM_ATTRIBUTE, entry.id);
        term.setAttribute(GENERATED_ATTRIBUTE, "true");
        term.setAttribute("role", "button");
        term.setAttribute("tabindex", "0");
        term.setAttribute("aria-label", `${entry.term} の説明を開く`);
        term.textContent = entry.term;
        term.addEventListener("click", () => showTooltip(term, entry));
        term.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showTooltip(term, entry);
          }
        });
        fragment.append(term);
      }
      lastIndex = matchedIndex + matchedText.length;
      match = TERM_PATTERN.exec(value);
    }

    if (didMatch && textNode.parentNode !== null) {
      fragment.append(value.slice(lastIndex));
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }
}

function restoreGlossaryTerms(): void {
  const parents = new Set<ParentNode>();
  document.querySelectorAll<HTMLElement>(`[${GENERATED_ATTRIBUTE}="true"]`).forEach((term) => {
    const parent = term.parentNode;
    term.replaceWith(document.createTextNode(term.textContent ?? ""));
    if (parent !== null) {
      parents.add(parent);
    }
  });
  parents.forEach((parent) => parent.normalize());
}

function isSupportedField(element: EventTarget | null): element is SupportedField {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    return false;
  }
  if (element instanceof HTMLInputElement && (element.type === "hidden" || element.type === "password")) {
    return false;
  }
  return element.getClientRects().length > 0;
}

function fieldLabel(field: SupportedField): string {
  const ariaLabel = field.getAttribute("aria-label")?.trim();
  if (ariaLabel !== undefined && ariaLabel.length > 0) {
    return ariaLabel;
  }
  const label = field.labels?.item(0)?.innerText.trim();
  if (label !== undefined && label.length > 0) {
    return label;
  }
  if (field.id.length > 0) {
    const explicitLabel = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(field.id)}"]`);
    if (explicitLabel?.innerText.trim()) {
      return explicitLabel.innerText.trim();
    }
  }
  return field.getAttribute("name")?.trim() || "この入力欄";
}

function fieldFacts(field: SupportedField): string[] {
  const facts: string[] = [];
  if (field.required || field.getAttribute("aria-required") === "true") {
    facts.push("この欄は必ず入力する項目です。");
  }
  if (field instanceof HTMLInputElement) {
    if (field.type === "email") facts.push("メールアドレスの形式で入力します。");
    if (field.type === "date") facts.push("日付を選ぶ欄です。");
    if (field.type === "tel") facts.push("電話番号を入力する欄です。");
    if (field.inputMode === "numeric" || field.type === "number") facts.push("数字を入力する欄です。");
  }
  const descriptionIds = field.getAttribute("aria-describedby")?.trim().split(/\s+/) ?? [];
  for (const id of descriptionIds) {
    const description = document.getElementById(id)?.innerText.trim();
    if (description !== undefined && description.length > 0) {
      facts.push(description);
    }
  }
  return facts.slice(0, 3);
}

function guideForField(pack: GuidePack | undefined, field: SupportedField): GuideField | undefined {
  return pack?.fields.find((guide) => {
    try {
      return field.matches(guide.publicSelector);
    } catch {
      return false;
    }
  });
}

function visibleFields(): SupportedField[] {
  return Array.from(document.querySelectorAll("input, select, textarea")).filter(isSupportedField);
}

function currentCapabilities(): PageCapabilities {
  const guidePack = state?.guidePack ?? guidePackFor(new URL(location.href));
  return {
    canInput: visibleFields().length > 0,
    canProceed: (guidePack?.routes.length ?? 0) > 0,
    canRead: true,
    hasVerifiedGuide: guidePack !== undefined
  };
}

function focusNextField(currentField: SupportedField, guide?: GuideField): void {
  if (guide?.nextPublicSelector !== undefined) {
    const specifiedNext = document.querySelector<HTMLElement>(guide.nextPublicSelector);
    if (specifiedNext !== null && isSupportedField(specifiedNext)) {
      specifiedNext.focus({ preventScroll: true });
      specifiedNext.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }
  const fields = visibleFields();
  const next = fields[fields.indexOf(currentField) + 1];
  if (next !== undefined) {
    next.focus({ preventScroll: true });
    next.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function safeNavigationLinks(): Array<{ href: string; label: string }> {
  const seen = new Set<string>();
  const links: Array<{ href: string; label: string }> = [];
  for (const link of Array.from(rootForTerms().querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const label = link.innerText.replaceAll(/\s+/g, " ").trim();
    if (label.length === 0) continue;
    let url: URL;
    try {
      url = new URL(link.href, location.href);
    } catch {
      continue;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ href: url.href, label });
    if (links.length === 3) break;
  }
  return links;
}

function appendText(parent: HTMLElement, tag: "p" | "h3", text: string, className?: string): void {
  const element = createElement(tag, className);
  element.textContent = text;
  parent.append(element);
}

function renderDock(current: AssistantState): void {
  current.dock.replaceChildren();
  current.dock.className = `font-${current.settings.fontSize}`;

  const header = createElement("header", "dock-header");
  const title = createElement("h2", "title");
  const book = createElement("span", "book");
  book.setAttribute("aria-hidden", "true");
  book.textContent = "▱";
  title.append(book, document.createTextNode("Silver Guide"));
  header.append(title);
  header.append(createButton("閉じる", "close", disableAssistant));
  current.dock.append(header);

  if (current.activeField !== undefined && document.contains(current.activeField)) {
    const label = fieldLabel(current.activeField);
    const guide = guideForField(current.guidePack, current.activeField);
    appendText(current.dock, "p", "入力のヒント", "lead");
    appendText(current.dock, "h3", `「${label}」について`, "section-title");
    const detail = createElement("section", "detail");
    appendText(detail, "p", guide?.purpose ?? "ページに表示されている説明を確認して、落ち着いて入力してください。");
    const facts = guide?.preparation ?? fieldFacts(current.activeField);
    if (facts.length > 0) {
      const list = createElement("ul");
      facts.forEach((fact) => {
        const item = createElement("li");
        item.textContent = fact;
        list.append(item);
      });
      detail.append(list);
    }
    current.dock.append(detail);
    current.dock.append(
      createButton("次の項目へ", "next", () => focusNextField(current.activeField as SupportedField, guide))
    );
  } else {
    appendText(current.dock, "p", "このページの案内", "lead");
    const detail = createElement("section", "detail");
    appendText(detail, "p", "文章の下線が付いた言葉を選ぶと、やさしい説明を読めます。");
    if (current.guidePack === undefined) {
      appendText(detail, "p", "このページに個別の行政ガイドは登録されていません。");
    }
    current.dock.append(detail);

    const routes: Array<{ href: string; label: string }> =
      current.guidePack === undefined
        ? safeNavigationLinks()
        : current.guidePack.routes.map((route) => ({ href: route.officialUrl, label: route.label }));
    if (routes.length > 0) {
      appendText(current.dock, "h3", "ページ内の案内", "section-title");
      const routeList = createElement("nav", "route-list");
      routes.forEach((route) => {
        const link = createElement("a", "route");
        link.href = route.href;
        link.textContent = route.label;
        routeList.append(link);
      });
      current.dock.append(routeList);
    }
  }

  const privacy = createElement("p", "privacy");
  const mark = createElement("span", "privacy-mark");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "▣";
  privacy.append(mark, document.createTextNode("入力内容は送信しません"));
  current.dock.append(privacy);
}

function showTooltip(anchor: HTMLElement, entry: GlossaryEntry): void {
  if (state === undefined) return;
  const tooltip = state.tooltip;
  tooltip.replaceChildren();
  tooltip.className = `font-${state.settings.fontSize}`;
  tooltip.setAttribute("data-open", "true");
  tooltip.setAttribute("aria-hidden", "false");

  const header = createElement("header", "tooltip-header");
  const title = createElement("h2", "tooltip-title");
  title.textContent = entry.plainLabel;
  header.append(title, createButton("閉じる", "close", hideTooltip));
  tooltip.append(header);

  if (state.settings.showOriginal) {
    appendText(tooltip, "p", `元の言葉: ${entry.term}`, "original");
  }
  const explanation = createElement("section", "explanation");
  appendText(explanation, "p", entry.plainExplanation);
  tooltip.append(explanation);

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - 352));
  const top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 250));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");
}

function hideTooltip(): void {
  if (state === undefined) return;
  state.tooltip.removeAttribute("data-open");
  state.tooltip.setAttribute("aria-hidden", "true");
  document.querySelectorAll<HTMLElement>(`[${GENERATED_ATTRIBUTE}="true"][aria-expanded="true"]`).forEach((term) => {
    term.setAttribute("aria-expanded", "false");
  });
}

function enableAssistant(settings: SilverGuideSettings): void {
  disableAssistant();
  const host = createElement("div");
  host.id = HOST_ID;
  const inlineStyle = document.createElement("style");
  inlineStyle.id = "silver-guide-inline-style";
  inlineStyle.textContent = INLINE_TERM_STYLE;
  document.head.append(inlineStyle);
  const shadow = host.attachShadow({ mode: "open" });
  const style = createElement("style");
  style.textContent = ASSISTANT_STYLE;
  const dock = createElement("aside");
  dock.id = "silver-guide-dock";
  dock.setAttribute("aria-label", "Silver Guide の支援パネル");
  dock.tabIndex = -1;
  const tooltip = createElement("aside");
  tooltip.id = "silver-guide-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  shadow.append(style, dock, tooltip);
  document.documentElement.append(host);

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(wrapGlossaryTerms);
  });
  const onFocusIn = (event: FocusEvent): void => {
    if (state !== undefined && isSupportedField(event.target)) {
      state.activeField = event.target;
      renderDock(state);
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") hideTooltip();
  };
  state = {
    dock,
    guidePack: guidePackFor(new URL(location.href)),
    host,
    inlineStyle,
    observer,
    settings,
    tooltip,
    onFocusIn,
    onKeyDown
  };
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("keydown", onKeyDown, true);
  observer.observe(rootForTerms(), { childList: true, subtree: true });
  wrapGlossaryTerms();
  renderDock(state);
  dock.focus();
}

function disableAssistant(): void {
  if (state === undefined) return;
  state.observer.disconnect();
  document.removeEventListener("focusin", state.onFocusIn, true);
  document.removeEventListener("keydown", state.onKeyDown, true);
  restoreGlossaryTerms();
  state.inlineStyle.remove();
  state.host.remove();
  state = undefined;
}

if (extensionApi !== undefined && !window.__silverGuideContentReady) {
  window.__silverGuideContentReady = true;
  extensionApi.runtime.onMessage.addListener((message: unknown): Promise<ContentState> | undefined => {
    if (!isContentMessage(message)) return undefined;
    switch (message.type) {
      case "silver-guide-enable":
        enableAssistant(message.settings);
        return Promise.resolve({ active: true, capabilities: currentCapabilities() });
      case "silver-guide-disable":
        disableAssistant();
        return Promise.resolve({ active: false });
      case "silver-guide-state":
        return Promise.resolve(
          state === undefined ? { active: false } : { active: true, capabilities: currentCapabilities() }
        );
      case "silver-guide-update-settings":
        if (state !== undefined) {
          state.settings = message.settings;
          renderDock(state);
        }
        return Promise.resolve({ active: state !== undefined });
    }
  });
}
