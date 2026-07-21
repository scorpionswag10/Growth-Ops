"use client";

import { use, useEffect, useState } from "react";
import { GrowthReport, ReportBody } from "@/components/report-view";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function PublicReportPage({
  params,
}: {
  params: Promise<{ locationId: string; token: string }>;
}) {
  const { locationId, token } = use(params);
  const [report, setReport] = useState<GrowthReport | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${API_URL}/report/${locationId}/${token}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setReport(await res.json());
    })();
  }, [locationId, token]);

  if (notFound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">This report is not available.</p>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-400">Loading your report…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-5">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {report.businessName} — Growth Report
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Last {report.periodDays} days · updated{" "}
            {new Date(report.generatedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </header>
        <ReportBody report={report} />
        <p className="mt-6 text-center text-[11px] text-slate-400">
          Prepared by GrowthOps — your growth department
        </p>
      </div>
    </main>
  );
}
