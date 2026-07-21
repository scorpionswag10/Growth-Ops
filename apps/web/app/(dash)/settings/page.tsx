"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { LocationRow, useWorkspace } from "@/lib/workspace";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const FEATURES: { key: string; label: string; note: string }[] = [
  { key: "booking", label: "Online booking", note: "Public booking page and appointment capture" },
  { key: "sms", label: "SMS", note: "Stays off until carrier (A2P 10DLC) registration is approved" },
  { key: "email", label: "Email sending", note: "Off while ActiveCampaign handles nurture" },
  { key: "social", label: "Social publishing", note: "Arrives with the social media module" },
  { key: "workflows", label: "Automations", note: "Arrives with the workflow engine" },
];

export default function SettingsPage() {
  const { me, location, reloadLocations } = useWorkspace();
  const loc = location as LocationRow;
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const features = (loc.features ?? {}) as Record<string, boolean>;

  async function toggle(key: string) {
    setError(null);
    setBusyKey(key);
    try {
      await api(`/locations/${loc.id}/features`, {
        method: "PATCH",
        body: { [key]: !features[key] },
      });
      await reloadLocations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-6">
      <h1 className="text-lg font-bold text-slate-900">Settings — {loc.name}</h1>

      <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Features</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Capabilities are enabled per client location. Everything ships built
          but dark until it is turned on here.
        </p>
        {!me.isPlatformAdmin && (
          <p className="mt-2 text-xs text-amber-700">Only platform admins can change these.</p>
        )}
        <div className="mt-4 divide-y divide-slate-100">
          {FEATURES.map((f) => (
            <div key={f.key} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-slate-900">{f.label}</div>
                <div className="text-xs text-slate-500">{f.note}</div>
              </div>
              <button
                disabled={!me.isPlatformAdmin || busyKey === f.key}
                onClick={() => toggle(f.key)}
                className={`h-6 w-11 rounded-full p-0.5 transition-colors disabled:opacity-40 ${
                  features[f.key] ? "bg-emerald-600" : "bg-slate-300"
                }`}
                aria-label={`Toggle ${f.label}`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    features[f.key] ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </section>

      <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Lead capture webhook</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Point LeadPages (or any form tool) at this URL — submissions become
          contacts automatically, deduped and tagged.
        </p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-300">
          POST {API_URL}/webhooks/leads/{loc.id}/{loc.webhookToken}
        </code>
      </section>
    </div>
  );
}
