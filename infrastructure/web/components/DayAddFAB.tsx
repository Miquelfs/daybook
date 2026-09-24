"use client";

import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { X, Plus, UtensilsCrossed, BookOpen, Apple, Plane, Wallet, Sparkles, Pencil, Trash2 } from "lucide-react";
import { api, type RestaurantIn, type Contact } from "@/lib/api";
import { booksApi, type Book } from "@/lib/books-api";
import { passengerFlightsApi, type PassengerFlight } from "@/lib/passenger-flights-api";
import { foodApi, type FoodEntry } from "@/lib/food-api";
import { moneyApi } from "@/lib/money-api";
import { FoodEntryComposer } from "@/components/FoodEntryComposer";
import { BookForm } from "@/components/books/BookForm";
import { PassengerFlightForm } from "@/components/PassengerFlightForm";
import { ContactsPicker } from "@/components/ContactsPicker";
import { AddExpenseSheet } from "@/components/money/AddExpenseSheet";
import { AddEventSheet } from "@/components/life/AddEventSheet";
import { CUISINE_EMOJI, CUISINE_LIST } from "@/lib/cuisines";

type Mode = "food" | "restaurant" | "book" | "flight";

function RestaurantForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  // Existing cities/countries → native autocomplete so you reuse a category
  // instead of typing it blind (and spawning near-duplicates).
  const { data: facets } = useQuery({
    queryKey: ["restaurant-facets"],
    queryFn: () => api.restaurantFacets(),
    staleTime: 5 * 60 * 1000,
  });
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [customCuisine, setCustomCuisine] = useState("");
  const [ratingMf, setRatingMf] = useState("");
  const [ratingAd, setRatingAd] = useState("");
  const [companions, setCompanions] = useState<Contact[]>([]);
  const [tripContext, setTripContext] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body: RestaurantIn = {
        name: name.trim(),
        date_visited: date,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        cuisine: customCuisine.trim() || cuisine || undefined,
        rating_mf: ratingMf ? parseFloat(ratingMf) : undefined,
        rating_ad: ratingAd ? parseFloat(ratingAd) : undefined,
        companions: companions.map((c) => c.name).join(", ") || undefined,
        trip_context: tripContext.trim() || undefined,
        google_maps_url: googleMapsUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await api.createRestaurant(body);
      qc.invalidateQueries({ queryKey: ["day-restaurants", date] });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input required value={name} onChange={e => setName(e.target.value)}
        placeholder="Restaurant name *"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <div className="grid grid-cols-2 gap-2">
        <input value={city} onChange={e => setCity(e.target.value)}
          placeholder="City" list="restaurant-cities" autoComplete="off"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={country} onChange={e => setCountry(e.target.value)}
          placeholder="Country" list="restaurant-countries" autoComplete="off"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <datalist id="restaurant-cities">
        {(facets?.cities ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="restaurant-countries">
        {(facets?.countries ?? []).map(c => <option key={c} value={c} />)}
      </datalist>

      {/* Cuisine — curated pills (same list as the full database page) + a
          free-text fallback for anything not already on it. */}
      <div>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {CUISINE_LIST.map((c) => (
            <button key={c} type="button"
              onClick={() => { setCuisine(c); setCustomCuisine(""); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                cuisine === c && !customCuisine
                  ? "bg-[#F59E0B] text-[#09090B]"
                  : "bg-[#18181B] border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] hover:border-[#3F3F46]"
              }`}>
              <span>{CUISINE_EMOJI[c]}</span>{c}
            </button>
          ))}
        </div>
        <input value={customCuisine} onChange={e => setCustomCuisine(e.target.value)}
          placeholder="Or type a new cuisine…"
          className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={ratingMf} onChange={e => setRatingMf(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="My rating (0–10)"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={ratingAd} onChange={e => setRatingAd(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="Partner rating"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <ContactsPicker selected={companions} onChange={setCompanions} placeholder="With (e.g. Adri, Mum)" />
      <input value={tripContext} onChange={e => setTripContext(e.target.value)}
        placeholder="Trip context (optional)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <input value={googleMapsUrl} onChange={e => setGoogleMapsUrl(e.target.value)}
        placeholder="Google Maps URL (optional)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)" rows={2}
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46] resize-none" />
      <button type="submit" disabled={saving || !name.trim()}
        className="w-full bg-[#F59E0B] hover:bg-[#FBBF24] disabled:opacity-40 text-black font-semibold text-sm rounded-lg py-2.5 transition-colors">
        {saving ? "Saving…" : "Add restaurant"}
      </button>
    </form>
  );
}

// Compact "already logged today" rows shared by Book/Flight/Food — lets the
// FAB edit/delete what you added instead of only ever creating new entries.
function MiniRow({ icon, label, sub, onEdit, onDelete }: {
  icon: React.ReactNode; label: string; sub?: string;
  onEdit?: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#D4D4D8] truncate">{label}</p>
        {sub && <p className="text-xs text-[#52525B] truncate">{sub}</p>}
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className="p-1 text-[#52525B] hover:text-[#A1A1AA]" aria-label="Edit">
          <Pencil size={13} />
        </button>
      )}
      <button type="button" onClick={onDelete} className="p-1 text-[#52525B] hover:text-red-400" aria-label="Delete">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

const MODE_META: Record<Mode, { label: string; icon: React.ReactNode }> = {
  food:       { label: "Food", icon: <Apple size={15} /> },
  restaurant: { label: "Restaurant", icon: <UtensilsCrossed size={15} /> },
  book:       { label: "Book", icon: <BookOpen size={15} /> },
  flight:     { label: "Flight", icon: <Plane size={15} /> },
};

// "transaction" and "event" don't hold an inline form in the sheet — they
// hand off to the exact same standalone add-sheet the money/life-in-weeks
// sections already use, so behaviour is identical rather than a re-build.
const LAUNCHER_META: Record<"transaction" | "event", { label: string; icon: React.ReactNode }> = {
  transaction: { label: "Transaction", icon: <Wallet size={15} /> },
  event: { label: "Event", icon: <Sparkles size={15} /> },
};

// Display order across both inline-form modes and launchers.
const TAB_ORDER: (Mode | "transaction" | "event")[] = ["transaction", "food", "restaurant", "book", "event", "flight"];

export function DayAddFAB({ date }: { date: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("food");
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | undefined>(undefined);
  const [editingFlight, setEditingFlight] = useState<PassengerFlight | undefined>(undefined);

  const { data: meta } = useQuery({ queryKey: ["money", "meta"], queryFn: () => moneyApi.meta() });
  const { data: todaysBooks = [] } = useQuery({
    queryKey: ["day-books", date], queryFn: () => booksApi.list({ date }), enabled: open,
  });
  const { data: todaysFlights = [] } = useQuery({
    queryKey: ["day-passenger-flights", date], queryFn: () => passengerFlightsApi.list({ date }), enabled: open,
  });
  const { data: todaysFood = [] } = useQuery({
    queryKey: ["day-food-entries", date], queryFn: () => foodApi.listEntries({ date }), enabled: open,
  });

  function close() {
    setOpen(false);
    setEditingBook(undefined);
    setEditingFlight(undefined);
  }

  function selectMode(m: Mode) {
    setMode(m);
    setEditingBook(undefined);
    setEditingFlight(undefined);
  }

  async function deleteBook(id: number) {
    await booksApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-books", date] });
  }
  async function deleteFlight(id: number) {
    await passengerFlightsApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-passenger-flights", date] });
  }
  async function deleteFood(id: number) {
    await foodApi.delete(id);
    qc.invalidateQueries({ queryKey: ["day-food-entries", date] });
    qc.invalidateQueries({ queryKey: ["day-food", date] });
    qc.invalidateQueries({ queryKey: ["food-summary", date] });
  }

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-[#F59E0B] hover:bg-[#FBBF24] text-black rounded-full flex items-center justify-center shadow-lg transition-colors"
        aria-label="Add entry"
      >
        <Plus size={22} strokeWidth={2.5} />
      </button>

      {/* Sheet */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={close} />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto">
            <div className="bg-[#111113] rounded-t-2xl border border-[#27272A] border-b-0 px-5 pb-8 pt-4 max-h-[90vh] overflow-y-auto">
              {/* Handle */}
              <div className="flex justify-center mb-4">
                <div className="w-10 h-1 rounded-full bg-[#3F3F46]" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-[#FAFAFA]">Add to today</p>
                <button onClick={close} className="p-1.5 rounded-lg hover:bg-[#27272A] transition-colors">
                  <X size={16} className="text-[#71717A]" />
                </button>
              </div>

              {/* Type selector */}
              <div className="flex gap-0 bg-[#0D0D0F] border border-[#27272A] rounded-lg p-1 mb-5 overflow-x-auto">
                {TAB_ORDER.map(key => {
                  if (key === "transaction" || key === "event") {
                    const l = LAUNCHER_META[key];
                    return (
                      <button key={key}
                        onClick={() => { setOpen(false); if (key === "transaction") setMoneyOpen(true); else setEventOpen(true); }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap text-[#52525B] hover:text-[#A1A1AA] transition-colors">
                        {l.icon}{l.label}
                      </button>
                    );
                  }
                  const m = MODE_META[key];
                  return (
                    <button key={key} onClick={() => selectMode(key)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                        mode === key ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                      }`}>
                      {m.icon}{m.label}
                    </button>
                  );
                })}
              </div>

              {/* Form */}
              {mode === "food" && (
                <div className="flex flex-col gap-3">
                  {todaysFood.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {todaysFood.map((f: FoodEntry) => (
                        <MiniRow key={f.id} icon="🍽" label={f.description}
                          sub={[f.meal_type, `${f.kcal} kcal`].filter(Boolean).join(" · ")}
                          onDelete={() => deleteFood(f.id)} />
                      ))}
                    </div>
                  )}
                  <FoodEntryComposer date={date} onDone={close} />
                </div>
              )}
              {mode === "restaurant" && <RestaurantForm date={date} onDone={close} />}
              {mode === "book" && (
                <div className="flex flex-col gap-3">
                  {todaysBooks.length > 0 && !editingBook && (
                    <div className="flex flex-col gap-1.5">
                      {todaysBooks.map((b: Book) => (
                        <MiniRow key={b.id} icon="📖" label={b.title} sub={b.author}
                          onEdit={() => setEditingBook(b)} onDelete={() => deleteBook(b.id)} />
                      ))}
                    </div>
                  )}
                  <BookForm
                    key={editingBook?.id ?? "new-book"}
                    initial={editingBook}
                    defaultDate={date}
                    onSaved={() => { setEditingBook(undefined); qc.invalidateQueries({ queryKey: ["day-books", date] }); close(); }}
                    onDeleted={() => { setEditingBook(undefined); qc.invalidateQueries({ queryKey: ["day-books", date] }); close(); }}
                  />
                  {editingBook && (
                    <button type="button" onClick={() => setEditingBook(undefined)}
                      className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors">
                      Cancel edit — add a different book instead
                    </button>
                  )}
                </div>
              )}
              {mode === "flight" && (
                <div className="flex flex-col gap-3">
                  {todaysFlights.length > 0 && !editingFlight && (
                    <div className="flex flex-col gap-1.5">
                      {todaysFlights.map((f: PassengerFlight) => (
                        <MiniRow key={f.id} icon="✈️"
                          label={[f.origin, f.destination].filter(Boolean).join(" → ") || "Flight"}
                          sub={[f.airline, f.flight_number].filter(Boolean).join(" · ")}
                          onEdit={() => setEditingFlight(f)} onDelete={() => deleteFlight(f.id)} />
                      ))}
                    </div>
                  )}
                  <PassengerFlightForm
                    key={editingFlight?.id ?? "new-flight"}
                    date={date}
                    initial={editingFlight}
                    submitLabel={editingFlight ? "Save changes" : "Add flight"}
                    onSaved={() => { setEditingFlight(undefined); qc.invalidateQueries({ queryKey: ["day-passenger-flights", date] }); close(); }}
                  />
                  {editingFlight && (
                    <button type="button" onClick={() => setEditingFlight(undefined)}
                      className="text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors">
                      Cancel edit — add a different flight instead
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Transaction and Event reuse the exact sheets used on the money
          section / Life in Weeks, so behaviour is identical, not re-built. */}
      {meta && (
        <AddExpenseSheet date={date} isOpen={moneyOpen} onClose={() => setMoneyOpen(false)} meta={meta} />
      )}
      <AddEventSheet isOpen={eventOpen} onClose={() => setEventOpen(false)} prefillDate={date} />
    </>
  );
}
