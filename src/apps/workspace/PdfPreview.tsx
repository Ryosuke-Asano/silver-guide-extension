import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PdfSession } from "../../adapters/pdf";
import type { PdfAnswers, PdfBox,PdfExportOptions,PdfField, PdfPageInfo } from "../../domain/pdf";
import { quadToScreenBox,screenToPoint } from "./geometry";
import { derivePdfPreviewLocations, type PdfPreviewLocation } from "./pdf-preview-locations";
import { pdfFieldReadOnly } from "../../domain/pdf";

const EMPTY_LOCATIONS:PdfPreviewLocation[]=[];
const LOCATIONS_PER_LIST_PAGE=25;
const PREVIEW_DELAY_MS=300;
export type PdfLivePreview = { answers: PdfAnswers; answerStatus?: Record<string,string>; mode?:PdfExportOptions["mode"];actionRemovalConfirmed?:boolean;paused?: boolean };

export function PdfPreview({ session, pages, fields, selectedId, pageIndex, onPageChange, onSelect, onSelectLocation, title = "原本のPDF", drawing=false,onDraw,selectionPurpose="question",showRejected=false,compact=false,preview }: {
  session: PdfSession | null;
  pages: PdfPageInfo[];
  fields: PdfField[];
  selectedId: string | null;
  pageIndex: number;
  onPageChange: (index: number) => void;
  onSelect: (id: string) => void;
  onSelectLocation?: (id: string, pageIndex: number) => void;
  title?: string;
  drawing?:boolean;
  onDraw?:(pageIndex:number,box:PdfBox)=>void;
  selectionPurpose?:"question"|"inspection";
  showRejected?:boolean;
  compact?:boolean;
  preview?:PdfLivePreview;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renders=useRef(Promise.resolve());
  const [displayed,setDisplayed]=useState<{session:PdfSession;pageIndex:number;preview:boolean}|null>(null);
  const page = pages[pageIndex];
  const previewAnswers=preview?.answers,previewStatus=preview?.answerStatus,previewMode=preview?.mode,previewActionRemoval=preview?.actionRemovalConfirmed,previewPaused=preview?.paused??false,livePreview=preview!==undefined;
  const [drag,setDrag]=useState<{x0:number;y0:number;x1:number;y1:number}|null>(null);
  const dragRef=useRef<typeof drag>(null);
  const positionHeading=useRef<HTMLHeadingElement>(null),positionList=useRef<HTMLDivElement>(null),positionButtons=useRef(new Map<string,HTMLButtonElement>()),positionListId=useId(),pageStatusId=useId();
  const [listPage,setListPage]=useState(0),[jumpNumber,setJumpNumber]=useState(""),[listNotice,setListNotice]=useState(""),[jumpError,setJumpError]=useState(false);
  const [chosenLocation,setChosenLocation]=useState<{fieldId:string;key:string}|null>(null);
  const locationsByPage=useMemo(()=>derivePdfPreviewLocations(fields),[fields]);
  const allPageLocations=locationsByPage.get(pageIndex)??EMPTY_LOCATIONS;
  const locations=useMemo(()=>showRejected?allPageLocations:allPageLocations.filter(location=>location.field.mappingState!=="rejected"),[allPageLocations,showRejected]);
  const pageCount=Math.ceil(locations.length/LOCATIONS_PER_LIST_PAGE),effectiveListPage=Math.min(listPage,Math.max(0,pageCount-1));
  const firstLocation=effectiveListPage*LOCATIONS_PER_LIST_PAGE,listedLocations=locations.slice(firstLocation,firstLocation+LOCATIONS_PER_LIST_PAGE);
  const selectedLocation=chosenLocation?.fieldId===selectedId&&locations.some(location=>location.key===chosenLocation.key)?chosenLocation.key:locations.find(location=>location.field.id===selectedId)?.key??null;
  const chooseLocation=(location:PdfPreviewLocation)=>{if(drawing)return;setChosenLocation({fieldId:location.field.id,key:location.key});if(onSelectLocation)onSelectLocation(location.field.id,pageIndex);else onSelect(location.field.id);};
  useEffect(()=>{setListPage(0);setJumpNumber("");setListNotice("");setJumpError(false);},[pageIndex,showRejected]);
  useEffect(()=>{if(positionList.current)positionList.current.scrollTop=0;},[pageIndex,showRejected,effectiveListPage]);
  const pendingPositionFocus=useRef<string|null>(null);
  useEffect(()=>{const key=pendingPositionFocus.current;if(key&&positionButtons.current.has(key)){pendingPositionFocus.current=null;positionButtons.current.get(key)?.focus();}},[effectiveListPage,locations,listNotice]);
  const changeListPage=(next:number)=>{setListPage(next);setListNotice(`${next*LOCATIONS_PER_LIST_PAGE+1}番目からの位置を表示しました。`);positionHeading.current?.focus();};
  const findPosition=()=>{const number=Number(jumpNumber),index=locations.findIndex(location=>location.number===number);if(!Number.isInteger(number)||index<0){setJumpError(true);setListNotice("このページに表示している位置の番号を入力してください。対象外の位置は、項目一覧から対象外の候補を開くと確認できます。");return;}setJumpError(false);const key=locations[index].key,currentButton=positionButtons.current.get(key);if(currentButton){pendingPositionFocus.current=null;currentButton.focus();}else pendingPositionFocus.current=key;setListPage(Math.floor(index/LOCATIONS_PER_LIST_PAGE));setListNotice(`位置${number}のボタンへ移動しました。内容を確認してから選んでください。`);};
  useEffect(() => {
    const abort = new AbortController();
    if (!session || !canvas.current || !page) return;
    if(previewPaused){setBusy(true);return ()=>abort.abort();}
    setBusy(true); setError(null);
    // Native appearances and OCR/manual answers share the PDF writer's layout.
    // Render into a private canvas: a cancelled, slower result cannot paint over
    // a newer answer or a newly selected page. One job runs at a time per view.
    const schedule=()=>{
      renders.current=renders.current.catch(()=>{}).then(async()=>{
        if(abort.signal.aborted)return;
        const staging=document.createElement("canvas");
        try{
          const options={scale:zoom/100*1.4,signal:abort.signal};
          if(livePreview)await session.renderPreview(pageIndex,staging,{...options,fields,answers:previewAnswers!,answerStatus:previewStatus,mode:previewMode,actionRemovalConfirmed:previewActionRemoval,pageReviews:pages.map(item=>({pageIndex:item.index,review:item.review}))});
          else await session.render(pageIndex,staging,options);
          if(abort.signal.aborted||!canvas.current)return;
          const target=canvas.current,context=target.getContext("2d");
          if(!context)throw new Error("ページを表示する準備ができませんでした。");
          target.width=staging.width;target.height=staging.height;
          context.drawImage(staging,0,0);
          setDisplayed({session,pageIndex,preview:livePreview});
        }catch(cause){
          if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:livePreview?"入力をプレビューへ反映できませんでした。回答は残っています。":"ページを表示できませんでした。");
        }finally{
          staging.width=1;staging.height=1;
          if(!abort.signal.aborted)setBusy(false);
        }
      });
    };
    const timer=livePreview?setTimeout(schedule,PREVIEW_DELAY_MS):null;
    if(!livePreview)schedule();
    return () => {if(timer!==null)clearTimeout(timer);abort.abort();};
  }, [session, pageIndex, zoom, page,livePreview,previewAnswers,previewStatus,previewMode,previewActionRemoval,previewPaused,livePreview?fields:null,livePreview?pages:null]);

  useEffect(() => {
    if (!compact || busy) return;
    const scroll = viewport.current, mark = scroll?.querySelector<HTMLElement>(".pdf-field-overlay.selected");
    if (!scroll || !mark) return;
    const frame = scroll.getBoundingClientRect(), target = mark.getBoundingClientRect(), padding = 24;
    if (target.top < frame.top + padding) scroll.scrollTop += target.top - frame.top - padding;
    else if (target.bottom > frame.bottom - padding) scroll.scrollTop += target.height > frame.height - padding * 2 ? target.top - frame.top - padding : target.bottom - frame.bottom + padding;
    if (target.left < frame.left) scroll.scrollLeft += target.left - frame.left;
    else if (target.right > frame.right) scroll.scrollLeft += target.right - frame.right;
  }, [compact, selectedId, pageIndex, zoom, busy]);

  const displayedCurrent=displayed?.session===session&&displayed.pageIndex===pageIndex&&displayed.preview===livePreview;
  return <section className={`pdf-original${compact?" pdf-original-compact":""}${livePreview?" pdf-original-live":""}`} aria-label={title} data-pdf-preview-state={livePreview?(error?"error":busy?"updating":"ready"):"original"}>
    <div className="pdf-toolbar">
      <h2>{title}</h2>
      <div className="page-controls">
        {compact?<label className="page-number"><span className="visually-hidden">ページ番号</span><select aria-label="ページ番号" value={pageIndex} onChange={event=>onPageChange(Number(event.target.value))}>{pages.map(page=><option key={page.index} value={page.index}>{page.index+1} / {pages.length}</option>)}</select></label>:<>
        <button type="button" aria-label="前のページ" disabled={pageIndex === 0} aria-describedby={pageIndex===0?pageStatusId:undefined} onClick={() => onPageChange(pageIndex - 1)}>前</button>
        <label className="page-number"><span>ページ番号</span><input type="number" min={1} max={pages.length} value={pageIndex + 1} onChange={event => { const index = Number(event.target.value) - 1; if (Number.isInteger(index) && index >= 0 && index < pages.length) onPageChange(index); }} /><span>/ {pages.length}</span></label>
        <button type="button" aria-label="次のページ" disabled={pageIndex >= pages.length - 1} aria-describedby={pageIndex>=pages.length-1?pageStatusId:undefined} onClick={() => onPageChange(pageIndex + 1)}>次</button>
        </>}
        <label><span>{livePreview?"拡大率":"原本の拡大率"}</span><select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
      </div>
    </div>
    <p id={pageStatusId} className={compact?"visually-hidden":"pdf-page-status"}>{pages.length===1?"この書類は1ページです。":pageIndex===0?"先頭のページです。":pageIndex===pages.length-1?"最後のページです。":`${pageIndex+1}ページを表示しています。`}</p>
    {livePreview&&<p className="pdf-live-preview-note">{previewPaused?"日本語の変換を確定すると反映します。":busy?"入力を反映しています…":error?"プレビューを更新できていません。回答は残っています。":"入力した内容を表示しています。"}<span>ファイルへの保存は、最後の「PDFを保存」で行います。</span></p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {!compact&&locations.length>0&&<section className="pdf-position-picker" aria-label={`${pageIndex+1}ページの候補の位置を選ぶ`}>
      <h3 ref={positionHeading} id={positionListId} tabIndex={-1}>このページの位置を番号から選ぶ</h3>
      <p>小さな枠は大きなボタンから選べます。同名の項目は、位置番号と選択肢で区別してください。</p>
      <p>{pageIndex+1}ページ：{locations.length}か所。{firstLocation+1}〜{Math.min(firstLocation+LOCATIONS_PER_LIST_PAGE,locations.length)}番目を表示しています。{drawing&&"枠を指定している間は、位置の選択を停止しています。"}</p>
      {pageCount>1&&<div className="pdf-position-navigation"><button type="button" disabled={effectiveListPage===0||drawing} onClick={()=>changeListPage(effectiveListPage-1)}>前の25か所を表示</button><button type="button" disabled={effectiveListPage>=pageCount-1||drawing} onClick={()=>changeListPage(effectiveListPage+1)}>次の25か所を表示</button><label htmlFor={`${positionListId}-number`}>このページの位置番号</label><input id={`${positionListId}-number`} type="number" min={1} value={jumpNumber} aria-invalid={jumpError||undefined} aria-describedby={`${positionListId}-notice`} onChange={event=>{setJumpNumber(event.target.value);if(jumpError){setJumpError(false);setListNotice("");}}} disabled={drawing}/><button type="button" disabled={drawing} onClick={findPosition}>番号のボタンへ移動</button></div>}
      <div ref={positionList} className="pdf-position-list" role="group" aria-label={`${pageIndex+1}ページの大きな位置選択ボタン`}>{listedLocations.map(location=><button type="button" key={location.key} ref={node=>{if(node)positionButtons.current.set(location.key,node);else positionButtons.current.delete(location.key);}} data-field-id={location.field.id} data-location-key={location.key} data-placement-aliases={JSON.stringify(location.aliases)} aria-pressed={selectedLocation===location.key} disabled={drawing} onClick={()=>chooseLocation(location)}><span>位置{location.number}：{location.field.label}</span><span>項目{location.fieldNumber}{location.optionLabels.length>0&&`・選択肢：${location.optionLabels.join("／")}`}。{location.field.mappingState==="rejected"?"対象外の位置と内容を確認":selectionPurpose==="inspection"||pdfFieldReadOnly(location.field)?"原本の位置と内容を確認":"この位置の質問へ移動"}</span>{selectedLocation===location.key&&<span className="pdf-selection-label">選択中</span>}</button>)}</div>
      <p id={`${positionListId}-notice`} role="status" aria-live="polite">{listNotice}</p>
    </section>}
    <div ref={viewport} className="pdf-canvas-scroll" role="region" aria-busy={busy} tabIndex={0} aria-label={`${livePreview?"記入プレビュー":"原本"}の表示領域。拡大時はスクロールできます。`}>
      <div className={`pdf-page ${drawing?"drawing":""}`} style={{ width: `${zoom}%` }} onPointerDown={event=>{if(!drawing||!page)return;event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();const x=(event.clientX-rect.left)/rect.width,y=(event.clientY-rect.top)/rect.height;const next={x0:x,y0:y,x1:x,y1:y};dragRef.current=next;setDrag(next);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(!drawing||!dragRef.current)return;const rect=event.currentTarget.getBoundingClientRect();const next={...dragRef.current,x1:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y1:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};dragRef.current=next;setDrag(next);}} onPointerUp={()=>{if(!drawing||!dragRef.current||!page)return;const value=dragRef.current;dragRef.current=null;setDrag(null);const p=screenToPoint({x:value.x0,y:value.y0},page),q=screenToPoint({x:value.x1,y:value.y1},page);if(Math.abs(p.x-q.x)>=3&&Math.abs(p.y-q.y)>=3)onDraw?.(pageIndex,[Math.min(p.x,q.x),Math.min(p.y,q.y),Math.max(p.x,q.x),Math.max(p.y,q.y)]);}} onPointerCancel={()=>{dragRef.current=null;setDrag(null);}}>
        <canvas ref={canvas} style={{visibility:displayedCurrent?"visible":"hidden",...(page&&!displayedCurrent?{aspectRatio:`${page.widthPt} / ${page.heightPt}`}:{})}} aria-label={`${pageIndex + 1}ページの${livePreview?"記入プレビュー":"原書類"}`} />
        {drag&&<div aria-hidden="true" className="drawn-field" style={{left:`${Math.min(drag.x0,drag.x1)*100}%`,top:`${Math.min(drag.y0,drag.y1)*100}%`,width:`${Math.abs(drag.x1-drag.x0)*100}%`,height:`${Math.abs(drag.y1-drag.y0)*100}%`}}/>}
        {page && locations.filter(location=>!compact||location.field.id===selectedId).map(location => {
          const [x0, y0, x1, y1] = quadToScreenBox(location.placement.quad, page),field=location.field;
          if(compact)return <div aria-hidden="true" key={location.key} className="pdf-field-overlay selected" style={{ left:`${x0*100}%`,top:`${y0*100}%`,width:`${(x1-x0)*100}%`,height:`${(y1-y0)*100}%`,pointerEvents:"none" }}/>;
          return <button type="button" key={location.key} data-field-id={field.id} data-location-key={location.key} data-placement-aliases={JSON.stringify(location.aliases)} className={`pdf-field-overlay ${selectedLocation===location.key ? "selected" : ""}`} style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }} aria-label={`原書類の「${field.label}」。${pageIndex + 1}ページの位置${location.number}。${location.optionLabels.length?`選択肢：${location.optionLabels.join("／")}。`:""}${field.mappingState==="rejected"?"対象外の候補の位置と内容を確認":selectionPurpose==="inspection"||pdfFieldReadOnly(field)?"位置と内容を確認":"質問へ移動"}`} aria-pressed={selectedLocation===location.key} disabled={drawing} onClick={() => chooseLocation(location)} />;
        })}
      </div>
    </div>
    {!compact&&<p className="preview-caption">{busy ? "ページを表示しています…" : drawing?"記入する枠をドラッグで囲んでください。数値と移動ボタンでも指定できます。":locations.length?selectionPurpose==="inspection"?"枠と、このページの大きな位置選択ボタンは、同じ原本の位置と内容を確認します。":"枠が小さい・重なる場合は、このページの大きな位置選択ボタンを使って質問へ移動できます。":"このページには、現在表示している候補の位置がありません。"}</p>}
  </section>;
}
