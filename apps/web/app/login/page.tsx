"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setTokens } from "@/lib/api";

type Tokens = { accessToken: string; refreshToken: string };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens =
        mode === "login"
          ? await api<Tokens>("/auth/login", {
              method: "POST",
              body: { email, password },
            })
          : await api<Tokens>("/auth/register", {
              method: "POST",
              body: { email, password, name },
            });
      setTokens(tokens.accessToken, tokens.refreshToken);
      router.replace("/inbox");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow-2xl">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          GrowthOps CRM
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login"
            ? "Sign in to your workspace"
            : "First-time setup — create the admin account"}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
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
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 10 : undefined}
          />
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          className="mt-4 text-xs text-slate-500 underline-offset-2 hover:underline"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "First time here? Set up the admin account"
            : "Already set up? Sign in"}
        </button>
      </div>
    </main>
  );
}
