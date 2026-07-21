"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getAccessToken } from "@/lib/api";
import { LocationRow, useWorkspace } from "@/lib/workspace";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PAGE_SIZE = 25;

type AuditRow = {
  id: string;
  actorLabel: string;
  module: string;
  action: string;
  targetLabel: string | null;
  detail: string | null;
  createdAt: string;
};

function formatAction(action: string) {
  return action.replace(/_/g, " ");
}

export default function AuditLogPage() {
  const { location } = useWorkspace();
  const loc = location as LocationRow;

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [modules, setModules] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (moduleFilter) params.set("module", moduleFilter);
      if (actionFilter) params.set("action", actionFilter);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      params.set("take", String(PAGE_SIZE));
      params.set("skip", String(page * PAGE_SIZE));
      const result = await api<{ total: number; items: AuditRow[] }>(
        `/locations/${loc.id}/audit-logs?${params.toString()}`,
      );
      setRows(result.items);
      setTotal(result.total);
    } catch {
      setError("Couldn't load the audit log — you may need platform admin or owner/admin access.");
    } finally {
      setLoading(false);
    }
  }, [loc.id, q, moduleFilter, actionFilter, from, to, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<{ modules: string[]; actions: string[] }>(`/locations/${loc.id}/audit-logs/facets`)
      .then((f) => {
        setModules(f.modules);
        setActions(f.actions);
      })
      .catch(() => {});
  }, [loc.id]);

  useEffect(() => {
    setPage(0);
  }, [q, moduleFilter, actionFilter, from, to]);

  async function exportCsv() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (moduleFilter) params.set("module", moduleFilter);
    if (actionFilter) params.set("action", actionFilter);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    const res = await fetch(
      `${API_URL}/locations/${loc.id}/audit-logs/export?${params.toString()}`,
      { headers: { authorization: `Bearer ${getAccessToken()}` } },
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${loc.name.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const from_ = page * PAGE_SIZE;
  const to_ = Math.min(from_ + rows.length, total);

  return (
    <div className="h-screen overflow-y-auto p-6">
      <h1 className="text-lg font-bold text-slate-900">Audit Log — {loc.name}</h1>
      <p className="mt-0.5 text-xs text-slate-500">
        Admin-level actions taken on this location — invites, feature changes,
        automations, and contact deletions. Not a request log; it only
        records things a location admin would want to see &quot;who did
        this&quot; for.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
        <input
          className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          placeholder="Search actor, target, detail…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
        >
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{formatAction(a)}</option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="date"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          onClick={load}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
        <button
          onClick={exportCsv}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          Export CSV
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">Date &amp; time</th>
              <th className="px-4 py-2.5 font-medium">Actor</th>
              <th className="px-4 py-2.5 font-medium">Module</th>
              <th className="px-4 py-2.5 font-medium">Action</th>
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-4 py-2.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{r.actorLabel}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.module}</td>
                <td className="px-4 py-2.5 text-slate-600">{formatAction(r.action)}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.targetLabel ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.detail ?? "—"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No matching activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          {total === 0 ? "0 results" : `${from_ + 1}–${to_} of ${total}`}
        </span>
        <div className="flex gap-2">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={to_ >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
