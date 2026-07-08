"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, X, Plus } from "lucide-react";
import { api, type Contact, type TennisSession } from "@/lib/api";

const ACCENT = "#F97316"; // tennis orange, matches sport identity palette

const RESULTS: { key: "win" | "loss" | "draw"; label: string; color: string }[] = [
  { key: "win", label: "Won", color: "#10B981" },
  { key: "loss", label: "Lost", color: "#EF4444" },
  { key: "draw", label: "Draw", color: "#A1A1AA" },
];

const SURFACES = ["hard", "clay", "grass", "indoor"] as const;

interface Props {
  activityId: string;
  initial: TennisSession | null;
}

type Draft = {
  session_type: "match" | "training";
  format: "singles" | "doubles";
  result: "win" | "loss" | "draw" | null;
  score: string;
  surface: string | null;
  focus: string;
  coaching_notes: string;
  partner_ids: number[];
  opponent_ids: number[];
  coach_ids: number[];
};

function draftFrom(s: TennisSession | null): Draft {
  return {
    session_type: s?.session_type ?? "match",
    format: (s?.format as "singles" | "doubles") ?? "singles",
    result: s?.result ?? null,
    score: s?.score ?? "",
    surface: s?.surface ?? null,
    focus: s?.focus ?? "",
    coaching_notes: s?.coaching_notes ?? "",
    partner_ids: s?.players.filter((p) => p.role === "partner").map((p) => p.contact_id) ?? [],
    opponent_ids: s?.players.filter((p) => p.role === "opponent").map((p) => p.contact_id) ?? [],
    coach_ids: s?.players.filter((p) => p.role === "coach").map((p) => p.contact_id) ?? [],
  };
}

