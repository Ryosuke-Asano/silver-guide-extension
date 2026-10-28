import { GLOSSARY } from "../../data/glossary";

export type SourceSpan = { start: number; end: number; text: string };
export type ContextDictionaryEntry = { id: string; term: string; plainLabel: string; plainExplanation: string; contexts: string[]; sourceIds: string[]; reviewedAt: string; validUntil: string };
export type ExplanationContext = { url?: string; sourceId?: string; sourceRevision?: number; dictionary?: readonly ContextDictionaryEntry[]; now?: string | Date; surroundingText?: string };
export type GlossaryMatch = {
  id: string;
  term: string;
  plainLabel: string;
  explanation: string;
  span: SourceSpan;
  status: "matched" | "ambiguous";
  dictionaryId: string;
  sourceIds: string[];
  reviewedAt: string | null;
};
export type ExplanationElement = {
  kind: "conclusion" | "condition" | "action" | "exception" | "deadline" | "term" | "original";
  displayText: string;
  sourceSpan: SourceSpan;
  dictionaryIds: string[];
  contextSpan?: SourceSpan;
};
export type SentenceExplanation = {
  sourceSpan: SourceSpan;
  elements: ExplanationElement[];
  glossary: GlossaryMatch[];
  organized: boolean;
  needsContextReview: boolean;
  incomplete: boolean;
};
export type TextExplanation = {
  status: "explained" | "partial" | "original-only";
  original: string;
  sourceId: string | null;
  sourceRevision: number;
  ruleVersion: "source-preserving-v2";
  context: ExplanationContext;
  sentences: SentenceExplanation[];
  elements: ExplanationElement[];
  glossary: GlossaryMatch[];
  plainText: string;
};

const CONTEXT_DEPENDENT = new Set(["notification", "decision", "household", "head-household"]);
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isAdministrativeContext(text: string, context: ExplanationContext): boolean {
  if (context.url) {
    try {
      const hostname = new URL(context.url).hostname;
      if (/\.(?:go|lg)\.jp$/u.test(hostname)) return true;
    } catch { /* Pasted text still has a local source paragraph even without a URL. */ }
  }
  return /(役所|自治体|市区町村|住民票|住民税|行政|給付|申請書|戸籍)/u.test(`${text}\n${context.surroundingText?.slice(0, 5000) ?? ""}`);
}

/** Local dictionary lookups preserve offsets in the original UTF-16 string. */
export function lookupGlossary(text: string, context: ExplanationContext = {}): GlossaryMatch[] {
  const administrative = isAdministrativeContext(text, context);
  const now = new Date(context.now ?? Date.now()).getTime();
  type LookupEntry = { id: string; term: string; plainLabel: string; plainExplanation: string; contexts?: string[]; sourceIds?: string[]; reviewedAt?: string };
  const entries: readonly LookupEntry[] = context.dictionary === undefined ? GLOSSARY : context.dictionary.filter((entry) => Date.parse(entry.reviewedAt) <= now && Date.parse(entry.validUntil) >= now);
  if (!entries.length) return [];
  const pattern = new RegExp([...new Set(entries.map((entry) => entry.term))].sort((a, b) => b.length - a.length).map(escapePattern).join("|"), "gu");
  const matches: GlossaryMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const candidates = entries.filter((candidate) => candidate.term === match[0]);
    const contextScore = (candidate: (typeof entries)[number]): number => {
      if (candidate.contexts === undefined) return CONTEXT_DEPENDENT.has(candidate.id) ? administrative ? 10 : -1 : 1;
      return Math.max(-1, ...candidate.contexts.map((scope) => {
        if (scope === "general") return 1;
        if (scope === "administrative" && administrative) return 10;
        if (!scope.startsWith("url:") || !context.url) return -1;
        try { const expected = new URL(scope.slice(4)), current = new URL(context.url); return expected.origin === current.origin && (current.pathname === expected.pathname || current.pathname.startsWith(`${expected.pathname.replace(/\/$/u, "")}/`)) ? 10_000 + expected.pathname.length : -1; }
        catch { return -1; }
      }));
    };
    const highest = Math.max(...candidates.map(contextScore));
    const applicable = highest >= 0 ? candidates.filter((candidate) => contextScore(candidate) === highest) : [];
    const entry = applicable[0] ?? candidates[0];
    if (!entry || match.index === undefined) continue;
    const ambiguous = applicable.length !== 1;
    matches.push({
      id: entry.id, term: entry.term, plainLabel: ambiguous ? entry.term : entry.plainLabel,
      explanation: ambiguous ? "文脈によって意味が変わる言葉です。元の文で使われている意味を確認してください。" : entry.plainExplanation,
      span: { start: match.index, end: match.index + match[0].length, text: match[0] },
      status: ambiguous ? "ambiguous" : "matched", dictionaryId: `${context.dictionary === undefined ? "bundled-glossary" : "verified-dictionary"}:${entry.id}`,
      sourceIds: [...(entry.sourceIds ?? [])], reviewedAt: entry.reviewedAt ?? null
    });
  }
  return matches;
}

