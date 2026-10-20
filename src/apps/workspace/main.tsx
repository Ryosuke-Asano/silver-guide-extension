import { createRoot } from "react-dom/client";
import { WorkspaceApp } from "./WorkspaceApp";
import {WorkspaceBoundary} from "./WorkspaceBoundary";
import "../../shared/tokens.css";
import "./pdf-workspace.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<WorkspaceBoundary><WorkspaceApp /></WorkspaceBoundary>);
