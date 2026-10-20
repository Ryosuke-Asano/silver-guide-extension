import { useEffect, useRef, useState } from "react";
import { BookIcon } from "../../shared/icons";
import { PDF_MAX_INPUT_BYTES } from "../../domain/pdf";
import { usePdfWorkspace } from "./usePdfWorkspace";
import { PdfWorkspace } from "./PdfWorkspace";
import { PdfPasswordDialog } from "./PdfPasswordDialog";

type Controller = ReturnType<typeof usePdfWorkspace>;
const processingStates = new Set(["loading", "analyzing", "exporting", "validating", "downloading"]);

export function WorkspaceApp() {
  const pdf = usePdfWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const processing = processingStates.has(pdf.state);
  const unsaved = !!pdf.task && pdf.task.revision > 1 && pdf.task.stage !== "saved";
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const task = pdf.taskRef.current;
      if (task && task.revision > 1 && task.stage !== "saved") { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pdf.taskRef]);
  const open = (file: File) => {
    if (processing) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { pdf.setError("PDFファイルを選んでください。"); return; }
    if (file.size > PDF_MAX_INPUT_BYTES) { pdf.setError("PDF は 100MiB 以下のファイルを選んでください。"); return; }
    if (unsaved && !window.confirm("別のPDFを開くと、このタブの未保存の入力は失われます。別のPDFを開きますか？")) return;
    void pdf.open(file, file.name);
  };
  const progressText = pdf.state === "loading" ? "PDFを開いています…" : pdf.state === "analyzing" ? "記入する項目を読み取っています…" : pdf.state === "validating" ? "保存するPDFを確認しています…" : pdf.state === "downloading" ? "保存先を選んでください…" : "PDFを作成しています…";
  return <main className={`pdf-app${dragging ? " pdf-app-dragging" : ""}`} onDragOver={event => {
    if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); if (!processing) setDragging(true); }
  }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => {
    event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) open(file);
  }}>
    <header className="pdf-app-header"><div className="pdf-brand"><BookIcon/><span>Silver Guide</span></div><h1>PDFに記入</h1>{pdf.task && <button type="button" className="pdf-open-another" disabled={processing} onClick={() => fileInput.current?.click()}>別のPDFを開く</button>}</header>
    <input ref={fileInput} type="file" accept=".pdf,application/pdf" className="visually-hidden" tabIndex={-1} aria-label="開くPDFファイル" onChange={event => { const file = event.target.files?.[0]; if (file) open(file); event.target.value = ""; }}/>
    <div className="pdf-app-status" aria-live="polite" aria-atomic="true">
      {processing ? <div className="pdf-processing" role="status"><div><p>{progressText}</p>{pdf.progress && <><progress max={Math.max(1,pdf.progress.total)} value={pdf.progress.completed}/><small>{pdf.progress.pageIndex !== undefined ? `${pdf.progress.pageIndex+1}ページ　` : ""}{pdf.progress.detail}</small></>}</div><button type="button" onClick={pdf.cancel}>中止</button></div> : <>
        {pdf.error && <p className="pdf-entry-error" role="alert">{pdf.error}</p>}
        {pdf.notice && <p role="status">{pdf.notice}</p>}
      </>}
    </div>
    {pdf.task ? <>
      {pdf.task.analysis.document.capabilities.export.allowed === false && <p className="pdf-document-warning" role="status">{pdf.task.analysis.document.capabilities.export.reason} 原本の内容を確認できます。</p>}
      {pdf.task.analysis.document.actionDependent && pdf.task.analysis.document.capabilities.export.allowed && <section className="pdf-document-warning"><p>このPDFには計算・検証機能があります。保存すると、その機能と編集可能な入力欄を取り除いた印刷用PDFになります。</p><label className="check-row"><input type="checkbox" checked={pdf.task.actionRemovalConfirmed} disabled={processing} onChange={event => pdf.update(() => ({ actionRemovalConfirmed: event.target.checked, exportMode: "print" }))}/>印刷用PDFとして保存する</label></section>}
      {pdf.task.fields.some(field=>field.native&&!field.placements.length) && <p className="pdf-document-warning">表示位置のない項目は、元の内容を保ったまま記入対象から外しています。</p>}
      {!pdf.task.analysis.complete && !pdf.reanalysisDiff && <div className="pdf-analysis-warning"><p>読み取れていないページがあります。記入済みの回答を残して読み取り直せます。</p><button type="button" disabled={processing} onClick={() => void pdf.retryPages()}>読み取り直す</button></div>}
      {pdf.reanalysisDiff && <ReanalysisReview key={`${pdf.reanalysisDiff.taskId}-${pdf.reanalysisDiff.baseRevision}`} controller={pdf}/>}
      <PdfWorkspace controller={pdf}/>
    </> : <section className="pdf-empty" aria-busy={processing}><div className="pdf-empty-icon"><BookIcon/></div><h2>PDFを開いて、ひとつずつ記入</h2><p>原本を見ながら回答し、最後に記入済みPDFを保存します。</p><button type="button" className="primary" disabled={processing} onClick={() => fileInput.current?.click()}>PDFを開く</button><p className="pdf-empty-note">PDFをここへドラッグしても開けます。<br/>100MiB・100ページまで</p><p className="pdf-memory-note">書類と入力は、このタブの中だけで扱います。<br/>再読み込みやタブを閉じる前に、PDFを保存してください。</p></section>}
    {pdf.passwordRequest && <PdfPasswordDialog key={pdf.passwordRequest.requestId} request={pdf.passwordRequest} onResolve={pdf.providePassword}/>}
  </main>;
}

function ReanalysisReview({ controller }: { controller: Controller }) {
  const diff = controller.reanalysisDiff!;
  const [selected, setSelected] = useState(() => diff.changes.filter(change => !change.protected).map(change => change.id));
  return <section className="pdf-reanalysis" aria-label="読み取り直した結果"><h2>読み取り直した結果</h2><p>{diff.changes.length ? "変更する項目だけ選んで採用します。入力済みの回答は保持します。" : "項目の変更はありませんでした。"}</p>
    {!!diff.changes.length && <details><summary>変更される項目を確認（{diff.changes.length}件）</summary>{diff.changes.map(change => <label className="check-row" key={change.id}><input type="checkbox" checked={selected.includes(change.id)} onChange={event => setSelected(current => event.target.checked ? [...current,change.id] : current.filter(id => id !== change.id))}/><span>{change.kind === "added" ? "追加" : change.kind === "removed" ? "対象外に変更" : "修正"}：{change.candidate?.label ?? change.previous?.label}{change.protected && <small>回答や修正のある項目です。</small>}</span></label>)}</details>}
    <div className="pdf-reanalysis-actions"><button type="button" onClick={controller.rejectReanalysis}>元のまま続ける</button><button type="button" className="primary" onClick={() => controller.acceptReanalysis(selected)}>読み取り結果を採用</button></div>
  </section>;
}
