// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PdfPreview} from "../../src/apps/workspace/PdfPreview";
import type {PdfSession,PdfRenderResult} from "../../src/adapters/pdf";
import {makeManualPdfField,type PdfAnswers,type PdfPageInfo} from "../../src/domain/pdf";

const page:PdfPageInfo={index:0,label:"1",mediaBox:[0,0,595,842],cropBox:[0,0,595,842],visibleBox:[0,0,595,842],rotation:0,userUnit:1,widthPt:595,heightPt:842,extraction:"native",review:"inputs-confirmed"};
const rendered:PdfRenderResult={width:595,height:842,pdfToViewport:[1,0,0,-1,0,842],viewportToPdf:[1,0,0,-1,0,842]};
let root:Root,container:HTMLDivElement;
let drawImage:ReturnType<typeof vi.fn>,clearRect:ReturnType<typeof vi.fn>;

beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);
  drawImage=vi.fn();clearRect=vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockImplementation((()=>({drawImage,clearRect})) as typeof HTMLCanvasElement.prototype.getContext);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const field=()=>({...makeManualPdfField(0,[80,620,360,665],"氏名"),id:"name"});
const marked=(canvas:HTMLCanvasElement,answers:PdfAnswers)=>{canvas.width=595;canvas.height=842;canvas.dataset.answer=String(answers.name??"");return rendered;};
const copied=()=>drawImage.mock.calls.map(call=>(call[0] as HTMLCanvasElement).dataset.answer);
const delay=async()=>act(async()=>{await vi.advanceTimersByTimeAsync(350);});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((accept,fail)=>{resolve=accept;reject=fail;});return{promise,resolve,reject};}

