import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import { assertSupportedTransport } from "./api/config";
import "./styles/tailwind.css";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/reference-pages.css";
import "./styles/reference-final.css";
import "./styles/reference-responsive.css";
import "./styles/approved-board.css";
import "./styles/landing-page.css";
import "./styles/light-mode.css";
import "./styles/simple-experience.css";

assertSupportedTransport();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
