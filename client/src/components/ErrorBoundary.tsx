import { Component, type ErrorInfo, type ReactNode } from "react";
import { House, RotateCcw } from "lucide-react";
import { CurialyMark } from "@/components/brand/Logo";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** A new deploy replaces the chunk files an open tab still points at; a reload fixes that. */
const isChunkError = (error: Error) => /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(`${error.name} ${error.message}`);

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkError(error);
    return (
      <main className="screen-center grid-paper">
        <div className="card crash-card" role="alert">
          <CurialyMark size={40} />
          <h1 className="serif-title">{stale ? "Curialy was updated" : "Something went wrong"}</h1>
          <p className="muted">
            {stale
              ? "This tab is running an older version of the app. Reload to get the new one; your tasks keep running on the server."
              : "This page hit an unexpected error. Reload to try again; tasks keep running on the server. If it keeps happening, the details below help track it down."}
          </p>
          <div className="cluster">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} aria-hidden="true" /> Reload page
            </button>
            <a className="btn secondary" href="/">
              <House size={15} aria-hidden="true" /> Go to the dashboard
            </a>
          </div>
          {!stale && (
            <details className="crash-details">
              <summary>Error details</summary>
              <pre className="code-block">{error.stack || error.message}</pre>
            </details>
          )}
        </div>
      </main>
    );
  }
}

export default ErrorBoundary;
