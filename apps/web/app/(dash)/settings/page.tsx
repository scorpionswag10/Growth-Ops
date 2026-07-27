"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { LocationRow, useWorkspace } from "@/lib/workspace";
import { enablePush, pushStatus, pushSupported } from "@/lib/push";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const FEATURES: { key: string; label: string; note: string }[] = [
  { key: "booking", label: "Online booking", note: "Public booking page and appointment capture" },
  { key: "sms", label: "SMS", note: "Stays off until carrier (A2P 10DLC) registration is approved" },
  { key: "email", label: "Email sending", note: "Off while ActiveCampaign handles nurture" },
  { key: "social", label: "Social publishing", note: "Arrives with the social media module" },
  { key: "workflows", label: "Automations", note: "Arrives with the workflow engine" },
  { key: "ai", label: "AI receptionist", note: "Auto-replies to inbound messages and books appointments; needs an Anthropic API key on the server" },
  { key: "seo", label: "SEO / AEO audit", note: "Live site audits — AI crawler access, llms.txt, schema, on-page SEO" },
];

type Invite = {
  id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  createdAt: string;
};

export default function SettingsPage() {
  const { me, location, reloadLocations } = useWorkspace();
  const loc = location as LocationRow;
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [profile, setProfile] = useState(loc.aiProfile ?? "");
  const [profileSaved, setProfileSaved] = useState(false);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "STAFF" as Invite["role"] });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    if (!me.isPlatformAdmin) return;
    setInvites(await api<Invite[]>(`/locations/${loc.id}/invites`));
  }, [loc.id, me.isPlatformAdmin]);

  useEffect(() => {
    loadInvites();
    pushStatus().then(setPushEnabled);
  }, [loadInvites]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteLink(null);
    try {
      const invite = await api<{ token: string }>(`/locations/${loc.id}/invites`, {
        method: "POST",
        body: inviteForm,
      });
      setInviteLink(`${window.location.origin}/accept-invite/${invite.token}`);
      setInviteForm({ email: "", role: "STAFF" });
      await loadInvites();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function revokeInvite(id: string) {
    await api(`/locations/${loc.id}/invites/${id}`, { method: "DELETE" });
    loadInvites();
  }

  async function handleEnablePush() {
    setPushError(null);
    const result = await enablePush();
    if (result.ok) setPushEnabled(true);
    else setPushError(result.error ?? "Failed to enable alerts");
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/locations/${loc.id}/ai-profile`, {
        method: "PATCH",
        body: { profile: profile || undefined },
      });
      await reloadLocations();
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

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
        <h2 className="text-sm font-semibold text-slate-900">AI receptionist — business profile</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Everything the AI is allowed to know and say about this business:
          services, prices, hours, policies, FAQs. It will not state anything
          that is not written here.
        </p>
        <form onSubmit={saveProfile} className="mt-3">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            rows={6}
            placeholder={"Example:\nServices: teeth whitening ($149), tooth gems (from $45)\nHours: Mon-Fri 9am-5pm\nAddress: ...\nPolicy: 24h notice to reschedule."}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            disabled={!me.isPlatformAdmin}
          />
          <button
            disabled={!me.isPlatformAdmin}
            className="mt-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {profileSaved ? "Saved" : "Save profile"}
          </button>
        </form>
      </section>

      <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Alerts</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Browser push notifications for new leads and appointments — works
          without email or SMS, even when this tab isn&apos;t focused. This is
          a personal setting for your account, not a location setting.
        </p>
        {!pushSupported() ? (
          <p className="mt-2 text-xs text-slate-400">Not supported in this browser.</p>
        ) : pushEnabled ? (
          <p className="mt-2 text-xs font-medium text-emerald-700">Alerts are on.</p>
        ) : (
          <button
            onClick={handleEnablePush}
            className="mt-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            Enable browser alerts
          </button>
        )}
        {pushError && <p className="mt-2 text-xs text-red-600">{pushError}</p>}
      </section>

      {me.isPlatformAdmin && (
        <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Team</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Invite people to this location. No email is sent — copy the link
            and send it however you currently reach them (text, WhatsApp, in
            person). Links expire in 7 days.
          </p>
          <form onSubmit={sendInvite} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="email"
              required
              placeholder="email@example.com"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
            />
            <select
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              value={inviteForm.role}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, role: e.target.value as Invite["role"] })
              }
            >
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
              <option value="OWNER">Owner</option>
            </select>
            <button className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
              Invite
            </button>
          </form>
          {inviteError && <p className="mt-2 text-xs text-red-600">{inviteError}</p>}
          {inviteLink && (
            <div className="mt-2 rounded-lg bg-emerald-50 p-2.5">
              <p className="text-xs font-medium text-emerald-800">
                Invite created — copy this link and send it:
              </p>
              <code className="mt-1 block overflow-x-auto text-xs text-emerald-900">
                {inviteLink}
              </code>
            </div>
          )}

          <div className="mt-4 divide-y divide-slate-100">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-2 text-xs">
                <span className="text-slate-700">
                  {inv.email} <span className="text-slate-400">— {inv.role.toLowerCase()}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={
                      inv.status === "PENDING"
                        ? "text-amber-600"
                        : inv.status === "ACCEPTED"
                          ? "text-emerald-600"
                          : "text-slate-400"
                    }
                  >
                    {inv.status.toLowerCase()}
                  </span>
                  {inv.status === "PENDING" && (
                    <button
                      onClick={() => revokeInvite(inv.id)}
                      className="text-red-500 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </span>
              </div>
            ))}
            {invites.length === 0 && (
              <p className="py-2 text-xs text-slate-400">No invites yet.</p>
            )}
          </div>
        </section>
      )}

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
