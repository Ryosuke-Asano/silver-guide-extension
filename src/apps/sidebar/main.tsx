import { createRoot } from "react-dom/client";
import { SidebarApp } from "./SidebarApp";
import "../../shared/tokens.css";
import "./sidebar.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<SidebarApp />);
