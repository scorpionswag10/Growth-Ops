"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type SocialPost = {
  id: string;
  content: string;
  platforms: string[];
  scheduledAt: string | null;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  error: string | null;
  publishedAt: string | null;
};

const PLATFORMS = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "gbp", label: "Google Business" },
  { key: "tiktok", label: "TikTok" },
];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-slate-200 text-slate-600",
  SCHEDULED: "bg-sky-100 text-sky-800",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-700",
};

export default function SocialPage() {
  const { location } = useWorkspace();
  const loc = location!;
  const featureOn = (loc.features ?? {}).social === true;
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    content: "",
    platforms: ["facebook", "instagram"] as string[],
    scheduledAt: "",
  });

  const load = useCallback(async () => {
    if (!featureOn) return;
    try {
      setPosts(await api<SocialPost[]>(`/locations/${loc.id}/social-posts`));
    } catch {
      /* feature gate flips can race the first load */
    }
  }, [loc.id, featureOn]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/locations/${loc.id}/social-posts`, {
        method: "POST",
        body: {
          content: form.content,
          platforms: form.platforms,
          scheduledAt: form.scheduledAt
            ? new Date(form.scheduledAt).toISOString()
            : undefined,
        },
      });
      setForm({ ...form, content: "", scheduledAt: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function cancel(id: string) {
    await api(`/locations/${loc.id}/social-posts/${id}`, {
      method: "PATCH",
      body: { cancel: true },
    });
    load();
  }

  async function remove(id: string) {
    await api(`/locations/${loc.id}/social-posts/${id}`, { method: "DELETE" });
    load();
  }

  function togglePlatform(key: string) {
    setForm((f) => ({
      ...f,
      platforms: f.platforms.includes(key)
        ? f.platforms.filter((p) => p !== key)
        : [...f.platforms, key],
    }));
  }

  if (!featureOn) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <p className="max-w-md rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
          Social publishing is not enabled for this location yet — flip it on in
          Settings. Note: posts will publish for real only once a provider
          (Ayrshare or platform APIs) is connected.
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto p-6">
      <h1 className="text-lg font-bold text-slate-900">Social calendar</h1>

      <form onSubmit={submit} className="mt-4 max-w-2xl rounded-xl bg-white p-4 shadow-sm">
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          rows={3}
          placeholder="Write the post…"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          required
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {PLATFORMS.map((p) => (
            <button
              type="button"
              key={p.key}
              onClick={() => togglePlatform(p.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                form.platforms.includes(p.key)
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              {p.label}
            </button>
          ))}
          <input
            type="datetime-local"
            className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            value={form.scheduledAt}
            onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
          />
          <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            {form.scheduledAt ? "Schedule" : "Save draft"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </form>

      <div className="mt-5 max-w-2xl space-y-2">
        {posts.map((p) => (
          <div key={p.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="flex-1 whitespace-pre-wrap text-sm text-slate-800">{p.content}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[p.status]}`}>
                {p.status}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                {p.platforms.join(" · ")}
                {p.scheduledAt
                  ? ` — ${new Date(p.scheduledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : ""}
              </span>
              <span className="flex gap-2">
                {p.status === "SCHEDULED" && (
                  <button onClick={() => cancel(p.id)} className="text-slate-500 hover:underline">
                    Cancel
                  </button>
                )}
                {p.status !== "PUBLISHED" && (
                  <button onClick={() => remove(p.id)} className="text-red-500 hover:underline">
                    Delete
                  </button>
                )}
              </span>
            </div>
            {p.error && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{p.error}</p>
            )}
          </div>
        ))}
        {posts.length === 0 && (
          <p className="text-xs text-slate-400">No posts yet — write the first one above.</p>
        )}
      </div>
    </div>
  );
}
