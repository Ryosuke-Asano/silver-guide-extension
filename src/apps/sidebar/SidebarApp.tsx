import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { actionLabel, explainText, type ExplanationElement, type TextExplanation } from "../../features/reading/explanation";
import { getWebExtensionApi, type WebExtensionApi } from "../../shared/webextension";
import type { PanelContext } from "../../shared/v3-protocol";
import { usePanelContext, type PanelState } from "./usePanelContext";

const ELEMENT_LABELS: Record<ExplanationElement["kind"], string> = {
  conclusion: "結果・扱い", condition: "条件", action: "やること",
  exception: "例外・注意", deadline: "期限・期間", term: "言葉", original: "原文"
};

function Explanation({ explanation }: { explanation: TextExplanation }) {
  const incomplete = explanation.sentences.some(sentence => sentence.incomplete);
  const terms = [...new Map(explanation.glossary.map(term => [term.dictionaryId, term])).values()];
  const organized = explanation.sentences.map(sentence => {
    const items = new Map<string, { labels: string[]; text: string }>();
    for (const element of sentence.elements) {
      if (element.kind === "term" || element.kind === "original") continue;
      const label = element.kind === "action" ? actionLabel(element.sourceSpan.text) : ELEMENT_LABELS[element.kind];
      const key = `${element.sourceSpan.start}:${element.sourceSpan.end}`;
      const previous = items.get(key);
      if (previous) previous.labels.push(label);
      else items.set(key, { labels: [label], text: element.sourceSpan.text });
    }
    return { sentence, items: [...items.values()] };
  }).filter(item => item.items.length > 0);
  const singleTerm = !incomplete && organized.length === 0 && terms.length === 1;
  const definitions = terms.map(term => <section className="sidebar-term" key={term.dictionaryId}>
    <h2 className="sidebar-term-original">{term.term}</h2>
    <p>{term.explanation}</p>
  </section>);

  return <section className="sidebar-explanation" aria-labelledby="explanation-heading">
    <h1 id="explanation-heading">{incomplete ? "前後の文も選んでください" : explanation.status === "original-only" ? "説明" : organized.length > 0 ? "文章の説明" : singleTerm ? terms[0].term : "言葉の意味"}</h1>
    {incomplete ? <p>文の途中だけでは、何をするか説明できません。</p> : null}
    {explanation.status === "original-only" && !incomplete ? <>
      <p className="sidebar-result-notice" role="status">この言葉や文章の説明は見つかりません。</p>
      <p>前後の文章も合わせてご確認ください。</p>
    </> : null}
    {explanation.status !== "original-only" ? <>
      {organized.length > 0 ? <section className="sidebar-organization" aria-label="原文の整理">
        {organized.map(({ sentence, items }) => <div className="sidebar-sentence" key={sentence.sourceSpan.start}>
          {sentence.needsContextReview ? <p className="sidebar-context-notice">条件や例外の関係は、原文全体で確認してください。</p> : null}
          <dl>{items.map((item, index) => <div key={index}>
            <dt>{item.labels.join("・")}</dt><dd>{item.text}</dd>
          </div>)}</dl>
        </div>)}
      </section> : null}
      {singleTerm ? <p>{terms[0].explanation}</p> : terms.length > 0 ? organized.length > 0 || incomplete ? <details className="sidebar-terms">
        <summary>言葉の意味</summary>{definitions}
      </details> : definitions : null}
      {!incomplete && explanation.status === "partial" && organized.length > 0 ? <p className="sidebar-result-notice">一部を整理しました。条件や数字は、原文も確認してください。</p> : null}
    </> : null}
  </section>;
}

