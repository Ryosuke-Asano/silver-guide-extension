import { describe, expect, it } from "vitest";
import { explainText, lookupGlossary, type ContextDictionaryEntry } from "../../src/features/reading/explanation";

describe("source-preserving explanation", () => {
  it("retains dates, conditions, exceptions and negation with exact source ranges", () => {
    const text = "令和8年10月31日までに申請してください。ただし、本人でない場合は申請できません。";
    const result = explainText(text);
    expect(result.original).toBe(text);
    expect(result.status).toBe("partial");
    expect(result.elements.map((element) => element.kind)).toEqual(expect.arrayContaining(["deadline", "condition", "exception", "action", "term"]));
    for (const element of result.elements) expect(text.slice(element.sourceSpan.start, element.sourceSpan.end)).toBe(element.sourceSpan.text);
    expect(result.plainText).toContain("申請できません");
    expect(result.plainText).toContain("令和8年10月31日");
    expect(result.plainText).toContain("ただし");
  });
  it("does not claim unknown paragraphs are fully explained just because one term matches", () => {
    expect(explainText("申請。\n").status).toBe("explained");
    expect(explainText("これは未知の複雑な申請内容です。").status).toBe("partial");
    expect(explainText("これは未知の説明文です。").status).toBe("original-only");
  });
  it("uses context for ambiguous terms and matches 世帯主 before 世帯", () => {
    expect(lookupGlossary("アプリの通知")[0].status).toBe("ambiguous");
    expect(lookupGlossary("通知", { url: "https://www.city.yokohama.lg.jp/" })[0].status).toBe("matched");
    expect(lookupGlossary("世帯主と世帯", { url: "https://www.city.yokohama.lg.jp/" }).map((match) => match.term)).toEqual(["世帯主", "世帯"]);
  });
  it("maintains UTF-16 positions across surrogate pairs and leading whitespace", () => {
    const text = "  📝申請してください。\n　期限は12月1日です。";
    const result = explainText(text, { sourceId: "selection", sourceRevision: 4 });
    expect(result.sourceRevision).toBe(4);
    expect(result.glossary[0].span.start).toBe(4);
    result.sentences.forEach((sentence) => expect(text.slice(sentence.sourceSpan.start, sentence.sourceSpan.end)).toBe(sentence.sourceSpan.text));
  });
  it("uses the local source paragraph for a selected word without duplicating it into the result", () => {
    const dictionary: ContextDictionaryEntry[] = [{ id: "power", term: "委任状", plainLabel: "本人から代理人への依頼を示す書類", plainExplanation: "本人が手続きを代理人に依頼したことを示す書類です。", contexts: ["administrative"], sourceIds: ["official-power-source"], reviewedAt: "2026-10-12", validUntil: "2027-01-10" }];
    expect(lookupGlossary("委任状", { dictionary, now: "2026-10-13" })[0].status).toBe("ambiguous");
    const result = explainText("委任状", { dictionary, surroundingText: "申請書と委任状を準備してください。", now: "2026-10-13" });
    expect(result.status).toBe("explained"); expect(result.glossary[0].sourceIds).toContain("official-power-source");
    expect(result.context.surroundingText).toBeUndefined(); expect(result.context.dictionary).toBeUndefined();
    expect(lookupGlossary("通知", { surroundingText: "物語の登場人物が、アプリの通知に気付きました。" })[0].status).toBe("ambiguous");
    expect(explainText("未登録の造語", { dictionary, surroundingText: "申請書を用意します。", now: "2026-10-13" }).status).toBe("original-only");
    expect(lookupGlossary("委任状", { dictionary, surroundingText: `${"あ".repeat(5000)}申請書`, now: "2026-10-13" })[0].status).toBe("ambiguous");
  });
  it("prefers a verified exact URL scope over broader meanings and keeps same-scope ties ambiguous", () => {
    const base = { term: "通知", plainLabel: "一般の通知", plainExplanation: "一般の通知です。", sourceIds: ["official-notification-source"], reviewedAt: "2026-10-12", validUntil: "2027-01-10" };
    const dictionary: ContextDictionaryEntry[] = [{ ...base, id: "general", contexts: ["general"] }, { ...base, id: "admin", contexts: ["administrative"] }, { ...base, id: "specific", contexts: ["url:https://www.city.yokohama.lg.jp/official"], plainLabel: "この手続きの結果の知らせ" }];
    const context = { dictionary, url: "https://www.city.yokohama.lg.jp/official/result", now: "2026-10-13" };
    expect(lookupGlossary("通知", context)[0]).toMatchObject({ id: "specific", status: "matched" });
    dictionary.push({ ...dictionary[2], id: "same-specificity" });
    expect(lookupGlossary("通知", context)[0].status).toBe("ambiguous");
    expect(lookupGlossary("通知", { ...context, url: "https://www.city.yokohama.lg.jp/officially" })[0].id).toBe("admin");
  });
});
