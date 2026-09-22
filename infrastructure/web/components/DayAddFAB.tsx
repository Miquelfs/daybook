"use client";

import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { X, Plus, UtensilsCrossed, BookOpen, Apple, Plane } from "lucide-react";
import { api, type RestaurantIn } from "@/lib/api";
import { FoodEntryComposer } from "@/components/FoodEntryComposer";
import { BookForm } from "@/components/books/BookForm";
import { PassengerFlightForm } from "@/components/PassengerFlightForm";

type Mode = "food" | "restaurant" | "book" | "flight";

function RestaurantForm({ date, onDone }: { date: string; onDone: () => void }) {
  const qc = useQueryClient();
  // Existing cuisines/cities/countries → native autocomplete so you reuse a
  // category instead of typing it blind (and spawning near-duplicates).
  const { data: facets } = useQuery({
    queryKey: ["restaurant-facets"],
    queryFn: () => api.restaurantFacets(),
    staleTime: 5 * 60 * 1000,
  });
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [ratingMf, setRatingMf] = useState("");
  const [ratingAd, setRatingAd] = useState("");
  const [companions, setCompanions] = useState("");
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
        cuisine: cuisine.trim() || undefined,
        rating_mf: ratingMf ? parseFloat(ratingMf) : undefined,
        rating_ad: ratingAd ? parseFloat(ratingAd) : undefined,
        companions: companions.trim() || undefined,
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
      <input value={cuisine} onChange={e => setCuisine(e.target.value)}
        placeholder="Cuisine" list="restaurant-cuisines" autoComplete="off"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      {cuisine.trim() && facets?.cuisines && !facets.cuisines.some(c => c.toLowerCase() === cuisine.trim().toLowerCase()) && (
        <p className="text-[11px] text-[#71717A] -mt-1">New cuisine — will be added to the list</p>
      )}
      <datalist id="restaurant-cuisines">
        {(facets?.cuisines ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="restaurant-cities">
        {(facets?.cities ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <datalist id="restaurant-countries">
        {(facets?.countries ?? []).map(c => <option key={c} value={c} />)}
      </datalist>
      <div className="grid grid-cols-2 gap-2">
        <input value={ratingMf} onChange={e => setRatingMf(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="My rating (0–10)"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
        <input value={ratingAd} onChange={e => setRatingAd(e.target.value)}
          type="number" min="0" max="10" step="0.5" placeholder="Partner rating"
          className="bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
      </div>
      <input value={companions} onChange={e => setCompanions(e.target.value)}
        placeholder="With (e.g. Adri, Mum)"
        className="w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-[#3F3F46]" />
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

const MODE_META: Record<Mode, { label: string; icon: React.ReactNode; color: string }> = {
  food:       { label: "Food", icon: <Apple size={15} />, color: "text-amber-400" },
  restaurant: { label: "Restaurant", icon: <UtensilsCrossed size={15} />, color: "text-orange-400" },
  book:       { label: "Book", icon: <BookOpen size={15} />, color: "text-emerald-400" },
  flight:     { label: "Flight", icon: <Plane size={15} />, color: "text-sky-400" },
};

export function DayAddFAB({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("food");

  function close() { setOpen(false); }

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
            <div className="bg-[#111113] rounded-t-2xl border border-[#27272A] border-b-0 px-5 pb-8 pt-4">
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
                {(Object.keys(MODE_META) as Mode[]).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      mode === m ? "bg-[#27272A] text-[#FAFAFA]" : "text-[#52525B] hover:text-[#A1A1AA]"
                    }`}>
                    {MODE_META[m].icon}{MODE_META[m].label}
                  </button>
                ))}
              </div>

              {/* Form */}
              {mode === "food"       && <FoodEntryComposer date={date} onDone={close} />}
              {mode === "restaurant" && <RestaurantForm date={date} onDone={close} />}
              {mode === "book"       && <BookForm defaultDate={date} onSaved={close} />}
              {mode === "flight"     && <PassengerFlightForm date={date} onSaved={close} />}
            </div>
          </div>
        </>
      )}
    </>
  );
}
