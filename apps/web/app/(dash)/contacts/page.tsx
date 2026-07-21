"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Contact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: string;
};

export default function ContactsPage() {
  const { location } = useWorkspace();
  const locId = location!.id;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    tags: "",
  });
  const [newTag, setNewTag] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ total: number; items: Contact[] }>(
      `/locations/${locId}/contacts?q=${encodeURIComponent(q)}`,
    );
    setRows(res.items);
    setTotal(res.total);
  }, [locId, q]);

  useEffect(() => {
    setSelected(null);
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function createContact(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const contact = await api<Contact>(`/locations/${locId}/contacts`, {
        method: "POST",
        body: {
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          tags: form.tags
            ? form.tags.split(",").map((t) => t.trim()).filter(Boolean)
            : undefined,
          source: "manual",
        },
      });
      setShowNew(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", tags: "" });
      await load();
      setSelected(contact);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !newTag.trim()) return;
    const updated = await api<Contact>(
      `/locations/${locId}/contacts/${selected.id}/tags`,
      { method: "POST", body: { tags: [newTag.trim()] } },
    );
    setNewTag("");
    setSelected(updated);
    load();
  }

  async function removeTag(tag: string) {
    if (!selected) return;
    const updated = await api<Contact>(
      `/locations/${locId}/contacts/${selected.id}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" },
    );
    setSelected(updated);
    load();
  }

  async function deleteContact() {
    if (!selected) return;
    if (!confirm(`Delete ${selected.firstName ?? selected.email ?? "this contact"}? This removes their conversations and opportunities too.`)) return;
    await api(`/locations/${locId}/contacts/${selected.id}`, {
      method: "DELETE",
    });
    setSelected(null);
    load();
  }

  return (
    <div className="flex h-screen">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">
            Contacts <span className="text-sm font-normal text-slate-400">({total})</span>
          </h1>
          <button
            onClick={() => setShowNew(!showNew)}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            New contact
          </button>
        </div>

        {showNew && (
          <form
            onSubmit={createContact}
            className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-white p-4 shadow-sm"
          >
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            {error && <p className="col-span-2 text-xs text-red-600">{error}</p>}
            <button className="col-span-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Save contact
            </button>
          </form>
        )}

        <input
          className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          placeholder="Search by name, email, or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Phone</th>
                <th className="px-4 py-2.5">Tags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${selected?.id === c.id ? "bg-emerald-50" : ""}`}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{c.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-400">
                    No contacts yet — add one, or point a LeadPages form at this location&apos;s webhook.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">
            {[selected.firstName, selected.lastName].filter(Boolean).join(" ") || "Contact"}
          </div>
          <dl className="mt-3 space-y-2 text-xs">
            <div><dt className="text-slate-400">Email</dt><dd className="text-slate-700">{selected.email ?? "—"}</dd></div>
            <div><dt className="text-slate-400">Phone</dt><dd className="text-slate-700">{selected.phone ?? "—"}</dd></div>
            <div><dt className="text-slate-400">Source</dt><dd className="text-slate-700">{selected.source ?? "—"}</dd></div>
            {Object.entries(selected.customFields).map(([k, v]) => (
              <div key={k}><dt className="text-slate-400">{k}</dt><dd className="text-slate-700">{String(v)}</dd></div>
            ))}
          </dl>

          <div className="mt-4">
            <div className="text-xs font-semibold text-slate-500">Tags</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {selected.tags.map((t) => (
                <button
                  key={t}
                  onClick={() => removeTag(t)}
                  title="Remove tag"
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-red-100 hover:text-red-700"
                >
                  {t} ×
                </button>
              ))}
            </div>
            <form onSubmit={addTag} className="mt-2 flex gap-1.5">
              <input
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                placeholder="Add tag"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
              />
              <button className="rounded-lg bg-slate-900 px-2.5 text-xs font-semibold text-white">
                Add
              </button>
            </form>
          </div>

          <button
            onClick={deleteContact}
            className="mt-6 w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Delete contact
          </button>
        </div>
      )}
    </div>
  );
}
