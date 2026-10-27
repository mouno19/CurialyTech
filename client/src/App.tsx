import { lazy, Suspense, useCallback, useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { RotateCcw } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { LoadingMark } from "@/components/brand/Logo";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { AppToaster } from "@/components/common/Toaster";
import { TooltipProvider } from "@/components/common/Tooltip";
import { AppShell } from "@/components/shell/AppShell";
import { trpc } from "@/lib/trpc";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskWorkspace from "./pages/TaskWorkspace";
import NotFound from "./pages/NotFound";

// Secondary screens load on first visit (smaller first bundle); the main flow stays in the entry chunk.
const Sandbox = lazy(() => import("./pages/Sandbox"));
const Media = lazy(() => import("./pages/Media"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Skills = lazy(() => import("./pages/Skills"));
const ApiKeys = lazy(() => import("./pages/ApiKeys"));

/** While a lazy screen loads, keep the shell on screen (it is cached, so this does not refetch). */
function RouteLoading() {
  return (
    <AppShell title="Loading…">
      <div className="page">
        <StateNotice variant="loading" size="lg" title="Opening…" />
      </div>
    </AppShell>
  );
}

export default function App() {
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={250}>
      <Gate />
      <AppToaster />
    </TooltipProvider>
  );
}

function Gate() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const [location, navigate] = useLocation();
  const refresh = useCallback(() => void me.refetch(), [me]);

  useEffect(() => {
    // Any API call that comes back 401 (expired session) sends the operator to sign in.
    const onUnauthorized = () => void me.refetch();
    window.addEventListener("curialy:unauthorized", onUnauthorized);
    return () => window.removeEventListener("curialy:unauthorized", onUnauthorized);
  }, [me]);

  if (me.isLoading) {
    return (
      <div className="screen-center">
        <LoadingMark size={44} label="Loading Curialy" />
      </div>
    );
  }
  if (!me.data && me.isError) {
    // auth.me answers every visitor, so an error here means the server could not be reached.
    return (
      <div className="screen-center grid-paper">
        <StateNotice
          variant="error"
          icon="mark"
          title="Can't reach Curialy"
          actions={<Button variant="primary" icon={RotateCcw} busy={me.isFetching} onClick={() => void me.refetch()}>Try again</Button>}
        >
          The server did not answer. Check your connection; if Curialy was just updated, it can take a few seconds to come back.
        </StateNotice>
      </div>
    );
  }
  if (!(me.data?.admin ?? false)) {
    return <Login configured={me.data?.configured ?? false} onSignedIn={() => { refresh(); if (location === "/login") navigate("/"); }} />;
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/login"><Redirect to="/" /></Route>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard">{() => <Redirect to={`/${window.location.search}`} />}</Route>
          <Route path="/tasks" component={Tasks} />
          <Route path="/tasks/:id">{params => <TaskWorkspace key={params.id} id={params.id} />}</Route>
          <Route path="/sandbox" component={Sandbox} />
          <Route path="/media" component={Media} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/skills" component={Skills} />
          <Route path="/keys" component={ApiKeys} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}
