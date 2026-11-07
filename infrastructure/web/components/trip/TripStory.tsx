"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { BookOpen, Download, ImagePlus, Map as MapIcon, MapPin, Pencil, Plus } from "lucide-react";
import { activityIcon, moodEmoji } from "@/lib/api";
import { localISODate } from "@/lib/dates";
import { photoUrl, storyKey, travelApi, uploadEach, type Moment, type StoryDay, type TripStory as Story } from "@/lib/travel-api";
import { Block, Empty, Hero, Panel, Skeleton, Stat } from "@/components/ui/kit";
import { StoryMap, type StoryMapHandle } from "./StoryMap";
import { MomentSheet } from "./MomentSheet";
import { Lightbox, type LightboxPhoto } from "./Lightbox";

/** The trip's photos in story order, for the lightbox. */
function allPhotos(s: Story): LightboxPhoto[] {
  const out: LightboxPhoto[] = [];
  for (const d of s.days) {
    for (const m of d.moments) {
      for (const p of m.photos) out.push({ id: p.id, path: p.path, caption: p.caption, title: m.title ?? m.place, date: d.date });
    }
    const inMoments = new Set(d.moments.flatMap((m) => m.photos.map((p) => p.path)));
    if (d.day_photo && !inMoments.has(d.day_photo)) {
      out.push({ id: null, path: d.day_photo, caption: d.day_photo_caption, title: "Photo of the day", date: d.date });
    }
  }
  return out;
}

function km(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
}