describe("live PDF preview rendering",()=>{
  it("toggles the exact PDF choice and exposes its checked state without enabling ambiguous or protected targets",async()=>{
    const choice={...field(),kind:"select" as const,multiple:true,options:[{id:"new",label:"新規登録",exportValue:"new",placements:field().placements},{id:"renew",label:"登録更新",exportValue:"renew",placements:makeManualPdfField(0,[380,620,400,640]).placements}]};
    choice.placements=choice.options.flatMap(option=>option.placements);
    const onToggleChoice=vi.fn(),session={renderPreview:vi.fn(async(_index:number,canvas:HTMLCanvasElement,options:{answers:PdfAnswers})=>marked(canvas,options.answers)),render:vi.fn()} as unknown as PdfSession;
    const render=async(fields=[choice],disabled=false)=>act(async()=>root.render(<PdfPreview compact session={session} pages={[page]} fields={fields} selectedId="name" pageIndex={0} onPageChange={()=>{}} onSelect={()=>{}} onToggleChoice={onToggleChoice} choicesDisabled={disabled} preview={{answers:{name:["new"]}}}/>));
    await render();const boxes=()=>[...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    expect(boxes().map(box=>box.getAttribute("aria-checked"))).toEqual(["true","false"]);
    await act(async()=>{boxes()[1].click();});expect(onToggleChoice).toHaveBeenCalledExactlyOnceWith("name","renew");
    await render([choice],true);await act(async()=>{boxes()[0].click();});expect(onToggleChoice).toHaveBeenCalledTimes(1);
    await render([{...choice,readOnly:true}]);expect(boxes()).toHaveLength(0);
    await render([{...choice,options:choice.options.map(option=>({...option,placements:choice.placements.slice(0,1)})),placements:choice.placements.slice(0,1)}]);expect(boxes()).toHaveLength(0);
  });
  it("debounces rapid edits into the latest answer snapshot and copies only completed renders",async()=>{
    const fields=[field()],renderPreview=vi.fn(async(_index:number,canvas:HTMLCanvasElement,options:{answers:PdfAnswers})=>marked(canvas,options.answers));
    const session={renderPreview,render:vi.fn()} as unknown as PdfSession;
    const render=async(value:string)=>act(async()=>root.render(<PdfPreview compact session={session} pages={[page]} fields={fields} selectedId="name" pageIndex={0} onPageChange={()=>{}} onSelect={()=>{}} preview={{answers:{name:value}}}/>));
    await render("山");await render("山田");await render("山田 花子");expect(renderPreview).not.toHaveBeenCalled();await delay();
    expect(renderPreview).toHaveBeenCalledTimes(1);expect(renderPreview.mock.calls[0][2].answers).toEqual({name:"山田 花子"});expect(copied()).toEqual(["山田 花子"]);
    expect(container.querySelector(".pdf-canvas-scroll")?.getAttribute("aria-busy")).toBe("false");expect(container.querySelectorAll(".pdf-toolbar button")).toHaveLength(0);
  });
  it("serializes slow renders and never commits a stale answer to the displayed canvas",async()=>{
    const fields=[field()],first=deferred<PdfRenderResult>(),second=deferred<PdfRenderResult>();
    const renderPreview=vi.fn((_index:number,canvas:HTMLCanvasElement,options:{answers:PdfAnswers})=>{marked(canvas,options.answers);return options.answers.name==="old"?first.promise:second.promise;});
    const session={renderPreview,render:vi.fn()} as unknown as PdfSession;
    const render=async(value:string)=>act(async()=>root.render(<PdfPreview compact session={session} pages={[page]} fields={fields} selectedId="name" pageIndex={0} onPageChange={()=>{}} onSelect={()=>{}} preview={{answers:{name:value}}}/>));
    await render("old");await delay();expect(renderPreview).toHaveBeenCalledTimes(1);await render("new");await delay();expect(renderPreview).toHaveBeenCalledTimes(1);
    await act(async()=>{first.resolve(rendered);});expect(copied()).toEqual([]);expect(renderPreview).toHaveBeenCalledTimes(2);
    await act(async()=>{second.resolve(rendered);});expect(copied()).toEqual(["new"]);expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("keeps the last completed preview and exposes a rendering failure without losing answers",async()=>{
    const fields=[field()],answers={name:"保持する氏名"},before=structuredClone(answers),renderPreview=vi.fn(async(_index:number,canvas:HTMLCanvasElement,options:{answers:PdfAnswers})=>marked(canvas,options.answers));
    const session={renderPreview,render:vi.fn()} as unknown as PdfSession;
    const render=async(value:PdfAnswers)=>act(async()=>root.render(<PdfPreview compact session={session} pages={[page]} fields={fields} selectedId="name" pageIndex={0} onPageChange={()=>{}} onSelect={()=>{}} preview={{answers:value}}/>));
    await render(answers);await delay();expect(copied()).toEqual(["保持する氏名"]);const clears=clearRect.mock.calls.length;
    renderPreview.mockRejectedValueOnce(new Error("プレビューを作成できませんでした。"));await render({name:"新しい氏名"});await delay();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("プレビューを作成できませんでした。");expect(copied()).toEqual(["保持する氏名"]);expect(clearRect).toHaveBeenCalledTimes(clears);expect(answers).toEqual(before);
    await render({name:"再試行した氏名"});await delay();expect(copied()).toEqual(["保持する氏名","再試行した氏名"]);expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("suspends pending rendering while Japanese IME composition is active and resumes with the committed value",async()=>{
    const fields=[field()],renderPreview=vi.fn(async(_index:number,canvas:HTMLCanvasElement,options:{answers:PdfAnswers})=>marked(canvas,options.answers));
    const session={renderPreview,render:vi.fn()} as unknown as PdfSession;
    const render=async(value:string,paused:boolean)=>act(async()=>root.render(<PdfPreview compact session={session} pages={[page]} fields={fields} selectedId="name" pageIndex={0} onPageChange={()=>{}} onSelect={()=>{}} preview={{answers:{name:value},paused}}/>));
    await render("",false);await render("や",true);await delay();await render("やまだ",true);await delay();expect(renderPreview).not.toHaveBeenCalled();
    await render("山田",false);await delay();expect(renderPreview).toHaveBeenCalledTimes(1);expect(copied()).toEqual(["山田"]);
  });
  it("uses the current page and zoom without dropping the previously entered answer snapshot",async()=>{
    const fields=[field()],answers={name:"山田 花子"},pages=[page,{...page,index:1,label:"2",rotation:90 as const,widthPt:842,heightPt:595}];
    const renderPreview=vi.fn(async(_index:number,canvas:HTMLCanvasElement,options:{answers:PdfAnswers;scale?:number})=>marked(canvas,options.answers));
    const session={renderPreview,render:vi.fn()} as unknown as PdfSession;
    const render=async(index:number)=>act(async()=>root.render(<PdfPreview compact session={session} pages={pages} fields={fields} selectedId="name" pageIndex={index} onPageChange={()=>{}} onSelect={()=>{}} preview={{answers}}/>));
    await render(0);await delay();const zoom=container.querySelectorAll<HTMLSelectElement>(".page-controls select")[1];
    await act(async()=>{zoom.value="150";zoom.dispatchEvent(new Event("change",{bubbles:true}));});await delay();expect(renderPreview.mock.calls.at(-1)?.[2].answers).toEqual(answers);expect(renderPreview.mock.calls.at(-1)?.[2].scale).toBeCloseTo(2.1);
    await render(1);await delay();expect(renderPreview.mock.calls.at(-1)?.[0]).toBe(1);expect(renderPreview.mock.calls.at(-1)?.[2].answers).toEqual(answers);expect(renderPreview.mock.calls.at(-1)?.[2].scale).toBeCloseTo(2.1);expect(copied()).toEqual(["山田 花子","山田 花子","山田 花子"]);
  });
});
