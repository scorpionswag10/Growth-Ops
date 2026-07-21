"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Stage = { id: string; name: string; position: number };
type Pipeline = { id: string; name: string; stages: Stage[] };

type Card = {
  id: string;
  name: string;
  monetaryValue: string;
  contact: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
};

type BoardStage = Stage & { opportunities: Card[] };
type Board = { id: string; name: string; stages: BoardStage[] };

type ContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export default function PipelinePage() {
  const { location } = useWorkspace();
  const locId = location!.id;
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPipe, setNewPipe] = useState({
    name: "New Customer Pipeline",
    stages: "New Lead, Contacted, Booked, Showed Up, Customer",
  });
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [oppForm, setOppForm] = useState({ query: "", contactId: "", name: "", value: "" });
  const [contactHits, setContactHits] = useState<ContactRow[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);

  const loadBoard = useCallback(
    async (pipelineId: string) => {
      setBoard(
        await api<Board>(
          `/locations/${locId}/pipelines/${pipelineId}/board`,
        ),
      );
    },
    [locId],
  );

  const loadPipelines = useCallback(async () => {
    const rows = await api<Pipeline[]>(`/locations/${locId}/pipelines`);
    setPipelines(rows);
    if (rows.length > 0) await loadBoard(rows[0].id);
    else setBoard(null);
  }, [locId, loadBoard]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (!oppForm.query.trim()) {
      setContactHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await api<{ items: ContactRow[] }>(
        `/locations/${locId}/contacts?q=${encodeURIComponent(oppForm.query)}&take=5`,
      );
      setContactHits(res.items);
    }, 250);
    return () => clearTimeout(t);
  }, [oppForm.query, locId]);

  async function createPipeline(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/locations/${locId}/pipelines`, {
        method: "POST",
        body: {
          name: newPipe.name,
          stages: newPipe.stages.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      await loadPipelines();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function addOpportunity(e: React.FormEvent, stageId: string) {
    e.preventDefault();
    if (!board || !oppForm.contactId) return;
    setError(null);
    try {
      await api(`/locations/${locId}/pipelines/${board.id}/opportunities`, {
        method: "POST",
        body: {
          contactId: oppForm.contactId,
          name: oppForm.name,
          monetaryValue: oppForm.value ? Number(oppForm.value) : 0,
          stageId,
        },
      });
      setAddingTo(null);
      setOppForm({ query: "", contactId: "", name: "", value: "" });
      await loadBoard(board.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function moveCard(cardId: string, stageId: string) {
    if (!board) return;
    try {
      await api(`/locations/${locId}/opportunities/${cardId}`, {
        method: "PATCH",
        body: { stageId },
      });
      await loadBoard(board.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Move failed");
    }
  }

  if (pipelines.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center">
        <form onSubmit={createPipeline} className="w-full max-w-md rounded-xl bg-white p-6 shadow">
          <h2 className="text-sm font-semibold text-slate-900">Create a pipeline</h2>
          <p className="mt-1 text-xs text-slate-500">
            The default stages fit an appointment business — edit freely.
          </p>
          <input
            className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={newPipe.name}
            onChange={(e) => setNewPipe({ ...newPipe, name: e.target.value })}
          />
          <input
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={newPipe.stages}
            onChange={(e) => setNewPipe({ ...newPipe, stages: e.target.value })}
          />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <button className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Create pipeline
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <h1 className="text-sm font-bold text-slate-900">Pipeline</h1>
        <select
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          value={board?.id ?? ""}
          onChange={(e) => loadBoard(e.target.value)}
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto p-5">
        {board?.stages.map((stage) => (
          <div
            key={stage.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragging && moveCard(dragging, stage.id)}
            className="flex w-64 shrink-0 flex-col rounded-xl bg-slate-200/60"
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                {stage.name}
              </span>
              <span className="text-xs text-slate-400">
                {stage.opportunities.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {stage.opportunities.map((card) => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={() => setDragging(card.id)}
                  onDragEnd={() => setDragging(null)}
                  className="cursor-grab rounded-lg bg-white p-3 shadow-sm active:cursor-grabbing"
                >
                  <div className="text-sm font-medium text-slate-900">{card.name}</div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {[card.contact.firstName, card.contact.lastName].filter(Boolean).join(" ") || card.contact.email}
                    </span>
                    <span className="font-semibold text-emerald-700">
                      ${Number(card.monetaryValue).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}

              {addingTo === stage.id ? (
                <form
                  onSubmit={(e) => addOpportunity(e, stage.id)}
                  className="space-y-1.5 rounded-lg bg-white p-2.5 shadow-sm"
                >
                  <input
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    placeholder="Search contact"
                    value={oppForm.query}
                    onChange={(e) => setOppForm({ ...oppForm, query: e.target.value, contactId: "" })}
                  />
                  {contactHits.length > 0 && !oppForm.contactId && (
                    <div className="rounded border border-slate-200">
                      {contactHits.map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() =>
                            setOppForm({
                              ...oppForm,
                              contactId: c.id,
                              query: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "",
                            })
                          }
                          className="block w-full px-2 py-1 text-left text-xs hover:bg-slate-50"
                        >
                          {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    placeholder="Deal name"
                    value={oppForm.name}
                    onChange={(e) => setOppForm({ ...oppForm, name: e.target.value })}
                    required
                  />
                  <input
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                    placeholder="Value ($)"
                    type="number"
                    value={oppForm.value}
                    onChange={(e) => setOppForm({ ...oppForm, value: e.target.value })}
                  />
                  <div className="flex gap-1.5">
                    <button className="flex-1 rounded bg-emerald-600 py-1 text-xs font-semibold text-white">
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingTo(null)}
                      className="rounded px-2 text-xs text-slate-500"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setAddingTo(stage.id)}
                  className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-xs text-slate-400 hover:border-slate-400 hover:text-slate-600"
                >
                  Add opportunity
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
