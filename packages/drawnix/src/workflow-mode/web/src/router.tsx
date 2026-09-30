import { Router, createPath, Outlet, useRoutes, type Navigator } from "react-router-dom";
import { useSyncExternalStore } from "react";
import { getWorkflowNavigationSnapshot, navigateWorkflow, subscribeWorkflowNavigation } from "../../host/workflow-navigation";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import DocsPage from "@/pages/docs";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import BatchGenerationPage from "@/pages/batch-generation";

const routes = [
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <CanvasPage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/docs", element: <DocsPage /> },
            { path: "/batch-generation", element: <BatchGenerationPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
];

const workflowPath = (to: Parameters<Navigator["createHref"]>[0]) => "/workflow" + (typeof to === "string" ? to : createPath(to));
const navigator: Navigator = {
    createHref: workflowPath,
    go: (delta) => window.history.go(delta),
    push: (to, state) => navigateWorkflow(workflowPath(to), false, state),
    replace: (to, state) => navigateWorkflow(workflowPath(to), true, state),
};

function WorkflowPages() { return useRoutes(routes); }

export function WorkflowRouter() {
    const { href } = useSyncExternalStore(subscribeWorkflowNavigation, getWorkflowNavigationSnapshot);
    const url = new URL(href);
    return (
        <Router navigator={navigator} location={{ pathname: url.pathname.replace(/^\/workflow(?=\/|$)/, "") || "/", search: url.search, hash: url.hash, state: window.history.state?.usr }}>
            <WorkflowPages />
        </Router>
    );
}