/** Drop photos and let them find their moments (EXIF time → where you were). */
function DropPhotos({ date, onDone, children, className }: {
  date: string; onDone: () => void; children: React.ReactNode; className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  async function go(files: File[]) {
    if (!files.length) return;
    const failed = await uploadEach(files, (f) => travelApi.dropPhoto(f, date),
      (d, t) => setProgress(d < t ? `${d + 1}/${t}` : null));
    if (failed) alert(`${failed} photo${failed === 1 ? "" : "s"} couldn't be read`);
    onDone();
  }
  return (
    <>
      <button type="button" onClick={() => input.current?.click()} disabled={!!progress} className={className}>
        {progress ? <span className="tabular-nums">Adding {progress}…</span> : children}
      </button>
      <input ref={input} type="file" accept="image/*" multiple className="hidden"
             onChange={(e) => { go(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </>
  );
}

const smallBtn = "inline-flex items-center gap-1 text-xs text-[#52525B] hover:text-[#F59E0B] transition-colors disabled:opacity-60";

function PhotoGrid({ m, onOpen }: { m: Moment; onOpen: (path: string) => void }) {
  const ps = m.photos;
  if (!ps.length) return null;
  const img = (path: string, cls: string, thumb?: string | null) => (
    <button key={path} onClick={() => onOpen(path)} className={`relative overflow-hidden rounded-xl border border-[#27272A] ${cls}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl(thumb ?? path)} alt="" loading="lazy" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
    </button>
  );
  if (ps.length === 1) return <div className="mt-3">{img(ps[0].path, "block w-full aspect-[4/3]")}</div>;
  if (ps.length === 2) return <div className="mt-3 grid grid-cols-2 gap-1.5">{ps.map((p) => img(p.path, "aspect-square", p.thumb_path))}</div>;
  const rest = ps.slice(1, 4);
  return (
    <div className="mt-3 space-y-1.5">
      {img(ps[0].path, "block w-full aspect-[16/10]")}
      <div className="grid grid-cols-3 gap-1.5">
        {rest.map((p, i) => (
          <div key={p.id} className="relative">
            {img(p.path, "block w-full aspect-square", p.thumb_path)}
            {i === rest.length - 1 && ps.length > 4 && (
              <button onClick={() => onOpen(p.path)}
                      className="absolute inset-0 rounded-xl bg-black/55 text-white text-sm font-medium flex items-center justify-center">
                +{ps.length - 4}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MomentCard({ m, onEdit, onOpen }: { m: Moment; onEdit: () => void; onOpen: (path: string) => void }) {
  const title = m.title ?? m.place ?? m.city ?? "A moment";
  const where = [m.local_time, m.title ? m.place : null, m.city].filter(Boolean).join(" · ");
  return (
    <article id={`moment-${m.id}`} className="relative scroll-mt-24">
      <span className="absolute -left-[27px] top-0.5 w-[18px] h-[18px] rounded-full bg-[#F59E0B] text-black text-[9px] font-semibold flex items-center justify-center tabular-nums">
        {m.n}
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[#FAFAFA]">{title}</h3>
          {where && (
            <p className="text-xs text-[#71717A] mt-0.5 inline-flex items-center gap-1">
              {m.lat != null && <MapPin size={10} />}{where}
            </p>
          )}
        </div>
        <button onClick={onEdit} aria-label="Edit moment" className="shrink-0 text-[#3F3F46] hover:text-[#A1A1AA] p-1">
          <Pencil size={12} />
        </button>
      </div>
      {m.story && <div className="mt-2 text-sm text-[#A1A1AA] leading-relaxed whitespace-pre-line">{m.story}</div>}
      {!m.story && !m.title && (
        <button onClick={onEdit} className="mt-1 text-xs text-[#52525B] hover:text-[#A1A1AA]">Write a few lines…</button>
      )}
      <PhotoGrid m={m} onOpen={onOpen} />
    </article>
  );
}

function DayFacts({ d }: { d: StoryDay }) {
  const bits: React.ReactNode[] = [];
  if (d.km >= 1) bits.push(`${km(d.km)} km`);
  if (d.steps) bits.push(`${d.steps.toLocaleString("en-GB")} steps`);
  for (const a of d.activities) {
    bits.push(
      <Link key={a.id} href={`/activity/${encodeURIComponent(a.id)}`} className="hover:text-[#FAFAFA]">
        {activityIcon(a.activity_type)} {a.name ?? a.activity_type}
        {a.distance_meters ? ` ${(a.distance_meters / 1000).toFixed(1)} km` : ""}
      </Link>);
  }
  for (const r of d.restaurants) {
    bits.push(<Link key={`r${r.id}`} href="/explore/restaurants" className="hover:text-[#FAFAFA]">🍽 {r.name}</Link>);
  }
  if (d.spent_eur) bits.push(`€${Math.round(d.spent_eur).toLocaleString("en-GB")}`);
  if (d.mood != null) bits.push(`${moodEmoji(d.mood)} ${d.mood}`);
  if (!bits.length) return null;
  return (
    <p className="text-xs text-[#71717A] mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
      {bits.map((b, i) => <span key={i} className="inline-flex items-center gap-1">{i > 0 && <span className="text-[#3F3F46]">·</span>}{b}</span>)}
    </p>
  );
}

function Summary({ start, end, initial }: { start: string; end: string; initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  async function save() {
    if (value.trim() === saved.trim()) return;
    await travelApi.saveStory(start, end, { summary: value.trim() || null });
    setSaved(value);
  }
  return (
    <Panel className="p-4">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} rows={value ? 4 : 2}
                placeholder="The trip in a few lines — what it was about, what you'll want to remember first…"
                className="w-full bg-transparent text-sm text-[#D4D4D8] leading-relaxed placeholder:text-[#3F3F46] outline-none resize-none" />
    </Panel>
  );
}

/**
 * The trip as a story: cover, the trip in a few lines, the route with every moment numbered, then
 * each day — its moments and photos, and what Daybook recorded (km, activities, food, spend, mood,
 * the plan's line). Moments are keyed by day, so the planned and the detected trip show the same one.
 */
export function TripStory({ start, end, hero, name }: {
  start: string;
  end: string;
  /** Detected-trip page: cover + the page's one hero. The plan page has its own. */
  hero?: { eyebrow: string; value: React.ReactNode; unit?: string; sub?: string };
  name?: string | null;
}) {
  const qc = useQueryClient();
  const today = localISODate();
  const { data: s, isLoading } = useQuery({ queryKey: storyKey(start, end), queryFn: () => travelApi.story(start, end) });
  const mapRef = useRef<StoryMapHandle>(null);
  const [sheet, setSheet] = useState<{ moment?: Moment; date: string } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: storyKey(start, end) });

  const photos = useMemo(() => (s ? allPhotos(s) : []), [s]);
  const hasRoute = !!s && s.days.some((d) => d.route.length > 1 || d.moments.some((m) => m.lat != null));
  const pastDays = s ? s.days.filter((d) => d.date <= today) : [];
  const dropDate = today >= start && today <= end ? today : start;
  const title = name ?? s?.name ?? null;

  if (isLoading || !s) return <div className="space-y-4"><Skeleton h={220} /><Skeleton h={320} /></div>;

  const t = s.totals;
  const open = (path: string) => setLightbox(Math.max(0, photos.findIndex((p) => p.path === path)));
  const jump = (id: number) => document.getElementById(`moment-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const setCover = async (id: number) => {
    await travelApi.saveStory(start, end, { cover_photo_id: id });
    refresh();
  };

  return (
    <div className="space-y-8">
      {hero && (
        <div className="space-y-3">
          {s.cover && (
            <button onClick={() => open(s.cover!.path)} className="block w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(s.cover.path)} alt="" className="w-full aspect-[16/9] object-cover rounded-2xl border border-[#27272A]" />
            </button>
          )}
          <Hero eyebrow={hero.eyebrow} value={hero.value} unit={hero.unit} sub={hero.sub}>
            <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-[#27272A]">
              <Stat plain label="Km" value={km(t.km)} />
              <Stat plain label="Places" value={t.cities.length} />
              <Stat plain label="Moments" value={t.moments} />
              <Stat plain label="Photos" value={t.photos} />
            </div>
          </Hero>
        </div>
      )}

      {!hero && (t.moments > 0 || t.km > 0) && (
        <p className="text-xs text-[#71717A]">
          {t.moments} moment{t.moments === 1 ? "" : "s"} · {t.photos} photo{t.photos === 1 ? "" : "s"}
          {t.km > 0 ? ` · ${km(t.km)} km` : ""}{t.cities.length ? ` · ${t.cities.slice(0, 5).join(", ")}` : ""}
        </p>
      )}

      {(pastDays.length > 0 || s.summary) && (
        <Block title="The trip in a few lines">
          <Summary start={start} end={end} initial={s.summary} />
        </Block>
      )}

      {hasRoute && (
        <Block title="Route" note={t.moments ? "Tap a number to jump to that moment." : undefined}
               action={<button onClick={() => mapRef.current?.focusDay(null)} className={smallBtn}>Whole trip</button>}>
          <div id="trip-map" className="scroll-mt-24"><StoryMap ref={mapRef} days={s.days} onMoment={jump} /></div>
        </Block>
      )}

      <Block title="Day by day"
             note={pastDays.length ? "Write a moment, or just add photos — each finds its day, time and place on its own." : undefined}
             action={pastDays.length ? (
               <DropPhotos date={dropDate} onDone={refresh} className={smallBtn}><ImagePlus size={13} /> Add photos</DropPhotos>
             ) : undefined}>
        <div className="space-y-7">
          {s.days.map((d) => {
            const future = d.date > today;
            const isToday = d.date === today;
            return (
              <section key={d.date} id={`day-${d.date}`} className="scroll-mt-24">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-[10px] uppercase tracking-widest ${isToday ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
                      Day {d.index} · {format(parseISO(d.date), "EEE d MMM")}{isToday ? " · today" : ""}
                    </p>
                    <Link href={`/day/${d.date}`} className="text-sm font-medium text-[#FAFAFA] hover:text-[#F59E0B] transition-colors">
                      {d.cities.length ? d.cities.slice(0, 4).join(" → ") : future ? (d.plan ?? "—") : "Somewhere"}
                    </Link>
                    {!future && <DayFacts d={d} />}
                    {d.plan && (!future || d.cities.length > 0) && (
                      <p className="text-xs text-[#52525B] italic mt-1">Plan: {d.plan}</p>
                    )}
                  </div>
                  {!future && (
                    <div className="shrink-0 flex items-center gap-3 pt-0.5">
                      {hasRoute && d.route.length > 1 && (
                        <button onClick={() => { mapRef.current?.focusDay(d.date); document.getElementById("trip-map")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                                aria-label="Show on the map" className={smallBtn}><MapIcon size={13} /></button>
                      )}
                      <DropPhotos date={d.date} onDone={refresh} className={smallBtn}><ImagePlus size={13} /></DropPhotos>
                      <button onClick={() => setSheet({ date: d.date })} className={smallBtn}><Plus size={13} /> Moment</button>
                    </div>
                  )}
                </div>

                {(d.moments.length > 0 || d.notes || d.day_photo) && (
                  <div className="mt-3 ml-[9px] pl-[18px] border-l border-[#27272A] space-y-5">
                    {d.moments.map((m) => (
                      <MomentCard key={m.id} m={m} onEdit={() => setSheet({ moment: m, date: d.date })} onOpen={open} />
                    ))}
                    {d.day_photo && !d.moments.some((m) => m.photos.some((p) => p.path === d.day_photo)) && (
                      <button onClick={() => open(d.day_photo!)} className="block w-full text-left">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoUrl(d.day_photo)} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover rounded-xl border border-[#27272A]" />
                        {d.day_photo_caption && <p className="text-xs text-[#71717A] mt-1">{d.day_photo_caption}</p>}
                      </button>
                    )}
                    {d.notes && <p className="text-sm text-[#A1A1AA] whitespace-pre-line border-l-2 border-[#27272A] pl-3">{d.notes}</p>}
                  </div>
                )}
                {!future && d.moments.length === 0 && !d.notes && !d.day_photo && (
                  <div className="mt-1"><Empty>Nothing written yet.</Empty></div>
                )}
              </section>
            );
          })}
        </div>
      </Block>

      {pastDays.length > 0 && (
        <Block title="Keep it" note="A web page that opens in any browser without Daybook, with the photos, the GPS track (GPX) and all of it as data (JSON).">
          <div className="flex flex-wrap gap-2">
            <a href={travelApi.exportUrl(start, end, title)} download
               className="inline-flex items-center gap-1.5 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 transition-colors">
              <Download size={13} /> Download the trip (.zip)
            </a>
            <a href={travelApi.bookUrl(start, end, title)} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1.5 text-xs border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] rounded-lg px-3 py-1.5 transition-colors">
              <BookOpen size={13} /> Open as a book · print to PDF
            </a>
          </div>
        </Block>
      )}

      {sheet && (
        <MomentSheet moment={sheet.moment} defaultDate={sheet.date} days={s.days.map((d) => d.date).filter((d) => d <= today)}
                     onSaved={refresh} onClose={() => setSheet(null)} />
      )}
      {lightbox != null && photos.length > 0 && (
        <Lightbox photos={photos} start={lightbox} coverId={s.cover_photo_id} onCover={setCover} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
