import type { ReactNode } from "react";

export function SimulatorLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[1680px] gap-4 p-4 lg:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
        <div className="rounded-lg border border-line bg-panel">{sidebar}</div>
      </aside>
      <main className="min-w-0 space-y-4">{children}</main>
    </div>
  );
}

export function ValidationMessage({ message }: { message: string | null }) {
  return message ? <p className="px-4 py-3 text-xs text-down">{message}</p> : null;
}
