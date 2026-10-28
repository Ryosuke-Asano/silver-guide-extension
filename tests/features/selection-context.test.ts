// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { selectedPublicText } from "../../src/features/selected-text";
import { isSelectionContext } from "../../src/shared/v3-protocol";

afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

function select(element: Element, fragment: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const text = nodes.map(node => node.data).join(""), start = text.indexOf(fragment);
  expect(start).toBeGreaterThanOrEqual(0);
  const at = (position: number): [Text, number] => {
    for (const node of nodes) { if (position <= node.length) return [node, position]; position -= node.length; }
    throw new Error("Invalid test range");
  };
  const range = document.createRange(); range.setStart(...at(start)); range.setEnd(...at(start + fragment.length));
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
}

it("completes the screenshot's fragment across inline dictionary wrappers without changing the selection", () => {
  document.body.innerHTML = '<p id="source">利用者情報を<span role="button" data-silver-guide-term="input">入力</span>してください。<strong>申込書</strong>は窓口で受け取れます。</p>';
  const original = "利用者情報を入力してください。申込書は窓口で受け取れます。";
  select(document.getElementById("source")!, "してください。申込書");
  const result = selectedPublicText(document);
  expect(result.text).toBe("してください。申込書");
  expect(result.selectionContext?.text).toBe(original);
  expect(isSelectionContext(result.selectionContext, result.text!)).toBe(true);
  expect(window.getSelection()!.toString()).toBe("してください。申込書");
});

it("retains the condition, deadline and subsequent exception around an instruction", () => {
  const original = "18歳以上の場合は、6月30日までに申請できます。ただし、本人確認書類がない場合は申請できません。";
  document.body.innerHTML = '<p id="source"></p>'; document.getElementById("source")!.textContent = original;
  select(document.getElementById("source")!, "申請できます");
  expect(selectedPublicText(document).selectionContext?.text).toBe(original);
});

it("keeps quoted punctuation and a softly wrapped condition together", () => {
  const original = "「申請できません。」という通知を受けた場合は、\n担当窓口へお問い合わせください。";
  document.body.innerHTML = '<p id="source"></p>'; document.getElementById("source")!.textContent = original;
  select(document.getElementById("source")!, "ください");
  expect(selectedPublicText(document).selectionContext?.text).toBe(original);
});

it("limits the context to the selected sentences and one adjacent sentence per side", () => {
  document.body.innerHTML = '<p id="source">一番目です。二番目です。三番目の手続きです。四番目です。五番目です。</p><p>別の段落です。</p>';
  select(document.getElementById("source")!, "手続き");
  expect(selectedPublicText(document).selectionContext?.text).toBe("二番目です。三番目の手続きです。四番目です。");
});

it("does not collect neighboring paragraphs or unrelated page sections", () => {
  document.body.innerHTML = '<p id="before">隣の文章は読みません。</p><div><p id="source">氏名を入力してください。</p></div><p id="after">この文章も読みません。</p>';
  select(document.getElementById("source")!, "してください");
  const reads = vi.fn(() => { throw new Error("Unrelated source read"); });
  for (const id of ["before", "after"]) Object.defineProperty(document.getElementById(id)!.firstChild!, "data", { get: reads });
  expect(selectedPublicText(document).selectionContext?.text).toBe("氏名を入力してください。");
  expect(reads).not.toHaveBeenCalled();
});

it.each([
  '<textarea>private draft</textarea>', '<span contenteditable="true">private edit</span>',
  '<span hidden>hidden text</span>', '<span aria-hidden="true">hidden text</span>',
  '<span style="display:none">hidden text</span>', '<script>private script</script>',
])("does not read excluded neighboring text while collecting context: %s", excluded => {
  document.body.innerHTML = `<p>${excluded}<span id="source">氏名を入力してください。</span></p>`;
  const source = document.getElementById("source")!;
  select(source, "してください");
  const reads = vi.fn(() => { throw new Error("Excluded text read"); });
  const privateNode = source.previousSibling!.firstChild!;
  Object.defineProperty(privateNode, "data", { get: reads });
  expect(selectedPublicText(document).selectionContext?.text).toBe("氏名を入力してください。");
  expect(reads).not.toHaveBeenCalled();
});

it("does not read form values or cross an adjacent input to obtain context", () => {
  document.body.innerHTML = '<p>別の手続きです。<input value="private"><span id="source">氏名を入力してください。</span><select><option>private choice</option></select>別の案内です。</p>';
  select(document.getElementById("source")!, "してください");
  const reads = vi.fn(() => { throw new Error("Private value read"); });
  for (const field of document.querySelectorAll("input,select")) Object.defineProperty(field, "value", { get: reads });
  expect(selectedPublicText(document).selectionContext?.text).toBe("氏名を入力してください。");
  expect(reads).not.toHaveBeenCalled();
});

it("identifies the chosen occurrence and preserves UTF-16 offsets after emoji", () => {
  document.body.innerHTML = '<p>📝申請について。本人は<span id="source">申請</span>できます。</p>';
  select(document.getElementById("source")!, "申請");
  const result = selectedPublicText(document), source = result.selectionContext!;
  expect(source.start).toBe(source.text.lastIndexOf("申請"));
  expect(source.text.slice(source.start, source.end)).toBe("申請");
  expect(isSelectionContext(source, result.text!)).toBe(true);
});

it("does not truncate a very long sentence into an apparently complete instruction", () => {
  document.body.innerHTML = '<p id="source"></p>';
  document.getElementById("source")!.textContent = "条件".repeat(3000) + "入力してください。";
  select(document.getElementById("source")!, "してください");
  expect(selectedPublicText(document)).toEqual({ status: "ready", text: "してください" });
});

it("preserves whitespace outside a trimmed selection and omits redundant context", () => {
  document.body.innerHTML = '<p id="source">氏名を  入力  してください。</p>';
  select(document.getElementById("source")!, "  入力  ");
  const result = selectedPublicText(document);
  expect(result.text).toBe("入力");
  expect(result.selectionContext?.text).toBe("氏名を  入力  してください。");
  expect(isSelectionContext(result.selectionContext, "入力")).toBe(true);
  select(document.getElementById("source")!, "氏名を  入力  してください。");
  expect(selectedPublicText(document).selectionContext).toBeUndefined();
});
