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
  isUtilityField,
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

function forbidImageAttributeReads(image: HTMLElement, forbidden: string[]): void {
  const getAttribute = image.getAttribute.bind(image);
  vi.spyOn(image, "getAttribute").mockImplementation((name) => {
    if (forbidden.includes(name.toLowerCase())) throw new Error(`Private image attribute read: ${name}`);
    return getAttribute(name);
  });
  for (const name of forbidden) {
    Object.defineProperty(image, name, {
      configurable: true,
      get: () => { throw new Error(`Private image property read: ${name}`); }
    });
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

  it("reads image alternatives in public labels and headings without inspecting their source", () => {
    page(`<label id="search-label" for="search"><img id="search-image" src="PRIVATE_IMAGE_URL" alt="サイト内検索"></label>
      <input id="search" type="search" value="PRIVATE_SEARCH">
      <h2 id="heading">申請前に <img id="heading-image" alt="必要なもの"> を確認</h2>`);
    forbidPrivateState(field("search"));
    forbidImageAttributeReads(element("search-image"), ["src"]);
    forbidImageAttributeReads(element("heading-image"), ["src"]);
    expect(fieldLabel(field("search"))).toBe("サイト内検索");
    expect(publicText(element("search-label"))).toBe("サイト内検索");
    expect(publicText(element("search-image"))).toBe("サイト内検索");
    expect(publicText(element("heading"))).toBe("申請前に 必要なもの を確認");
  });

  it("bounds image alternatives and keeps decorative images out of the text", () => {
    page(`<label for="target"><img alt=""><img alt="${"申".repeat(700)}"></label><input id="target">`);
    expect(fieldLabel(field("target"))).toBe("申".repeat(600));
    expect(publicText(document.querySelector("label"), 5)).toBe("申".repeat(5) + "…");
  });

  it("does not read image alternatives inside private controls or live regions", () => {
    page(`<label for="target">連絡先
      <span id="editor" contenteditable><img id="private-editor-image" alt="PRIVATE_EDITOR"></span>
      <span role="combobox"><img id="private-combo-image" alt="PRIVATE_SELECTION"></span>
      <output><img id="private-output-image" alt="PRIVATE_ECHO"></output>
      <span role="alert"><img id="private-error-image" alt="PRIVATE_ERROR"></span>
    </label><input id="target" value="PRIVATE_VALUE">`);
    for (const id of ["private-editor-image", "private-combo-image", "private-output-image", "private-error-image"]) {
      forbidImageAttributeReads(element(id), ["alt", "src"]);
    }
    forbidPrivateState(field("target"));
    expect(fieldLabel(field("target"))).toBe("連絡先");
    expect(fieldDetails(field("target"))).toMatchObject({ label: "連絡先", facts: [] });
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

describe("visible native label context", () => {
  it("keeps an ARIA input example as the accessible name while supplementing the visible phone label", () => {
    page(`<dl><dt><span class="required_span">必須</span></dt><dd>
      <label id="phone-heading" for="phone">電話番号</label>
      <input id="phone" type="text" aria-label="入力例）012-345-6789は0123456789と入力" aria-describedby="phone-heading" maxlength="20">
    </dd></dl>`);
    forbidPrivateState(field("phone"));
    expect(fieldLabel(field("phone"))).toBe("入力例）012-345-6789は0123456789と入力");
    expect(fieldDetails(field("phone"))).toMatchObject({
      label: "入力例）012-345-6789は0123456789と入力", visibleLabel: "電話番号", required: false,
      descriptions: ["電話番号"],
      facts: ["ページの項目名や見出しに「必須」と表示されています。ページの説明を確認してください。", "ページでは20文字までと指定されています。"]
    });
  });

  it("supplements aria-labelledby with wrapped and multiple public labels without control values", () => {
    page(`<span id="aria">郵便番号を数字7桁で入力</span>
      <label for="postal">郵便番号</label>
      <label>住所の郵便番号 <input id="postal" aria-labelledby="aria" value="PRIVATE_VALUE">
        <output id="echo">PRIVATE_ECHO</output></label>
      <label for="postal">郵便番号</label>`);
    forbidPrivateState(field("postal"));
    forbidPrivateText(element("echo"));
    expect(fieldDetails(field("postal"))).toMatchObject({
      label: "郵便番号を数字7桁で入力", visibleLabel: "郵便番号 住所の郵便番号"
    });
  });

  it("does not repeat an equal label or invent supplemental context without a native label", () => {
    page('<label for="equal">氏名</label><input id="equal" aria-label="  氏名  "><input id="unlabelled" aria-label="住所">');
    expect(fieldDetails(field("equal"))).not.toHaveProperty("visibleLabel");
    expect(fieldDetails(field("unlabelled"))).not.toHaveProperty("visibleLabel");
  });

  it.each([
    "hidden", 'aria-hidden="true"', "inert", 'style="display:none"',
    'style="visibility:hidden"', 'style="visibility:collapse"'
  ])("does not read or supplement a hidden native label with %s", (attribute) => {
    page(`<label id="hidden-label" for="target" ${attribute}><img id="hidden-image" alt="PRIVATE_HIDDEN_NAME">PRIVATE_HIDDEN_TEXT</label>
      <input id="target" aria-label="公開の読み上げ名">`);
    forbidPrivateText(element("hidden-label"));
    forbidImageAttributeReads(element("hidden-image"), ["alt", "src"]);
    expect(fieldDetails(field("target"))).toMatchObject({ label: "公開の読み上げ名", facts: [] });
    expect(fieldDetails(field("target"))).not.toHaveProperty("visibleLabel");
  });

  it("preserves hidden ARIA references while taking supplemental context only from visible native text", () => {
    page(`<span id="aria" hidden>郵便番号を7桁で入力</span>
      <label for="postal">郵便番号<span hidden>OLD_HIDDEN_LABEL</span></label>
      <label for="postal" style="display:none">OLD_HIDDEN_LABEL_2</label>
      <input id="postal" aria-labelledby="aria">`);
    expect(fieldLabel(field("postal"))).toBe("郵便番号を7桁で入力");
    expect(fieldDetails(field("postal")).visibleLabel).toBe("郵便番号");
  });

  it("allows visible descendants and display:contents labels without requiring a label rectangle", () => {
    page(`<label for="target" style="display:contents;visibility:hidden"><span style="visibility:visible">申請者</span></label>
      <input id="target" aria-label="氏名を入力">`);
    expect(fieldDetails(field("target")).visibleLabel).toBe("申請者");
  });
});

describe("utility field classification", () => {
  it.each([
    '<main><input id="target" type="search"></main>',
    '<main><input id="target" role="searchbox"></main>',
    '<main><form role="search"><input id="target"></form></main>',
    '<header><input id="target"></header><main></main>',
    '<nav><input id="target"></nav>',
    '<section role="banner"><input id="target"></section>',
    '<section role="navigation"><input id="target"></section>'
  ])("identifies a structural site utility while retaining native support: %s", (markup) => {
    page(markup);
    forbidPrivateState(field("target"));
    expect(isUtilityField(field("target"))).toBe(true);
    expect(isSupportedField(field("target"))).toBe(true);
  });

  it.each([
    '<main><header><input id="target"></header></main>',
    '<section role="main"><nav><input id="target"></nav></section>',
    '<article><header><input id="target"></header></article>',
    '<form><input id="target" name="search" aria-label="サイト内検索"></form>',
    '<section><input id="target"></section>',
    '<footer><input id="target"></footer>'
  ])("does not classify application content or guess from names: %s", (markup) => {
    page(markup);
    forbidPrivateState(field("target"));
    expect(isUtilityField(field("target"))).toBe(false);
  });

  it("preserves same-form navigation when a utility field receives explicit focus", () => {
    page(`<form><header><label for="lookup">書類を検索</label><input id="lookup" type="search"></header>
      <main><label for="name">氏名</label><input id="name"></main></form>`);
    for (const control of visibleFields()) forbidPrivateState(control);
    expect(ids(visibleFields())).toEqual(["lookup", "name"]);
    expect(ids(fieldsFor(field("lookup")))).toEqual(["lookup", "name"]);
    expect(adjacentField(field("lookup"), 1)).toBe(field("name"));
    expect(fieldDetails(field("lookup")).label).toBe("書類を検索");
  });

  it("updates its classification after structural or native type changes", () => {
    page('<header><input id="target"></header><main id="content"></main>');
    expect(isUtilityField(field("target"))).toBe(true);
    element("content").append(field("target"));
    expect(isUtilityField(field("target"))).toBe(false);
    field("target").setAttribute("type", "search");
    expect(isUtilityField(field("target"))).toBe(true);
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
    expect(fieldDetails(field("wording")).facts).toContain("ページの項目名や見出しに「必須」と表示されています。ページの説明を確認してください。");
  });

  it.each([
    '<label for="target">氏名<span>必須</span></label><input id="target" aria-label="氏名の入力">',
    '<dl><dt>連絡先<span>必須</span></dt><dd><label for="target">電話番号</label><input id="target"></dd></dl>',
    '<table><tr><th scope="row">申請者<img alt="必須"></th><td><label for="target">氏名</label><input id="target"></td></tr></table>',
    '<fieldset><legend>受取方法<span>必須</span></legend><label>郵送<input id="target" type="radio" name="delivery"></label></fieldset>'
  ])("supplements an exact public required marker from the associated structural heading: %s", (markup) => {
    page(markup);
    forbidPrivateState(field("target"));
    expect(fieldDetails(field("target")).required).toBe(false);
    expect(fieldDetails(field("target")).facts).toContain(
      "ページの項目名や見出しに「必須」と表示されています。ページの説明を確認してください。"
    );
  });

  it.each(["任意", "必須ではありません", "必須でない", "非必須", "必須事項については案内を確認"]) (
    "does not turn ambiguous or negative wording into a required fact: %s", (wording) => {
      page(`<label for="target">氏名（${wording}）</label><input id="target">`);
      expect(fieldDetails(field("target")).required).toBe(false);
      expect(fieldDetails(field("target")).facts).toEqual([]);
    }
  );

  it.each([
    '氏名（<span>必須</span>ではありません）',
    '氏名（非<span>必須</span>）',
    '<span>必須</span>事項については案内を確認'
  ])("does not mistake a fragment of negative or explanatory wording for a badge: %s", (heading) => {
    page(`<label for="target">${heading}</label><input id="target">`);
    expect(fieldDetails(field("target"))).toMatchObject({ required: false, facts: [] });
  });

  it.each(["hidden", 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"']) (
    "does not read or infer a requirement from a hidden badge with %s", (attribute) => {
      page(`<label for="target">氏名<span id="old-marker" ${attribute}><img id="old-image" alt="必須">必須</span></label>
        <input id="target" aria-label="氏名の入力">`);
      forbidPrivateText(element("old-marker"));
      forbidImageAttributeReads(element("old-image"), ["alt", "src"]);
      expect(fieldDetails(field("target"))).toMatchObject({ visibleLabel: "氏名", required: false, facts: [] });
    }
  );

  it("uses the row heading and immediate definition heading rather than neighboring headings or paragraphs", () => {
    page(`<table><tr><th scope="col">必須</th><th scope="row">備考</th><td><input id="table" aria-label="備考"></td></tr></table>
      <dl><dt>必須</dt><dd>別の項目</dd><dt>備考</dt><dd><input id="definition" aria-label="備考">
        <p id="unassociated-error">必須 PRIVATE_ECHO</p></dd></dl>`);
    forbidPrivateText(element("unassociated-error"));
    expect(fieldDetails(field("table")).facts).toEqual([]);
    expect(fieldDetails(field("definition")).facts).toEqual([]);
  });

  it("does not infer visible requirements from an ARIA name or read private heading regions", () => {
    page(`<dl><dt>問い合わせ
      <span role="alert" id="error">必須 PRIVATE_ECHO</span>
      <span contenteditable id="editor"><img id="private-marker" alt="必須">PRIVATE_INPUT</span>
    </dt><dd><label for="target">備考</label><input id="target" aria-label="備考（必須）"></dd></dl>`);
    forbidPrivateState(field("target"));
    forbidPrivateText(element("error"));
    forbidPrivateText(element("editor"));
    forbidImageAttributeReads(element("private-marker"), ["alt", "src"]);
    expect(fieldDetails(field("target"))).toMatchObject({ label: "備考（必須）", visibleLabel: "備考", required: false, facts: [] });
  });

  it("prefers native requirement state and avoids duplicating required facts from several badges", () => {
    page(`<fieldset><legend>連絡先<span>必須</span></legend><dl><dt>必須</dt><dd>
      <label for="target">電話番号（必須）</label><input id="target" required>
    </dd></dl></fieldset>`);
    expect(fieldDetails(field("target"))).toMatchObject({
      required: true, facts: ["この項目は必須です。入力や選択が必要です。"]
    });
    field("target").required = false;
    expect(fieldDetails(field("target")).facts).toEqual([
      "ページの項目名や見出しに「必須」と表示されています。ページの説明を確認してください。"
    ]);
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
