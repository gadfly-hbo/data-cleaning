import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppShell } from "./AppShell.js";
import { UploadPage } from "./pages/UploadPage.js";
import { PipelinesPage } from "./pages/PipelinesPage.js";
import { DataSourcePage } from "./pages/DataSourcePage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { DatasetPage } from "./pages/DatasetPage.js";
import "./index.css";

const router = createBrowserRouter([
  { path: "/login", element: <Navigate to="/" replace /> },
  { path: "/setup", element: <Navigate to="/" replace /> },
  { path: "/change-password", element: <Navigate to="/" replace /> },
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <UploadPage /> },
      { path: "/pipelines", element: <PipelinesPage /> },
      { path: "/audit", element: <AuditPage /> },
      { path: "/sources", element: <DataSourcePage /> },
      { path: "/datasets/:id", element: <DatasetPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
