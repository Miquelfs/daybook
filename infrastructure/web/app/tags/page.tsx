"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tagsApi, CATEGORY_LABELS } from "@/lib/tags-api";
import type { Tag } from "@/lib/tags-api";
import { Plus, Trash2, Lock, Check, X } from "lucide-react";

const KNOWN_ORDER = ["work", "location", "social", "activity", "health", "emotion", "environment"];

function labelFor(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

export default function TagManagerPage() {
  const qc = useQueryClient();
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [pendingNewIn, setPendingNewIn] = useState<string | null>(null);

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["tags"],
    queryFn: () => tagsApi.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tags"] });

  const grouped = tags.reduce<Record<string, Tag[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});
  const categories = [
    ...KNOWN_ORDER.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !KNOWN_ORDER.includes(c)).sort(),
  ];
  const allCategories = [...new Set([...categories, ...(pendingNewIn ? [pendingNewIn] : [])])];

  return (
    <main className="max-w-2xl mx-auto px-4 pb-20 pt-8">
      <div className="mb-8">
        <Link href="/" className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-2 inline-block">
          ← Today
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
        <p className="text-xs text-[#52525B] mt-0.5">
          rename, re-icon, move between categories, delete · system tags are locked
        </p>
      </div>

      {isLoading ? (
        <div className="h-40 bg-[#0D0D0F] rounded-xl animate-pulse" />
      ) : (
        <div className="space-y-8">
          {allCategories.map((cat) => (
            <section key={cat}>
              <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">
                {labelFor(cat)}
                <span className="text-[#3F3F46] normal-case tracking-normal ml-2">
                  {grouped[cat]?.length ?? 0}
                </span>
              </h2>
              <div className="flex flex-col gap-1.5">
                {(grouped[cat] ?? []).map((tag) => (
                  <TagRow key={tag.id} tag={tag} categories={categories} onChanged={invalidate} />
                ))}
                {pendingNewIn === cat ? (
                  <NewTagRow
                    category={cat}
                    onDone={() => { setPendingNewIn(null); invalidate(); }}
                    onCancel={() => setPendingNewIn(null)}
                  />
                ) : (
                  <button
                    onClick={() => setPendingNewIn(cat)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#27272A] text-xs text-[#3F3F46] hover:text-[#71717A] hover:border-[#3F3F46] transition-colors w-fit"
                  >
                    <Plus size={12} /> new tag
                  </button>
                )}
              </div>
            </section>
          ))}

          {/* New category */}
          <section className="border-t border-[#27272A] pt-6">
            {!showNewCategory ? (
              <button
                onClick={() => setShowNewCategory(true)}
                className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-[#F59E0B] transition-colors uppercase tracking-widest"
              >
                <Plus size={12} /> New category
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  placeholder="Category name…"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newCategory.trim()) {
                      setPendingNewIn(newCategory.trim().toLowerCase());
                      setNewCategory("");
                      setShowNewCategory(false);
                    }
                    if (e.key === "Escape") setShowNewCategory(false);
                  }}
                  className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-xs text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none focus:border-[#F59E0B]"
                />
                <p className="text-[10px] text-[#3F3F46]">
                  enter to add its first tag — a category exists once it has a tag
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function TagRow({ tag, categories, onChanged }: { tag: Tag; categories: string[]; onChanged: () => void }) {
  const [name, setName] = useState(tag.name);
  const [icon, setIcon] = useState(tag.icon ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useMutation({
    mutationFn: (body: Parameters<typeof tagsApi.updateTag>[1]) => tagsApi.updateTag(tag.id, body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () => tagsApi.deleteTag(tag.id),
    onSuccess: onChanged,
  });

  return (
    <div className="flex items-center gap-2 bg-[#0D0D0F] border border-[#27272A] rounded-xl px-3 py-2 group">
      {/* Icon — editable emoji */}
      <input
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        onBlur={() => icon !== (tag.icon ?? "") && update.mutate({ icon })}
        placeholder="·"
        className="w-8 bg-transparent text-center text-base focus:outline-none focus:bg-[#18181B] rounded"
        title="icon — type an emoji"
      />
      {/* Name — inline editable */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== tag.name && update.mutate({ name })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="flex-1 min-w-0 bg-transparent text-sm text-[#D4D4D8] focus:outline-none focus:bg-[#18181B] rounded px-1 py-0.5"
      />
      <span className="text-[10px] text-[#3F3F46] tabular-nums shrink-0" title="days used">
        {tag.usage_count}d
      </span>
      {tag.is_negative && (
        <span className="text-[9px] uppercase tracking-wider text-[#EF4444]/70 border border-[#EF4444]/30 rounded-full px-1.5 py-0.5 shrink-0">
          neg
        </span>
      )}
      {/* Category — move */}
      <select
        value={tag.category}
        onChange={(e) => update.mutate({ category: e.target.value })}
        className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-[10px] text-[#71717A] focus:outline-none focus:border-[#F59E0B] shrink-0"
        title="move to category"
      >
        {categories.map((c) => (
          <option key={c} value={c}>{labelFor(c)}</option>
        ))}
      </select>
      {/* Delete */}
      {tag.is_system ? (
        <span className="p-1.5 text-[#3F3F46] shrink-0" title="system tag — cannot delete">
          <Lock size={13} />
        </span>
      ) : confirmDelete ? (
        <span className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => remove.mutate()}
            className="p-1.5 rounded-lg bg-[#EF4444]/15 text-[#EF4444] hover:bg-[#EF4444]/25 transition-colors"
            title={`delete — removes it from ${tag.usage_count} days`}
          >
            <Check size={13} />
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="p-1.5 rounded-lg text-[#52525B] hover:text-[#A1A1AA] transition-colors"
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="p-1.5 rounded-lg text-[#3F3F46] hover:text-[#EF4444] transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="delete tag"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function NewTagRow({ category, onDone, onCancel }: { category: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");

  const create = useMutation({
    mutationFn: () =>
      tagsApi.createTag({
        slug: name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
        name: name.trim(),
        icon: icon || undefined,
        category,
      }),
    onSuccess: onDone,
  });

  return (
    <div className="flex items-center gap-2 bg-[#0D0D0F] border border-[#F59E0B]/40 rounded-xl px-3 py-2">
      <input
        value={icon}
        onChange={(e) => setIcon(e.target.value)}
        placeholder="😀"
        className="w-8 bg-transparent text-center text-base focus:outline-none"
      />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) create.mutate();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Tag name…"
        className="flex-1 min-w-0 bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] focus:outline-none"
      />
      <button
        onClick={() => name.trim() && create.mutate()}
        disabled={!name.trim() || create.isPending}
        className="text-xs text-[#F59E0B] disabled:text-[#3F3F46] uppercase tracking-widest"
      >
        add
      </button>
      <button onClick={onCancel} className="p-1 text-[#52525B] hover:text-[#A1A1AA]">
        <X size={13} />
      </button>
    </div>
  );
}
