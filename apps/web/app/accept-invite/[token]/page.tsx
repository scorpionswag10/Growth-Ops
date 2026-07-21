"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setTokens } from "@/lib/api";

type Preview = {
  email: string;
  role: string;
  locationName: string;
  userExists: boolean;
};

export default function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Preview>(`/invites/${token}`)
      .then(setPreview)
      .catch(() => setNotFound(true));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>(
        `/invites/${token}/accept`,
        { method: "POST", body: { name: name || undefined, password } },
      );
      setTokens(tokens.accessToken, tokens.refreshToken);
      router.replace("/inbox");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to accept invite");
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900">
        <p className="text-sm text-slate-300">
          This invite link is invalid, expired, or has already been used.
        </p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900">
        <p className="text-sm text-slate-400">Loading invite…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-2xl">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Join {preview.locationName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {preview.email} — invited as {preview.role.toLowerCase()}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {!preview.userExists && (
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder={preview.userExists ? "Password (log in to accept)" : "Create a password"}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={preview.userExists ? undefined : 10}
          />
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Joining…" : preview.userExists ? "Accept and sign in" : "Create account and join"}
          </button>
        </form>
      </div>
    </main>
  );
}
