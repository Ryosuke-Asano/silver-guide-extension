import {getDocument as genuineGetDocument} from "pdfjs-dist/legacy/build/pdf.mjs";
import type {PDFDocumentLoadingTask,PDFDocumentProxy,PDFPageProxy} from "pdfjs-dist/types/src/display/api";
import {fault,hold,type ValidationFault} from "./validation-cancel-fault";
export * from "pdfjs-dist/legacy/build/pdf.mjs";

function pageProxy(page:PDFPageProxy,state:ValidationFault):PDFPageProxy{
  return new Proxy(page,{get(target,key){
    if(key==="getTextContent"||key==="getOperatorList")return(...args:unknown[])=>{const method=Reflect.get(target,key,target) as(...args:unknown[])=>Promise<unknown>,result=method.apply(target,args);return state.phase===(key==="getTextContent"?"text":"operators")&&!state.held?hold(result,state):result;};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
}
function documentProxy(document:PDFDocumentProxy,state:ValidationFault):PDFDocumentProxy{
  return new Proxy(document,{get(target,key){if(key==="getPage")return(index:number)=>{const result=target.getPage(index).then(page=>pageProxy(page,state));return state.phase==="page"&&!state.held?hold(result,state):result;};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
}
export const getDocument:typeof genuineGetDocument=(source)=>{
  const loading=genuineGetDocument(source),state=fault();if(!state?.armed||state.claimed)return loading;state.claimed=true;
  if(typeof source==="object"&&source!==null&&"worker"in source)state.worker=source.worker??null;
  const opened=loading.promise.then(document=>documentProxy(document,state));
  return new Proxy(loading,{get(target,key){
    if(key==="promise")return state.phase==="loading"&&!state.held?hold(opened,state):opened;
    if(key==="destroy")return()=>{state.destroyCalls++;const result=target.destroy();void result.catch(()=>{});if(state.destroyNever){if(!state.held){state.held=true;queueMicrotask(state.onHeld);}return new Promise<void>(()=>{});}return result;};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }}) as PDFDocumentLoadingTask;
};
