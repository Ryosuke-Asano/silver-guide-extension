/**
 * Native form structure only. Never inspect value, checked, files, selectedIndex,
 * validity or validationMessage, and never invoke validation or submission.
 */
export type SupportedField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export type FieldDetails = {
  label: string;
  groupLabel?: string;
  required: boolean;
  facts: string[];
  descriptions: string[];
};

const EXCLUDED_TEXT = [
  "input", "select", "textarea", "option", "datalist", "output", "button",
  "script", "style", "[contenteditable]", "[role=textbox]", "[role=searchbox]",
  "[role=combobox]", "[role=spinbutton]", "[role=slider]", "[role=listbox]", "[role=option]",
  "[role=alert]", "[role=status]", "[aria-live]", "#silver-guide-host"
].join(",");
const EXCLUDED_INPUT_TYPES = new Set(["hidden", "password", "submit", "reset", "button", "image"]);

/** Read explanatory text without descending into controls or editable content. */
export function publicText(element: Element | null, limit = 600): string {
  if (element === null || element.closest(EXCLUDED_TEXT) !== null) return "";
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest(EXCLUDED_TEXT) === null
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT
  });
  let text = "";
  let node = walker.nextNode();
  while (node !== null && text.length <= limit) {
    text += (node as Text).data.replace(/\s+/g, " ");
    node = walker.nextNode();
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

export function isSupportedField(element: EventTarget | null): element is SupportedField {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    return false;
  }
  if (!element.isConnected || element.matches(":disabled") || element.tabIndex < 0) return false;
  if (element instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(element.type)) return false;
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.readOnly) return false;
  if (element.closest("[hidden], [inert], [aria-hidden=true], [aria-disabled=true], [aria-readonly=true], details:not([open]), dialog:not([open]), #silver-guide-host") !== null) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  if (view === null || element.getClientRects().length === 0) return false;
  const style = view.getComputedStyle(element);
  return style.visibility !== "hidden" && style.visibility !== "collapse" && style.display !== "none";
}

export function visibleFields(root: Document = document): SupportedField[] {
  return Array.from(root.querySelectorAll("input, select, textarea")).filter(isSupportedField);
}

function formScope(field: SupportedField): HTMLFormElement | Element | Document {
  return field.form ?? field.closest("[role=form]") ?? field.ownerDocument;
}

function sameRadioGroup(a: SupportedField, b: SupportedField): boolean {
  return a instanceof HTMLInputElement && b instanceof HTMLInputElement &&
    a.type === "radio" && b.type === "radio" && a.name.length > 0 &&
    a.name === b.name && formScope(a) === formScope(b);
}

/** Radio choices share one navigation position; do not inspect the selection. */
export function logicalFields(fields: readonly SupportedField[]): SupportedField[] {
  const seen = new Map<ReturnType<typeof formScope>, Set<string>>();
  return fields.filter((field) => {
    if (!(field instanceof HTMLInputElement) || field.type !== "radio" || field.name.length === 0) return true;
    const scope = formScope(field);
    const names = seen.get(scope) ?? new Set<string>();
    if (names.has(field.name)) return false;
    names.add(field.name);
    seen.set(scope, names);
    return true;
  });
}

export function fieldsFor(field: SupportedField, fields = visibleFields(field.ownerDocument)): SupportedField[] {
  const scope = formScope(field);
  return logicalFields(fields.filter((candidate) => formScope(candidate) === scope));
}

export function fieldPosition(field: SupportedField, fields: readonly SupportedField[]): number {
  return fields.findIndex((candidate) => candidate === field || sameRadioGroup(candidate, field));
}

export function adjacentField(field: SupportedField, direction: -1 | 1): SupportedField | undefined {
  const fields = fieldsFor(field);
  const index = fieldPosition(field, fields);
  return index < 0 ? undefined : fields[index + direction];
}

function referencedText(field: SupportedField, attribute: string): string[] {
  const ids = field.getAttribute(attribute)?.trim().split(/\s+/).filter(Boolean) ?? [];
  return [...new Set(ids)].slice(0, 8)
    .map((id) => publicText(field.ownerDocument.getElementById(id)))
    .filter(Boolean);
}

export function fieldLabel(field: SupportedField): string {
  const labelledBy = referencedText(field, "aria-labelledby").join(" ");
  if (labelledBy) return labelledBy.slice(0, 600);
  const ariaLabel = field.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel.slice(0, 600);
  const labels = Array.from(field.labels ?? []).map((label) => publicText(label)).filter(Boolean);
  if (labels.length > 0) return [...new Set(labels)].join(" ").slice(0, 600);

  // Common legacy administrative layouts: row headers and definition lists.
  const cell = field.closest("td");
  const row = cell?.parentElement;
  if (row?.matches("tr")) {
    const heading = Array.from(row.children).find((child) => child.matches("th[scope=row]")) ??
      Array.from(row.children).find((child) => child.matches("th"));
    const text = publicText(heading ?? (cell?.previousElementSibling?.matches("td") ? cell.previousElementSibling : null));
    if (text) return text;
  }
  const description = field.closest("dd");
  if (description?.previousElementSibling?.matches("dt")) {
    const text = publicText(description.previousElementSibling);
    if (text) return text;
  }
  return "名称が確認できない入力欄";
}

