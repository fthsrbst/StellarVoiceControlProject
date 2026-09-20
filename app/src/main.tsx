import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import { PanelRoot } from "@/panels/PanelRoot";
import { parsePanelRoute } from "@/panels/panelRoutes";
import "@/index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root container missing from index.html");
}

// Every window loads this same bundle; Rust selects the window with the URL hash
// (`app/src-tauri/src/panels.rs`). No hash is the notch overlay, unchanged.
const route = parsePanelRoute(window.location.hash);

createRoot(container).render(
  <StrictMode>
    {route.kind === "panel" ? <PanelRoot panel={route.panel} /> : <App />}
  </StrictMode>,
);