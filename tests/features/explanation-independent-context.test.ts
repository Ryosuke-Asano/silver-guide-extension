import { describe, expect, it } from "vitest";
import { explainText } from "../../src/features/reading/explanation";

// Independent source cases: assertions describe the source's scope, without
// deriving expected clauses from the parser's expressions or its authored tests.
const options = { dictionary: [] };
describe("independent explanation scope and source evidence", () => {
  it("keeps a line-wrapped condition in the context of its conclusion", () => {
    const text = "申請する人が18歳未満の場合は、\n保護者の同意書が必要です。";
    const result = explainText(text, options);
    const conclusion = result.elements.find(element => element.kind === "conclusion");
    expect(conclusion).toBeTruthy();
    expect(conclusion!.contextSpan?.text).toBe(text);
    expect(conclusion!.contextSpan?.text).toContain("18歳未満の場合は");
  });

  it.each([
    ['"', '"'], ["“", "”"], ["「", "」"], ["『", "』"]
  ])("does not promote a reported quotation (%s %s) into independent requirements", (open, close) => {
    const text = `注意書きには ${open}申請書は不要です。再提出しないでください。${close} と記載されています。`;
    const result = explainText(text, options);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0].sourceSpan.text).toBe(text);
    expect(result.status).toBe("original-only");
  });

  it("does not treat the condition marker inside an ASCII quotation as the reader's condition", () => {
    const text = '"代理人が申請する場合は、" の意味を窓口で確認してください。';
    const result = explainText(text, options);
    expect(result.elements.filter(element => element.kind === "condition")).toEqual([]);
    expect(result.elements.find(element => element.kind === "action")?.sourceSpan.text).toBe(text);
  });

  it("identifies a deadline contained in a condition without separating the conclusion from it", () => {
    const text = "6月30日までに申請する場合は、翌日に交付できます。";
    const result = explainText(text, options);
    expect(result.elements.some(element => element.kind === "deadline" && element.sourceSpan.text.includes("6月30日までに"))).toBe(true);
    expect(result.elements.find(element => element.kind === "conclusion")?.contextSpan?.text).toBe(text);
  });

  it.each([
    "本人または同一世帯の代理人で、本人確認が済んでいる場合のみ交付できます。",
    "窓口が休みの場合は、本人でない場合を除き、申請できません。",
    "代理人が申請する場合（本人確認が済んでいるときも含む）は、窓口では交付できません。",
    "本人確認書類がない場合は、申請できないわけではありません。",
    "本人でない人以外は、審査が終わった場合でも交付できません。"
  ])("retains every qualification and negation in its exact source context: %s", text => {
    const result = explainText(text, options);
    expect(result.original).toBe(text);
    expect(result.status).not.toBe("explained");
    const sourceElements = result.elements.filter(element => element.kind !== "term");
    expect(sourceElements.length).toBeGreaterThan(0);
    for (const element of sourceElements) {
      expect(text.slice(element.sourceSpan.start, element.sourceSpan.end)).toBe(element.sourceSpan.text);
      expect(element.contextSpan?.text).toBe(text);
    }
  });

  it("preserves unknown continuation text after a recognized condition", () => {
    const text = "転居する場合は、机の左側に青い紙があります。";
    const result = explainText(text, options);
    expect(result.elements.some(element => element.kind === "original" && element.sourceSpan.text === "机の左側に青い紙があります。")).toBe(true);
    expect(result.elements.every(element => element.contextSpan?.text === text)).toBe(true);
  });

  it("maintains distinct UTF-16 source ranges for repeated clauses after supplementary characters", () => {
    const sentence = "🧾代理人が申請する場合は、委任状が必要です。";
    const text = `${sentence}\n\n${sentence}`;
    const result = explainText(text, options);
    const conclusions = result.elements.filter(element => element.kind === "conclusion");
    expect(conclusions).toHaveLength(2);
    expect(conclusions[1].sourceSpan.start).toBeGreaterThan(conclusions[0].sourceSpan.end);
    for (const element of result.elements) {
      expect(text.slice(element.sourceSpan.start, element.sourceSpan.end)).toBe(element.sourceSpan.text);
      const context = element.contextSpan!;
      expect(text.slice(context.start, context.end)).toBe(context.text);
    }
  });
});
