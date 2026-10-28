import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";
import { lookupGlossary } from "../features/reading/explanation";

describe("GLOSSARY", () => {
  it("has unique local entries with a concise explanation", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(80);
    expect(new Set(GLOSSARY.map((entry) => entry.id)).size).toBe(GLOSSARY.length);
    expect(new Set(GLOSSARY.map((entry) => entry.term)).size).toBe(GLOSSARY.length);
    expect(GLOSSARY.every((entry) => entry.term.length >= 2 && entry.plainLabel.length > 0 && entry.plainExplanation.length > 0 && entry.plainExplanation.length <= 140)).toBe(
      true
    );
  });

  it("explains library registration, split names and document operations in plain language", () => {
    const matches = lookupGlossary("利用者登録・在住・在勤・在学・姓と名・市外局番・PDF・添付・アップロード・ファイル形式");
    expect(matches.map(match => match.term)).toEqual(["利用者登録", "在住", "在勤", "在学", "姓と名", "市外局番", "PDF", "添付", "アップロード", "ファイル形式"]);
    expect(matches.every(match => match.status === "matched")).toBe(true);
    expect(matches.find(match => match.term === "姓と名")?.explanation).toContain("「姓」は名字、「名」は下の名前");
    expect(matches.find(match => match.term === "在勤")?.explanation).toContain("自宅がその地域にあるという意味ではありません");
    expect(matches.find(match => match.term === "PDF")?.explanation).toContain("文字を入力できるかどうかはPDFによって異なります");
  });

  it("keeps complete compound terms ahead of their shorter overlapping words", () => {
    const text = "名前カタカナと名前。利用者登録と利用者。予約受取館と予約連絡方法と予約。有効期限と期限。本人確認書類と本人確認。申請者と申請。";
    expect(lookupGlossary(text).map(match => match.term)).toEqual([
      "名前カタカナ", "名前", "利用者登録", "利用者", "予約受取館", "予約連絡方法", "予約", "有効期限", "期限", "本人確認書類", "本人確認", "申請者", "申請"
    ]);
  });

  it("preserves exact source positions around emoji and repeated newly added terms", () => {
    const text = "📄氏名とフリガナをPDFに記入し、本人確認書類を添付してください。PDFの原本も保存します。";
    const matches = lookupGlossary(text);
    expect(matches.map(match => match.term)).toEqual(["氏名", "フリガナ", "PDF", "記入", "本人確認書類", "添付", "PDF", "原本", "保存"]);
    expect(matches[0].span.start).toBe(2);
    for (const match of matches) expect(text.slice(match.span.start, match.span.end)).toBe(match.term);
    const pdfs = matches.filter(match => match.term === "PDF");
    expect(pdfs[1].span.start).toBeGreaterThan(pdfs[0].span.end);
  });

  it("does not make a one-character name label into a match inside unrelated words", () => {
    expect(lookupGlossary("姓／名／有名／地名／姓名判断")).toEqual([]);
    expect(lookupGlossary("名字と氏名").map(match => match.term)).toEqual(["名字", "氏名"]);
  });

  it("retains context checks for existing administrative meanings after the expansion", () => {
    expect(lookupGlossary("アプリの通知")[0].status).toBe("ambiguous");
    expect(lookupGlossary("通知", { url: "https://www.city.yokohama.lg.jp/" })[0]).toMatchObject({ id: "notification", status: "matched" });
  });
});
