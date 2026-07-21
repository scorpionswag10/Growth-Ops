"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace, WorkspaceProvider } from "@/lib/workspace";

const NAV = [
  { href: "/inbox", label: "Inbox" },
  { href: "/contacts", label: "Contacts" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/calendar", label: "Calendar" },
  { href: "/workflows", label: "Automations" },
  { href: "/social", label: "Social" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, locations, location, setLocationId, reloadLocations, logout } =
    useWorkspace();
  const pathname = usePathname();
  const [newLocName, setNewLocName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function createLocation(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const loc = await api<{ id: string }>("/locations", {
        method: "POST",
        body: { name: newLocName },
      });
      await reloadLocations();
      setLocationId(loc.id);
      setNewLocName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col bg-slate-900 text-slate-200">
        <div className="px-5 py-5">
          <div className="text-base font-bold tracking-tight text-white">
            GrowthOps CRM
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-400">
            {me.email}
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                pathname.startsWith(item.href)
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 px-3 pb-5">
          {locations.length > 0 && (
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
              value={location?.id ?? ""}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={logout}
            className="w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {location ? (
          children
        ) : (
          <div className="flex h-full items-center justify-center">
            <form
              onSubmit={createLocation}
              className="w-full max-w-sm rounded-xl bg-white p-6 shadow"
            >
              <h2 className="text-sm font-semibold text-slate-900">
                Create your first client location
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                A location is one client business. Everything — contacts,
                conversations, pipelines — lives inside it.
              </p>
              <input
                className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                placeholder="Business name"
                value={newLocName}
                onChange={(e) => setNewLocName(e.target.value)}
                required
              />
              {error && (
                <p className="mt-2 text-xs text-red-600">{error}</p>
              )}
              <button className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                Create location
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DashLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
