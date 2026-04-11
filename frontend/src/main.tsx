import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";

// Global CSS for the spinner animation (can't be done with inline styles alone)
const styleEl = document.createElement("style");
styleEl.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Tighten up Google Maps Autocomplete dropdown z-index when inside sidebar */
  .pac-container {
    z-index: 9999 !important;
  }

  button:hover:not(:disabled) {
    filter: brightness(0.93);
  }

  input:focus {
    border-color: #2E7D32 !important;
  }
`;
document.head.appendChild(styleEl);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
