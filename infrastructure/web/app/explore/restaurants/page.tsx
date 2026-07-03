"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Restaurant, type RestaurantIn, type Contact } from "@/lib/api";
import { ContactsPicker } from "@/components/ContactsPicker";

const FLAG: Record<string, string> = {
  Spain: "🇪🇸", France: "🇫🇷", Germany: "🇩🇪", Italy: "🇮🇹",
  Portugal: "🇵🇹", Netherlands: "🇳🇱", Belgium: "🇧🇪", Luxembourg: "🇱🇺",
  Switzerland: "🇨🇭", Austria: "🇦🇹", "United Kingdom": "🇬🇧",
  Norway: "🇳🇴", Sweden: "🇸🇪", Denmark: "🇩🇰", Finland: "🇫🇮",
  "United States": "🇺🇸", Japan: "🇯🇵", Thailand: "🇹🇭",
  Morocco: "🇲🇦", "United Arab Emirates": "🇦🇪",
};

const CUISINE_EMOJI: Record<string, string> = {
  Italian: "🍝", Sushi: "🍣", Japanese: "🍱", Tapas: "🥘", Spanish: "🥘",
  Catalan: "🥘", French: "🥐", Mexican: "🌮", Asian: "🥡", Chinese: "🥟",
  Indian: "🍛", Thai: "🍜", Greek: "🫒", Pizza: "🍕", Burger: "🍔",
  Brunch: "🍳", Breakfast: "🥐", "Fast Food": "🍟", Ramen: "🍜",
  "Bar/Tapas": "🍺", Portuguese: "🍷", "Middle Eastern": "🧆",
  Peruvian: "🐟", Vegetarian: "🥗",
};

function RatingBar({ value, max = 10, color = "#F59E0B" }: { value: number | null; max?: number; color?: string }) {
  if (value == null) return <span className="text-xs text-[#3F3F46]">—</span>;
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs font-medium tabular-nums" style={{ color }}>{value}</span>
      <div className="w-12 h-1 rounded-full bg-[#27272A] shrink-0">
        <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, backgroundColor: color }} />
      </div>
    </span>
  );
}

const CUISINE_LIST = Object.keys(CUISINE_EMOJI).sort();

const EMOJI_PICKER = ["🍽","🍝","🍣","🍜","🥘","🍕","🍔","🌮","🥡","🥟","🍛","🫒","🥐","🍟","🍺","🍷","🧆","🐟","🥗","🍳","🍱","🌶","🫕","🥩","🦞","🦐","🥪","☕","🍻","🥂","🍾","🧁","🍰","🎂","🧇","🌯","🥙","🫔","🍤","🦑","🦀","🥓","🍖","🍗","🥚","🧀","🥑","🍅","🫙","🥫"];

const STORAGE_KEY = "cuisine_emoji_overrides";

