"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Calendar = {
  id: string;
  name: string;
  slug: string;
  slotDurationMin: number;
  timezone: string | null;
};

type Appointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string | null;
  contact: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  calendar: { name: string };
};

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
  NO_SHOW: "bg-red-100 text-red-700",
  COMPLETED: "bg-sky-100 text-sky-800",
};

export default function CalendarPage() {
  const { location } = useWorkspace();
  const locId = location!.id;
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "Appointments", slug: "appointments" });

  const load = useCallback(async () => {
    const [cals, rows] = await Promise.all([
      api<Calendar[]>(`/locations/${locId}/calendars`),
      api<Appointment[]>(`/locations/${locId}/appointments`),
    ]);
    setCalendars(cals);
    setAppts(rows);
  }, [locId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function createCalendar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/locations/${locId}/calendars`, { method: "POST", body: form });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function setStatus(id: string, status: string) {
    await api(`/locations/${locId}/appointments/${id}`, {
      method: "PATCH",
      body: { status },
    });
    load();
  }

  if (calendars.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <form onSubmit={createCalendar} className="w-full max-w-md rounded-xl bg-white p-6 shadow">
          <h2 className="text-sm font-semibold text-slate-900">Create a booking calendar</h2>
          <p className="mt-1 text-xs text-slate-500">
            Defaults: Mon–Fri 9–5, 30-minute slots, 2 hours minimum notice.
            The public booking link goes on the client&apos;s existing website.
          </p>
          <input
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Calendar name"
          />
          <input
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="link-slug"
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <button className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Create calendar
          </button>
        </form>
      </div>
    );
  }

  const bookingUrl = `${window.location.origin}/book/${locId}/${calendars[0].slug}`;
  const tz = calendars[0].timezone ?? location!.timezone;

  return (
    <div className="h-screen overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">
          Calendar{" "}
          <span className="text-sm font-normal text-slate-400">({tz})</span>
        </h1>
        <div className="text-xs text-slate-500">
          Booking link:{" "}
          <a href={bookingUrl} target="_blank" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
            {bookingUrl}
          </a>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Customer</th>
              <th className="px-4 py-2.5">Contact info</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {appts.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium text-slate-900">
                  {new Date(a.startsAt).toLocaleString("en-US", {
                    timeZone: tz,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-2.5">
                  {[a.contact.firstName, a.contact.lastName].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {[a.contact.phone, a.contact.email].filter(Boolean).join(" · ")}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[a.status] ?? ""}`}>
                    {a.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {a.status === "CONFIRMED" && (
                    <div className="flex gap-1.5 text-[11px]">
                      <button onClick={() => setStatus(a.id, "COMPLETED")} className="rounded border border-sky-200 px-2 py-0.5 text-sky-700 hover:bg-sky-50">
                        Completed
                      </button>
                      <button onClick={() => setStatus(a.id, "NO_SHOW")} className="rounded border border-red-200 px-2 py-0.5 text-red-600 hover:bg-red-50">
                        No-show
                      </button>
                      <button onClick={() => setStatus(a.id, "CANCELLED")} className="rounded border border-slate-200 px-2 py-0.5 text-slate-500 hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {appts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                  No upcoming appointments. Share the booking link above — bookings land here automatically.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
