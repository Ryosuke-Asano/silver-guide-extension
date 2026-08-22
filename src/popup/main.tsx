import { createRoot } from "react-dom/client";
import "../shared/tokens.css";
import { PopupApp } from "./PopupApp";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("ポップアップの表示領域が見つかりません。");
}

createRoot(rootElement).render(<PopupApp />);
