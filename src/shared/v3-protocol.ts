/** Offsets identify the exact selection within bounded, public source sentences. */
export type SelectionContext = { text: string; start: number; end: number };
/** Selected public text and nearby sentences cross this boundary; form values never do. */
export type SelectionSnapshot = {
  documentToken: string;
  generation: number;
  pageUrl: string;
  title: string;
  text: string | null;
  selectionContext?: SelectionContext;
  status: "ready" | "empty" | "too-long";
};
export type PanelContext = {
  tabId: number | null;
  windowId: number;
  documentToken: string | null;
  generation: number;
  url: string;
  title: string;
  selection: string | null;
  selectionContext?: SelectionContext;
  status: "ready" | "empty" | "restricted" | "too-long";
  notice?: string;
};
export type PanelContextReply = { ok: true; context: PanelContext } | { ok: false; message: string };
export const PANEL_CONTEXT = "silver-guide-v3-panel-context";
export const GET_SELECTION = "silver-guide-v3-get-selection";
export const SELECTION_CHANGED = "silver-guide-v3-selection-changed";
export const MAX_SELECTION_LENGTH = 5_000;
export function isSelectionContext(value: unknown, selection: string): value is SelectionContext {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SelectionContext>;
  return typeof item.text === "string" && item.text.length <= MAX_SELECTION_LENGTH
    && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end)
    && Number(item.start) >= 0 && Number(item.end) > Number(item.start) && Number(item.end) <= item.text.length
    && item.text.slice(item.start, item.end) === selection;
}
export function isSelectionSnapshot(value: unknown): value is SelectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SelectionSnapshot>;
  return typeof item.documentToken === "string" && item.documentToken.length > 0 && item.documentToken.length <= 100
    && Number.isSafeInteger(item.generation) && Number(item.generation) >= 0
    && typeof item.pageUrl === "string" && item.pageUrl.length <= 8192
    && typeof item.title === "string" && item.title.length <= 500
    && ["ready", "empty", "too-long"].includes(String(item.status))
    && (item.status === "ready" ? typeof item.text === "string" && item.text.length > 0 && item.text.length <= MAX_SELECTION_LENGTH
      && (item.selectionContext === undefined || isSelectionContext(item.selectionContext, item.text))
      : item.text === null && item.selectionContext === undefined);
}
