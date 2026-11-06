import { createBrowserRouter, Navigate } from "react-router-dom";
import { HomePage, DemoPage, MetricsPage, LoginPage, ReferenceTrackingPage, ReferenceComparisonPage } from "./LazyPages";
import { AppLayout } from "../layouts/AppLayout";
import { LandingPage } from "../pages/LandingPage";
import { NotFoundPage } from "../pages/NotFoundPage";
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/request", element: <HomePage /> },
      { path: "/start", element: <Navigate to="/request" replace /> },
      { path: "/demo", element: <DemoPage /> },
      { path: "/tracking", element: <ReferenceTrackingPage /> },
      { path: "/comparison", element: <ReferenceComparisonPage /> },
      { path: "/metrics", element: <MetricsPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/how-it-works", element: <Navigate to="/#how-it-works" replace /> },
      { path: "/about", element: <Navigate to="/#about" replace /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
