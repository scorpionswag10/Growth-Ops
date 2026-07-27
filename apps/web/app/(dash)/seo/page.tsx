"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Finding = { severity: string; message: string; fix: string };

type AuditResult = {
  url: string;
  robots_txt?: { bots: { bot: string; status: string }[] };
  llms_txt?: { exists: boolean };
  sitemap?: { exists: boolean; url_count: number | null };
  https?: { enforced: boolean };
  on_page?: {
    title: string | null;
    title_length: number | null;
    meta_description: string | null;
    h1_count: number | null;
    word_count: number | null;
  };
  schema?: { found: string[]; commonly_missing: string[] };
  insights?: { agentic_browsing_score: number | null };
  findings: Finding[];
};

type AuditListItem = {
  id: string;
  url: string;
  score: number;
  createdAt: string;
};

type AuditDetail = AuditListItem & { result: AuditResult };

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200",
  HIGH: "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM: "bg-amber-100 text-amber-800 border-amber-200",
  LOW: "bg-slate-100 text-slate-600 border-slate-200",
};

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

function scoreColor(score: number) {
  if (score >= 90) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

export default function SeoPage() {
  const { location } = useWorkspace();
  const loc = location!;
  const featureOn = (loc.features ?? {}).seo === true;

  const [history, setHistory] = useState<AuditListItem[]>([]);
  const [selected, setSelected] = useState<AuditDetail | null>(null);
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!featureOn) return;
    try {
      setHistory(await api<AuditListItem[]>(`/locations/${loc.id}/seo-audits`));
    } catch {
      /* feature gate flips can race the first load */
    }
  }, [loc.id, featureOn]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function openAudit(id: string) {
    setError(null);
    try {
      setSelected(await api<AuditDetail>(`/locations/${loc.id}/seo-audits/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load that audit");
    }
  }

  async function runAudit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRunning(true);
    try {
      const audit = await api<AuditDetail>(`/locations/${loc.id}/seo-audits`, {
        method: "POST",
        body: { url },
      });
      setSelected(audit);
      setUrl("");
      await loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Audit failed");
    } finally {
      setRunning(false);
    }
  }

  if (!featureOn) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <p className="max-w-md rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
          SEO/AEO auditing is not enabled for this location yet — flip it on
          in Settings.
        </p>
      </div>
    );
  }

  const findingsBySeverity = selected
    ? SEVERITY_ORDER.map((sev) => ({
        sev,
        items: selected.result.findings.filter((f) => f.severity === sev),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="h-screen overflow-y-auto p-6">
      <h1 className="text-lg font-bold text-slate-900">SEO / AEO Audit</h1>
      <p className="mt-0.5 text-xs text-slate-500">
        Checks AI crawler access (GPTBot, ClaudeBot, PerplexityBot, and more),
        llms.txt, on-page SEO, schema markup, sitemap, HTTPS, and local SEO —
        live, on any real URL.
      </p>

      <form onSubmit={runAudit} className="mt-4 flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          placeholder="https://client-website.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button
          disabled={running}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? "Auditing…" : "Run Audit"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-6 grid grid-cols-[240px_1fr] gap-6">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            History
          </h2>
          <div className="mt-2 space-y-1">
            {history.length === 0 && (
              <p className="px-1 py-2 text-xs text-slate-400">
                No audits run yet.
              </p>
            )}
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => openAudit(h.id)}
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-50 ${
                  selected?.id === h.id ? "bg-slate-100" : ""
                }`}
              >
                <div className="truncate font-medium text-slate-700">{h.url}</div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>{new Date(h.createdAt).toLocaleDateString()}</span>
                  <span className={`font-semibold ${scoreColor(h.score)}`}>
                    {h.score}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected && (
            <p className="rounded-xl bg-white p-6 text-sm text-slate-400 shadow-sm">
              Run an audit or pick a past one from the history list.
            </p>
          )}
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {selected.result.url}
                  </div>
                  <div className="text-xs text-slate-400">
                    {new Date(selected.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className={`text-3xl font-bold ${scoreColor(selected.score)}`}>
                  {selected.score}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <StatChip
                  label="AI crawlers allowed"
                  value={`${
                    selected.result.robots_txt?.bots.filter(
                      (b) => b.status === "ALLOWED",
                    ).length ?? 0
                  }/${selected.result.robots_txt?.bots.length ?? 0}`}
                />
                <StatChip
                  label="llms.txt"
                  value={selected.result.llms_txt?.exists ? "Found" : "Missing"}
                  good={selected.result.llms_txt?.exists}
                />
                <StatChip
                  label="HTTPS enforced"
                  value={selected.result.https?.enforced ? "Yes" : "No"}
                  good={selected.result.https?.enforced}
                />
                <StatChip
                  label="Schema types found"
                  value={String(selected.result.schema?.found?.length ?? 0)}
                  good={(selected.result.schema?.found?.length ?? 0) > 0}
                />
              </div>

              <div className="rounded-xl bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Findings</h3>
                <div className="mt-2 space-y-2">
                  {findingsBySeverity.map((group) => (
                    <div key={group.sev}>
                      {group.items.map((f, i) => (
                        <div
                          key={i}
                          className={`mt-2 rounded-lg border px-3 py-2 text-xs ${SEVERITY_STYLES[f.severity] ?? SEVERITY_STYLES.LOW}`}
                        >
                          <div className="font-semibold">{f.severity}</div>
                          <div className="mt-0.5">{f.message}</div>
                          <div className="mt-1 text-slate-600">Fix: {f.fix}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {selected.result.findings.length === 0 && (
                    <p className="text-xs text-slate-400">No issues found.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-3 text-center shadow-sm">
      <div
        className={`text-sm font-bold ${
          good === undefined ? "text-slate-900" : good ? "text-emerald-600" : "text-red-600"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">{label}</div>
    </div>
  );
}
