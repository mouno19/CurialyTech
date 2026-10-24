import { Link } from "wouter";
import { Compass } from "lucide-react";
import { AppShell, EmptyState } from "@/components/shell/AppShell";

export default function NotFound() {
  return (
    <AppShell title="Not found">
      <div className="page">
        <EmptyState icon={Compass} title="This page does not exist">
          <Link href="/" className="btn sm" style={{ marginTop: 12 }}>Back to the dashboard</Link>
        </EmptyState>
      </div>
    </AppShell>
  );
}