function ContextView({ context }: { context: PanelContext }) {
  const explanation = useMemo(() => context.status === "ready" && context.selection
    ? explainText(context.selection, { url: context.url, sourceId: context.documentToken ?? undefined, sourceRevision: context.generation })
    : null, [context.status, context.selection, context.url, context.documentToken, context.generation]);
  useEffect(() => {
    document.scrollingElement?.scrollTo?.({ top: 0 });
  }, [context.tabId, context.documentToken, context.generation]);

  const incomplete = explanation?.sentences.some(sentence => sentence.incomplete) ?? false;
  const selectionAnnouncement = explanation
    ? incomplete ? "説明したい文章を、前後も含めて選んでください。"
      : `${explanation.original.length <= 40 ? `「${explanation.original}」` : "選んだ文章"}の${explanation.status === "original-only" ? "説明は見つかりませんでした" : explanation.status === "partial" ? "一部を整理しました" : "説明を表示しました"}。`
    : "";

  if (!explanation) {
    if (context.status === "restricted") return <section className="sidebar-empty"><h1>このページでは文章や入力欄を読み取れません</h1><p>{context.notice ?? "通常のウェブページで、説明したい言葉や文章を選んでください。"}</p></section>;
    if (context.status === "too-long") return <section className="sidebar-empty"><h1>短い範囲を選んでください</h1><p>文章が長いため、説明する言葉や文章を5,000文字以内で選び直してください。</p></section>;
    return <section className="sidebar-empty"><h1>説明したい言葉や文章を選んでください</h1><p>{context.notice ?? "元のページで選ぶと、ここに説明が表示されます。"}</p></section>;
  }

  const original = <blockquote>{explanation.original}</blockquote>;
  return <>
    <p className="sidebar-screen-reader-status" role="status" aria-atomic="true">{selectionAnnouncement}</p>
    <Explanation key={`${context.documentToken}:${context.generation}`} explanation={explanation} />
    {explanation.status === "original-only" || incomplete ? <section className="sidebar-original" aria-labelledby="original-heading">
      <h2 id="original-heading">選んだ原文</h2>
      {original}
    </section> : <details className="sidebar-original sidebar-original-details" key={`source:${context.documentToken}:${context.generation}`}>
      <summary>原文を見る</summary>{original}
    </details>}
  </>;
}

export function SidebarView({ state, pdfHref, onOpenPdf, pdfError }: {
  state: PanelState; pdfHref: string; onOpenPdf?: (event: MouseEvent<HTMLAnchorElement>) => void; pdfError?: string | null;
}) {
  return <main className="silver-guide-sidebar" aria-label="選んだ文章の説明">
    <details className="sidebar-tools">
      <summary aria-label="その他の操作"><span aria-hidden="true">⋯</span></summary>
      <div className="sidebar-tools-menu">
        <a className="sidebar-pdf-link" href={pdfHref} target="_blank" rel="noopener noreferrer" onClick={onOpenPdf}>PDFを開く<span aria-hidden="true">↗</span></a>
      </div>
    </details>
    <div className="sidebar-content" aria-busy={state.loading}>
      {state.loading ? <p role="status">対象ページを確認しています…</p> : state.message ? <p role="status">{state.message}</p> : state.context ? <ContextView context={state.context} /> : null}
      {pdfError ? <p className="sidebar-pdf-error" role="alert">{pdfError}</p> : null}
    </div>
  </main>;
}

export function SidebarApp({ api = getWebExtensionApi() }: { api?: WebExtensionApi }) {
  const state = usePanelContext(api);
  const openingPdf = useRef(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfHref = api?.runtime.getURL("workspace.html") ?? "workspace.html";
  const openPdf = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!api || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (openingPdf.current) return;
    openingPdf.current = true;
    setPdfError(null);
    void api.tabs.create({ url: pdfHref, ...(state.context ? { windowId: state.context.windowId } : {}) })
      .then(async tab => {
        try {
          if (api.sidePanel && Number.isSafeInteger(tab.id) && Number(tab.id) >= 0) {
            // Keep the original page's panel available; hide it only on this PDF tab.
            await api.sidePanel.setOptions({ tabId: tab.id, enabled: false });
          } else if (!api.sidePanel && api.sidebarAction) {
            // Firefox 133+ supports closing a sidebar from its own document.
            // sidebarAction.close() would lose its required gesture after tabs.create.
            window.close();
          }
        } catch { /* The PDF tab is already open; a panel error must not report that opening failed. */ }
      }, () => setPdfError("PDFの画面を開けませんでした。もう一度「PDFを開く」を選んでください。"))
      .finally(() => { openingPdf.current = false; });
  };
  return <SidebarView state={state} pdfHref={pdfHref} onOpenPdf={openPdf} pdfError={pdfError} />;
}
