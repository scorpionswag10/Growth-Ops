"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type ContactSummary = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
};

type Conversation = {
  id: string;
  contact: ContactSummary;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
};

type Message = {
  id: string;
  channel: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  body: string;
  occurredAt: string;
};

type Thread = Conversation & { messages: Message[] };

function contactName(c: ContactSummary) {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return name || c.email || c.phone || "Unknown contact";
}

export default function InboxPage() {
  const { location } = useWorkspace();
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [channel, setChannel] = useState<"NOTE" | "SMS" | "EMAIL">("NOTE");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const locId = location!.id;

  const loadInbox = useCallback(async () => {
    const res = await api<{ items: Conversation[] }>(
      `/locations/${locId}/conversations`,
    );
    setConvos(res.items);
  }, [locId]);

  useEffect(() => {
    setThread(null);
    loadInbox();
    const t = setInterval(loadInbox, 8000);
    return () => clearInterval(t);
  }, [loadInbox]);

  async function openThread(id: string) {
    const t = await api<Thread>(`/locations/${locId}/conversations/${id}`);
    setThread(t);
    await api(`/locations/${locId}/conversations/${id}/read`, {
      method: "POST",
    });
    loadInbox();
    setTimeout(() => bottomRef.current?.scrollIntoView(), 50);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!thread || !draft.trim()) return;
    setError(null);
    try {
      await api(
        `/locations/${locId}/contacts/${thread.contact.id}/messages`,
        { method: "POST", body: { channel, body: draft.trim() } },
      );
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Send failed");
    }
    await openThread(thread.id);
  }

  return (
    <div className="flex h-screen">
      <div className="w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          Inbox
        </div>
        {convos.length === 0 && (
          <p className="px-4 py-6 text-xs text-slate-500">
            No conversations yet. They appear here the moment a lead comes in
            or you message a contact.
          </p>
        )}
        {convos.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setError(null);
              openThread(c.id);
            }}
            className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
              thread?.id === c.id ? "bg-emerald-50" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900">
                {contactName(c.contact)}
              </span>
              {c.unreadCount > 0 && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  {c.unreadCount}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {c.lastMessagePreview ?? ""}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-1 flex-col">
        {!thread ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Select a conversation
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-white px-5 py-3">
              <div className="text-sm font-semibold text-slate-900">
                {contactName(thread.contact)}
              </div>
              <div className="text-xs text-slate-500">
                {[thread.contact.phone, thread.contact.email]
                  .filter(Boolean)
                  .join("  ·  ")}
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {thread.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-md rounded-2xl px-4 py-2 text-sm shadow-sm ${
                      m.channel === "NOTE"
                        ? "border border-amber-200 bg-amber-50 text-amber-900"
                        : m.direction === "OUTBOUND"
                          ? "bg-emerald-600 text-white"
                          : "bg-white text-slate-900"
                    }`}
                  >
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide opacity-70">
                      {m.channel}
                      {m.status === "FAILED" ? " · failed" : ""}
                    </div>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <form
              onSubmit={send}
              className="border-t border-slate-200 bg-white p-4"
            >
              {error && (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <select
                  className="rounded-lg border border-slate-300 px-2 text-xs"
                  value={channel}
                  onChange={(e) =>
                    setChannel(e.target.value as typeof channel)
                  }
                >
                  <option value="NOTE">Note</option>
                  <option value="SMS">SMS</option>
                  <option value="EMAIL">Email</option>
                </select>
                <input
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                  placeholder={
                    channel === "NOTE"
                      ? "Internal note (never sent to the contact)"
                      : "Type a message"
                  }
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                  Send
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
