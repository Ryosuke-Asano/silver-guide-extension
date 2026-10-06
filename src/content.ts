import { GLOSSARY, type GlossaryEntry } from "./data/glossary";
import { guidePackFor, type GuideField, type GuidePack, type GuidePageEvidence } from "./data/guide-packs";
import type { PageCapabilities } from "./shared/capabilities";
import type { SilverGuideSettings } from "./shared/settings";
import {
  adjacentField, fieldDetails, fieldPosition, fieldsFor, hasPageError,
  isSupportedField, isUtilityField, logicalFields, publicText, visibleFields, type SupportedField
} from "./content/form-analysis";

type ContentMessage =
  | { type: "silver-guide-enable"; settings: SilverGuideSettings }
  | { type: "silver-guide-disable" }
  | { type: "silver-guide-state" }
  | { type: "silver-guide-update-settings"; settings: SilverGuideSettings };

type DemoStep = "read" | "preparation";

type ContentState = {
  active: boolean;
  capabilities?: PageCapabilities;
};

declare const chrome: typeof browser;

type AssistantState = {
  activeField?: SupportedField;
  activeTerm?: HTMLElement;
  collapsed: boolean;
  demoSteps: Set<DemoStep>;
  dock: HTMLElement;
  guidePack?: GuidePack;
  host: HTMLElement;
  inlineStyle: HTMLStyleElement;
  observer: MutationObserver;
  nativeErrors: WeakSet<SupportedField>;
  pendingLayout?: number;
  pendingRefresh?: number;
  renderKey?: string;
  renderTargets: SupportedField[];
  renderedField?: SupportedField;
  status: HTMLElement;
  terms: Set<HTMLElement>;
  settings: SilverGuideSettings;
  tooltip: HTMLElement;
  onFocusIn: (event: FocusEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onInvalid: (event: Event) => void;
  onInput: (event: Event) => void;
  onNavigation: () => void;
  onResize: () => void;
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
  "script",
  "style",
  "label",
  "legend",
  "option",
  "output",
  "datalist",
  "summary",
  "input",
  "select",
  "textarea",
  "[contenteditable]",
  "[role=application]",
  "[role=button]",
  "[role=link]",
  "[role=textbox]",
  "[role=combobox]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=searchbox]",
  "[role=spinbutton]",
  "[role=slider]",
  "[role=listbox]",
  "[role=option]",
  "[role=grid]",
  "[role=tree]",
  "[role=tablist]",
  "[role=menu]",
  "[role=alert]",
  "[role=status]",
  "[aria-live]",
  "[hidden]",
  "[inert]",
  "[aria-hidden=true]",
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
    overflow-wrap: anywhere;
  }
  .font-small { --body-size: 18px; --heading-size: 26px; }
  .font-medium { --body-size: 20px; --heading-size: 28px; }
  .font-large { --body-size: 24px; --heading-size: 30px; }
  #silver-guide-dock {
    background: #ffffff;
    border: 1px solid #cad3df;
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(15, 39, 71, .24);
    left: 18px;
    max-height: calc(100vh - 36px);
    overflow: auto;
    padding: 24px;
    position: fixed;
    right: auto;
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
    max-height: calc(100vh - 24px);
    max-width: min(360px, calc(100vw - 24px));
    overflow: auto;
    padding: 16px;
    position: fixed;
    width: 340px;
    z-index: 2147483647;
  }
  #silver-guide-tooltip[data-open] { display: block; }
  .dock-header, .tooltip-header { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; }
  .dock-actions { align-items: center; display: flex; gap: 8px; }
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
  .collapse {
    background: #ffffff;
    border: 2px solid #0f2747;
    border-radius: 8px;
    color: #0f2747;
    cursor: pointer;
    font-size: 18px;
    font-weight: 700;
    min-height: 44px;
    padding: 5px 10px;
  }
  .collapse:hover { background: #edf7f8; }
  .minimize { margin-top: 12px; width: 100%; }
  #silver-guide-dock.is-collapsed { max-height: none; padding: 12px; width: min(340px, calc(100vw - 36px)); }
  #silver-guide-dock.is-collapsed .title { font-size: 22px; }
  #silver-guide-dock.is-collapsed .dock-header { flex-wrap: wrap; }
  #silver-guide-dock.is-collapsed .dock-actions { flex: 1 0 100%; display: grid; grid-template-columns: 1fr 1fr; }
  #silver-guide-dock.is-collapsed .dock-actions button { width: 100%; }
  .collapsed-note { color: #39556f; font-size: 18px; font-weight: 700; line-height: 1.6; margin: 12px 0 0; }
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
  .end-note { color: #39556f; font-size: 18px; font-weight: 700; line-height: 1.6; margin: 0; }
  .field-actions { display: grid; gap: 10px; margin: 16px 0; }
  .position { font-size: var(--body-size); margin: 0 0 12px; }
  .error-note { border: 2px solid #a02222; border-radius: 10px; color: #a02222; font-size: var(--body-size); margin: 16px 0; padding: 12px; }
  .page-description { border: 2px solid #b5d5ec; border-radius: 10px; font-size: var(--body-size); margin: 16px 0; padding: 12px; }
  .page-description p { margin: 0; }
  .page-description p + p { margin-top: 8px; }
  .sr-only { clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
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
  .demo-actions { display: grid; gap: 10px; margin: 0 0 16px; }
  .demo-action {
    background: #ffffff;
    border: 2px solid #b5d5ec;
    border-radius: 8px;
    color: #0f2747;
    cursor: pointer;
    font-size: var(--body-size);
    font-weight: 700;
    min-height: 52px;
    padding: 10px 12px;
    text-align: left;
  }
  .demo-action:hover { background: #edf7f8; }
  .demo-action[data-complete] { background: #f3fbf0; border-color: #a8cfab; }
  .demo-note { color: #39556f; font-size: 18px; font-weight: 700; line-height: 1.6; margin: 0 0 16px; }
  .privacy { align-items: flex-start; border-top: 2px solid #cad3df; display: flex; font-size: 18px; font-weight: 700; gap: 8px; margin: 20px 0 0; padding-top: 16px; }
  .privacy-mark { color: #076c78; }
  .tooltip-title { font-size: 24px; line-height: 1.35; margin: 0; }
  .original { color: #39556f; font-size: 18px; margin: 8px 0 0; }
  .explanation { background: #f3fbf0; border: 2px solid #a8cfab; border-radius: 8px; font-size: var(--body-size); margin: 12px 0 0; padding: 12px; }
  .explanation p { margin: 0; }
  .tooltip-actions { display: grid; gap: 10px; margin-top: 12px; }
  .listen {
    background: #ffffff;
    border: 2px solid #0f2747;
    border-radius: 8px;
    color: #0f2747;
    cursor: pointer;
    font-size: var(--body-size);
    font-weight: 700;
    min-height: 52px;
    padding: 10px 12px;
  }
  .listen:hover { background: #edf7f8; }
  @media (max-width: 620px) {
    #silver-guide-dock { bottom: 0; left: 0; max-height: 48vh; right: 0; top: auto; width: 100vw; }
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
  button.setAttribute("data-silver-guide-action", label);
  button.addEventListener("click", onClick);
  return button;
}

function rootForTerms(): HTMLElement {
  return document.querySelector<HTMLElement>("main, article, [role=main]") ?? document.body;
}

function publicPageEvidence(): GuidePageEvidence {
  return {
    headings: Array.from(document.querySelectorAll<HTMLElement>("h1, h2, h3"))
      .filter(isVisibleElement)
      .map((heading) => publicText(heading))
      .filter((heading) => heading.length > 0)
  };
}

function isVisibleElement(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden], [inert], [aria-hidden=true]") !== null ||
      element.getClientRects().length === 0) return false;
  const visibility = window.getComputedStyle(element).visibility;
  return visibility !== "hidden" && visibility !== "collapse";
}

function isEligibleTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (parent === null || parent.closest(EXCLUDED_TERM_CONTAINERS) !== null ||
      parent.closest(TERM_CONTAINER_SELECTOR) === null || !isVisibleElement(parent)) {
    return false;
  }

  // Exclude private and interactive containers before accessing their text.
  return node.data.trim().length > 0;
}

function wrapGlossaryTerms(): void {
  if (state === undefined) return;
  // Removed/hidden steps and containers that become editable must not retain
  // generated controls. Unwrap by moving nodes without reading their text.
  for (const term of state.terms) {
    if (!isVisibleElement(term) || term.parentElement?.closest(EXCLUDED_TERM_CONTAINERS) !== null) {
      term.replaceWith(...term.childNodes);
      state.terms.delete(term);
    }
  }
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
        state.terms.add(term);
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
  state?.terms.forEach((term) => {
    const parent = term.parentNode;
    term.replaceWith(...term.childNodes);
    if (parent !== null) {
      parents.add(parent);
    }
  });
  parents.forEach((parent) => parent.normalize());
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

function currentCapabilities(): PageCapabilities {
  const guidePack = guidePackFor(new URL(location.href), publicPageEvidence());
  return {
    canInput: visibleFields().length > 0,
    canProceed: (guidePack?.routes.length ?? 0) > 0,
    canRead: firstGlossaryTerm() !== undefined,
    hasVerifiedGuide: guidePack !== undefined
  };
}

function nextFieldFor(currentField: SupportedField, guide?: GuideField, scopeFields = fieldsFor(currentField)): SupportedField | undefined {
  if (!isSupportedField(currentField)) return undefined;
  if (guide?.nextPublicSelector !== undefined) {
    try {
      const specifiedNext = document.querySelector<HTMLElement>(guide.nextPublicSelector);
      if (specifiedNext !== null && isSupportedField(specifiedNext) && scopeFields.includes(specifiedNext) && specifiedNext !== currentField) {
        return specifiedNext;
      }
    } catch {
      // ページ改版などでセレクターが無効でも、一般フォームの次項目へ安全にフォールバックする。
    }
  }
  const index = fieldPosition(currentField, scopeFields);
  return index < 0 ? undefined : scopeFields[index + 1];
}

function focusField(field: SupportedField | undefined): void {
  if (state === undefined) return;
  if (field === undefined || !isSupportedField(field)) {
    refreshAssistant(state);
    return;
  }
  field.focus({ preventScroll: true });
  field.scrollIntoView({ behavior: "instant", block: window.innerWidth <= 620 ? "start" : "center" });
  if (window.innerWidth <= 620) {
    const top = field.getBoundingClientRect().top;
    if (top < 48) window.scrollBy({ top: top - 48, behavior: "instant" });
  }
  state.dock.scrollTop = 0;
  positionDockForControl(state, field);
}

/** Place around the focused page control without using it as a hint target. */
function dockPlacementTarget(current: AssistantState): HTMLElement | undefined {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && isPageValueControl(focused) ? focused : current.activeField;
}

/** Geometry alone keeps private and unsupported controls operable too. */
function positionDockForControl(current: AssistantState, field?: HTMLElement): void {
  for (const property of ["left", "right", "top", "bottom", "max-height"]) current.dock.style.removeProperty(property);
  if (field === undefined || window.innerWidth <= 620 || !field.isConnected || field.getClientRects().length === 0) return;
  const rect = field.getBoundingClientRect();
  const width = current.dock.getBoundingClientRect().width;
  const gap = 30;
  if (rect.left >= width + gap) return;
  if (window.innerWidth - rect.right >= width + gap) {
    current.dock.style.left = "auto";
    current.dock.style.right = "18px";
    return;
  }
  const above = Math.min(rect.top - gap, window.innerHeight - 36);
  const below = Math.min(window.innerHeight - rect.bottom - gap, window.innerHeight - 36);
  if (Math.max(above, below) < 180) return;
  current.dock.style.maxHeight = `${Math.floor(Math.max(above, below))}px`;
  if (below > above) {
    current.dock.style.top = "auto";
    current.dock.style.bottom = "18px";
  }
}

function scheduleDockLayout(current: AssistantState): void {
  if (current.pendingLayout !== undefined) return;
  current.pendingLayout = window.requestAnimationFrame(() => {
    current.pendingLayout = undefined;
    if (state !== current) return;
    const field = dockPlacementTarget(current);
    positionDockForControl(current, field);
    if (field === undefined || document.activeElement !== field || window.innerWidth > 620) return;
    const rect = field.getBoundingClientRect();
    const dockRect = current.dock.getBoundingClientRect();
    const overlaps = (control: DOMRect, panel: DOMRect): boolean =>
      control.left < panel.right && control.right > panel.left && control.top < panel.bottom && control.bottom > panel.top;
    // Native Tab/click focus can scroll after focusin. Wait for that layout,
    // then move only an occluded control; visible controls keep their position.
    if (!overlaps(rect, dockRect)) return;
    if (Math.abs(rect.top - 48) >= 1) {
      window.scrollBy({ top: rect.top - 48, behavior: "instant" });
    }
    const movedRect = field.getBoundingClientRect();
    if (!overlaps(movedRect, current.dock.getBoundingClientRect())) return;
    // Short forms cannot scroll. Use free space above/below the control, while
    // keeping the mobile panel at most 48vh and a useful minimum height.
    const above = movedRect.top - 30;
    const below = window.innerHeight - movedRect.bottom - 30;
    const space = Math.max(above, below);
    if (space < 180) return;
    current.dock.style.maxHeight = `${Math.floor(Math.min(space, window.innerHeight * 0.48))}px`;
    if (above > below) {
      current.dock.style.top = "0px";
      current.dock.style.bottom = "auto";
    }
  });
}

function firstInputField(): SupportedField | undefined {
  const fields = logicalFields(visibleFields().filter((field) => !isUtilityField(field)));
  return fields.find((field) => rootForTerms().contains(field)) ?? fields[0];
}

function errorFields(current: AssistantState, fields = visibleFields()): SupportedField[] {
  return logicalFields(fields.filter((field) => hasPageError(field) || current.nativeErrors.has(field)));
}

function showFieldOverview(): void {
  if (state === undefined) return;
  state.activeField = undefined;
  renderDock(state);
  state.dock.focus({ preventScroll: true });
}

function firstGlossaryTerm(): HTMLElement | undefined {
  return state === undefined ? undefined : Array.from(document.querySelectorAll<HTMLElement>(`[${GENERATED_ATTRIBUTE}="true"]`))
    .find((term) => state?.terms.has(term) && isVisibleElement(term));
}

function openFirstGlossaryExplanation(): void {
  const term = firstGlossaryTerm();
  if (term === undefined) {
    return;
  }
  const entryId = term.getAttribute(TERM_ATTRIBUTE);
  const entry = entryId === null ? undefined : GLOSSARY_BY_ID.get(entryId);
  if (entry === undefined) {
    return;
  }
  markDemoStep("read");
  term.focus({ preventScroll: true });
  term.scrollIntoView({ behavior: "auto", block: "center" });
  showTooltip(term, entry);
}

function markDemoStep(step: DemoStep): void {
  if (state === undefined || state.demoSteps.has(step)) {
    return;
  }
  state.demoSteps.add(step);
  renderDock(state);
}

function showPreparation(): void {
  if (state === undefined) {
    return;
  }
  hideTooltip(false);
  markDemoStep("preparation");
  const preparation = state.dock.querySelector<HTMLElement>("#silver-guide-preparation");
  if (preparation === null) {
    return;
  }
  preparation.focus({ preventScroll: true });
  preparation.scrollIntoView({ behavior: "auto", block: "nearest" });
}

function setDockCollapsed(collapsed: boolean): void {
  if (state === undefined) {
    return;
  }
  if (collapsed) {
    hideTooltip(false);
  }
  state.collapsed = collapsed;
  renderDock(state);
  state.dock.focus({ preventScroll: true });
}

function supportsReadAloud(): boolean {
  return typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

function stopReading(): void {
  if (supportsReadAloud()) {
    window.speechSynthesis.cancel();
  }
}

function appendText(parent: HTMLElement, tag: "p" | "h3", text: string, className?: string): void {
  const element = createElement(tag, className);
  element.textContent = text;
  parent.append(element);
}

function renderDock(current: AssistantState): void {
  if (current.activeField !== undefined && !isSupportedField(current.activeField)) current.activeField = undefined;
  const activeField = current.activeField;
  const visible = visibleFields();
  const help = activeField === undefined ? undefined : fieldDetails(activeField, visible);
  const fields = logicalFields(visible.filter((field) => !isUtilityField(field)));
  const errors = errorFields(current, visible);
  const scopeFields = activeField === undefined ? [] : fieldsFor(activeField, visible);
  const position = activeField === undefined ? -1 : fieldPosition(activeField, scopeFields);
  const utilityField = activeField !== undefined && isUtilityField(activeField);
  const guide = activeField === undefined || utilityField ? undefined : guideForField(current.guidePack, activeField);
  const step = document.querySelector<HTMLElement>('[aria-current="step"]');
  const stepText = step !== null && step.getClientRects().length > 0 ? publicText(step, 160) : "";
  const hasError = activeField !== undefined && (hasPageError(activeField) || current.nativeErrors.has(activeField));
  const renderKey = JSON.stringify({
    help, count: fields.length, position, utilityField,
    scopeCount: scopeFields.length, errors: errors.length, hasError, stepText,
    guide: current.guidePack?.id, term: firstGlossaryTerm() !== undefined,
    collapsed: current.collapsed, settings: current.settings, demo: [...current.demoSteps]
  });
  const targets = [...fields, ...(activeField === undefined ? [] : [activeField]), ...errors];
  if (renderKey === current.renderKey && targets.length === current.renderTargets.length &&
      targets.every((field, index) => field === current.renderTargets[index])) return;
  current.renderKey = renderKey;
  current.renderTargets = targets;
  const fieldChanged = current.renderedField !== activeField;
  current.renderedField = activeField;

  const focused = current.host.shadowRoot?.activeElement;
  const focusedInDock = focused instanceof HTMLElement && current.dock.contains(focused);
  const focusedAction = focusedInDock ? focused.getAttribute("data-silver-guide-action") : null;
  const focusedId = focusedInDock ? focused.id : "";
  const restoreDockFocus = (): void => {
    if (!focusedInDock) return;
    const replacement = Array.from(current.dock.querySelectorAll<HTMLElement>("[data-silver-guide-action]"))
      .find((element) => element.getAttribute("data-silver-guide-action") === focusedAction);
    const byId = focusedId ? current.dock.querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`) : null;
    (replacement ?? byId ?? current.dock).focus({ preventScroll: true });
  };
  current.dock.replaceChildren();
  current.dock.className = `font-${current.settings.fontSize}`;
  current.dock.classList.toggle("is-collapsed", current.collapsed);

  const header = createElement("header", "dock-header");
  const title = createElement("h2", "title");
  const book = createElement("span", "book");
  book.setAttribute("aria-hidden", "true");
  book.textContent = "▱";
  title.append(book, document.createTextNode("Silver Guide"));
  header.append(title);
  const headerActions = createElement("div", "dock-actions");
  if (current.collapsed) {
    const openButton = createButton("開く", "collapse", () => setDockCollapsed(false));
    openButton.setAttribute("aria-expanded", "false");
    headerActions.append(openButton);
  }
  headerActions.append(createButton("閉じる", "close", disableAssistant));
  header.append(headerActions);
  current.dock.append(header);

  if (current.collapsed) {
    appendText(current.dock, "p", "必要なときに「開く」を選ぶと、案内をもう一度表示します。", "collapsed-note");
    current.dock.scrollTop = 0;
    positionDockForControl(current, dockPlacementTarget(current));
    restoreDockFocus();
    return;
  }

  const collapseButton = createButton("表示を小さくする", "collapse minimize", () => setDockCollapsed(true));
  collapseButton.setAttribute("aria-expanded", "true");
  current.dock.append(collapseButton);

  if (stepText) appendText(current.dock, "p", `ページが示す現在の手順：${stepText}`, "position");
  if (errors.length > 0) {
    appendText(current.dock, "p", `確認が必要な項目：${errors.length} 件。ページで入力エラーが示されています。`, "error-note");
    current.dock.append(createButton("最初のエラー項目へ", "demo-action", () => {
      if (state !== undefined) focusField(errorFields(state)[0]);
    }));
  }

  if (activeField !== undefined && help !== undefined) {
    appendText(current.dock, "p", "入力のヒント", "lead");
    if (utilityField) appendText(current.dock, "p", "ページ共通の入力欄（検索など）", "position");
    appendText(current.dock, "p", `現在の項目：${position + 1} / ${scopeFields.length}`, "position");
    if (help.groupLabel !== undefined && help.groupLabel !== help.label) {
      appendText(current.dock, "p", `項目のまとまり：${help.groupLabel}`, "position");
    }
    appendText(current.dock, "h3", `「${help.visibleLabel ?? help.label}」について`, "section-title");
    if (hasError) {
      appendText(current.dock, "p", "ページから入力エラーが通知されています。欄の近くのエラー説明を確認して、ご自身で修正してください。", "error-note");
    }
    const detail = createElement("section", "detail");
    appendText(detail, "p", guide?.purpose ?? "ページに表示されている説明を確認して、落ち着いて入力してください。");
    const facts = [...help.facts, ...(guide?.preparation ?? [])];
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
    if (help.descriptions.length > 0 || help.visibleLabel !== undefined) {
      appendText(current.dock, "h3", "ページの説明・入力例", "section-title");
      const description = createElement("section", "page-description");
      if (help.visibleLabel !== undefined) {
        appendText(description, "p", `ページが設定した読み上げ名：${help.label}`);
      }
      help.descriptions.forEach((text) => appendText(description, "p", text));
      current.dock.append(description);
    }
    const actions = createElement("div", "field-actions");
    if (position > 0) {
      actions.append(createButton("前の項目へ", "demo-action", () => focusField(adjacentField(activeField, -1))));
    }
    const nextField = nextFieldFor(activeField, guide, scopeFields);
    if (nextField !== undefined) {
      actions.append(
        createButton("次の項目へ", "next", () => focusField(nextFieldFor(activeField,
          isUtilityField(activeField) ? undefined : guideForField(state?.guidePack, activeField))))
      );
    } else {
      appendText(actions, "p", utilityField
        ? "このフォームの入力欄はここまでです。検索などの操作は、ページのボタンをご自身で確認してください。"
        : "この画面の入力項目はここまでです。次の画面への移動や送信は、ページのボタンをご自身で確認してください。", "end-note");
    }
    actions.append(createButton("項目の案内に戻る", "demo-action", showFieldOverview));
    current.dock.append(actions);
  } else {
    appendText(current.dock, "p", "このページの案内", "lead");
    const detail = createElement("section", "detail");
    const firstTerm = firstGlossaryTerm();
    const routes = current.guidePack?.routes ?? [];
    if (current.guidePack !== undefined) {
      appendText(detail, "p", current.guidePack.summary);
    } else if (firstTerm === undefined) {
      appendText(detail, "p", "このページでは、登録された言葉は見つかりませんでした。");
    } else {
      appendText(detail, "p", "下線の言葉を選ぶと、やさしい説明を読めます。");
    }
    if (firstTerm !== undefined && current.guidePack !== undefined) {
      appendText(detail, "p", "下線の言葉を選ぶと、やさしい説明を読めます。");
    }
    current.dock.append(detail);

    if (fields.length > 0) {
      appendText(current.dock, "h3", "入力項目の案内", "section-title");
      appendText(current.dock, "p", `この画面の入力項目：${fields.length} 項目。入力済みかどうかは判定しません。`, "position");
      appendText(current.dock, "p", "表示中の入力欄だけを案内します。画面を進めたら、この案内も更新します。", "position");
      current.dock.append(createButton("最初の入力項目へ", "next", () => focusField(firstInputField())));
    } else {
      appendText(current.dock, "p", visible.length > 0
        ? "この画面には本文の入力欄がありません。検索などページ共通の入力欄は、欄を選ぶと案内します。"
        : "この画面には支援できる入力欄がありません。", "end-note");
    }

    if (current.guidePack !== undefined) {
      appendText(current.dock, "h3", "このページで試す", "section-title");
      const demoActions = createElement("section", "demo-actions");
      if (firstTerm !== undefined) {
        const readAction = createButton(
          current.demoSteps.has("read") ? "✓ 言葉の説明を確認しました" : "1. 言葉の説明を試す",
          "demo-action",
          openFirstGlossaryExplanation
        );
        if (current.demoSteps.has("read")) {
          readAction.setAttribute("data-complete", "true");
        }
        demoActions.append(readAction);
      }
      if ((current.guidePack.preparation?.length ?? 0) > 0) {
        const preparationAction = createButton(
          current.demoSteps.has("preparation") ? "✓ 申請前の確認を読みました" : "2. 申請前の確認を読む",
          "demo-action",
          showPreparation
        );
        if (current.demoSteps.has("preparation")) {
          preparationAction.setAttribute("data-complete", "true");
        }
        demoActions.append(preparationAction);
      }
      if (demoActions.childElementCount > 0) {
        current.dock.append(demoActions);
      }
    }

    if (routes.length > 0) {
      appendText(current.dock, "h3", "公式の案内", "section-title");
      const routeList = createElement("nav", "route-list");
      routes.forEach((route) => {
        const link = createElement("a", "route");
        link.href = route.officialUrl;
        link.textContent = route.label;
        link.setAttribute("data-silver-guide-action", route.officialUrl);
        routeList.append(link);
      });
      current.dock.append(routeList);
      if (current.guidePack !== undefined) {
        appendText(current.dock, "p", "最後に、上の公式リンクを選ぶと横浜市の案内を開けます。", "demo-note");
      }
    }

    if ((current.guidePack?.preparation?.length ?? 0) > 0) {
      appendText(current.dock, "h3", "申請前の確認", "section-title");
      const checklist = createElement("section", "detail");
      checklist.id = "silver-guide-preparation";
      checklist.tabIndex = -1;
      const list = createElement("ul");
      current.guidePack?.preparation?.forEach((item) => {
        const listItem = createElement("li");
        listItem.textContent = item;
        list.append(listItem);
      });
      checklist.append(list);
      current.dock.append(checklist);
    }
    if (firstTerm !== undefined) {
      current.dock.append(createButton("最初の説明を読む", "next", openFirstGlossaryExplanation));
    }
  }

  const privacy = createElement("p", "privacy");
  const mark = createElement("span", "privacy-mark");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "▣";
  privacy.append(mark, document.createTextNode("入力内容は送信しません"));
  current.dock.append(privacy);
  if (fieldChanged) current.dock.scrollTop = 0;
  positionDockForControl(current, dockPlacementTarget(current));
  restoreDockFocus();
}

function showTooltip(anchor: HTMLElement, entry: GlossaryEntry): void {
  if (state === undefined) return;
  hideTooltip(false);
  const tooltip = state.tooltip;
  tooltip.replaceChildren();
  tooltip.className = `font-${state.settings.fontSize}`;
  tooltip.setAttribute("aria-label", `${entry.term} の説明`);
  tooltip.setAttribute("data-open", "true");
  tooltip.setAttribute("aria-hidden", "false");

  const header = createElement("header", "tooltip-header");
  const title = createElement("h2", "tooltip-title");
  title.textContent = entry.plainLabel;
  header.append(title, createButton("閉じる", "close", () => hideTooltip(true)));
  tooltip.append(header);

  if (state.settings.showOriginal) {
    appendText(tooltip, "p", `元の言葉: ${entry.term}`, "original");
  }
  const explanation = createElement("section", "explanation");
  appendText(explanation, "p", entry.plainExplanation);
  tooltip.append(explanation);

  if (supportsReadAloud()) {
    const actions = createElement("section", "tooltip-actions");
    const listenButton = createButton("声で聞く", "listen", () => {
      if (listenButton.getAttribute("data-reading") === "true") {
        stopReading();
        listenButton.removeAttribute("data-reading");
        listenButton.textContent = "声で聞く";
        return;
      }
      stopReading();
      const speech = new SpeechSynthesisUtterance(`${entry.plainLabel}。${entry.plainExplanation}`);
      speech.lang = "ja-JP";
      speech.rate = 0.85;
      speech.onend = () => {
        listenButton.removeAttribute("data-reading");
        listenButton.textContent = "声で聞く";
      };
      speech.onerror = () => {
        listenButton.removeAttribute("data-reading");
        listenButton.textContent = "声で聞く";
      };
      window.speechSynthesis.speak(speech);
      listenButton.setAttribute("data-reading", "true");
      listenButton.textContent = "読み上げを止める";
    });
    actions.append(listenButton);
    tooltip.append(actions);
  }

  positionTooltip(state, anchor);
  anchor.setAttribute("aria-expanded", "true");
  state.activeTerm = anchor;
  tooltip.focus();
}

function positionTooltip(current: AssistantState, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const dockRect = current.dock.getBoundingClientRect();
  const tooltipRect = current.tooltip.getBoundingClientRect();
  const maxLeft = Math.max(12, window.innerWidth - tooltipRect.width - 12);
  let left = Math.max(12, Math.min(rect.left, maxLeft));
  let top = Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - tooltipRect.height - 12));
  const overlapsDock =
    left < dockRect.right && left + tooltipRect.width > dockRect.left && top < dockRect.bottom && top + tooltipRect.height > dockRect.top;
  if (overlapsDock && dockRect.right + tooltipRect.width + 12 <= window.innerWidth) {
    left = dockRect.right + 12;
  } else if (overlapsDock && dockRect.top >= tooltipRect.height + 24) {
    top = dockRect.top - tooltipRect.height - 12;
  }
  current.tooltip.style.left = `${left}px`;
  current.tooltip.style.top = `${top}px`;
}

/** Keep the open explanation's controls, focus and reading state intact. */
function updateTooltipSettings(current: AssistantState): void {
  const anchor = current.activeTerm;
  if (anchor === undefined) return;
  const entryId = anchor.getAttribute(TERM_ATTRIBUTE);
  const entry = entryId === null ? undefined : GLOSSARY_BY_ID.get(entryId);
  if (entry === undefined) return;
  current.tooltip.className = `font-${current.settings.fontSize}`;
  const original = current.tooltip.querySelector<HTMLElement>(".original");
  if (!current.settings.showOriginal) {
    original?.remove();
  } else if (original === null) {
    const paragraph = createElement("p", "original");
    paragraph.textContent = `元の言葉: ${entry.term}`;
    current.tooltip.insertBefore(paragraph, current.tooltip.querySelector(".explanation"));
  }
  positionTooltip(current, anchor);
}

function hideTooltip(returnFocus = false): void {
  if (state === undefined) return;
  stopReading();
  const activeTerm = state.activeTerm;
  state.tooltip.removeAttribute("data-open");
  state.tooltip.setAttribute("aria-hidden", "true");
  state.terms.forEach((term) => {
    if (term.getAttribute("aria-expanded") === "true") term.setAttribute("aria-expanded", "false");
  });
  state.activeTerm = undefined;
  if (returnFocus && activeTerm !== undefined && document.contains(activeTerm)) {
    activeTerm.focus({ preventScroll: true });
  }
}

const PAGE_OBSERVATION: MutationObserverInit = {
  childList: true,
  characterData: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    "aria-labelledby", "aria-label", "aria-describedby", "aria-errormessage", "aria-required", "aria-invalid", "aria-current", "aria-disabled", "aria-readonly",
    "required", "disabled", "readonly", "hidden", "inert", "aria-hidden", "style", "class", "type", "name", "id", "for", "form", "alt",
    "inputmode", "min", "max", "minlength", "maxlength", "pattern", "placeholder", "multiple", "open", "tabindex",
    "role", "contenteditable", "aria-live"
  ]
};

function refreshAssistant(current: AssistantState): void {
  const guidePack = guidePackFor(new URL(location.href), publicPageEvidence());
  if (guidePack !== current.guidePack) current.demoSteps.clear();
  current.guidePack = guidePack;
  if (current.activeField !== undefined && !isSupportedField(current.activeField)) {
    current.activeField = undefined;
    current.status.textContent = "表示中の入力項目が変わりました。「最初の入力項目へ」から確認できます。";
  }
  if (current.activeTerm !== undefined && !isVisibleElement(current.activeTerm)) hideTooltip(false);
  renderDock(current);
}

function scheduleRefresh(current: AssistantState): void {
  if (current.pendingRefresh !== undefined) return;
  current.pendingRefresh = window.requestAnimationFrame(() => {
    current.pendingRefresh = undefined;
    if (state !== current) return;
    // Do not observe our own glossary replacements or queue repeated full scans.
    current.observer.disconnect();
    wrapGlossaryTerms();
    current.observer.observe(document.documentElement, PAGE_OBSERVATION);
    refreshAssistant(current);
  });
}

/** Recognize value-control containers without inspecting their private text. */
function isPageValueControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest([
    "input", "textarea", "select", "[contenteditable]", "[role=textbox]", "[role=searchbox]",
    "[role=combobox]", "[role=spinbutton]", "[role=slider]", "[role=listbox]", "[role=option]",
    "[role=checkbox]", "[role=radio]", "[role=switch]", "[role=grid]", "[role=tree]"
  ].join(",")) !== null;
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
  dock.lang = "ja";
  dock.setAttribute("aria-label", "Silver Guide の支援パネル");
  dock.tabIndex = -1;
  const tooltip = createElement("aside");
  tooltip.id = "silver-guide-tooltip";
  tooltip.setAttribute("role", "dialog");
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.tabIndex = -1;
  tooltip.lang = "ja";
  const status = createElement("p", "sr-only");
  status.id = "silver-guide-status";
  status.lang = "ja";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  shadow.append(style, dock, tooltip, status);
  document.documentElement.append(host);

  const observer = new MutationObserver(() => {
    if (state !== undefined) scheduleRefresh(state);
  });
  const onFocusIn = (event: FocusEvent): void => {
    if (state === undefined || event.target === host) return;
    if (state.activeTerm !== undefined && event.target !== state.activeTerm) hideTooltip(false);
    if (isSupportedField(event.target)) {
      state.activeField = event.target;
      const help = fieldDetails(event.target);
      status.textContent = `${isUtilityField(event.target) ? "ページ共通の入力欄（検索など）。" : ""}入力のヒント：${help.visibleLabel ?? help.label}。${hasPageError(event.target) || state.nativeErrors.has(event.target) ? "ページで入力エラーが示されています。" : ""}`;
    } else if (isPageValueControl(event.target)) {
      state.activeField = undefined;
      status.textContent = "この欄は入力支援の対象外です。ページの説明をご自身で確認してください。";
    }
    refreshAssistant(state);
    if (isPageValueControl(event.target)) scheduleDockLayout(state);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") hideTooltip(true);
  };
  const onInvalid = (event: Event): void => {
    if (state === undefined || !isSupportedField(event.target)) return;
    state.nativeErrors.add(event.target);
    status.textContent = "ページから入力エラーが通知されました。「最初のエラー項目へ」から確認できます。";
    scheduleRefresh(state);
  };
  const onInput = (event: Event): void => {
    if (state !== undefined &&
        (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) &&
        state.nativeErrors.delete(event.target)) {
      scheduleRefresh(state);
    }
  };
  const onNavigation = (): void => {
    if (state !== undefined) scheduleRefresh(state);
  };
  const onResize = (): void => {
    if (state !== undefined) scheduleDockLayout(state);
  };
  state = {
    collapsed: false,
    demoSteps: new Set<DemoStep>(),
    dock,
    guidePack: guidePackFor(new URL(location.href), publicPageEvidence()),
    host,
    inlineStyle,
    observer,
    nativeErrors: new WeakSet<SupportedField>(),
    renderTargets: [],
    status,
    terms: new Set<HTMLElement>(),
    settings,
    tooltip,
    onFocusIn,
    onKeyDown,
    onInvalid,
    onInput,
    onNavigation,
    onResize
  };
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("invalid", onInvalid, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  window.addEventListener("popstate", onNavigation);
  window.addEventListener("hashchange", onNavigation);
  window.addEventListener("resize", onResize);
  wrapGlossaryTerms();
  renderDock(state);
  observer.observe(document.documentElement, PAGE_OBSERVATION);
  dock.focus();
}

function disableAssistant(): void {
  if (state === undefined) return;
  hideTooltip(false);
  state.observer.disconnect();
  if (state.pendingRefresh !== undefined) window.cancelAnimationFrame(state.pendingRefresh);
  if (state.pendingLayout !== undefined) window.cancelAnimationFrame(state.pendingLayout);
  document.removeEventListener("focusin", state.onFocusIn, true);
  document.removeEventListener("keydown", state.onKeyDown, true);
  document.removeEventListener("invalid", state.onInvalid, true);
  document.removeEventListener("input", state.onInput, true);
  document.removeEventListener("change", state.onInput, true);
  window.removeEventListener("popstate", state.onNavigation);
  window.removeEventListener("hashchange", state.onNavigation);
  window.removeEventListener("resize", state.onResize);
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
        if (state !== undefined) refreshAssistant(state);
        return Promise.resolve(
          state === undefined ? { active: false } : { active: true, capabilities: currentCapabilities() }
        );
      case "silver-guide-update-settings":
        if (state !== undefined) {
          state.settings = message.settings;
          renderDock(state);
          updateTooltipSettings(state);
        }
        return Promise.resolve({ active: state !== undefined });
    }
  });
}
