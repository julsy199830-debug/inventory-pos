import type { ReactNode } from "react";
import Sidebar from "./_components/Sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-6 py-8 sm:px-8 lg:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
