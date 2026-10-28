import { MAX_SELECTION_LENGTH, type SelectionContext } from "../shared/v3-protocol";
import { selectionContext } from "./selection-context";
const EDITABLE = "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox],[data-silver-guide-term-popup]";
const element = (node: Node | null): Element | null => node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
/** Reject editors and our own explanation before reading selected text. */
export function selectedPublicText(doc: Document): { text: string | null; status: "ready" | "empty" | "too-long"; selectionContext?: SelectionContext } {
  const empty = { text: null, status: "empty" as const };
  const selection = doc.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || doc.designMode === "on") return empty;
  if (element(selection.anchorNode)?.closest(EDITABLE) || element(selection.focusNode)?.closest(EDITABLE)
    || doc.activeElement?.closest(EDITABLE)) return empty;
  for (let index = 0; index < selection.rangeCount; index++) {
    const ancestor = element(selection.getRangeAt(index).commonAncestorContainer);
    if (!ancestor) return empty;
    for (const editor of ancestor.querySelectorAll(EDITABLE)) if (selection.getRangeAt(index).intersectsNode(editor)) return empty;
  }
  const raw = selection.toString(), text = raw.trim();
  if (!text) return empty;
  if (text.length > MAX_SELECTION_LENGTH) return { text: null, status: "too-long" };
  const surrounding = selection.rangeCount === 1 ? selectionContext(selection.getRangeAt(0), raw) : undefined;
  return { text, status: "ready", ...(surrounding ? { selectionContext: surrounding } : {}) };
}
