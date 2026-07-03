"use client";

import { useEffect, useRef, useState } from "react";
import type { PantryItem } from "@/lib/api";

interface Props {
  initialItems: PantryItem[];
}

interface SearchResult {
  id: string;
  name: string;
  price?: number;
  unit?: string;
}

const CATEGORIES = ["dairy", "produce", "meat", "fish", "bakery", "pantry", "frozen", "drinks", "other"];

export function PantryPanel({ initialItems }: Props) {
  const [items, setItems] = useState(initialItems);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Add-item form state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("pantry");
  const [newUnit, setNewUnit] = useState("");
  const [newMercadonaId, setNewMercadonaId] = useState("");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const grouped = CATEGORIES.reduce<Record<string, PantryItem[]>>((acc, cat) => {
    acc[cat] = items.filter((i) => (i.category || "other") === cat);
    return acc;
  }, {});

  // Debounced search
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/groceries/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  function pickResult(r: SearchResult) {
    setSelectedResult(r);
    setNewName(r.name);
    setNewMercadonaId(r.id);
    if (r.unit) setNewUnit(r.unit);
    setSearchQuery("");
    setSearchResults([]);
  }

  function resetForm() {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedResult(null);
    setNewName("");
    setNewCategory("pantry");
    setNewUnit("");
    setNewMercadonaId("");
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/groceries/prices/sync", { method: "POST" });
      const data = await res.json();
      setSyncResult(`Synced ${data.synced} prices · ${data.skipped} skipped · ${data.errors} errors`);
      const refreshed = await fetch("/api/groceries/pantry").then((r) => r.json());
      setItems(refreshed);
    } catch {
      setSyncResult("Sync failed — mercadona-cli may not be installed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    try {
      const res = await fetch("/api/groceries/pantry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          category: newCategory,
          unit: newUnit.trim() || null,
          mercadona_id: newMercadonaId.trim() || null,
        }),
      });
      const item = await res.json();
      setItems((prev) => [...prev, item]);
      resetForm();
      setAdding(false);
    } catch {
      // silent
    }
  }

  async function handleDelete(itemId: string) {
    await fetch(`/api/groceries/pantry/${itemId}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[#F59E0B] uppercase tracking-[0.2em]">Pantry</p>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="text-xs text-[#52525B] hover:text-[#71717A] transition-colors disabled:opacity-40"
          >
            {syncing ? "Syncing…" : "↻ Sync prices"}
          </button>
          <button
            onClick={() => { setAdding((v) => !v); resetForm(); }}
            className="text-xs px-3 py-1.5 rounded-full bg-[#F59E0B] text-[#18181B] font-medium hover:bg-[#FBBF24] transition-colors"
          >
            + Add item
          </button>
        </div>
      </div>

      {syncResult && (
        <p className="text-xs text-[#71717A] mb-4">{syncResult}</p>
      )}

      {adding && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-4 mb-6 space-y-3">
          {/* Search box */}
          <div className="relative">
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSelectedResult(null); setNewName(""); setNewMercadonaId(""); }}
              placeholder="Search Mercadona catalog…"
              className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] placeholder-[#52525B] focus:outline-none focus:border-[#F59E0B]"
            />
            {searching && (
              <span className="absolute right-3 top-2 text-xs text-[#52525B]">…</span>
            )}
            {searchResults.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#09090B] border border-[#27272A] rounded-lg overflow-hidden shadow-xl">
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => pickResult(r)}
                    className="w-full text-left px-3 py-2.5 text-sm text-[#E4E4E7] hover:bg-[#18181B] flex items-center justify-between border-b border-[#1A1A1E] last:border-0"
                  >
                    <span>{r.name}</span>
                    <span className="text-xs text-[#52525B]">ID {r.id}{r.price != null ? ` · €${r.price}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Divider + manual entry hint */}
          <p className="text-[10px] text-[#3F3F46] text-center">— or enter manually —</p>

          {/* Name field (pre-filled from search result, or manual) */}
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Item name"
            className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] placeholder-[#52525B] focus:outline-none focus:border-[#F59E0B]"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] focus:outline-none focus:border-[#F59E0B]"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              placeholder="Unit (kg, L, ud…)"
              className="bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#E4E4E7] placeholder-[#52525B] focus:outline-none focus:border-[#F59E0B]"
            />
          </div>

          {/* Mercadona ID — shown but de-emphasized; auto-filled from search */}
          <input
            value={newMercadonaId}
            onChange={(e) => setNewMercadonaId(e.target.value)}
            placeholder="Mercadona ID (auto-filled from search)"
            className="w-full bg-[#09090B] border border-[#1A1A1E] rounded-lg px-3 py-2 text-xs text-[#3F3F46] placeholder-[#3F3F46] focus:outline-none focus:border-[#52525B]"
          />

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setAdding(false); resetForm(); }}
              className="text-xs px-3 py-1.5 rounded-full border border-[#27272A] text-[#71717A] hover:text-[#A1A1AA] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="text-xs px-3 py-1.5 rounded-full bg-[#F59E0B] text-[#18181B] font-medium hover:bg-[#FBBF24] transition-colors disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {items.length === 0 && !adding && (
        <div className="bg-[#18181B] rounded-xl border border-[#27272A] p-6 text-center">
          <p className="text-sm text-[#52525B]">No pantry items yet.</p>
        </div>
      )}

      <div className="space-y-6">
        {CATEGORIES.map((cat) => {
          const catItems = grouped[cat] || [];
          if (catItems.length === 0) return null;
          return (
            <div key={cat}>
              <h2 className="text-xs text-[#52525B] uppercase tracking-widest mb-2 capitalize">{cat}</h2>
              <div className="space-y-1">
                {catItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[#18181B] rounded-xl border border-[#27272A] px-4 py-3 flex items-center justify-between group"
                  >
                    <div>
                      <p className="text-sm text-[#E4E4E7]">
                        {item.name}
                        {item.unit && <span className="text-xs text-[#52525B] ml-1">/{item.unit}</span>}
                      </p>
                      {item.mercadona_id && (
                        <p className="text-xs text-[#3F3F46] mt-0.5">ID: {item.mercadona_id}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {item.latest_price != null && (
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[#A1A1AA]">€{item.latest_price.toFixed(2)}</p>
                          {item.price_date && (
                            <p className="text-[10px] text-[#3F3F46]">{item.price_date}</p>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-[#3F3F46] hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