export function TennisSessionPanel({ activityId, initial }: Props) {
  const [session, setSession] = useState<TennisSession | null>(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftFrom(initial));
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (editing && contacts.length === 0) {
      api.contacts().then(setContacts).catch(() => {});
    }
  }, [editing, contacts.length]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function togglePlayer(role: "partner_ids" | "opponent_ids" | "coach_ids", id: number) {
    setDraft((d) => {
      const has = d[role].includes(id);
      return { ...d, [role]: has ? d[role].filter((x) => x !== id) : [...d[role], id] };
    });
  }

  async function addContact() {
    const name = newName.trim();
    if (!name) return;
    try {
      const c = await api.createContact({ name });
      setContacts((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
    } catch {
      /* likely a duplicate — ignore */
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/tennis`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_type: draft.session_type,
          format: draft.session_type === "match" ? draft.format : null,
          result: draft.session_type === "match" ? draft.result : null,
          score: draft.session_type === "match" ? draft.score || null : null,
          surface: draft.surface,
          focus: draft.session_type === "training" ? draft.focus || null : null,
          coaching_notes: draft.coaching_notes || null,
          partner_ids: draft.partner_ids,
          opponent_ids: draft.session_type === "match" ? draft.opponent_ids : [],
          coach_ids: draft.session_type === "training" ? draft.coach_ids : [],
        }),
      });
      if (res.ok) {
        setSession(await res.json());
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(draftFrom(session));
    setEditing(false);
  }

  // ── Display view ────────────────────────────────────────────────────────────
  if (!editing) {
    const hasContent = session !== null;
    return (
      <div
        className={`rounded-xl border px-4 py-3 cursor-pointer transition-colors group ${
          hasContent
            ? "bg-[#0D0D0F] border-[#27272A] hover:border-[#3F3F46]"
            : "border-dashed border-[#27272A] hover:border-[#3F3F46]"
        }`}
        onClick={() => setEditing(true)}
      >
        {hasContent ? (
          <SessionSummary session={session!} />
        ) : (
          <div className="flex items-center gap-2 text-[#3F3F46] group-hover:text-[#52525B] transition-colors">
            <Pencil size={13} />
            <span className="text-sm">Log match or training…</span>
          </div>
        )}
      </div>
    );
  }

  // ── Edit view ───────────────────────────────────────────────────────────────
  const isMatch = draft.session_type === "match";
  return (
    <div className="bg-[#0D0D0F] border border-[#27272A] rounded-xl px-4 py-4 space-y-4">
      {/* Session type */}
      <SegToggle
        value={draft.session_type}
        options={[
          { key: "match", label: "🎾 Match" },
          { key: "training", label: "🏋 Training" },
        ]}
        onChange={(v) => set("session_type", v as "match" | "training")}
      />

      {isMatch && (
        <>
          {/* Format */}
          <Field label="Format">
            <SegToggle
              value={draft.format}
              options={[
                { key: "singles", label: "Singles" },
                { key: "doubles", label: "Doubles" },
              ]}
              onChange={(v) => set("format", v as "singles" | "doubles")}
            />
          </Field>

          {/* Result */}
          <Field label="Result">
            <div className="flex gap-1.5">
              {RESULTS.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => set("result", draft.result === r.key ? null : r.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold border transition-all"
                  style={
                    draft.result === r.key
                      ? { backgroundColor: r.color, borderColor: r.color, color: "#09090B" }
                      : { borderColor: "#27272A", color: "#71717A", background: "#18181B" }
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Score */}
          <Field label="Score">
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F97316] placeholder:text-[#3F3F46] tabular-nums"
              placeholder="6-4 3-6 7-5"
              value={draft.score}
              onChange={(e) => set("score", e.target.value)}
            />
          </Field>

          {/* Players */}
          {draft.format === "doubles" && (
            <PlayerPicker
              label="Partner"
              contacts={contacts}
              selected={draft.partner_ids}
              onToggle={(id) => togglePlayer("partner_ids", id)}
            />
          )}
          <PlayerPicker
            label="Opponents"
            contacts={contacts}
            selected={draft.opponent_ids}
            onToggle={(id) => togglePlayer("opponent_ids", id)}
          />
        </>
      )}

      {!isMatch && (
        <>
          {/* Coach */}
          <PlayerPicker
            label="Coach / hitting partner"
            contacts={contacts}
            selected={draft.coach_ids}
            onToggle={(id) => togglePlayer("coach_ids", id)}
          />
          {/* Focus */}
          <Field label="Worked on">
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F97316] placeholder:text-[#3F3F46]"
              placeholder="serve, kick serve, backhand slice…"
              value={draft.focus}
              onChange={(e) => set("focus", e.target.value)}
            />
          </Field>
        </>
      )}

      {/* Add person inline */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1.5 text-xs text-[#FAFAFA] outline-none focus:border-[#F97316] placeholder:text-[#3F3F46]"
          placeholder="Add a new person…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addContact();
            }
          }}
        />
        <button
          type="button"
          onClick={addContact}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-[#71717A] hover:text-[#FAFAFA] border border-[#27272A] rounded-lg transition-colors"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {/* Surface */}
      <Field label="Surface">
        <div className="flex gap-1.5">
          {SURFACES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set("surface", draft.surface === s ? null : s)}
              className={`flex-1 py-1.5 rounded-lg text-xs capitalize border transition-colors ${
                draft.surface === s
                  ? "border-[#F97316]/60 bg-[#F97316]/15 text-[#F97316]"
                  : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA] bg-[#18181B]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      {/* Tips */}
      <Field label="Tips & takeaways">
        <textarea
          rows={3}
          className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F97316] resize-none placeholder:text-[#3F3F46]"
          placeholder="What clicked, what to fix next time, tactics that worked…"
          value={draft.coaching_notes}
          onChange={(e) => set("coaching_notes", e.target.value)}
        />
      </Field>

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={cancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
        >
          <X size={13} /> Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:bg-[#27272A] disabled:text-[#52525B]"
          style={saving ? {} : { backgroundColor: ACCENT, color: "#09090B" }}
        >
          <Check size={13} /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[#52525B] uppercase tracking-widest mb-2">{label}</p>
      {children}
    </div>
  );
}

function SegToggle({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { key: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 bg-[#18181B] border border-[#27272A] rounded-lg p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
            value === o.key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PlayerPicker({
  label,
  contacts,
  selected,
  onToggle,
}: {
  label: string;
  contacts: Contact[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <Field label={label}>
      {contacts.length === 0 ? (
        <p className="text-xs text-[#3F3F46]">No people yet — add one below.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {contacts.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  on
                    ? "border-[#F97316]/60 bg-[#F97316]/15 text-[#F97316]"
                    : "border-[#27272A] text-[#71717A] hover:text-[#A1A1AA]"
                }`}
              >
                {c.emoji ? `${c.emoji} ` : ""}
                {c.name}
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

function SessionSummary({ session }: { session: TennisSession }) {
  const byRole = (role: string) => session.players.filter((p) => p.role === role);
  const resultMeta = RESULTS.find((r) => r.key === session.result);
  const nameList = (role: string) =>
    byRole(role)
      .map((p) => (p.emoji ? `${p.emoji} ${p.name}` : p.name))
      .join(", ");

  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: ACCENT }}>
            {session.session_type === "match" ? "Match" : "Training"}
          </span>
          {session.format && (
            <span className="text-xs text-[#52525B] capitalize">{session.format}</span>
          )}
          {resultMeta && (
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{ color: resultMeta.color, backgroundColor: `${resultMeta.color}22` }}
            >
              {resultMeta.label}
            </span>
          )}
          {session.score && (
            <span className="text-xs text-[#A1A1AA] tabular-nums">{session.score}</span>
          )}
          {session.surface && (
            <span className="text-xs text-[#52525B] capitalize">· {session.surface}</span>
          )}
        </div>

        {nameList("opponent") && (
          <p className="text-xs text-[#71717A]">
            <span className="text-[#52525B]">vs</span> {nameList("opponent")}
          </p>
        )}
        {nameList("partner") && (
          <p className="text-xs text-[#71717A]">
            <span className="text-[#52525B]">with</span> {nameList("partner")}
          </p>
        )}
        {nameList("coach") && (
          <p className="text-xs text-[#71717A]">
            <span className="text-[#52525B]">coach</span> {nameList("coach")}
          </p>
        )}
        {session.focus && (
          <p className="text-xs text-[#A1A1AA]">
            <span className="text-[#52525B]">Worked on:</span> {session.focus}
          </p>
        )}
        {session.coaching_notes && (
          <p className="text-sm text-[#A1A1AA] whitespace-pre-wrap pt-0.5">{session.coaching_notes}</p>
        )}
      </div>
      <Pencil size={13} className="text-[#3F3F46] shrink-0 mt-0.5" />
    </div>
  );
}
