import { Link, useLocation } from "wouter";
import { ListTodo } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { StateNotice } from "@/components/common/StateNotice";

export default function NotFound() {
  const [location] = useLocation();
  return (
    <AppShell title="Page not found">
      <div className="page">
        <StateNotice
          variant="empty"
          icon="mark"
          size="lg"
          title="This page doesn't exist"
          actions={
            <>
              <Link href="/" className="btn primary">Back to the dashboard</Link>
              <Link href="/tasks" className="btn secondary"><ListTodo size={15} aria-hidden="true" /> Open tasks</Link>
            </>
          }
        >
          Nothing lives at <code className="mono break-anywhere">{location}</code>. The link may be outdated, or the page has moved.
        </StateNotice>
      </div>
    </AppShell>
  );
}
