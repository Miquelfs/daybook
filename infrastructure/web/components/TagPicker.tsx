"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tagsApi, CATEGORY_LABELS, COUNTER_SLUGS, COUNTER_TYPE, COUNTER_PLACEHOLDER } from "@/lib/tags-api";
import type { Tag, DayTag } from "@/lib/tags-api";
import type { DayTagSummary } from "@/lib/api";
import { X, Plus, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  date: string;
  initialTags: DayTagSummary[];
}

export function TagPicker({ date, initialTags }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTag, setNewTag] = useState({ name: "", icon: "", category: "activity" });
  // note inputs keyed by slug
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => tagsApi.list(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: dayTags = initialTags as DayTag[] } = useQuery<DayTag[]>({
    queryKey: ["day-tags", date],
    queryFn: () => tagsApi.getDayTags(date),
    initialData: initialTags as DayTag[],
    initialDataUpdatedAt: 0, // treat initialData as immediately stale → always refetch
  });

  const addMutation = useMutation({
    mutationFn: ({ tag_id, note }: { tag_id: number; note?: string }) =>
      tagsApi.addDayTag(date, tag_id, note),
    onSuccess: (data) => qc.setQueryData(["day-tags", date], data),
  });

  const removeMutation = useMutation({
    mutationFn: (tag_id: number) => tagsApi.removeDayTag(date, tag_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["day-tags", date] }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      tagsApi.createTag({
        slug: newTag.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
        name: newTag.name,
        icon: newTag.icon || undefined,
        category: newTag.category,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tags"] });
      setNewTag({ name: "", icon: "", category: "activity" });
      setShowNewForm(false);
    },
  });

  const activeIds = new Set(dayTags.map((t) => t.tag_id));

  const toggle = (tag: Tag) => {
    if (activeIds.has(tag.id)) {
      removeMutation.mutate(tag.id);
      if (COUNTER_SLUGS.has(tag.slug)) {
        setNoteInputs((p) => { const n = { ...p }; delete n[tag.slug]; return n; });
      }
    } else {
      addMutation.mutate({ tag_id: tag.id });
    }
  };

  const handleNoteBlur = (tag: Tag) => {
    if (!activeIds.has(tag.id)) return;
    const note = noteInputs[tag.slug] ?? dayTags.find((t) => t.slug === tag.slug)?.note ?? "";
    addMutation.mutate({ tag_id: tag.id, note: note || undefined });
  };

  const grouped = allTags.reduce<Record<string, Tag[]>>((acc, tag) => {
    const filtered =
      filter.trim() === "" ||
      tag.name.toLowerCase().includes(filter.toLowerCase()) ||
      tag.slug.toLowerCase().includes(filter.toLowerCase());
    if (filtered) {
      (acc[tag.category] ??= []).push(tag);
    }
    return acc;
  }, {});

  // Known categories first, any user-created ones after (alphabetically)
  const knownOrder = ["work", "location", "social", "activity", "health", "emotion", "environment"];
  const categoryOrder = [
    ...knownOrder,
    ...Object.keys(grouped).filter((c) => !knownOrder.includes(c)).sort(),
  ];

  // Tags that are active AND have a counter input
  const activeCounterTags = allTags.filter(
    (t) => activeIds.has(t.id) && COUNTER_SLUGS.has(t.slug)
  );

  return (
    <div className="space-y-3">
      {/* Applied tags */}
      {dayTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dayTags.map((tag) => (
            <span
              key={tag.tag_id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                         bg-[#F59E0B]/10 border border-[#F59E0B]/40 text-[#F59E0B]
                         shadow-[0_0_8px_rgba(245,158,11,0.15)]"
            >
              {tag.icon && <span>{tag.icon}</span>}
              {tag.name}
              {tag.note && <span className="text-[#F59E0B]/60 ml-0.5">· {tag.note}</span>}
              <button
                onClick={() => removeMutation.mutate(tag.tag_id)}
                className="ml-0.5 text-[#F59E0B]/50 hover:text-[#F59E0B] transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Inputs for active tags that need them */}
      {activeCounterTags.map((tag) => {
        const existing = dayTags.find((t) => t.slug === tag.slug)?.note ?? "";
        const value = noteInputs[tag.slug] ?? existing;
        const isCounter = COUNTER_TYPE[tag.slug] === "counter";
        const numVal = isCounter ? (parseInt(value) || 0) : 0;

        const setNum = (n: number) => {
          const s = n > 0 ? String(n) : "";
          setNoteInputs((p) => ({ ...p, [tag.slug]: s }));
          addMutation.mutate({ tag_id: tag.id, note: s || undefined });
        };

        return (
          <div key={tag.slug} className="flex items-center gap-2 ml-1">
            {(COUNTER_PLACEHOLDER[tag.slug] ?? tag.name) && (
              <span className="text-xs text-[#52525B] shrink-0">{tag.icon} {COUNTER_PLACEHOLDER[tag.slug] ?? tag.name}:</span>
            )}
            {isCounter ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setNum(Math.max(0, numVal - 1))}
                  className="w-6 h-6 rounded border border-[#27272A] bg-[#18181B] text-[#A1A1AA]
                             hover:border-[#F59E0B] hover:text-[#F59E0B] transition-colors text-sm leading-none"
                >−</button>
                <span className="w-6 text-center text-sm font-semibold text-[#F59E0B] tabular-nums">
                  {numVal || "—"}
                </span>
                <button
                  onClick={() => setNum(numVal + 1)}
                  className="w-6 h-6 rounded border border-[#27272A] bg-[#18181B] text-[#A1A1AA]
                             hover:border-[#F59E0B] hover:text-[#F59E0B] transition-colors text-sm leading-none"
                >+</button>
              </div>
            ) : (
              <input
                type="text"
                placeholder={COUNTER_PLACEHOLDER[tag.slug] ?? "Note…"}
                value={value}
                onChange={(e) => setNoteInputs((p) => ({ ...p, [tag.slug]: e.target.value }))}
                onBlur={() => handleNoteBlur(tag)}
                className="w-32 bg-[#18181B] border border-[#27272A] rounded px-2 py-1 text-xs
                           text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#F59E0B]"
              />
            )}
          </div>
        );
      })}

      {/* Toggle picker button */}
      <button
        onClick={() => setShowPicker((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
      >
        {showPicker ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showPicker ? "Hide tags" : "Add tags"}
      </button>

      {showPicker && (
        <div className="space-y-3 pt-1">
          {/* Search */}
          <input
            type="text"
            placeholder="Filter tags…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs
                       text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#F59E0B]"
          />

          {/* Category groups */}
          {categoryOrder.map((cat) => {
            const tags = grouped[cat];
            if (!tags?.length) return null;
            return (
              <div key={cat}>
                <p className="text-[10px] uppercase tracking-widest text-[#3F3F46] mb-1.5 font-medium">
                  {CATEGORY_LABELS[cat] ?? cat}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const active = activeIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggle(tag)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
                          active
                            ? "bg-[#F59E0B]/10 border-[#F59E0B] text-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.2)]"
                            : "bg-[#18181B] border-[#27272A] text-[#52525B] hover:border-[#3F3F46] hover:text-[#71717A]"
                        }`}
                      >
                        {tag.icon && <span className="text-[11px]">{tag.icon}</span>}
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* New tag form */}
          <div className="border-t border-[#27272A] pt-2">
            {!showNewForm ? (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowNewForm(true)}
                  className="flex items-center gap-1 text-xs text-[#3F3F46] hover:text-[#52525B] transition-colors"
                >
                  <Plus size={12} />
                  New tag
                </button>
                <a
                  href="/tags"
                  className="text-[10px] uppercase tracking-widest text-[#3F3F46] hover:text-[#F59E0B] transition-colors"
                >
                  Manage tags →
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-[#3F3F46]">New tag</p>
                <div className="flex gap-2">
                  <input
                    placeholder="Emoji"
                    value={newTag.icon}
                    onChange={(e) => setNewTag((p) => ({ ...p, icon: e.target.value }))}
                    className="w-12 bg-[#18181B] border border-[#27272A] rounded px-2 py-1.5 text-xs text-center
                               text-[#FAFAFA] focus:outline-none focus:border-[#F59E0B]"
                  />
                  <input
                    placeholder="Tag name"
                    value={newTag.name}
                    onChange={(e) => setNewTag((p) => ({ ...p, name: e.target.value }))}
                    className="flex-1 bg-[#18181B] border border-[#27272A] rounded px-2 py-1.5 text-xs
                               text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#F59E0B]"
                  />
                  <select
                    value={newTag.category}
                    onChange={(e) => setNewTag((p) => ({ ...p, category: e.target.value }))}
                    className="bg-[#18181B] border border-[#27272A] rounded px-2 py-1.5 text-xs
                               text-[#A1A1AA] focus:outline-none focus:border-[#F59E0B]"
                  >
                    {categoryOrder.map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => createMutation.mutate()}
                    disabled={!newTag.name.trim() || createMutation.isPending}
                    className="px-3 py-1 rounded text-xs bg-[#F59E0B] text-[#0D0D0F] font-medium
                               disabled:opacity-40 hover:bg-[#D97706] transition-colors"
                  >
                    {createMutation.isPending ? "Saving…" : "Create"}
                  </button>
                  <button
                    onClick={() => { setShowNewForm(false); setNewTag({ name: "", icon: "", category: "activity" }); }}
                    className="px-3 py-1 rounded text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
