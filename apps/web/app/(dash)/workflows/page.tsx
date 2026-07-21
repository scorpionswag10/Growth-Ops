"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type CatalogItem = { key: string; name: string; description: string; trigger: string };
type Workflow = {
  id: string;
  name: string;
  trigger: string;
  status: "ACTIVE" | "PAUSED";
  stopOnReply: boolean;
  _count: { executions: number };
};
type Execution = {
  id: string;
  status: string;
  currentStep: number;
  resumeAt: string | null;
  createdAt: string;
  contact: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
};

const TRIGGER_LABELS: Record<string, string> = {
  CONTACT_CREATED: "New lead arrives",
  APPOINTMENT_BOOKED: "Appointment booked",
  APPOINTMENT_NO_SHOW: "Appointment no-show",
  APPOINTMENT_CANCELLED: "Appointment cancelled",
  APPOINTMENT_COMPLETED: "Appointment completed",
  MANUAL: "Manual enrollment",
};

const EXEC_STYLES: Record<string, string> = {
  RUNNING: "bg-sky-100 text-sky-800",
  WAITING: "bg-amber-100 text-amber-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
  FAILED: "bg-red-100 text-red-700",
};

export default function WorkflowsPage() {
  const { location } = useWorkspace();
  const loc = location!;
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [error, setError] = useState<string | null>(null);

  const featureOn = (loc.features ?? {}).workflows === true;

  const load = useCallback(async () => {
    const [cat, wfs] = await Promise.all([
      api<CatalogItem[]>(`/locations/${loc.id}/workflows/catalog`),
      api<Workflow[]>(`/locations/${loc.id}/workflows`),
    ]);
    setCatalog(cat);
    setWorkflows(wfs);
  }, [loc.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addFromTemplate(key: string) {
    setError(null);
    try {
      await api(`/locations/${loc.id}/workflows/from-template/${key}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function toggle(wf: Workflow) {
    await api(`/locations/${loc.id}/workflows/${wf.id}`, {
      method: "PATCH",
      body: { status: wf.status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
    });
    await load();
  }

  async function openExecutions(wfId: string) {
    if (expanded === wfId) {
      setExpanded(null);
      return;
    }
    setExecutions(await api<Execution[]>(`/locations/${loc.id}/workflows/${wfId}/executions`));
    setExpanded(wfId);
  }

  const installedKeys = new Set(workflows.map((w) => w.name));

  return (
    <div className="h-screen overflow-y-auto p-6">
      <h1 className="text-lg font-bold text-slate-900">Automations</h1>
      {!featureOn && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Automations are built but not yet enabled for this location — flip the
          switch in Settings to make triggers live. You can still install and
          review them here.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <section className="mt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Installed
        </h2>
        <div className="mt-2 space-y-2">
          {workflows.map((wf) => (
            <div key={wf.id} className="rounded-xl bg-white shadow-sm">
              <div className="flex items-center justify-between p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{wf.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Trigger: {TRIGGER_LABELS[wf.trigger] ?? wf.trigger}
                    {wf.stopOnReply ? " · stops when the contact replies" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openExecutions(wf.id)}
                    className="text-xs text-slate-500 underline-offset-2 hover:underline"
                  >
                    {wf._count.executions} run{wf._count.executions === 1 ? "" : "s"}
                  </button>
                  <button
                    onClick={() => toggle(wf)}
                    className={`h-6 w-11 rounded-full p-0.5 transition-colors ${
                      wf.status === "ACTIVE" ? "bg-emerald-600" : "bg-slate-300"
                    }`}
                    aria-label={`Toggle ${wf.name}`}
                  >
                    <span
                      className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        wf.status === "ACTIVE" ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
              {expanded === wf.id && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {executions.length === 0 && (
                    <p className="text-xs text-slate-400">No runs yet.</p>
                  )}
                  {executions.map((ex) => (
                    <div key={ex.id} className="flex items-center justify-between py-1.5 text-xs">
                      <span className="text-slate-700">
                        {[ex.contact.firstName, ex.contact.lastName].filter(Boolean).join(" ") ||
                          ex.contact.email ||
                          ex.contact.phone}
                      </span>
                      <span className="text-slate-400">
                        step {ex.currentStep}
                        {ex.resumeAt
                          ? ` · resumes ${new Date(ex.resumeAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                          : ""}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${EXEC_STYLES[ex.status] ?? ""}`}>
                        {ex.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {workflows.length === 0 && (
            <p className="text-xs text-slate-400">
              Nothing installed yet — add automations from the library below.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Automation library
        </h2>
        <div className="mt-2 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {catalog.map((t) => (
            <div key={t.key} className="flex flex-col rounded-xl bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-slate-900">{t.name}</div>
              <p className="mt-1 flex-1 text-xs text-slate-500">{t.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {TRIGGER_LABELS[t.trigger] ?? t.trigger}
                </span>
                <button
                  onClick={() => addFromTemplate(t.key)}
                  disabled={installedKeys.has(t.name)}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {installedKeys.has(t.name) ? "Installed" : "Install"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
