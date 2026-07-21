"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, clearTokens } from "@/lib/api";

type Profile = {
  sub: string;
  email: string;
  name: string;
  phone: string | null;
  isPlatformAdmin: boolean;
};

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    api<Profile>("/auth/me").then((p) => {
      setMe(p);
      setName(p.name);
      setPhone(p.phone ?? "");
    });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    try {
      const updated = await api<Profile>("/auth/me", {
        method: "PATCH",
        body: { name, phone: phone || undefined },
      });
      setMe(updated);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation don't match.");
      return;
    }
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 2000);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function signOutEverywhere() {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await api("/auth/logout-all", { method: "POST" });
      clearTokens();
      router.replace("/login");
    } catch (err) {
      setSignOutError(err instanceof ApiError ? err.message : "Failed");
      setSigningOut(false);
    }
  }

  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        Loading profile…
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto p-6">
      <h1 className="text-lg font-bold text-slate-900">My Profile</h1>

      <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Personal info</h2>
        <form onSubmit={saveProfile} className="mt-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Email</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
              value={me.email}
              disabled
            />
            <p className="mt-1 text-xs text-slate-400">
              Email is your login and can&apos;t be changed here.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Phone</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          {profileError && <p className="text-xs text-red-600">{profileError}</p>}
          <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            {profileSaved ? "Saved" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
        <form onSubmit={changePassword} className="mt-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Current password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">New password</label>
            <input
              type="password"
              minLength={10}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Confirm new password</label>
            <input
              type="password"
              minLength={10}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {passwordError && <p className="text-xs text-red-600">{passwordError}</p>}
          <button className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            {passwordSaved ? "Password changed" : "Change password"}
          </button>
        </form>
      </section>

      <section className="mt-5 max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Sessions</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Sign out of every device where you&apos;re logged in, including this
          one. Useful if a device was lost or a session feels compromised.
        </p>
        {signOutError && <p className="mt-2 text-xs text-red-600">{signOutError}</p>}
        <button
          onClick={signOutEverywhere}
          disabled={signingOut}
          className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
        >
          Sign out everywhere
        </button>
      </section>
    </div>
  );
}
