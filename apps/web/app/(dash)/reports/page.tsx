"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { GrowthReport, ReportBody } from "@/components/report-view";

const PERIODS = [7, 30, 90];

export default function ReportsPage() {
  const { location } = useWorkspace();
  const loc = location!;
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<GrowthReport | null>(null);

  const load = useCallback(async () => {
    setReport(await api<GrowthReport>(`/locations/${loc.id}/report?days=${days}`));
  }, [loc.id, days]);

  useEffect(() => {
    load();
  }, [load]);

  const shareUrl = `${typeof window === "undefined" ? "" : window.location.origin}/report/${loc.id}/${loc.reportToken}`;

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">Growth report</h1>
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setDays(p)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                days === p
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:border-emerald-500"
              }`}
            >
              Last {p} days
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Client link (live, read-only):{" "}
        <a href={shareUrl} target="_blank" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
          {shareUrl}
        </a>
      </p>

      <div className="mt-4">
        {report ? (
          <ReportBody report={report} />
        ) : (
          <p className="text-sm text-slate-400">Loading report…</p>
        )}
      </div>
    </div>
  );
}