function groupLabel(field: SupportedField): string | undefined {
  const fieldset = field.closest("fieldset");
  const legend = fieldset === null ? undefined : Array.from(fieldset.children).find((child) => child.matches("legend"));
  return publicText(legend ?? null) || undefined;
}

export function fieldDetails(field: SupportedField, fields?: SupportedField[]): FieldDetails {
  const label = fieldLabel(field);
  const group = groupLabel(field);
  const radioPeers = field instanceof HTMLInputElement && field.type === "radio" && field.name.length > 0
    ? (fields ?? visibleFields(field.ownerDocument)).filter((candidate) => candidate === field || sameRadioGroup(candidate, field))
    : [field];
  const required = radioPeers.some((candidate) => candidate.required || candidate.getAttribute("aria-required") === "true");
  const facts: string[] = [];
  if (required) {
    facts.push("この項目は必須です。入力や選択が必要です。");
  } else if (/(?:^|[（(\s【])必須(?:[）)\s】]|$)/.test(`${label} ${group ?? ""}`)) {
    facts.push("ページの項目名に「必須」と表示されています。ページの説明を確認してください。");
  }

  if (field instanceof HTMLSelectElement) {
    facts.push(field.multiple ? "ページの選択肢から、複数の項目を選べる欄です。" : "ページの選択肢から、ご自身で項目を選ぶ欄です。");
  } else if (field instanceof HTMLTextAreaElement) {
    facts.push("複数行の文章を入力できる欄です。");
  } else {
    const typeFacts: Record<string, string> = {
      email: "メールアドレスの形式で入力します。",
      tel: "電話番号を入力する欄です。区切り方はページの説明を確認してください。",
      date: "日付を選ぶ欄です。",
      month: "年と月を選ぶ欄です。",
      time: "時刻を選ぶ欄です。",
      "datetime-local": "日付と時刻を選ぶ欄です。",
      url: "ウェブアドレスを入力する欄です。",
      number: "数字を入力する欄です。",
      radio: "同じ項目の選択肢から、1つをご自身で選びます。",
      checkbox: "内容を確認して、チェックを入れるかご自身で判断してください。",
      file: "ページで指定されたファイルをご自身で選ぶ欄です。Silver Guide は添付ファイルを読み取りません。"
    };
    const typeFact = typeFacts[field.type];
    if (typeFact) facts.push(typeFact);
    if (field.type !== "number" && (field.inputMode === "numeric" || field.inputMode === "decimal")) {
      facts.push("ページでは数字用の入力方法が指定されています。桁数や区切り方はページの説明を確認してください。");
    }
    if (field.hasAttribute("pattern")) {
      facts.push("ページに入力形式の指定があります。欄の近くの説明を確認してください。");
    }
    for (const [attribute, wording] of [["min", "最小"], ["max", "最大"]] as const) {
      const bound = field.getAttribute(attribute)?.trim();
      if (bound) facts.push(`ページで指定された${wording}の値：${bound.slice(0, 80)}。`);
    }
  }
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.minLength > 0) facts.push(`ページでは${field.minLength}文字以上と指定されています。`);
    if (field.maxLength >= 0) facts.push(`ページでは${field.maxLength}文字までと指定されています。`);
  }

  const errorIds = new Set(field.getAttribute("aria-errormessage")?.trim().split(/\s+/) ?? []);
  const descriptionIds = field.getAttribute("aria-describedby")?.trim().split(/\s+/).filter(Boolean) ?? [];
  const descriptions = [...new Set(descriptionIds)].slice(0, 8)
    .filter((id) => !errorIds.has(id))
    .map((id) => field.ownerDocument.getElementById(id))
    // Error text may echo a typed value. Keep recovery guidance generic.
    .filter((element) => element?.closest("[role=alert], [aria-live=assertive]") === null)
    .map((element) => publicText(element))
    .filter(Boolean);
  const placeholder = field.getAttribute("placeholder")?.trim();
  if (placeholder) descriptions.push(`ページの入力例：${placeholder.slice(0, 600)}`);

  return { label, groupLabel: group, required, facts: [...new Set(facts)], descriptions: [...new Set(descriptions)] };
}

/** Use the page's declared error state; do not read or trigger validation. */
export function hasPageError(field: SupportedField): boolean {
  const invalid = field.getAttribute("aria-invalid")?.toLowerCase();
  return invalid === "true" || invalid === "grammar" || invalid === "spelling";
}
