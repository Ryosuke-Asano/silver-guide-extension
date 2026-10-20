import { describe, expect, it } from "vitest";
import { explainText } from "../../src/features/reading/explanation";

// Authored administrative-style examples; these are not descriptions of a real scheme.
// Expected clauses come from the sentence's grammar, not from parser output.
const cases = [
  {
    text: "本人以外が窓口へ来る場合は、委任状を提出してください。",
    parts: [["condition", "本人以外が窓口へ来る場合は、"], ["action", "委任状を提出してください。"]],
  },
  {
    text: "同じ世帯の人が請求する場合、委任状は不要です。",
    parts: [["condition", "同じ世帯の人が請求する場合、"], ["conclusion", "委任状は不要です。"]],
  },
  {
    text: "ただし、本人が窓口へ来るときは、委任状は必要ありません。",
    parts: [["condition", "ただし、本人が窓口へ来るときは、"], ["exception", "ただし、本人が窓口へ来るときは、"], ["conclusion", "委任状は必要ありません。"]],
  },
  {
    text: "対象者以外が請求する場合は、証明書を交付できません。",
    parts: [["condition", "対象者以外が請求する場合は、"], ["conclusion", "証明書を交付できません。"]],
  },
  {
    text: "令和９年１１月３日までに、申請書を送付してください。",
    parts: [["deadline", "令和９年１１月３日までに、"], ["action", "申請書を送付してください。"]],
  },
  {
    text: "12月1日までに申請書を提出してください。",
    parts: [["deadline", "12月1日までに"], ["action", "申請書を提出してください。"]],
  },
  {
    text: "代理人が請求する場合は、10日以内に、書類を提出してください。",
    parts: [["condition", "代理人が請求する場合は、"], ["deadline", "10日以内に、"], ["action", "書類を提出してください。"]],
  },
  {
    text: "申請書を提出しなければなりません。",
    parts: [["action", "申請書を提出しなければなりません。"]],
  },
  {
    text: "登録者が転出するときは、登録は自動的に廃止されます。",
    parts: [["condition", "登録者が転出するときは、"], ["conclusion", "登録は自動的に廃止されます。"]],
  },
] as const;

describe("source-linked administrative clauses", () => {
  it.each(cases)("separates the actual source clauses: $text", ({ text, parts }) => {
    const result = explainText(text, { dictionary: [] });
    for (const [kind, source] of parts) {
      const element = result.elements.find((candidate) => candidate.kind === kind && candidate.sourceSpan.text === source);
      expect(element, `${kind}: ${source}`).toBeDefined();
      expect(element).toMatchObject({ contextSpan: { start: 0, end: text.length, text } });
    }
    expect(result.status).toBe("partial");
    expect(result.original).toBe(text);
    for (const element of result.elements) {
      expect(text.slice(element.sourceSpan.start, element.sourceSpan.end)).toBe(element.sourceSpan.text);
      if (element.contextSpan) expect(text.slice(element.contextSpan.start, element.contextSpan.end)).toBe(element.contextSpan.text);
    }
  });

  it("preserves UTF-16 offsets when clauses follow emoji, whitespace and another sentence", () => {
    const text = "📝案内です。\n　代理人の場合は、書類を送付してください。";
    const result = explainText(text, { dictionary: [] });
    const action = result.elements.find((element) => element.sourceSpan.text === "書類を送付してください。");
    expect(action).toBeDefined();
    expect(action!.sourceSpan.start).toBe(text.indexOf("書類"));
    expect(action!.contextSpan!.text).toBe("代理人の場合は、書類を送付してください。");
  });

  it("keeps dates of birth and document revision dates separate from deadlines", () => {
    for (const text of ["生年月日は平成12年4月3日です。", "この様式の改訂日は令和8年4月1日です。", "窓口の説明は2026年4月21日に更新されました。"]) {
      expect(explainText(text, { dictionary: [] }).elements.some((element) => element.kind === "deadline")).toBe(false);
    }
  });

  it("does not omit an unrecognized body after finding its condition", () => {
    const text = "本人の場合は、12,345円の項目Ａと項目Ｂで扱いが変わる予定です。";
    const result = explainText(text, { dictionary: [] });
    const originals = result.elements.filter(element => element.kind === "original");
    expect(originals.some(element => element.sourceSpan.text === "12,345円の項目Ａと項目Ｂで扱いが変わる予定です。")).toBe(true);
    expect(result.plainText).toContain("12,345円");
    expect(result.plainText).toContain("変わる予定です");
    expect(result.status).toBe("partial");
  });

  it("does not detach a result from nested or alternative conditions", () => {
    const text = "本人が来る場合又は代理人が来る場合は、書類の種類によって必要なものが異なります。";
    const result = explainText(text, { dictionary: [] });
    expect(result.sentences[0]).toMatchObject({ needsContextReview: true, organized: false });
    expect(result.elements.filter((element) => element.kind !== "term").every((element) => element.sourceSpan.text === text)).toBe(true);
  });

  it("retains quoted punctuation as part of the surrounding statement", () => {
    const text = "「申請できません。」という通知を受けた場合は、担当窓口へお問い合わせください。";
    const result = explainText(text, { dictionary: [] });
    expect(result.sentences).toHaveLength(1);
    expect(result.elements.some((element) => element.kind === "conclusion" && element.sourceSpan.text === "申請できません。")).toBe(false);
    expect(result.original).toBe(text);
  });

  it("keeps a complex exception complete and explicitly asks for a relation check", () => {
    const text = "本人の場合は手続きできますが、ただし代理人の場合は別の条件があります。";
    const result = explainText(text, { dictionary: [] });
    expect(result.sentences[0]).toMatchObject({ needsContextReview: true, organized: false });
    expect(result.elements.filter((element) => element.kind !== "term").every((element) => element.sourceSpan.text === text)).toBe(true);
  });

  it("does not count unknown prose or a marker inside a quoted term as an organized explanation", () => {
    for (const text of ["これは未知の複雑な内容です。", "『場合は』という語句の説明です。", "場合によって異なる内容です。"]) {
      const result = explainText(text, { dictionary: [] });
      expect(result.sentences[0]).toMatchObject({ organized: false });
      expect(result.status).toBe("original-only");
    }
  });
});