function useCuisineEmoji() {
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setOverrides(JSON.parse(stored));
    } catch {}
  }, []);

  const getEmoji = (cuisine: string | null | undefined): string => {
    if (!cuisine) return "🍽";
    return overrides[cuisine] ?? CUISINE_EMOJI[cuisine] ?? "🍽";
  };

  const setEmoji = (cuisine: string, emoji: string) => {
    const next = { ...overrides, [cuisine]: emoji };
    setOverrides(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  return { getEmoji, setEmoji, overrides };
}

function parseCompanions(raw: string | null | undefined): Contact[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((name, i) => ({ id: -(i + 1), name, emoji: null, group_: null }));
}

function serializeCompanions(contacts: Contact[]): string {
  return contacts.map((c) => c.name).join(", ");
}

function RestaurantSheet({
  onClose,
  onSave,
  onDelete,
  onAddVisit,
  onEditSibling,
  initial,
  siblings = [],
  defaultDate,
  mode = "add",
}: {
  onClose: () => void;
  onSave: (r: RestaurantIn) => void;
  onDelete?: () => void;
  onAddVisit?: () => void;
  onEditSibling?: (r: Restaurant) => void;
  initial?: Partial<Restaurant>;
  siblings?: Restaurant[];
  defaultDate?: string;
  mode?: "add" | "edit" | "visit";
}) {
  const isEdit = mode === "edit";
  const [form, setForm] = useState<RestaurantIn>(
    initial
      ? {
          name: initial.name ?? "",
          date_visited: initial.date_visited ?? defaultDate,
          cuisine: initial.cuisine ?? undefined,
          city: initial.city ?? undefined,
          country: initial.country ?? undefined,
          rating_mf: initial.rating_mf ?? undefined,
          rating_ad: initial.rating_ad ?? undefined,
          google_maps_url: initial.google_maps_url ?? undefined,
          companions: initial.companions ?? undefined,
          notes: initial.notes ?? undefined,
        }
      : { name: "", date_visited: defaultDate }
  );
  const [companions, setCompanions] = useState<Contact[]>(() => parseCompanions(initial?.companions));
  const [customCuisine, setCustomCuisine] = useState(
    !!initial?.cuisine && !CUISINE_LIST.includes(initial.cuisine)
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const { getEmoji, setEmoji } = useCuisineEmoji();

  const set = (key: keyof RestaurantIn, value: string | number | undefined) =>
    setForm((f) => ({ ...f, [key]: value || undefined }));

  const cuisineValue = form.cuisine ?? "";
  const currentEmoji = getEmoji(cuisineValue || null);

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave({ ...form, companions: serializeCompanions(companions) || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-md bg-[#09090B] border border-[#27272A] rounded-t-2xl sm:rounded-xl p-5 pb-8 sm:pb-5 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">
            {mode === "edit" ? "Edit Restaurant" : mode === "visit" ? `Another visit · ${initial?.name}` : "Add Restaurant"}
          </h2>
          <div className="flex items-center gap-3">
            {isEdit && onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={onDelete}
                    className="text-xs text-red-400 hover:text-red-300 font-medium"
                  >
                    Confirm delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-[#52525B] hover:text-[#A1A1AA]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-[#52525B] hover:text-red-400 transition-colors"
                >
                  Delete
                </button>
              )
            )}
            <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA] text-lg leading-none">×</button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Name *</label>
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
              placeholder="Restaurant name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Date</label>
              <input
                type="date"
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                value={form.date_visited ?? ""}
                onChange={(e) => set("date_visited", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 flex items-center justify-between">
                <span>Cuisine</span>
                <button
                  type="button"
                  onClick={() => { setCustomCuisine((v) => !v); set("cuisine", undefined); }}
                  className="text-[9px] text-[#52525B] hover:text-[#A1A1AA] ml-1"
                >
                  {customCuisine ? "pick from list" : "custom"}
                </button>
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                  className="shrink-0 w-9 h-9 flex items-center justify-center bg-[#18181B] border border-[#27272A] rounded-lg text-base hover:border-[#F59E0B] transition-colors"
                  title="Change emoji for this cuisine"
                >
                  {currentEmoji}
                </button>
                {customCuisine ? (
                  <input
                    className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                    placeholder="e.g. Peruvian"
                    value={cuisineValue}
                    onChange={(e) => set("cuisine", e.target.value)}
                  />
                ) : (
                  <select
                    className="flex-1 bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                    value={cuisineValue}
                    onChange={(e) => set("cuisine", e.target.value)}
                  >
                    <option value="">Select…</option>
                    {CUISINE_LIST.map((c) => (
                      <option key={c} value={c}>{getEmoji(c)} {c}</option>
                    ))}
                  </select>
                )}
              </div>
              {showEmojiPicker && cuisineValue && (
                <div className="mt-2 p-2 bg-[#18181B] border border-[#27272A] rounded-lg">
                  <p className="text-[9px] text-[#52525B] mb-1.5">Emoji for {cuisineValue}</p>
                  <div className="flex flex-wrap gap-1">
                    {EMOJI_PICKER.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => { setEmoji(cuisineValue, e); setShowEmojiPicker(false); }}
                        className={`w-8 h-8 flex items-center justify-center rounded text-base hover:bg-[#27272A] transition-colors ${currentEmoji === e ? "bg-[#27272A] ring-1 ring-[#F59E0B]" : ""}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">City</label>
              <input
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                placeholder="Barcelona"
                value={form.city ?? ""}
                onChange={(e) => set("city", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Country</label>
              <input
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                placeholder="Spain"
                value={form.country ?? ""}
                onChange={(e) => set("country", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Rating MF (1–10)</label>
              <input
                type="number" min={1} max={10}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                placeholder="8"
                value={form.rating_mf ?? ""}
                onChange={(e) => set("rating_mf", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div>
              <label className="text-xs text-[#71717A] mb-1 block">Rating AD (1–10)</label>
              <input
                type="number" min={1} max={10}
                className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
                placeholder="8"
                value={form.rating_ad ?? ""}
                onChange={(e) => set("rating_ad", e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Google Maps URL</label>
            <input
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B]"
              placeholder="https://maps.app.goo.gl/…"
              value={form.google_maps_url ?? ""}
              onChange={(e) => set("google_maps_url", e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">With</label>
            <ContactsPicker
              selected={companions}
              onChange={setCompanions}
              placeholder="Who were you with?"
            />
          </div>

          <div>
            <label className="text-xs text-[#71717A] mb-1 block">Notes</label>
            <textarea
              rows={2}
              className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] resize-none"
              placeholder="Tasting notes, highlights…"
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          {/* Other visits to this restaurant */}
          {siblings.length > 0 && (
            <div>
              <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1.5">All visits</p>
              <div className="flex flex-col gap-1">
                {siblings.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onEditSibling?.(s)}
                    className="flex items-center gap-2 px-3 py-2 bg-[#18181B] border border-[#27272A] rounded-lg hover:border-[#3F3F46] transition-colors text-left"
                  >
                    <span className="text-xs text-[#52525B] w-20 shrink-0 tabular-nums">{s.date_visited ?? "—"}</span>
                    {s.rating_mf != null && (
                      <span className="text-xs font-semibold text-[#F59E0B] tabular-nums">{s.rating_mf}/10</span>
                    )}
                    {s.companions && (
                      <span className="text-xs text-[#52525B] truncate">w/ {s.companions}</span>
                    )}
                    {s.id === initial?.id && (
                      <span className="ml-auto text-[9px] text-[#3F3F46]">this</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === "edit" && onAddVisit && (
            <button
              onClick={onAddVisit}
              className="w-full border border-[#3F3F46] text-[#A1A1AA] hover:border-[#F59E0B] hover:text-[#F59E0B] rounded-lg py-2 text-sm transition-colors"
            >
              + Log another visit
            </button>
          )}

          <button
            disabled={!form.name.trim()}
            onClick={handleSave}
            className="w-full bg-[#F59E0B] hover:bg-[#D97706] disabled:bg-[#27272A] disabled:text-[#52525B] text-[#09090B] font-semibold rounded-lg py-2.5 text-sm transition-colors mt-1"
          >
            {isEdit ? "Save changes" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RestaurantsPageInner() {
  const searchParams = useSearchParams();
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterCuisine, setFilterCuisine] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addVisitFrom, setAddVisitFrom] = useState<Restaurant | null>(null);
  const [editing, setEditing] = useState<Restaurant | null>(null);
  const [deepLinked, setDeepLinked] = useState(false);
  const { getEmoji } = useCuisineEmoji();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["restaurants"] });
    queryClient.invalidateQueries({ queryKey: ["restaurant-stats"] });
  };

  const { data: restaurants = [], isLoading } = useQuery({
    queryKey: ["restaurants"],
    queryFn: () => api.restaurants(),
  });

  // Auto-open sheet when navigated from day view with ?id=
  useEffect(() => {
    if (deepLinked || restaurants.length === 0) return;
    const id = searchParams.get("id");
    if (!id) return;
    const target = restaurants.find((r) => r.id === Number(id));
    if (target) { setEditing(target); setDeepLinked(true); }
  }, [restaurants, searchParams, deepLinked]);

  const { data: stats } = useQuery({
    queryKey: ["restaurant-stats"],
    queryFn: () => api.restaurantStats(),
  });

  const createMutation = useMutation({
    mutationFn: (body: RestaurantIn) => api.createRestaurant(body),
    onSuccess: () => { invalidate(); setShowAdd(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<RestaurantIn> }) =>
      api.patchRestaurant(id, body),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteRestaurant(id),
    onSuccess: () => { invalidate(); setEditing(null); },
  });

  // Derive available years from data
  const years = Array.from(
    new Set(restaurants.map((r) => r.date_visited?.slice(0, 4)).filter(Boolean) as string[])
  ).sort((a, b) => b.localeCompare(a));

  const searchQ = search.toLowerCase().trim();

  // Group all visits by normalised name
  const visitsByName: Record<string, Restaurant[]> = {};
  restaurants.forEach((r) => {
    const key = r.name.toLowerCase().trim();
    (visitsByName[key] ??= []).push(r);
  });
  // Sort each group by date desc
  Object.values(visitsByName).forEach((arr) => arr.sort((a, b) => (b.date_visited ?? "").localeCompare(a.date_visited ?? "")));

  // Filter list
  const filtered = restaurants.filter((r) => {
    if (filterYear !== "all" && r.date_visited?.slice(0, 4) !== filterYear) return false;
    if (filterCuisine !== "all" && r.cuisine !== filterCuisine) return false;
    if (searchQ && !r.name.toLowerCase().includes(searchQ) && !(r.city ?? "").toLowerCase().includes(searchQ)) return false;
    return true;
  });

  // Existing matches for search (used to show "already in DB" hint on Add)
  const searchMatches = searchQ.length >= 2
    ? restaurants.filter((r) => r.name.toLowerCase().includes(searchQ))
    : [];

  const getSiblings = (r: Restaurant): Restaurant[] =>
    (visitsByName[r.name.toLowerCase().trim()] ?? []);

  // Top cuisines from filtered
  const cuisineCounts: Record<string, number> = {};
  restaurants.forEach((r) => {
    if (filterYear !== "all" && r.date_visited?.slice(0, 4) !== filterYear) return;
    if (r.cuisine) cuisineCounts[r.cuisine] = (cuisineCounts[r.cuisine] ?? 0) + 1;
  });
  const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).map(([c]) => c);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-28 pt-8">
      <Link
        href="/explore"
        className="text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors uppercase tracking-widest mb-3 inline-block"
      >
        ← Explore
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em] mb-1">Databases</p>
          <h1 className="text-2xl font-semibold tracking-tight">Restaurants</h1>
          {stats && (
            <p className="text-sm text-[#71717A] mt-1">
              {stats.total} visited
              {stats.avg_rating_mf != null && ` · avg ${stats.avg_rating_mf}/10`}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="mt-1 flex items-center gap-1.5 bg-[#F59E0B] hover:bg-[#D97706] text-[#09090B] text-xs font-semibold rounded-lg px-3 py-2 transition-colors shrink-0"
        >
          + Add
        </button>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{stats.total}</p>
            <p className="text-xs text-[#52525B]">Restaurants</p>
          </div>
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{Object.keys(stats.by_country).length}</p>
            <p className="text-xs text-[#52525B]">Countries</p>
          </div>
          <div className="bg-[#18181B] border border-[#27272A] rounded-xl px-3 py-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{stats.avg_rating_mf ?? "—"}</p>
            <p className="text-xs text-[#52525B]">Avg Rating</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525B] text-sm">🔍</span>
          <input
            className="w-full bg-[#18181B] border border-[#27272A] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[#FAFAFA] outline-none focus:border-[#F59E0B] transition-colors placeholder:text-[#3F3F46]"
            placeholder="Search by name or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52525B] hover:text-[#A1A1AA] text-sm"
            >
              ×
            </button>
          )}
        </div>
        {searchMatches.length > 0 && search && (
          <div className="mt-1.5 px-1">
            <p className="text-[10px] text-[#52525B] mb-1">Already in DB — tap to edit or add a visit:</p>
            <div className="flex flex-col gap-0.5">
              {searchMatches.slice(0, 4).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setEditing(r)}
                  className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-[#18181B] transition-colors"
                >
                  <span className="text-sm">{getEmoji(r.cuisine)}</span>
                  <span className="text-xs text-[#A1A1AA] flex-1 truncate">{r.name}</span>
                  <span className="text-[10px] text-[#52525B] shrink-0">{r.city}{r.date_visited ? ` · ${r.date_visited.slice(0, 7)}` : ""}</span>
                  {r.rating_mf != null && <span className="text-[10px] text-[#F59E0B] shrink-0">{r.rating_mf}/10</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Year filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
        {(["all", ...years] as string[]).map((y) => (
          <button
            key={y}
            onClick={() => setFilterYear(y)}
            className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
              filterYear === y
                ? "border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/10"
                : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
            }`}
          >
            {y === "all" ? "All time" : y}
          </button>
        ))}
      </div>

      {/* Cuisine filter pills */}
      {topCuisines.length > 0 && (
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1 scrollbar-none">
          {(["all", ...topCuisines] as string[]).map((c) => (
            <button
              key={c}
              onClick={() => setFilterCuisine(c)}
              className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
                filterCuisine === c
                  ? "border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10"
                  : "border-[#27272A] text-[#52525B] hover:text-[#A1A1AA]"
              }`}
            >
              {c === "all" ? "All cuisines" : `${getEmoji(c)} ${c}`}
            </button>
          ))}
        </div>
      )}

      {/* Top rated section */}
      {stats && stats.top_rated.length > 0 && filterYear === "all" && filterCuisine === "all" && (
        <section className="mb-6">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-3">Top Rated</h2>
          <div className="flex flex-col gap-1">
            {stats.top_rated.slice(0, 5).map((r, i) => (
              <div key={r.id} className="flex items-center gap-2 py-0.5">
                <span className="text-xs text-[#3F3F46] tabular-nums w-4 text-right shrink-0">{i + 1}</span>
                <span className="text-sm text-[#D4D4D8] flex-1 truncate">{r.name}</span>
                {r.city && <span className="text-xs text-[#52525B] truncate max-w-[80px]">{r.city}</span>}
                <RatingBar value={r.rating_mf} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Restaurant list */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs text-[#52525B] uppercase tracking-widest">
            {filtered.length} {filtered.length === 1 ? "restaurant" : "restaurants"}
          </h2>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-[#18181B] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-[#27272A] rounded-xl px-6 py-12 text-center">
            <p className="text-sm text-[#71717A]">No restaurants match your filters.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((r) => (
              <RestaurantRow
                key={r.id}
                restaurant={r}
                onEdit={() => setEditing(r)}
                getEmoji={getEmoji}
                visitCount={getSiblings(r).length}
              />
            ))}
          </div>
        )}
      </section>

      {showAdd && (
        <RestaurantSheet
          mode="add"
          onClose={() => setShowAdd(false)}
          onSave={(body) => createMutation.mutate(body)}
          defaultDate={new Date().toISOString().slice(0, 10)}
        />
      )}

      {addVisitFrom && (
        <RestaurantSheet
          mode="visit"
          onClose={() => setAddVisitFrom(null)}
          onSave={(body) => createMutation.mutate(body)}
          defaultDate={new Date().toISOString().slice(0, 10)}
          initial={{
            name: addVisitFrom.name,
            cuisine: addVisitFrom.cuisine,
            city: addVisitFrom.city,
            country: addVisitFrom.country,
            google_maps_url: addVisitFrom.google_maps_url,
          }}
        />
      )}

      {editing && (
        <RestaurantSheet
          mode="edit"
          onClose={() => setEditing(null)}
          onSave={(body) => updateMutation.mutate({ id: editing.id, body })}
          onDelete={() => deleteMutation.mutate(editing.id)}
          onAddVisit={() => { setEditing(null); setAddVisitFrom(editing); }}
          onEditSibling={(r) => setEditing(r)}
          initial={editing}
          siblings={getSiblings(editing)}
        />
      )}
    </main>
  );
}

export default function RestaurantsPage() {
  return (
    <Suspense>
      <RestaurantsPageInner />
    </Suspense>
  );
}

function RestaurantRow({ restaurant: r, onEdit, getEmoji, visitCount = 1 }: { restaurant: Restaurant; onEdit: () => void; getEmoji: (c: string | null | undefined) => string; visitCount?: number }) {
  const emoji = getEmoji(r.cuisine);
  const flag = FLAG[r.country ?? ""] ?? "";

  return (
    <div
      className="border-b border-[#1C1C1F] last:border-none py-3 flex items-center gap-3 px-2 cursor-pointer hover:bg-[#18181B] rounded-lg transition-colors"
      onClick={onEdit}
    >
      <span className="text-lg w-7 shrink-0 text-center">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#FAFAFA] truncate">{r.name}</p>
        <p className="text-xs text-[#52525B] truncate">
          {[r.city, r.country ? `${flag} ${r.country}` : null].filter(Boolean).join(" · ")}
          {r.date_visited && ` · ${r.date_visited.slice(0, 7)}`}
          {r.companions && ` · ${r.companions}`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {visitCount > 1 && (
          <span className="text-[10px] text-[#52525B] border border-[#27272A] rounded-full px-1.5 py-0.5 tabular-nums">{visitCount}×</span>
        )}
        {r.rating_mf != null && (
          <span className="text-xs font-semibold text-[#F59E0B] tabular-nums">{r.rating_mf}/10</span>
        )}
        {r.rating_ad != null && (
          <span className="text-xs text-[#71717A] tabular-nums">AD {r.rating_ad}</span>
        )}
        {r.google_maps_url && (
          <a
            href={r.google_maps_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[#52525B] hover:text-[#3B82F6] transition-colors text-sm"
            title="Open in Maps"
          >
            📍
          </a>
        )}
        <span className="text-[#3F3F46] text-xs">✎</span>
      </div>
    </div>
  );
}
