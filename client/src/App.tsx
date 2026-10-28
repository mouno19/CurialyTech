import { lazy, Suspense, useCallback, useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { RotateCcw } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { LoadingMark } from "@/components/brand/Logo";
import { Button } from "@/components/common/Button";
import { StateNotice } from "@/components/common/StateNotice";
import { AppToaster } from "@/components/common/Toaster";
import { TooltipProvider } from "@/components/common/Tooltip";
import { AppShell, rescueFocusOnNextShell } from "@/components/shell/AppShell";
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
const Admin = lazy(() => import("./pages/Admin"));
// The public homepage has its own chunk and stylesheet.
const Landing = lazy(() => import("./pages/Landing"));

function Splash() {
  return (
    <div className="screen-center">
      <LoadingMark size={44} label="Loading Curialy" />
    </div>
  );
}

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
  const [, navigate] = useLocation();

  // Login waits for this, so it never sits on "Signing in…" when the session didn't take.
  const signedIn = useCallback(async () => {
    rescueFocusOnNextShell();
    const result = await me.refetch();
    if (result.data?.user) return;
    // A failed refetch keeps the previous (signed-out) data, so tell the two cases apart by the error.
    throw new Error(result.isError
      ? "The password was accepted, but the server couldn't confirm the session. Check your connection, then sign in again."
      : "The password was accepted, but this browser didn't keep the session. Allow cookies for this site, then sign in again.");
  }, [me]);

  useEffect(() => {
    // Any API call that comes back 401 (expired session) asks to sign in again. Signed out, "/" is
    // the public homepage, so a session that ends on the dashboard goes to the sign-in page instead.
    const onUnauthorized = () => {
      const wasSignedIn = Boolean(me.data?.user);
      void me.refetch().then(result => {
        if (wasSignedIn && result.data && !result.data.user && window.location.pathname === "/") navigate("/login", { replace: true });
      });
    };
    window.addEventListener("curialy:unauthorized", onUnauthorized);
    return () => window.removeEventListener("curialy:unauthorized", onUnauthorized);
  }, [me, navigate]);

  if (me.isLoading) return <Splash />;
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
  const admin = me.data?.admin ?? false;
  if (!me.data?.user) {
    // Visitors get the homepage at "/"; every other address asks them to sign in (and stays put,
    // so a shared task link opens after signing in).
    // After signing in, auth.me is fetched again; the signed-in routes then take over (and send
    // /login to the dashboard), so nothing else shows in between.
    const signIn = <Login configured={me.data?.configured ?? false} github={me.data?.github ?? false} signupsOpen={me.data?.signupsOpen ?? true} onSignedIn={signedIn} />;
    return (
      <ErrorBoundary>
        <Switch>
          <Route path="/"><Suspense fallback={<Splash />}><Landing signedIn={false} /></Suspense></Route>
          <Route path="/welcome"><Suspense fallback={<Splash />}><Landing signedIn={false} /></Suspense></Route>
          <Route>{signIn}</Route>
        </Switch>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/login"><Redirect to="/" /></Route>
          <Route path="/" component={Dashboard} />
          <Route path="/welcome"><Landing signedIn /></Route>
          <Route path="/dashboard">{() => <Redirect to={`/${window.location.search}`} />}</Route>
          <Route path="/tasks" component={Tasks} />
          <Route path="/tasks/:id">{params => <TaskWorkspace key={params.id} id={params.id} />}</Route>
          <Route path="/sandbox" component={Sandbox} />
          <Route path="/media" component={Media} />
          <Route path="/integrations" component={Integrations} />
          <Route path="/skills" component={Skills} />
          {/* The operator's pages: other accounts land on the dashboard. */}
          <Route path="/keys">{admin ? <ApiKeys /> : <Redirect to="/" />}</Route>
          <Route path="/admin">{admin ? <Admin /> : <Redirect to="/" />}</Route>
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </ErrorBoundary>
  );
}