function trimmedSpan(text: string, start: number, end: number): SourceSpan | null {
  const section = text.slice(start, end);
  const leading = section.length - section.trimStart().length;
  const trailing = section.length - section.trimEnd().length;
  if (leading + trailing >= section.length) return null;
  return { start: start + leading, end: end - trailing, text: section.trim() };
}

const BRACKET_ENDS: Record<string, string> = { "「": "」", "『": "』", "（": "）", "(": ")", "【": "】", "[": "]", "“": "”", "‘": "’", "\"": "\"", "'": "'" };
const SENTENCE_END = /[。！？!?]/u;
const CONDITION_MARKER = /(?:場合|とき|時)(?:には|は|のみ|も|[、，,])(?:[、，,])?\s*/gu;
const CONDITION_WORD = /(?:場合|とき|時|であれば|(?:方|者|人)のみ)/gu;
const ELIGIBILITY_WORD = /(?:に限り|条件|対象者は|であれば|(?:方|者|人)のみ)/gu;
const ACTION_END = /(?:ください|下さい|お願いします|お願い申し上げます|しなければなりません|する必要があります|する必要はありません)[。！？!?]*$/u;
const CONCLUSION_END = /(?:必要です|必要ありません|不要です|不要となります|できます|できません|できる|できない|受け付けます|受け付けません|受け付けない|対象です|対象となります|対象ではありません|交付します|交付されます|交付しません|交付されません|発行します|発行されます|発行できません|廃止されます|無効です|有効です|免除されます|減免されます|異なります)[。！？!?]*$/u;
// A polite ending or a bare result does not say what the reader should do.
// Keep its exact source, rather than presenting it as a useful instruction.
const BARE_PREDICATE = /^(?:(?:して|て|しないで|ないで)(?:ください|下さい)|ください|下さい|お願いします|お願い申し上げます|しなければなりません|する必要があります|する必要はありません|必要です|必要ありません|不要です|できます|できません|できる|できない)[。！？!?]*$/u;
const DEADLINE_WORD = /(?:締切|期限|までに|以内に|必着|消印有効|有効期間|受付期間)/gu;
const DEADLINE_BOUNDARY = /(?:までに|以内に)(?:[、，,])?\s*/gu;
const EXCEPTION_PREFIX = /^(?:ただし|但し|なお|※|注[０-９0-9]*[：:])(?:[、，,])?/u;
const COMPLEX_CONNECTOR = /(?:又は|または|若しくは|もしくは|及び|および|かつ|ただし|但し|一方|それ以外|以外の|が[、，,]|けれど|しかし)/gu;

export function actionLabel(text: string): string {
  if (/する必要はありません[。！？!?]*$/u.test(text)) return "しなくてよいこと";
  if (/ないで(?:ください|下さい)[。！？!?]*$/u.test(text)) return "してはいけないこと";
  return "やること";
}

function advanceBrackets(text: string, index: number, closings: string[]): void {
  const character = text[index]!;
  if (character === "\"" || character === "'") {
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) backslashes++;
    if (backslashes % 2 || (character === "'" && /[a-z0-9]/iu.test(text[index - 1] ?? "") && /[a-z0-9]/iu.test(text[index + 1] ?? ""))) return;
  }
  if (character === closings.at(-1)) closings.pop();
  else if (BRACKET_ENDS[character]) closings.push(BRACKET_ENDS[character]!);
}

