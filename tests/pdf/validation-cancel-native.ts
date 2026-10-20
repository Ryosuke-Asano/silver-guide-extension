import {PDFDocument as GenuineDocument} from "pdf-lib";
import {fault,hold} from "./validation-cancel-fault";
export * from "pdf-lib";
export const PDFDocument=new Proxy(GenuineDocument,{get(target,key){
  if(key==="load")return(...args:Parameters<typeof GenuineDocument.load>)=>{const result=target.load(...args),state=fault();return state?.armed&&state.claimed&&state.phase==="native"&&!state.held?hold(result,state):result;};
  const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
}});
