"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Contact } from "@/lib/api";
import { Check, Pencil, Trash2, X } from "lucide-react";

interface Props {
  onClose: () => void;
}

export function PeopleManager({ onClose }: Props) {
  const qc = useQueryClient();
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.contacts(),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(c: Contact) {
    setEditingId(c.id);
    setName(c.name);
    setEmoji(c.emoji ?? "");
    setError(null);
  }

  async function saveEdit(id: number) {
    if (!name.trim()) {
      setError("Name can't be empty");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateContact(id, { name: name.trim(), emoji: emoji.trim() || null });
      await qc.invalidateQueries({ queryKey: ["contacts"] });
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Contact) {
    if (!confirm(`Remove ${c.name}? This unlinks them from days and tennis sessions.`)) return;
    setBusy(true);
    try {
      await api.deleteContact(c.id);
      await qc.invalidateQueries({ queryKey: ["contacts"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">People</h2>
            <p className="text-xs text-[#52525B] mt-0.5">Rename or remove anyone — changes apply everywhere.</p>
          </div>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] text-lg leading-none">
            ×
          </button>
        </div>

        {contacts.length === 0 ? (
          <p className="text-xs text-[#52525B] py-6 text-center">
            No people yet — add them when logging a day or a tennis session.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-[#18181B]">
            {contacts.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <div key={c.id} className="py-2.5">
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          value={emoji}
                          onChange={(e) => setEmoji(e.target.value)}
                          placeholder="🙂"
                          maxLength={4}
                          className="w-12 text-center bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[#F59E0B]"
                        />
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); saveEdit(c.id); }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1.5 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                        />
                      </div>
                      {error && <p className="text-xs text-red-400">{error}</p>}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
                        >
                          <X size={12} /> Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(c.id)}
                          disabled={busy}
                          className="flex items-center gap-1 px-3 py-1 text-xs bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg transition-colors"
                        >
                          <Check size={12} /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[#FAFAFA] truncate">
                        {c.emoji && <span className="mr-1.5">{c.emoji}</span>}
                        {c.name}
                        {c.group_ && <span className="text-xs text-[#52525B] ml-2">{c.group_}</span>}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(c)}
                          className="p-1.5 text-[#52525B] hover:text-[#FAFAFA] transition-colors"
                          aria-label={`Rename ${c.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => remove(c)}
                          disabled={busy}
                          className="p-1.5 text-[#52525B] hover:text-red-400 transition-colors"
                          aria-label={`Remove ${c.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
