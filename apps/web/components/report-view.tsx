"use client";

import { useMemo, useRef, useState } from "react";

export type GrowthReport = {
  businessName: string;
  periodDays: number;
  generatedAt: string;
  leads: { current: number; previous: number; bySource: { source: string; count: number }[] };
  appointments: {
    booked: number;
    previousBooked: number;
    completed: number;
    noShows: number;
    showRatePct: number | null;
  };
  revenue: { wonInPeriod: number; openPipeline: number };
  messages: { inbound: number; outbound: number };
  daily: { date: string; leads: number; appointments: number }[];
};

// Validated palette (dataviz reference instance, light mode, white surface).
const SERIES = { leads: "#2a78d6", appointments: "#eb6834" };
const INK = { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781" };
const GRID = "#e1e0d9";
const GOOD = "#006300";

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  const pct = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  const up = current >= previous;
  return (
    <span
      className="text-xs font-semibold"
      style={{ color: up ? GOOD : "#d03b3b" }}
    >
      {up ? "▲" : "▼"} {pct === null ? "new" : `${Math.abs(pct)}%`}
      <span className="ml-1 font-normal" style={{ color: INK.muted }}>
        vs prior {`period`}
      </span>
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { current: number; previous: number };
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="text-xs font-medium" style={{ color: INK.secondary }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold" style={{ color: INK.primary }}>
        {value}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        {delta && <Delta current={delta.current} previous={delta.previous} />}
        {sub && (
          <span className="text-xs" style={{ color: INK.muted }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

const W = 720;
const H = 220;
const PAD = { top: 16, right: 96, bottom: 28, left: 36 };

export function LeadsChart({ daily }: { daily: GrowthReport["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { paths, maxY, points } = useMemo(() => {
    const maxY = Math.max(2, ...daily.map((d) => Math.max(d.leads, d.appointments)));
    const x = (i: number) =>
      PAD.left + (i / Math.max(1, daily.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom);
    const line = (key: "leads" | "appointments") =>
      daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d[key])}`).join("");
    return {
      maxY,
      paths: { leads: line("leads"), appointments: line("appointments") },
      points: daily.map((d, i) => ({
        x: x(i),
        yLeads: y(d.leads),
        yAppts: y(d.appointments),
        ...d,
      })),
    };
  }, [daily]);

  function onMove(e: React.MouseEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.x - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  const h = hover !== null ? points[hover] : null;
  const yTicks = [0, Math.ceil(maxY / 2), maxY];

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: INK.primary }}>
          Leads and appointments per day
        </h3>
        <div className="flex gap-4 text-xs" style={{ color: INK.secondary }}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES.leads }} />
            New leads
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES.appointments }} />
            Appointments
          </span>
        </div>
      </div>
      <div className="relative mt-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {yTicks.map((t) => {
            const y = PAD.top + (1 - t / maxY) * (H - PAD.top - PAD.bottom);
            return (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                <text x={PAD.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill={INK.muted}>
                  {t}
                </text>
              </g>
            );
          })}
          {[0, Math.floor(points.length / 2), points.length - 1].map((i) =>
            points[i] ? (
              <text key={i} x={points[i].x} y={H - 8} textAnchor="middle" fontSize={10} fill={INK.muted}>
                {new Date(`${points[i].date}T12:00:00`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            ) : null,
          )}

          <path d={paths.leads} fill="none" stroke={SERIES.leads} strokeWidth={2} strokeLinejoin="round" />
          <path d={paths.appointments} fill="none" stroke={SERIES.appointments} strokeWidth={2} strokeLinejoin="round" />

          {points.length > 0 && (
            <>
              <text
                x={points[points.length - 1].x + 8}
                y={points[points.length - 1].yLeads + 3}
                fontSize={11}
                fontWeight={600}
                fill={INK.secondary}
              >
                Leads
              </text>
              <text
                x={points[points.length - 1].x + 8}
                y={points[points.length - 1].yAppts + (Math.abs(points[points.length - 1].yAppts - points[points.length - 1].yLeads) < 14 ? 17 : 3)}
                fontSize={11}
                fontWeight={600}
                fill={INK.secondary}
              >
                Appts
              </text>
            </>
          )}

          {h && (
            <g>
              <line x1={h.x} x2={h.x} y1={PAD.top} y2={H - PAD.bottom} stroke={INK.muted} strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={h.x} cy={h.yLeads} r={4.5} fill={SERIES.leads} stroke="#ffffff" strokeWidth={2} />
              <circle cx={h.x} cy={h.yAppts} r={4.5} fill={SERIES.appointments} stroke="#ffffff" strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(h.x / W) * 100}%`,
              transform: h.x > W * 0.6 ? "translateX(-110%)" : "translateX(12px)",
              borderColor: GRID,
              color: INK.secondary,
            }}
          >
            <div className="font-semibold" style={{ color: INK.primary }}>
              {new Date(`${h.date}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES.leads }} />
              {h.leads} lead{h.leads === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES.appointments }} />
              {h.appointments} appointment{h.appointments === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SourceBreakdown({
  bySource,
}: {
  bySource: { source: string; count: number }[];
}) {
  const max = Math.max(1, ...bySource.map((s) => s.count));
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold" style={{ color: INK.primary }}>
        Where leads came from
      </h3>
      <div className="mt-3 space-y-2.5">
        {bySource.map((s) => (
          <div key={s.source}>
            <div className="flex justify-between text-xs">
              <span style={{ color: INK.secondary }}>{s.source}</span>
              <span className="font-semibold" style={{ color: INK.primary }}>
                {s.count}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full" style={{ background: "#f0efec" }}>
              <div
                className="h-2 rounded-full"
                style={{ width: `${(s.count / max) * 100}%`, background: SERIES.leads }}
              />
            </div>
          </div>
        ))}
        {bySource.length === 0 && (
          <p className="text-xs" style={{ color: INK.muted }}>
            No leads in this period yet.
          </p>
        )}
      </div>
    </div>
  );
}

export function ReportBody({ report }: { report: GrowthReport }) {
  const r = report;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="New leads"
          value={String(r.leads.current)}
          delta={{ current: r.leads.current, previous: r.leads.previous }}
        />
        <StatTile
          label="Appointments booked"
          value={String(r.appointments.booked)}
          delta={{ current: r.appointments.booked, previous: r.appointments.previousBooked }}
        />
        <StatTile
          label="Show rate"
          value={r.appointments.showRatePct === null ? "—" : `${r.appointments.showRatePct}%`}
          sub={
            r.appointments.showRatePct === null
              ? "No finished appointments yet"
              : `${r.appointments.completed} completed · ${r.appointments.noShows} no-shows`
          }
        />
        <StatTile
          label="Revenue won"
          value={`$${r.revenue.wonInPeriod.toLocaleString()}`}
          sub={`$${r.revenue.openPipeline.toLocaleString()} in open pipeline`}
        />
      </div>
      <LeadsChart daily={r.daily} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SourceBreakdown bySource={r.leads.bySource} />
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold" style={{ color: INK.primary }}>
            Conversations handled
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold" style={{ color: INK.primary }}>
                {r.messages.inbound}
              </div>
              <div className="text-xs" style={{ color: INK.secondary }}>
                Customer messages received
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ color: INK.primary }}>
                {r.messages.outbound}
              </div>
              <div className="text-xs" style={{ color: INK.secondary }}>
                Replies and follow-ups sent
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