/** Quoted punctuation and parenthesized qualifications belong to their sentence. */
function sourceSentences(text: string): SourceSpan[] {
  const spans: SourceSpan[] = [], closings: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    advanceBrackets(text, index, closings);
    // A single soft line wrap can separate a condition from its result. Paragraph
    // breaks and explicit list items delimit prose; line wrapping alone does not.
    const paragraphBreak = character === "\n" && (text[index + 1] === "\n" || /^[ \t　]*(?:[・●※*-]|[０-９0-9]+[.．)）])/u.test(text.slice(index + 1, index + 40)));
    if (closings.length || !(SENTENCE_END.test(character) || paragraphBreak)) continue;
    let end = index + 1;
    while (end < text.length && (SENTENCE_END.test(text[end]!) || (paragraphBreak && text[end] === "\n"))) end++;
    const span = trimmedSpan(text, start, end);
    if (span) spans.push(span);
    start = end; index = end - 1;
  }
  const tail = trimmedSpan(text, start, text.length);
  if (tail) spans.push(tail);
  return spans;
}

/** Match grammar markers only outside quoted text and bracketed explanations. */
function topLevelMatches(text: string, pattern: RegExp): RegExpMatchArray[] {
  const depths = new Uint32Array(text.length + 1), closings: string[] = [];
  for (let index = 0; index < text.length; index++) {
    depths[index] = closings.length;
    advanceBrackets(text, index, closings);
  }
  depths[text.length] = closings.length;
  return [...text.matchAll(pattern)].filter(match => depths[match.index!] === 0 && depths[match.index! + match[0].length] === 0);
}

