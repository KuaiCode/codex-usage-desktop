import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import "./styles.css";
import { isTauri } from "@tauri-apps/api/core";

if (isTauri() && navigator.platform.startsWith("Mac")) {
  document.documentElement.dataset.platform = "macos";
}

async function renderApp() {
  if (import.meta.env.MODE === "e2e") {
    await import("@wdio/tauri-plugin");
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void renderApp();
