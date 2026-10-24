import { useCallback, useEffect, useState } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { trpc } from "@/lib/trpc";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskWorkspace from "./pages/TaskWorkspace";
import Sandbox from "./pages/Sandbox";
import Integrations from "./pages/Integrations";
import Skills from "./pages/Skills";
import ApiKeys from "./pages/ApiKeys";
import Media from "./pages/Media";
import NotFound from "./pages/NotFound";

export default function App() {
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
    return <div className="login"><Loader2 className="spin" color="var(--violet)" /></div>;
  }
  const admin = me.data?.admin ?? false;
  if (!admin) {
    return <Login configured={me.data?.configured ?? false} onSignedIn={() => { refresh(); if (location === "/login") navigate("/"); }} />;
  }

  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}
