import { createRoot } from "react-dom/client";
import "../shared/tokens.css";
import { SidePanelApp } from "./SidePanelApp";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("サイドパネルの表示領域が見つかりません。");

createRoot(rootElement).render(<SidePanelApp />);
