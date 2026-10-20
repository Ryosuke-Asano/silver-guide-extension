import {Component,type ReactNode} from "react";
export class WorkspaceBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main className="pdf-app"><section className="pdf-empty" role="alert"><h1>PDFの画面を表示できませんでした</h1><p>再読み込みすると、このタブの未保存の入力は失われます。すでに保存したPDFは保存先に残っています。</p><button type="button" className="primary" onClick={()=>location.reload()}>画面を読み込み直す</button></section></main>:this.props.children;}
}
