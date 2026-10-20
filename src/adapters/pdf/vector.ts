import { rectToQuad, quadToBox, type PdfAffine, type PdfBox } from "../../domain/pdf";
import { multiply, transformPoint, transformQuad } from "./geometry";

export type PdfOperatorData={fnArray:ArrayLike<number>;argsArray:ArrayLike<unknown[]>};
type Edge={position:number;start:number;end:number};
/** Actual stroked path edges, never a multi-path bounding box, define a cell. */
export function inspectVectorGeometry(list:PdfOperatorData,ops:Record<string,number>,userUnit=1):{boxes:PdfBox[];images:PdfBox[];underlines:PdfBox[]}{
  if(!Number.isFinite(userUnit)||userUnit<=0)throw new Error("INVALID_USER_UNIT");
  const initial:PdfAffine=[userUnit,0,0,userUnit,0,0];let current:PdfAffine=[...initial],annotationDepth=0;const stack:PdfAffine[]=[],primitive:PdfBox[]=[],images:PdfBox[]=[],horizontal:Edge[]=[],vertical:Edge[]=[],underlineEdges:Edge[]=[];
  const transformedBox=(box:PdfBox)=>quadToBox(transformQuad(current,rectToQuad(box)));
  const addEdge=(a:[number,number],b:[number,number])=>{const p=transformPoint(current,{x:a[0],y:a[1]}),q=transformPoint(current,{x:b[0],y:b[1]});if(Math.abs(p.y-q.y)<.75&&Math.abs(p.x-q.x)>5)horizontal.push({position:(p.y+q.y)/2,start:Math.min(p.x,q.x),end:Math.max(p.x,q.x)});else if(Math.abs(p.x-q.x)<.75&&Math.abs(p.y-q.y)>5)vertical.push({position:(p.x+q.x)/2,start:Math.min(p.y,q.y),end:Math.max(p.y,q.y)});};
  const addUnderlineEdge=(a:[number,number],b:[number,number])=>{const p=transformPoint(current,{x:a[0],y:a[1]}),q=transformPoint(current,{x:b[0],y:b[1]});if(Math.abs(p.y-q.y)<.75&&Math.abs(p.x-q.x)>5)underlineEdges.push({position:(p.y+q.y)/2,start:Math.min(p.x,q.x),end:Math.max(p.x,q.x)});};
  const strokes=new Set([ops.stroke,ops.closeStroke,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke]);
  for(let i=0;i<list.fnArray.length;i++){
    const fn=list.fnArray[i],args=list.argsArray[i];if(fn===ops.beginAnnotation){annotationDepth++;continue;}if(fn===ops.endAnnotation){annotationDepth=Math.max(0,annotationDepth-1);continue;}if(annotationDepth)continue;
    if(fn===ops.save){stack.push([...current]);continue;}if(fn===ops.restore){current=stack.pop()??[...initial];continue;}if(fn===ops.transform){current=multiply(current,args as PdfAffine);continue;}if(fn===ops.paintFormXObjectBegin){stack.push([...current]);if(args[0])current=multiply(current,args[0] as PdfAffine);continue;}if(fn===ops.paintFormXObjectEnd){current=stack.pop()??[...initial];continue;}
    if([ops.paintImageXObject,ops.paintInlineImageXObject,ops.paintImageMaskXObject].includes(fn)){images.push(transformedBox([0,0,1,1]));continue;}if(fn!==ops.constructPath)continue;
    const path=Array.isArray(args[1])?args[1][0]:null;if(!path||typeof path!=="object"||!("length"in path))continue;
    const data=Array.from(path as ArrayLike<number>);let first:[number,number]|null=null,last:[number,number]|null=null,points:Array<[number,number]>=[],curved=false,hasCurve=false,hasClose=false,malformed=false,subpathCount=0;const stroke=strokes.has(Number(args[0])),implicitClose=[ops.closeStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(Number(args[0])),candidateLines:Array<[[number,number],[number,number]]>=[],candidateBars:Array<[[number,number],[number,number]]>=[];
    // A glyph contour contributes cell boundary evidence, but its individual
    // horizontal edges are not standalone answer lines. Preserve subpath
    // closure/curvature until the complete stroke can be classified.
    const finishOpenStroke=()=>{if(stroke&&!curved&&points.length>=2){const transformed=points.map(p=>transformPoint(current,{x:p[0],y:p[1]}));if(transformed.every(p=>Math.abs(p.y-transformed[0].y)<.75))candidateLines.push([points[0],points.at(-1)!]);}};
    for(let j=0;j<data.length;){const command=data[j++];if(command===0){finishOpenStroke();if(points.length>1||curved)subpathCount++;const x=data[j++],y=data[j++];first=last=Number.isFinite(x)&&Number.isFinite(y)?[x,y]:null;if(!last)malformed=true;points=last?[last]:[];curved=false;}
      else if(command===1){const next:[number,number]=[data[j++],data[j++]];if(!next.every(Number.isFinite)){last=null;malformed=true;continue;}if(stroke&&last)addEdge(last,next);last=next;points.push(next);}
      else if(command===2||command===3){const count=command===2?6:4;last=[data[j+count-2],data[j+count-1]];if(j+count>data.length||!data.slice(j,j+count).every(Number.isFinite))malformed=true;j+=count;curved=hasCurve=true;}
      else if(command===4){hasClose=true;if(points.length>1||curved)subpathCount++;if(stroke&&last&&first)addEdge(last,first);if(!curved&&points.length>=4){const xs=[...new Set(points.map(p=>p[0]))],ys=[...new Set(points.map(p=>p[1]))];if(xs.length===2&&ys.length===2){const raw:[number,number,number,number]=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],box=transformedBox(raw),w=box[2]-box[0],h=box[3]-box[1];if(stroke&&w>5&&h>5)primitive.push(box);else if(!stroke&&w>5&&h<=2){const a:[number,number]=[raw[0],(raw[1]+raw[3])/2],b:[number,number]=[raw[2],(raw[1]+raw[3])/2];addEdge(a,b);candidateBars.push([a,b]);}else if(!stroke&&h>5&&w<=2)addEdge([(raw[0]+raw[2])/2,raw[1]],[(raw[0]+raw[2])/2,raw[3]]);}}first=last=null;points=[];curved=false;}else{malformed=true;break;}
    }if(points.length>1||curved)subpathCount++;if(stroke&&first&&last&&(Number(args[0])===ops.closeStroke||Number(args[0])===ops.closeFillStroke||Number(args[0])===ops.closeEOFillStroke))addEdge(last,first);else finishOpenStroke();
    if(!malformed&&!hasCurve){if(stroke&&!hasClose&&!implicitClose&&candidateLines.length===subpathCount)for(const [a,b]of candidateLines)addUnderlineEdge(a,b);else if(!stroke&&subpathCount===1&&candidateBars.length===1)for(const [a,b]of candidateBars)addUnderlineEdge(a,b);}
  }
  const merge=(edges:Edge[])=>{const result:Edge[]=[];for(const edge of edges.sort((a,b)=>a.position-b.position||a.start-b.start)){const found=result.find(item=>Math.abs(item.position-edge.position)<.75&&edge.start<=item.end+1&&edge.end>=item.start-1);if(found){found.start=Math.min(found.start,edge.start);found.end=Math.max(found.end,edge.end);}else result.push({...edge});}return result;};
  const hs=merge(horizontal),vs=merge(vertical),boxes:PdfBox[]=[];
  const divided=(box:PdfBox)=>hs.some(edge=>edge.position>box[1]+1&&edge.position<box[3]-1&&edge.start<=box[0]+1&&edge.end>=box[2]-1)||vs.some(edge=>edge.position>box[0]+1&&edge.position<box[2]-1&&edge.start<=box[1]+1&&edge.end>=box[3]-1);
  const add=(box:PdfBox)=>{if(!divided(box)&&!boxes.some(old=>old.every((value,index)=>Math.abs(value-box[index])<1)))boxes.push(box);};
  for(const box of primitive)add(box);
  // Adjacent supporting horizontal boundaries are the only possible cells for
  // a pair of vertical sides. Partial dividers preserve real merged cells.
  for(let left=0;left<vs.length;left++)for(let right=left+1;right<vs.length;right++){const a=vs[left],b=vs[right];if(b.position-a.position<7)continue;const low=Math.max(a.start,b.start),high=Math.min(a.end,b.end);if(high-low<7)continue;const boundaries=hs.filter(edge=>edge.start<=a.position+1&&edge.end>=b.position-1&&edge.position>=low-1&&edge.position<=high+1).sort((x,y)=>x.position-y.position);for(let row=1;row<boundaries.length;row++){const y0=boundaries[row-1].position,y1=boundaries[row].position;if(y1-y0>6)add([a.position,y0,b.position,y1]);}}
  const underlines:PdfBox[]=[],addUnderline=(start:number,end:number,y:number,standalone:boolean)=>{const span=end-start;if(standalone?span>=7:span>30)underlines.push([start,y+1,end,y+1+Math.min(22,span)]);};for(const edge of merge(underlineEdges)){const covered=boxes.filter(box=>Math.abs(edge.position-box[1])<2||Math.abs(edge.position-box[3])<2).map(box=>[Math.max(edge.start,box[0]),Math.min(edge.end,box[2])] as const).filter(([start,end])=>end>start).sort((a,b)=>a[0]-b[0]);const standalone=covered.length===0;let cursor=edge.start;for(const [start,end]of covered){addUnderline(cursor,start,edge.position,standalone);cursor=Math.max(cursor,end);}addUnderline(cursor,edge.end,edge.position,standalone);}
  const raw=(b:PdfBox)=>b.map(n=>n/userUnit) as PdfBox;return {boxes:boxes.map(raw),images:images.map(raw),underlines:underlines.map(raw)};
}
