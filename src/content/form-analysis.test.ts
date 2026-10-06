// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjacentField,
  fieldDetails,
  fieldLabel,
  fieldPosition,
  fieldsFor,
  hasPageError,
  isSupportedField,
  logicalFields,
  publicText,
  visibleFields,
  type SupportedField
} from "./form-analysis";

function page(markup: string): void {
  document.body.innerHTML = markup;
}

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (result === null) throw new Error(`Missing fixture element: ${id}`);
  return result;
}

function field(id: string): SupportedField {
  const result = element(id);
  if (!(result instanceof HTMLInputElement || result instanceof HTMLSelectElement || result instanceof HTMLTextAreaElement)) {
    throw new Error(`Fixture element is not a native control: ${id}`);
  }
  return result;
}

function ids(fields: readonly SupportedField[]): string[] {
  return fields.map((item) => item.id);
}

/** A property read or write must fail even when the fixture contains synthetic data. */
function forbidPrivateState(control: SupportedField): void {
  for (const name of ["value", "valueAsNumber", "valueAsDate", "defaultValue", "checked", "defaultChecked", "files", "selectedIndex", "selectedOptions", "validity", "validationMessage"]) {
    Object.defineProperty(control, name, {
      configurable: true,
      get: () => { throw new Error(`Private property read: ${name}`); },
      set: () => { throw new Error(`Private property write: ${name}`); }
    });
  }
  for (const method of ["checkValidity", "reportValidity"] as const) {
    vi.spyOn(control, method).mockImplementation(() => { throw new Error(`Validation invoked: ${method}`); });
  }
  const getAttribute = control.getAttribute.bind(control);
  vi.spyOn(control, "getAttribute").mockImplementation((name) => {
    if (["value", "checked", "selected"].includes(name.toLowerCase())) {
      throw new Error(`Private state attribute read: ${name}`);
    }
    return getAttribute(name);
  });
}

/** Detect reads of the actual text node, not just textContent on its parent. */
function forbidPrivateText(root: HTMLElement): void {
  for (const name of ["textContent", "innerText", "innerHTML"]) {
    Object.defineProperty(root, name, {
      configurable: true,
      get: () => { throw new Error(`Private text read: ${name}`); }
    });
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    for (const name of ["data", "nodeValue", "textContent"]) {
      Object.defineProperty(node, name, {
        configurable: true,
        get: () => { throw new Error(`Private text node read: ${name}`); }
      });
    }
    node = walker.nextNode();
  }
}

