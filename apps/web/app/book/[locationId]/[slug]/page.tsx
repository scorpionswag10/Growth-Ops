"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Info = {
  businessName: string;
  calendarName: string;
  slotDurationMin: number;
  timezone: string;
};

type Slot = { startsAt: string; endsAt: string };

function dstr(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function PublicBookingPage({
  params,
}: {
  params: Promise<{ locationId: string; slug: string }>;
}) {
  const { locationId, slug } = use(params);
  const base = `${API_URL}/book/${locationId}/${slug}`;

  const [info, setInfo] = useState<Info | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Captured once on load so a client-side nav (day/time picks) never loses
  // the campaign that brought this visitor here.
  const utm = useMemo(() => {
    if (typeof window === "undefined") return {};
    const p = new URLSearchParams(window.location.search);
    const pick = (k: string) => p.get(k) || undefined;
    return {
      utmSource: pick("utm_source"),
      utmMedium: pick("utm_medium"),
      utmCampaign: pick("utm_campaign"),
      utmContent: pick("utm_content"),
      utmTerm: pick("utm_term"),
    };
  }, []);

  const loadSlots = useCallback(async () => {
    const from = new Date();
    const to = new Date(Date.now() + 13 * 86_400_000);
    const res = await fetch(`${base}/slots?from=${dstr(from)}&to=${dstr(to)}`);
    if (res.ok) setSlots(await res.json());
  }, [base]);

  useEffect(() => {
    (async () => {
      const res = await fetch(base);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setInfo(await res.json());
      await loadSlots();
    })();
  }, [base, loadSlots]);

  const days = useMemo(() => {
    const byDay = new Map<string, Slot[]>();
    for (const s of slots) {
      const day = new Date(s.startsAt).toLocaleDateString("en-CA", {
        timeZone: info?.timezone,
      });
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    return byDay;
  }, [slots, info]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startsAt: selectedSlot.startsAt,
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          ...utm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          Array.isArray(data?.message)
            ? data.message.join("; ")
            : (data?.message ?? "Booking failed"),
        );
        await loadSlots();
        return;
      }
      setConfirmation(data.localTime);
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">This booking page is not available.</p>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-400">Loading…</p>
      </main>
    );
  }

  if (confirmation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
          <h1 className="text-lg font-bold text-slate-900">You&apos;re booked</h1>
          <p className="mt-2 text-sm text-slate-600">
            {info.businessName} — {info.calendarName}
          </p>
          <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {confirmation}
          </p>
          <p className="mt-4 text-xs text-slate-400">
            Need to change it? Contact {info.businessName} directly.
          </p>
        </div>
      </main>
    );
  }

  const daySlots = selectedDay ? (days.get(selectedDay) ?? []) : [];

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {info.businessName}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {info.calendarName} · {info.slotDurationMin} minutes
          </p>

          <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pick a day
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {[...days.keys()].map((day) => (
              <button
                key={day}
                onClick={() => {
                  setSelectedDay(day);
                  setSelectedSlot(null);
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  selectedDay === day
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500"
                }`}
              >
                {new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </button>
            ))}
            {days.size === 0 && (
              <p className="text-xs text-slate-400">
                No openings in the next two weeks.
              </p>
            )}
          </div>

          {selectedDay && (
            <>
              <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pick a time ({info.timezone})
              </h2>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {daySlots.map((s) => (
                  <button
                    key={s.startsAt}
                    onClick={() => setSelectedSlot(s)}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                      selectedSlot?.startsAt === s.startsAt
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:border-emerald-500"
                    }`}
                  >
                    {new Date(s.startsAt).toLocaleTimeString("en-US", {
                      timeZone: info.timezone,
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </button>
                ))}
              </div>
            </>
          )}

          {selectedSlot && (
            <form onSubmit={book} className="mt-6 space-y-3 border-t border-slate-100 pt-6">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                placeholder="Your name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  placeholder="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}
              <button
                disabled={busy}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy
                  ? "Booking…"
                  : `Confirm ${new Date(selectedSlot.startsAt).toLocaleTimeString("en-US", {
                      timeZone: info.timezone,
                      hour: "numeric",
                      minute: "2-digit",
                    })}`}
              </button>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-slate-400">
          Powered by GrowthOps
        </p>
      </div>
    </main>
  );
}