function organizeSentence(text: string, sourceSpan: SourceSpan, glossary: GlossaryMatch[]): SentenceExplanation {
  const elements: ExplanationElement[] = [];
  const sentenceGlossary = glossary.filter(match => match.span.start >= sourceSpan.start && match.span.end <= sourceSpan.end);
  const add = (kind: ExplanationElement["kind"], span: SourceSpan, label: string): void => {
    elements.push({ kind, displayText: label + "：" + span.text, sourceSpan: span, contextSpan: sourceSpan, dictionaryIds: [] });
  };
  const local = sourceSpan.text;
  const markers = topLevelMatches(local, CONDITION_MARKER), conditionWords = topLevelMatches(local, CONDITION_WORD);
  const connectors = topLevelMatches(local, COMPLEX_CONNECTOR).filter(match => match.index! > (EXCEPTION_PREFIX.exec(local)?.[0].length ?? 0));
  // Multiple predicates and alternatives need a semantic relation check. Keep all
  // qualifications together rather than manufacture one interpretation.
  const needsContextReview = conditionWords.length > 1 || connectors.length > 0 ||
    /(?:\([^)]*(?:場合|とき)|（[^）]*(?:場合|とき))/u.test(local);
  let cursor = sourceSpan.start, organized = false;
  if (!needsContextReview && markers.length === 1) {
    const boundary = sourceSpan.start + markers[0]!.index! + markers[0]![0].length;
    const prefix = trimmedSpan(text, cursor, boundary), remainder = trimmedSpan(text, boundary, sourceSpan.end);
    if (prefix && remainder) {
      add("condition", prefix, "当てはまる条件");
      if (EXCEPTION_PREFIX.test(prefix.text)) add("exception", prefix, "例外と注意");
      if (topLevelMatches(prefix.text, DEADLINE_WORD).length) add("deadline", prefix, "期限・期間を含む条件");
      cursor = boundary; organized = true;
    }
  }
  if (!needsContextReview) {
    const remaining = text.slice(cursor, sourceSpan.end);
    const deadline = topLevelMatches(remaining, DEADLINE_BOUNDARY)[0];
    const deadlinePrefix = deadline ? remaining.slice(0, deadline.index! + deadline[0].length) : "";
    // A leading action/cause is not a detachable deadline just because it contains
    // までに; leave such mixed qualifications in their source sentence.
    if (deadline && deadline.index! > 0 && deadline.index! <= 80 && !/[\r\n]/u.test(deadlinePrefix) &&
      !topLevelMatches(deadlinePrefix, /(?:して|し[、，,]|場合|とき|ただし|ので|ため|こと)/gu).length) {
      const boundary = cursor + deadlinePrefix.length;
      const prefix = trimmedSpan(text, cursor, boundary), remainder = trimmedSpan(text, boundary, sourceSpan.end);
      if (prefix && remainder) { add("deadline", prefix, "期限・期間"); cursor = boundary; organized = true; }
    }
  }
  let body = trimmedSpan(text, cursor, sourceSpan.end) ?? sourceSpan;
  const bareBody = BARE_PREDICATE.test(body.text.replace(/\s/gu, ""));
  const incomplete = bareBody && BARE_PREDICATE.test(local.replace(/\s/gu, ""));
  if (bareBody && !incomplete) {
    // Splitting a deadline can itself detach the verb: "支払いは6月30日までに
    // してください" is complete. Restore its whole sentence before classifying.
    elements.length = 0;
    body = sourceSpan;
    organized = false;
  }
  const bodyText = body.text;
  const beforeBody = elements.length;
  const action = ACTION_END.test(bodyText), conclusion = CONCLUSION_END.test(bodyText) ||
    /(?:手数料|費用|料金|金額).*[０-９0-9]+円(?:です|となります|になります)?[。！？!?]*$/u.test(bodyText);
  if (incomplete) {
    elements.length = 0;
    add("original", sourceSpan, "元の文");
    organized = false;
  } else if (needsContextReview) {
    if (conditionWords.length || topLevelMatches(local, ELIGIBILITY_WORD).length) add("condition", sourceSpan, "条件の関係は原文で確認");
    if (topLevelMatches(local, /(?:ただし|但し|なお|例外)/gu).length) add("exception", sourceSpan, "例外と注意");
    if (topLevelMatches(local, DEADLINE_WORD).length) add("deadline", sourceSpan, "期限・期間");
    if (action) add("action", sourceSpan, actionLabel(bodyText));
    if (conclusion) add("conclusion", sourceSpan, "原文が示す結果・扱い");
  } else {
    if (!organized && (markers.length || topLevelMatches(bodyText, ELIGIBILITY_WORD).length)) add("condition", body, "当てはまる条件");
    if (EXCEPTION_PREFIX.test(bodyText)) add("exception", body, "例外と注意");
    if (topLevelMatches(bodyText, DEADLINE_WORD).length) add("deadline", body, "期限・期間");
    if (action) add("action", body, actionLabel(bodyText));
    if (conclusion) add("conclusion", body, "原文が示す結果・扱い");
    // A standalone recognized action/result is useful without claiming a complete
    // explanation of a scheme; the public result still remains partial.
    organized ||= action || conclusion;
  }
  if (!incomplete && elements.length === beforeBody) add("original", body, "元の文");
  for (const term of sentenceGlossary.filter(entry => entry.status === "matched")) {
    elements.push({ kind: "term", displayText: term.term + "：" + term.plainLabel + "。" + term.explanation, sourceSpan: term.span, contextSpan: sourceSpan, dictionaryIds: [term.dictionaryId] });
  }
  return { sourceSpan, elements, glossary: sentenceGlossary, organized, needsContextReview, incomplete };
}

/** Organizes exact source clauses; qualifications always retain their parent sentence. */
export function explainText(text: string, context: ExplanationContext = {}): TextExplanation {
  const glossary = lookupGlossary(text, context);
  const sentences = sourceSentences(text).map(span => organizeSentence(text, span, glossary));
  const elements = sentences.flatMap((sentence) => sentence.elements);
  const hasHelpful = elements.some((element) => element.kind !== "original");
  // Clause classification is assistance, not proof that every meaning was explained.
  const fullyExplained = sentences.length > 0 && sentences.every((sentence) => {
    const term = sentence.glossary[0];
    return sentence.glossary.length === 1 && term?.status === "matched" &&
      sentence.sourceSpan.text.replace(/[。！？!?]+$/u, "") === term.term;
  });
  return {
    status: fullyExplained ? "explained" : hasHelpful ? "partial" : "original-only",
    original: text, sourceId: context.sourceId ?? null, sourceRevision: context.sourceRevision ?? 0,
    ruleVersion: "source-preserving-v2", context: { url: context.url, sourceId: context.sourceId, sourceRevision: context.sourceRevision }, sentences, elements, glossary,
    plainText: elements.map((element) => element.displayText).join("\n")
  };
}