beforeEach(() => {
  document.body.innerHTML = "";
  // jsdom has no layout. Keep direct display/visibility checks in the analyzer,
  // while reproducing the browser's empty rects for display:none ancestors.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    for (let ancestor = this.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
      if (window.getComputedStyle(ancestor).display === "none") return [] as unknown as DOMRectList;
    }
    return [new DOMRect(0, 0, 100, 24)] as unknown as DOMRectList;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("publicText", () => {
  it("extracts public explanations without reading editable or reflected private text", () => {
    page(`<section id="explanation">
      <p>申請に必要な情報</p>
      <label>氏名 <input id="name" value="PRIVATE_INPUT"></label>
      <textarea id="private-textarea">PRIVATE_TEXTAREA</textarea>
      <select id="private-select"><option selected>PRIVATE_OPTION</option></select>
      <output id="private-output">PRIVATE_OUTPUT</output>
      <div id="private-editor" contenteditable="true"><span>PRIVATE_EDITOR</span></div>
      <div id="private-textbox" role="textbox">PRIVATE_TEXTBOX</div>
      <datalist id="private-list"><option>PRIVATE_LIST</option></datalist>
      <button id="private-button">PRIVATE_BUTTON</button>
      <script id="private-script">PRIVATE_SCRIPT</script>
      <style id="private-style">/* PRIVATE_STYLE */</style>
      <div id="silver-guide-host">PRIVATE_EXTENSION</div>
      <p>提出前に内容を確認してください。</p>
    </section>`);

    for (const id of ["private-textarea", "private-select", "private-output", "private-editor", "private-textbox", "private-list", "private-button", "private-script", "private-style", "silver-guide-host"]) {
      forbidPrivateText(element(id));
      expect(publicText(element(id))).toBe("");
    }
    for (const control of document.querySelectorAll<SupportedField>("input, select, textarea")) {
      forbidPrivateState(control);
    }

    expect(publicText(element("explanation"))).toBe("申請に必要な情報 氏名 提出前に内容を確認してください。");
  });

  it("normalizes whitespace and bounds long public text", () => {
    page('<p id="text">  申請\n  書類   の確認  </p>');
    expect(publicText(null)).toBe("");
    expect(publicText(element("text"))).toBe("申請 書類 の確認");
    expect(publicText(element("text"), 5)).toBe("申請 書類…");
    expect(publicText(element("text"), 9)).toBe("申請 書類 の確認");
  });

  it("does not let layout whitespace consume the public text limit", () => {
    page(`<div id="label">${" ".repeat(650)}<span>住民票の郵送先</span></div>
      <input id="address" aria-labelledby="label">`);
    expect(publicText(element("label"))).toBe("住民票の郵送先");
    expect(fieldLabel(field("address"))).toBe("住民票の郵送先");
  });

  it.each([
    'role="searchbox"', 'role="combobox"', 'role="spinbutton"', 'role="slider"',
    'role="listbox"', 'role="option"', 'role="alert"', 'role="status"', 'aria-live="polite"'
  ])("does not read a custom input or live-region reference with %s", (attribute) => {
    page(`<div id="private" ${attribute}><span id="reference">PRIVATE_INPUT_OR_ECHO</span></div>
      <input id="target" aria-labelledby="reference" aria-describedby="reference" aria-label="氏名">`);
    forbidPrivateText(element("private"));
    expect(publicText(element("private"))).toBe("");
    expect(publicText(element("reference"))).toBe("");
    expect(fieldLabel(field("target"))).toBe("氏名");
    expect(fieldDetails(field("target")).descriptions).toEqual([]);
  });
});

describe("fieldLabel", () => {
  it("uses aria-labelledby before aria-label and native labels, resolving IDs in order once", () => {
    page(`<span id="kind">連絡先</span><span id="address">メールアドレス</span>
      <label for="email">通常ラベル</label>
      <input id="email" aria-label="別のラベル" aria-labelledby=" kind missing address kind ">`);
    expect(fieldLabel(field("email"))).toBe("連絡先 メールアドレス");
    field("email").setAttribute("aria-labelledby", "missing");
    expect(fieldLabel(field("email"))).toBe("別のラベル");
    field("email").setAttribute("aria-label", "   ");
    expect(fieldLabel(field("email"))).toBe("通常ラベル");
  });

  it("supports wrapped and multiple labels without reading the wrapped control", () => {
    page(`<label for="postal">郵便番号</label>
      <label>住所の郵便番号 <input id="postal" value="PRIVATE_POSTAL"></label>
      <label for="postal">郵便番号</label>`);
    forbidPrivateState(field("postal"));
    expect(fieldLabel(field("postal"))).toBe("郵便番号 住所の郵便番号");
  });

  it("excludes control values from referenced labels and falls back when a reference is editable", () => {
    page(`<div id="heading">申請者 <output id="echo">PRIVATE_NAME</output></div>
      <textarea id="editor">PRIVATE_LABEL</textarea>
      <input id="name" aria-labelledby="heading editor" aria-label="氏名">`);
    forbidPrivateText(element("echo"));
    forbidPrivateText(element("editor"));
    expect(fieldLabel(field("name"))).toBe("申請者");
    field("name").setAttribute("aria-labelledby", "editor");
    expect(fieldLabel(field("name"))).toBe("氏名");
  });

  it.each([
    ['<table><tr><th scope="row">生年月日</th><td><input id="target" type="date"></td></tr></table>', "生年月日"],
    ['<table><tr><th>電話番号</th><td><input id="target" type="tel"></td></tr></table>', "電話番号"],
    ['<table><tr><td>申請者の住所</td><td><input id="target"></td></tr></table>', "申請者の住所"],
    ['<dl><dt>申請理由</dt><dd><span><textarea id="target"></textarea></span></dd></dl>', "申請理由"]
  ])("supports a legacy administrative layout: %s", (markup, expected) => {
    page(markup);
    expect(fieldLabel(field("target"))).toBe(expected);
  });

  it("uses an explicit native label ahead of nearby table text", () => {
    page('<table><tr><th>住所</th><td><label for="postal">郵便番号</label><input id="postal"></td></tr></table>');
    expect(fieldLabel(field("postal"))).toBe("郵便番号");
  });

  it("prefers an explicit row header when a row also has a column header", () => {
    page('<table><tr><th scope="col">項番</th><th scope="row">生年月日</th><td><input id="date" type="date"></td></tr></table>');
    expect(fieldLabel(field("date"))).toBe("生年月日");
  });

  it.each(["aria", "native"])("bounds the complete label when several %s labels are combined", (source) => {
    const first = "申".repeat(450);
    const second = "請".repeat(450);
    page(source === "aria"
      ? `<span id="first">${first}</span><span id="second">${second}</span><input id="target" aria-labelledby="first second">`
      : `<label for="target">${first}</label><label for="target">${second}</label><input id="target">`);
    expect(fieldLabel(field("target"))).toBe(`${first} ${second}`.slice(0, 600));
  });

  it("does not invent a label from an input value, name, or placeholder", () => {
    page('<input id="target" name="PRIVATE_NAME" value="PRIVATE_VALUE" placeholder="入力例">');
    forbidPrivateState(field("target"));
    expect(fieldLabel(field("target"))).toBe("名称が確認できない入力欄");
  });
});

describe("supported fields and visibility", () => {
  it.each(["text", "email", "tel", "date", "number", "checkbox", "radio", "file"])("supports native %s inputs without reading their state", (type) => {
    page(`<input id="target" type="${type}">`);
    forbidPrivateState(field("target"));
    expect(isSupportedField(field("target"))).toBe(true);
  });

  it("supports selects and textareas, and rejects non-controls and disconnected controls", () => {
    page('<select id="choice"><option>選択肢</option></select><textarea id="note"></textarea><button id="button">次へ</button>');
    expect(ids(visibleFields())).toEqual(["choice", "note"]);
    expect(isSupportedField(element("button"))).toBe(false);
    expect(isSupportedField(document.createElement("input"))).toBe(false);
    expect(isSupportedField(null)).toBe(false);
  });

  it.each([
    'type="hidden"', 'type="password"', 'type="submit"', 'type="reset"',
    'type="button"', 'type="image"', "disabled", "readonly", 'tabindex="-1"',
    'aria-disabled="true"', 'aria-readonly="true"'
  ])("excludes a control with %s", (attributes) => {
    page(`<input id="target" ${attributes}>`);
    expect(isSupportedField(field("target"))).toBe(false);
  });

  it("honors disabled fieldsets and the native first-legend exception", () => {
    page(`<fieldset disabled>
      <legend><label><input id="legend-choice" type="checkbox">編集を有効にする</label></legend>
      <label>氏名 <input id="name"></label><textarea id="note" readonly></textarea>
    </fieldset><input id="next">`);
    expect(ids(visibleFields())).toEqual(["legend-choice", "next"]);
  });

  it.each([
    '<div hidden><input id="target"></div>',
    '<div inert><input id="target"></div>',
    '<div aria-hidden="true"><input id="target"></div>',
    '<div aria-disabled="true"><input id="target"></div>',
    '<div aria-readonly="true"><input id="target"></div>',
    '<details><summary>追加の情報</summary><input id="target"></details>',
    '<dialog><input id="target"></dialog>',
    '<div id="silver-guide-host"><input id="target"></div>'
  ])("excludes hidden, inactive, or extension-owned content: %s", (markup) => {
    page(markup);
    expect(isSupportedField(field("target"))).toBe(false);
  });

  it.each([
    '<input id="target" style="display:none">',
    '<input id="target" style="visibility:hidden">',
    '<input id="target" style="visibility:collapse">',
    '<div style="display:none"><input id="target"></div>',
    '<div style="visibility:hidden"><input id="target"></div>'
  ])("excludes CSS-hidden fields with layout mocked: %s", (markup) => {
    page(markup);
    expect(isSupportedField(field("target"))).toBe(false);
  });

  it("supports open disclosures and an explicit visible descendant", () => {
    page('<details open><input id="details"></details><dialog open><input id="dialog"></dialog><div style="visibility:hidden"><input id="visible" style="visibility:visible"></div>');
    expect(ids(visibleFields())).toEqual(["details", "dialog", "visible"]);
  });

  it("excludes controls with no rendered rectangle", () => {
    page('<input id="target">');
    vi.spyOn(field("target"), "getClientRects").mockReturnValue([] as unknown as DOMRectList);
    expect(isSupportedField(field("target"))).toBe(false);
  });
});

describe("form-scoped navigation", () => {
  it("stays inside the native form, including externally associated controls", () => {
    page(`<form id="application"><input id="first"><input id="skipped" tabindex="-1"><input id="last"></form>
      <form id="search"><input id="search-term"></form>
      <input id="external" form="application"><input id="unassociated">`);
    expect(ids(fieldsFor(field("first")))).toEqual(["first", "last", "external"]);
    expect(adjacentField(field("first"), -1)).toBeUndefined();
    expect(adjacentField(field("first"), 1)).toBe(field("last"));
    expect(adjacentField(field("external"), 1)).toBeUndefined();
    expect(adjacentField(field("external"), -1)).toBe(field("last"));
    expect(ids(fieldsFor(field("search-term")))).toEqual(["search-term"]);
    expect(ids(fieldsFor(field("unassociated")))).toEqual(["unassociated"]);
  });

  it("keeps separate role=form regions isolated", () => {
    page('<section role="form"><input id="a"><input id="b"></section><section role="form"><input id="c"></section><input id="outside">');
    expect(ids(fieldsFor(field("a")))).toEqual(["a", "b"]);
    expect(adjacentField(field("b"), 1)).toBeUndefined();
    expect(ids(fieldsFor(field("c")))).toEqual(["c"]);
    expect(ids(fieldsFor(field("outside")))).toEqual(["outside"]);
  });

  it("gives radio groups one position without inspecting checked state", () => {
    page(`<form id="application"><input id="before">
      <fieldset><legend>証明書の種類</legend>
        <label><input id="resident" type="radio" name="kind" checked>住民票</label>
        <label><input id="tax" type="radio" name="kind">税証明</label>
      </fieldset><input id="unnamed-a" type="radio"><input id="unnamed-b" type="radio"><input id="after"></form>
      <form><input id="other-form" type="radio" name="kind"></form>`);
    for (const control of visibleFields()) forbidPrivateState(control);
    expect(ids(logicalFields(visibleFields()))).toEqual(["before", "resident", "unnamed-a", "unnamed-b", "after", "other-form"]);
    expect(fieldPosition(field("tax"), fieldsFor(field("tax")))).toBe(1);
    expect(adjacentField(field("tax"), -1)).toBe(field("before"));
    expect(adjacentField(field("tax"), 1)).toBe(field("unnamed-a"));
    expect(fieldDetails(field("tax")).groupLabel).toBe("証明書の種類");
  });

  it("recalculates navigation after step changes and DOM replacement", () => {
    page('<form id="application"><section id="step-one"><input id="old"><input id="old-next"></section><section id="step-two" hidden><input id="new"></section></form>');
    const old = field("old");
    expect(ids(fieldsFor(old))).toEqual(["old", "old-next"]);
    element("step-one").remove();
    element("step-two").removeAttribute("hidden");
    element("step-two").insertAdjacentHTML("beforeend", '<select id="new-next"><option>選択肢</option></select>');
    expect(isSupportedField(old)).toBe(false);
    expect(adjacentField(old, 1)).toBeUndefined();
    expect(ids(fieldsFor(field("new")))).toEqual(["new", "new-next"]);
    expect(adjacentField(field("new"), 1)).toBe(field("new-next"));
    const replaced = field("new-next");
    replaced.outerHTML = '<textarea id="replacement"></textarea>';
    expect(adjacentField(field("new"), 1)).toBe(field("replacement"));
    expect(adjacentField(replaced, -1)).toBeUndefined();
  });
});

describe("fieldDetails and declared page errors", () => {
  it("uses the nearest fieldset legend and includes required state from a visible radio peer", () => {
    page(`<form><fieldset><legend>申請全体</legend><fieldset><legend>受取方法</legend>
      <label><input id="mail" type="radio" name="delivery">郵送</label>
      <label><input id="counter" type="radio" name="delivery" required>窓口</label>
    </fieldset></fieldset></form>`);
    forbidPrivateState(field("mail"));
    forbidPrivateState(field("counter"));
    expect(fieldDetails(field("mail"))).toMatchObject({ label: "郵送", groupLabel: "受取方法", required: true });
    expect(fieldDetails(field("mail")).facts).toContain("この項目は必須です。入力や選択が必要です。");
    field("counter").disabled = true;
    expect(fieldDetails(field("mail")).required).toBe(false);
  });

  it("distinguishes a declared requirement from explanatory 必須 text", () => {
    page('<label for="declared">メール</label><input id="declared" aria-required="true"><label for="wording">氏名（必須）</label><input id="wording">');
    expect(fieldDetails(field("declared")).required).toBe(true);
    expect(fieldDetails(field("wording"))).toMatchObject({ required: false });
    expect(fieldDetails(field("wording")).facts).toContain("ページの項目名に「必須」と表示されています。ページの説明を確認してください。");
  });

  it("derives format and length guidance from public attributes", () => {
    page('<label for="postal">郵便番号</label><input id="postal" inputmode="numeric" pattern="[0-9]{7}" minlength="7" maxlength="7" min="1" max="9999999" placeholder="例：1234567" required>');
    forbidPrivateState(field("postal"));
    expect(fieldDetails(field("postal"))).toEqual({
      label: "郵便番号", groupLabel: undefined, required: true,
      facts: [
        "この項目は必須です。入力や選択が必要です。",
        "ページでは数字用の入力方法が指定されています。桁数や区切り方はページの説明を確認してください。",
        "ページに入力形式の指定があります。欄の近くの説明を確認してください。",
        "ページで指定された最小の値：1。",
        "ページで指定された最大の値：9999999。",
        "ページでは7文字以上と指定されています。",
        "ページでは7文字までと指定されています。"
      ], descriptions: ["ページの入力例：例：1234567"]
    });
  });

  it.each([
    ['<input id="target" type="email">', "メールアドレスの形式で入力します。"],
    ['<input id="target" type="tel">', "電話番号を入力する欄です。区切り方はページの説明を確認してください。"],
    ['<input id="target" type="checkbox">', "内容を確認して、チェックを入れるかご自身で判断してください。"],
    ['<input id="target" type="file">', "ページで指定されたファイルをご自身で選ぶ欄です。Silver Guide は添付ファイルを読み取りません。"],
    ['<select id="target"><option>選択肢</option></select>', "ページの選択肢から、ご自身で項目を選ぶ欄です。"],
    ['<select id="target" multiple><option>選択肢</option></select>', "ページの選択肢から、複数の項目を選べる欄です。"],
    ['<textarea id="target"></textarea>', "複数行の文章を入力できる欄です。"]
  ])("explains the control type without reading private state: %s", (markup, fact) => {
    page(markup);
    forbidPrivateState(field("target"));
    expect(fieldDetails(field("target")).facts).toContain(fact);
  });

  it("uses static descriptions but excludes error messages and alert text that could echo an input", () => {
    page(`<label for="email">メールアドレス</label>
      <input id="email" type="email" aria-invalid="true" aria-describedby="hint hint error alert nested-alert assertive missing editable" aria-errormessage="error">
      <p id="hint">半角で入力してください。<output id="echo">PRIVATE_ECHO</output></p>
      <p id="error">PRIVATE_ERROR</p><p id="alert" role="alert">PRIVATE_ALERT</p>
      <div role="alert"><p id="nested-alert">PRIVATE_NESTED_ALERT</p></div>
      <p id="assertive" aria-live="assertive">PRIVATE_ASSERTIVE</p>
      <textarea id="editable">PRIVATE_EDITABLE_DESCRIPTION</textarea>`);
    forbidPrivateState(field("email"));
    forbidPrivateText(element("echo"));
    forbidPrivateText(element("editable"));
    for (const id of ["error", "alert", "nested-alert", "assertive"]) forbidPrivateText(element(id));
    expect(fieldDetails(field("email")).descriptions).toEqual(["半角で入力してください。"]);
    expect(hasPageError(field("email"))).toBe(true);
  });

  it.each([
    [null, false], ["", false], ["false", false], ["FALSE", false], ["unknown", false],
    ["true", true], ["TRUE", true], ["grammar", true], ["spelling", true]
  ])("reads only aria-invalid=%s for the declared error state", (attribute, expected) => {
    page('<input id="target" type="email">');
    if (attribute !== null) field("target").setAttribute("aria-invalid", attribute);
    forbidPrivateState(field("target"));
    expect(hasPageError(field("target"))).toBe(expected);
  });
});
