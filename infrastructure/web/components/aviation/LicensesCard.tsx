"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Plus, Pencil, Trash2, X, Check, Loader } from "lucide-react";
import { api, type PilotLicense, type PilotLicenseIn } from "@/lib/api";

const CATEGORIES = ["licence", "rating", "medical", "training", "other"] as const;

const CATEGORY_LABEL: Record<string, string> = {
  licence: "Licence",
  rating: "Rating",
  medical: "Medical",
  training: "Training",
  other: "Other",
};

const inputCls = "w-full bg-[#09090B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-sky-500";

function expiryStatus(validUntil: string | null): { label: string; color: string; days: number | null } {
  if (!validUntil) return { label: "no expiry", color: "text-[#52525B]", days: null };
  const days = Math.ceil((new Date(validUntil).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: `expired ${-days}d ago`, color: "text-red-400", days };
  if (days <= 30) return { label: `${days}d left`, color: "text-red-400", days };
  if (days <= 90) return { label: `${days}d left`, color: "text-amber-400", days };
  return { label: `${days}d left`, color: "text-green-400", days };
}

const EMPTY_FORM: PilotLicenseIn = { category: "licence", name: "" };

export function LicensesCard() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<PilotLicenseIn>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const { data: licenses = [] } = useQuery({
    queryKey: ["pilotLicenses"],
    queryFn: () => api.licenses().catch(() => []),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pilotLicenses"] });

  const { mutate: saveLicense, isPending: saving } = useMutation({
    mutationFn: () =>
      editing === "new"
        ? api.createLicense(form)
        : api.updateLicense(editing as number, form),
    onSuccess: () => { invalidate(); setEditing(null); setForm(EMPTY_FORM); },
  });

  const { mutate: removeLicense } = useMutation({
    mutationFn: (id: number) => api.deleteLicense(id),
    onSuccess: () => { invalidate(); setConfirmDelete(null); },
  });

  const openEdit = (lic: PilotLicense) => {
    setForm({
      category: lic.category,
      name: lic.name,
      number: lic.number ?? undefined,
      issued_date: lic.issued_date ?? undefined,
      valid_until: lic.valid_until ?? undefined,
      remarks: lic.remarks ?? undefined,
    });
    setEditing(lic.id);
  };

  // Soonest expiry drives the header hint
  const expiring = licenses
    .filter(l => l.valid_until)
    .map(l => ({ ...l, st: expiryStatus(l.valid_until) }))
    .filter(l => l.st.days !== null && l.st.days <= 90)
    .sort((a, b) => (a.st.days ?? 0) - (b.st.days ?? 0));

  return (
    <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BadgeCheck size={14} className={expiring.length ? "text-amber-400" : "text-emerald-400"} />
        <p className="text-sm font-medium text-[#FAFAFA]">Licenses & Ratings</p>
        {expiring.length > 0 && (
          <span className="text-xs text-amber-400">{expiring[0].name} {expiring[0].st.label}</span>
        )}
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditing("new"); }}
          className="ml-auto flex items-center gap-1 px-2 py-1 text-xs text-[#71717A] hover:text-[#A1A1AA] bg-[#27272A] hover:bg-[#3F3F46] rounded-lg transition-colors">
          <Plus size={11} />Add
        </button>
      </div>

      {licenses.length === 0 && editing === null && (
        <p className="text-xs text-[#52525B] text-center py-2">
          Track licence, ratings, medical & recurrent training expiry dates.
        </p>
      )}

      <div className="space-y-1">
        {licenses.map(lic => {
          const st = expiryStatus(lic.valid_until);
          if (editing === lic.id) return null;
          return (
            <div key={lic.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#27272A]/40 group transition-colors">
              <span className="text-xs px-1.5 py-0.5 rounded bg-[#27272A] text-[#71717A] w-16 text-center shrink-0">
                {CATEGORY_LABEL[lic.category] ?? lic.category}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-[#FAFAFA] truncate">{lic.name}</p>
                {(lic.number || lic.remarks) && (
                  <p className="text-xs text-[#52525B] truncate">{[lic.number, lic.remarks].filter(Boolean).join(" · ")}</p>
                )}
              </div>
              <div className="ml-auto text-right shrink-0">
                <p className={`text-xs tabular-nums ${st.color}`}>{st.label}</p>
                {lic.valid_until && <p className="text-[10px] text-[#3F3F46] tabular-nums">{lic.valid_until}</p>}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => openEdit(lic)} className="p-1 text-[#52525B] hover:text-[#A1A1AA]"><Pencil size={11} /></button>
                {confirmDelete === lic.id ? (
                  <button onClick={() => removeLicense(lic.id)} className="p-1 text-red-400"><Check size={11} /></button>
                ) : (
                  <button onClick={() => setConfirmDelete(lic.id)} className="p-1 text-[#52525B] hover:text-red-400"><Trash2 size={11} /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editing !== null && (
        <div className="mt-2 p-3 bg-[#09090B] border border-[#27272A] rounded-lg space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-[#52525B] mb-1">Category</p>
              <select className={inputCls} value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-1">Number</p>
              <input className={inputCls} placeholder="e.g. ES.FCL.12345" value={form.number ?? ""}
                onChange={e => setForm(f => ({ ...f, number: e.target.value || undefined }))} />
            </div>
          </div>
          <div>
            <p className="text-xs text-[#52525B] mb-1">Name</p>
            <input className={inputCls} placeholder="e.g. ATPL(A), Class 1 Medical, B737 Type Rating…" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-xs text-[#52525B] mb-1">Issued</p>
              <input type="date" className={inputCls} value={form.issued_date ?? ""}
                onChange={e => setForm(f => ({ ...f, issued_date: e.target.value || undefined }))} />
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-1">Valid until</p>
              <input type="date" className={inputCls} value={form.valid_until ?? ""}
                onChange={e => setForm(f => ({ ...f, valid_until: e.target.value || undefined }))} />
            </div>
          </div>
          <div>
            <p className="text-xs text-[#52525B] mb-1">Remarks</p>
            <input className={inputCls} placeholder="Optional" value={form.remarks ?? ""}
              onChange={e => setForm(f => ({ ...f, remarks: e.target.value || undefined }))} />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => saveLicense()}
              disabled={saving || !form.name.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors">
              {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              {editing === "new" ? "Add" : "Save"}
            </button>
            <button onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors">
              <X size={12} />Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
