"use client";

import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { ImagePlus, MapPin, X } from "lucide-react";
import { Sheet, Field, inputCls } from "@/components/plan/Sheet";
import { photoUrl, travelApi, uploadEach, type Moment } from "@/lib/travel-api";

/**
 * Write a moment: a title, a few lines, photos. Where and when fill themselves in (the photo's GPS
 * or your Overland track at that minute); the place can still be typed by hand.
 */
export function MomentSheet({ moment, days, defaultDate, onClose, onSaved }: {
  moment?: Moment;
  days: string[];
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(moment?.title ?? "");
  const [story, setStory] = useState(moment?.story ?? "");
  const [day, setDay] = useState(moment?.date ?? defaultDate);
  const [time, setTime] = useState(moment?.local_time ?? "");
  const [place, setPlace] = useState(moment?.place_source === "manual" ? moment.place ?? "" : "");
  const [photos, setPhotos] = useState(moment?.photos ?? []);
  const [queued, setQueued] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  const autoPlace = moment && moment.place_source !== "manual"
    ? [moment.place, moment.city, moment.country].filter(Boolean).join(", ") : "";

  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (!moment) { setQueued((q) => [...q, ...files]); return; }
    const failed = await uploadEach(files, async (f) => {
      const m = await travelApi.addPhoto(moment.id, f);
      setPhotos(m.photos);
    }, (d, t) => setBusy(d < t ? `Adding photo ${d + 1} of ${t}…` : null));
    if (failed) setError(`${failed} photo${failed === 1 ? "" : "s"} couldn't be read`);
    onSaved();
  }

  async function removePhoto(id: number) {
    await travelApi.deletePhoto(id);
    setPhotos((p) => p.filter((x) => x.id !== id));
    onSaved();
  }

  async function save() {
    setError(null);
    setBusy("Saving…");
    try {
      const body = {
        date: day,
        title: title.trim() || null,
        story: story.trim() || null,
        place: place.trim() || null,
        ...(moment ? (time !== (moment.local_time ?? "") ? { time: time || null } : {}) : { time: time || null }),
      };
      if (moment && moment.place_source !== "manual" && !place.trim()) delete (body as { place?: string | null }).place;
      const saved = moment ? await travelApi.updateMoment(moment.id, body) : await travelApi.createMoment(body);
      if (queued.length) {
        const failed = await uploadEach(queued, (f) => travelApi.addPhoto(saved.id, f),
          (d, t) => setBusy(d < t ? `Adding photo ${d + 1} of ${t}…` : "Saving…"));
        if (failed) { setError(`${failed} photo${failed === 1 ? "" : "s"} couldn't be read`); setBusy(null); onSaved(); return; }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      setBusy(null);
    }
  }

  async function remove() {
    if (!moment || !confirm("Delete this moment and its photos?")) return;
    setBusy("Deleting…");
    await travelApi.deleteMoment(moment.id).catch(() => null);
    onSaved();
    onClose();
  }

  return (
    <Sheet title={moment ? "Edit moment" : "New moment"} onClose={onClose}>
      <input className={inputCls} placeholder="What happened — Night market in Raohe" autoFocus={!moment}
             value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea rows={5} className={`${inputCls} resize-none leading-relaxed`}
                placeholder="A few lines for future you: who was there, what it smelled like, what you'd tell someone…"
                value={story} onChange={(e) => setStory(e.target.value)} />

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Day">
          <select className={inputCls} value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d, i) => <option key={d} value={d}>Day {i + 1} · {format(parseISO(d), "EEE d MMM")}</option>)}
          </select>
        </Field>
        <Field label="Time (local)">
          <input type="time" className={`${inputCls} w-28`} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      <Field label="Place">
        <input className={inputCls} value={place} onChange={(e) => setPlace(e.target.value)}
               placeholder={autoPlace || "Found from your track — or type it"} />
      </Field>
      {autoPlace && !place && (
        <p className="-mt-2 text-xs text-[#52525B] inline-flex items-center gap-1">
          <MapPin size={11} /> {moment?.place_source === "exif" ? "From the photo" : "From your track"}: {autoPlace}
        </p>
      )}

      <div>
        <span className="text-xs text-[#71717A] mb-1 block">Photos</span>
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden border border-[#27272A]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(p.thumb_path ?? p.path)} alt="" className="w-full h-full object-cover" />
              <button onClick={() => removePhoto(p.id)} aria-label="Remove photo"
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center">
                <X size={11} />
              </button>
            </div>
          ))}
          {queued.map((f, i) => (
            <div key={`q${i}`} className="relative aspect-square rounded-lg overflow-hidden border border-dashed border-[#3F3F46]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover opacity-70" />
              <button onClick={() => setQueued((q) => q.filter((_, j) => j !== i))} aria-label="Remove photo"
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center">
                <X size={11} />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => pick.current?.click()} disabled={!!busy}
                  className="aspect-square rounded-lg border border-dashed border-[#3F3F46] text-[#52525B] hover:text-[#F59E0B] hover:border-[#F59E0B]/40 flex flex-col items-center justify-center gap-1 text-[10px]">
            <ImagePlus size={16} /> Add
          </button>
        </div>
        <input ref={pick} type="file" accept="image/*" multiple className="hidden"
               onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>

      {error && <p className="text-rose-400 text-xs">{error}</p>}

      <button onClick={save} disabled={!!busy}
              className="w-full bg-[#F59E0B] text-black font-semibold rounded-xl py-3 text-sm disabled:opacity-40">
        {busy ?? (moment ? "Save" : "Add moment")}
      </button>
      {moment && (
        <div className="flex justify-end text-xs">
          <button onClick={remove} disabled={!!busy} className="text-rose-400/80 hover:text-rose-400">Delete moment</button>
        </div>
      )}
    </Sheet>
  );
}
