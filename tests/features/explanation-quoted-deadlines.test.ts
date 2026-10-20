import { describe, expect, it } from "vitest";
import { explainText } from "../../src/features/reading/explanation";

const options = { dictionary: [] };
describe("deadline and eligibility source scope", () => {
  it.each([["「", "」"], ["『", "』"], ["“", "”"], ['"', '"'], ["（", "）"], ["(", ")"]])(
    "keeps the deadline inside a reported example %s %s as source text", (open, close) => {
      const text = `担当者は${open}7日以内に提出してください。${close}という例文の意味を説明しました。`;
      const result = explainText(text, options);
      expect(result.status).toBe("original-only");
      expect(result.elements.filter(element => element.kind === "deadline")).toEqual([]);
      expect(result.sentences.every(sentence => !sentence.organized)).toBe(true);
      expect(result.original).toBe(text);
    }
  );

  it("does not make a quoted deadline part of the reader's prohibition", () => {
    const text = "自由記入欄に「7日以内に提出」のような説明文を記入しないでください。";
    const result = explainText(text, options);
    expect(result.elements.filter(element => element.kind === "deadline")).toEqual([]);
    expect(result.elements.find(element => element.kind === "action")?.sourceSpan.text).toBe(text);
  });

  it("finds an actual deadline after a quoted example without detaching that example", () => {
    const text = "「7日以内に提出」は記入例です。実際には6月30日までに申請してください。";
    const result = explainText(text, options);
    expect(result.elements.filter(element => element.kind === "deadline").map(element => element.sourceSpan.text)).toEqual(["実際には6月30日までに"]);
    expect(result.elements.find(element => element.kind === "action")?.contextSpan?.text).toBe("実際には6月30日までに申請してください。");
  });

  it("finds a top-level deadline even when an earlier quoted phrase contains a deadline marker", () => {
    const text = "「7日以内に提出」という例文を、6月30日までに確認してください。";
    const result = explainText(text, options);
    expect(result.elements.filter(element => element.kind === "deadline").map(element => element.sourceSpan.text)).toEqual(["「7日以内に提出」という例文を、6月30日までに"]);
    expect(result.elements.find(element => element.kind === "action")?.sourceSpan.text).toBe("確認してください。");
  });

  it.each(["架空区の住民であれば、証明書を取得できます。", "本人確認が完了した方のみ、証明書を取得できます。"]) (
    "keeps eligibility and conclusion together: %s", text => {
      const result = explainText(text, options);
      expect(result.elements.find(element => element.kind === "condition")?.sourceSpan.text).toBe(text);
      expect(result.elements.find(element => element.kind === "conclusion")?.contextSpan?.text).toBe(text);
    }
  );

  it("does not classify quoted eligibility as the reader's eligibility", () => {
    const text = "「住民であれば」「確認済みの方のみ」という例文を説明してください。";
    expect(explainText(text, options).elements.filter(element => element.kind === "condition")).toEqual([]);
  });

  it("keeps a quoted deadline inside a complex condition out of deadline classification", () => {
    const text = "本人または代理人は「7日以内に提出」という表現の意味を確認してください。";
    const result = explainText(text, options);
    expect(result.sentences[0].needsContextReview).toBe(true);
    expect(result.elements.filter(element => element.kind === "deadline")).toEqual([]);
  });
});
