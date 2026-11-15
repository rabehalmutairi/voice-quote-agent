import { lazy } from "react";

export const HomePage = lazy(() => import("../pages/HomePage").then((module) => ({ default: module.HomePage })));
export const DemoPage = lazy(() => import("../pages/DemoPage").then((module) => ({ default: module.DemoPage })));
export const MetricsPage = lazy(() => import("../pages/MetricsPage").then((module) => ({ default: module.MetricsPage })));
export const LoginPage = lazy(() => import("../pages/LoginPage").then((module) => ({ default: module.LoginPage })));
export const ReferenceTrackingPage = lazy(() => import("../pages/ReferencePages").then((module) => ({ default: module.ReferenceTrackingPage })));
export const ReferenceComparisonPage = lazy(() => import("../pages/ReferencePages").then((module) => ({ default: module.ReferenceComparisonPage })));
