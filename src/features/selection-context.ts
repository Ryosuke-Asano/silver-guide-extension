import { MAX_SELECTION_LENGTH, type SelectionContext } from "../shared/v3-protocol";
import { sourceSentences } from "./reading/explanation";

const BLOCKS = "p,li,dt,dd,blockquote,figcaption,caption,td,th,label,legend,h1,h2,h3,h4,h5,h6,[role=paragraph]";
const EXCLUDED = "input,textarea,select,option,datalist,button,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],script,style,noscript,template,iframe,object,embed,svg,math,[hidden],[inert],[aria-hidden=true],[data-silver-guide-form-tooltip],[data-silver-guide-term-popup]";
const blockDisplay = (element: Element): boolean => /^(?:block|list-item|table-cell|flex|grid)$/u.test(element.ownerDocument.defaultView?.getComputedStyle(element).display ?? "");
const elementOf = (node: Node): Element | null => node.nodeType === 1 ? node as Element : node.parentElement;

function excluded(element: Element): boolean {
  if (element.matches(EXCLUDED)) return true;
  const css = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (css?.display === "none" || css?.visibility === "hidden" || css?.visibility === "collapse" || css?.contentVisibility === "hidden" || css?.opacity === "0") return true;
  if (element.tagName === "DETAILS" && !element.hasAttribute("open")) return true;
  return false;
}

function paragraphAt(node: Node): Element | null {
  let paragraph: Element | null = null;
  for (let current = elementOf(node); current; current = current.parentElement) {
    if (excluded(current)) return null;
    if (!paragraph && !current.matches("html,body,form") && (current.matches(BLOCKS) || blockDisplay(current))) paragraph = current;
  }
  return paragraph;
}

/** Read one public side of a range, stopping at controls and paragraph boundaries. */
function nearby(root: Element, range: Range, side: "before" | "after", limit: number): string | null {
  let text = "", stopped = false, visited = 0, truncated = false;
  const append = (value: string) => {
    if (side === "before") {
      truncated ||= text.length + value.length > limit;
      text = (text + value).slice(-limit);
    } else {
      truncated ||= text.length + value.length > limit;
      text += value.slice(0, limit - text.length);
      if (truncated) stopped = true;
    }
  };
  const visit = (node: Node): void => {
    if (stopped) return;
    if (++visited > 2000) { truncated = true; stopped = true; return; }
    if (node.nodeType === 3) {
      const leaf = node as Text;
      if (side === "before") {
        if (node === range.startContainer) { append(leaf.data.slice(0, range.startOffset)); stopped = true; }
        else if (range.comparePoint(node, 0) < 0) append(leaf.data);
        else stopped = true;
      } else {
        if (node === range.endContainer) append(leaf.data.slice(range.endOffset));
        else if (range.comparePoint(node, leaf.length) > 0) append(leaf.data);
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (excluded(element) || element !== root && (element.matches(BLOCKS) || blockDisplay(element))) {
      const position = range.comparePoint(node, 0);
      if (side === "before" && position < 0) { text = ""; truncated = false; }
      if (side === "after" && position > 0) stopped = true;
      return;
    }
    if (element.tagName === "BR") {
      const position = range.comparePoint(node, 0);
      if (side === "before" && position < 0 || side === "after" && position > 0) append("\n");
      return;
    }
    for (const child of element.childNodes) { visit(child); if (stopped) break; }
  };
  visit(root);
  return truncated ? null : text;
}

/** Complete the selected sentences and retain one adjacent sentence on each side. */
export function selectionContext(range: Range, rawSelection: string): SelectionContext | undefined {
  const selected = rawSelection.trim(), limit = MAX_SELECTION_LENGTH - selected.length;
  if (!selected || limit <= 0) return;
  const first = paragraphAt(range.startContainer), last = paragraphAt(range.endContainer);
  if (!first || !last) return;
  const before = nearby(first, range, "before", limit), after = nearby(last, range, "after", limit);
  if (before === null || after === null) return;
  const leading = rawSelection.length - rawSelection.trimStart().length;
  const text = before + rawSelection + after, start = before.length + leading, end = start + selected.length;
  const sentences = sourceSentences(text);
  const touched = sentences.map((span, index) => ({ span, index })).filter(({ span }) => span.end > start && span.start < end);
  if (!touched.length) return;
  const requiredFirst = touched[0].index, requiredLast = touched.at(-1)!.index;
  let from = Math.max(0, requiredFirst - 1), to = Math.min(sentences.length - 1, requiredLast + 1);
  while (sentences[to].end - sentences[from].start > MAX_SELECTION_LENGTH) {
    if (to > requiredLast) to--;
    else if (from < requiredFirst) from++;
    else return;
  }
  const offset = sentences[from].start, context = text.slice(offset, sentences[to].end);
  if (context === selected || start < offset || end > sentences[to].end) return;
  return { text: context, start: start - offset, end: end - offset };
}
