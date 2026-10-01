import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import "./styles.css";


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
