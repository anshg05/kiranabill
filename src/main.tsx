import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-paper text-ink font-body flex items-center justify-center">
      <h1 className="text-2xl font-semibold">KiranaBill</h1>
    </div>
  </StrictMode>,
);
