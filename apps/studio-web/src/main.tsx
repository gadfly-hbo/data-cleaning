import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import { UploadPage } from "./pages/UploadPage.js";
import { DatasetPage } from "./pages/DatasetPage.js";
import "./index.css";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <UploadPage /> },
      { path: "/datasets/:id", element: <DatasetPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
