"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, RefreshCw, Trash2, Upload } from "lucide-react";
import { Block, Empty, Hero, Panel, Skeleton, Stat, Stats } from "@/components/ui/kit";
import {
  collApi, COLL_KEYS, turnText, type CollCourse, type CollCourseDetail, type CollSettings,
} from "@/lib/coll-api";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
const input = "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-[#52525B] focus:outline-none focus:border-[#3F3F46]";
const small = "inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors";

interface Goal { id: number; name: string; race_date: string; status: string }

function fmtDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function statusLine(c: CollCourse): React.ReactNode {
  if (c.status === "pending") return <span className="text-[#F59E0B]">waiting to build</span>;
  if (c.status === "building") return <span className="text-[#F59E0B]">building{c.progress ? ` · ${c.progress.trim()}` : "…"}</span>;
  if (c.status === "failed") return <span className="text-rose-400">failed · {c.error}</span>;
  return (
    <>
      {c.km} km · {c.turns} prompts{c.keeps ? ` (${c.keeps} keep)` : ""} · {Math.round((c.bytes ?? 0) / 1024)} KB
      {c.matched_pct !== null && c.matched_pct < 95 && <span className="text-rose-400"> · {c.matched_pct}% on mapped roads</span>}
    </>
  );
}

/** Coll — the bike computer. Every routed session lands here on its own; uploads for anything else. */
export function CollTab() {
  const qc = useQueryClient();
  const { data: courses } = useQuery({
    queryKey: COLL_KEYS.courses, queryFn: collApi.courses,
    // builds take minutes (map data from OpenStreetMap): poll while one is running
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === "pending" || c.status === "building") ? 5000 : false),
  });
  const { data: settings } = useQuery({ queryKey: COLL_KEYS.settings, queryFn: collApi.settings });
  const { data: goals } = useQuery<Goal[]>({
    queryKey: ["race-goals"], queryFn: () => fetch(`${API}/race-plans/goals`).then((r) => r.json()),
  });
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [raceGoal, setRaceGoal] = useState<number | "">("");
  const file = useRef<HTMLInputElement>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["coll"] });
  };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    const notes: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const r = await collApi.upload(await f.text(), f.name.replace(/\.gpx$/i, ""), raceGoal || null);
        if (r.duplicate) notes.push(`${f.name}: already here`);
      } catch (e) {
        notes.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (file.current) file.current.value = "";
    setMsg(notes.join(" · ") || null);
    refresh();
  }

  if (!courses || !settings) return <Skeleton h={320} />;

  const onColl = courses.filter((c) => c.synced);
  const planned = courses.filter((c) => c.auto);
  const uploads = courses.filter((c) => !c.auto);
  const next = onColl.filter((c) => c.session_date).sort((a, b) => (a.session_date! < b.session_date! ? -1 : 1))[0];
  const activeGoals = (goals ?? []).filter((g) => g.status === "active");

  const list = (items: CollCourse[]) => (
    <Panel className="divide-y divide-[#18181B]">
      {items.map((c) => (
        <div key={c.id}>
          <button onClick={() => setOpen(open === c.id ? null : c.id)}
                  className="w-full text-left px-4 py-2.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {c.name}
                {c.session_date && <span className="text-[#71717A] font-normal"> · {fmtDate(c.session_date)}</span>}
              </p>
              <p className="text-xs text-[#71717A] mt-0.5 truncate">{statusLine(c)}</p>
              {c.synced && c.fuel_plan_now && <p className="text-xs text-[#52525B] mt-0.5">Fuel {c.fuel_plan_now}</p>}
            </div>
            <span className={`text-[10px] uppercase tracking-widest mt-1 ${c.synced ? "text-[#F59E0B]" : "text-[#52525B]"}`}>
              {c.synced ? "on Coll" : c.on_device ? (c.status === "ready" ? "later" : "") : "off"}
            </span>
            {open === c.id ? <ChevronUp size={14} className="text-[#52525B] mt-1" /> : <ChevronDown size={14} className="text-[#52525B] mt-1" />}
          </button>
          {open === c.id && <CourseDetail id={c.id} settings={settings} onChange={refresh} onGone={() => { setOpen(null); refresh(); }} />}
        </div>
      ))}
    </Panel>
  );

  return (
    <div className="space-y-8">
      <Hero eyebrow="On Coll" value={onColl.length} unit={onColl.length === 1 ? "course" : "courses"}
            sub={next ? <>Next: {next.name} · {fmtDate(next.session_date!)}</> : "Routed sessions land here on their own"}>
        {!settings.token_configured && (
          <p className="text-xs text-rose-400 mt-3">COLL_TOKEN isn&apos;t set in the Pi&apos;s .env — Coll can&apos;t sync yet.</p>
        )}
      </Hero>

      <Block title="Planned rides"
             note="Every session with a GPX route becomes a course with its own fuel plan. Coll keeps yesterday to three weeks ahead.">
        {planned.length ? list(planned) : <Empty>No routed sessions yet — add a GPX to a tour day or a ride in the plan.</Empty>}
      </Block>

      <Block title="Uploaded courses" note="Anything else: a race course, a loop from home. Stays on Coll until switched off."
             action={
               <button onClick={() => file.current?.click()} className={`${small} text-[#F59E0B] hover:text-[#F59E0B]`}>
                 <Upload size={13} />GPX
               </button>
             }>
        <input ref={file} type="file" accept=".gpx,application/gpx+xml" multiple className="hidden"
               onChange={(e) => upload(e.target.files)} />
        {activeGoals.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-[#71717A] mb-3">
            Upload as the course of
            <select value={raceGoal} onChange={(e) => setRaceGoal(e.target.value ? Number(e.target.value) : "")}
                    className="bg-[#18181B] border border-[#27272A] rounded-lg px-2 py-1 text-xs text-[#A1A1AA]">
              <option value="">no race</option>
              {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        {msg && <p className="text-xs text-[#71717A] mb-3">{msg}</p>}
        {uploads.length ? list(uploads) : <Empty>No uploads.</Empty>}
      </Block>

      <SettingsBlock settings={settings} onChange={refresh} />
    </div>
  );
}

function CourseDetail({ id, settings, onChange, onGone }: {
  id: number; settings: CollSettings; onChange: () => void; onGone: () => void;
}) {
  const qc = useQueryClient();
  const { data: c } = useQuery({ queryKey: COLL_KEYS.course(id), queryFn: () => collApi.course(id) });
  const [err, setErr] = useState<string | null>(null);
  const [allTurns, setAllTurns] = useState(false);

  if (!c) return <div className="px-4 pb-4"><Skeleton h={80} /></div>;

  async function save(body: Parameters<typeof collApi.patch>[1]) {
    setErr(null);
    try {
      qc.setQueryData(COLL_KEYS.course(id), await collApi.patch(id, body));
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const s = c.summary ?? {};
  const turns = allTurns ? c.turns : c.turns.slice(0, 12);
  const isRace = c.goal_id !== null;

  return (
    <div className="px-4 pb-4 space-y-4">
      {c.status === "ready" && (
        <Stats cols={4}>
          <Stat label="Prompts" value={c.turns.length} sub={`${s.keeps ?? 0} keep · ${s.roundabouts ?? 0} rbt`} />
          <Stat label="On roads" value={s.matched_pct ?? "—"} unit="%" />
          <Stat label="Waypoints" value={c.waypoints ?? 0}
                sub={s.waypoint_kinds ? `${s.waypoint_kinds.feed} feed · ${s.waypoint_kinds.summit} top` : undefined} />
          <Stat label="Tunnels" value={s.tunnels?.length ?? 0} sub={s.has_elevation === false ? "no elevation" : "fixed"} />
        </Stats>
      )}

      {c.session_id && (
        <p className="text-xs text-[#71717A]">
          From the plan{c.session_date && <> · <Link href={`/day/${c.session_date}`} className="underline hover:text-[#A1A1AA]">{fmtDate(c.session_date)}</Link></>}
          {" "}— a new route on that day replaces this course.
        </p>
      )}

      {/* Fuel: derived from the session / race and your products, or typed here */}
      <div>
        <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Fuel reminders</p>
        <p className="text-sm text-[#A1A1AA]">{c.fuel.fuel_plan ?? "—"}
          <span className="text-xs text-[#52525B]"> · {c.fuel.source ? `from the ${c.fuel.source}` : "none"}</span></p>
        <p className="text-xs text-[#52525B] mt-0.5">{c.fuel.note}</p>
        <input className={`${input} mt-2`} placeholder={`Override, e.g. Gel:30:25,Drink:20 (${settings.fuel_product?.name ?? "carb product"} per Settings below)`}
               defaultValue={c.fuel_plan ?? ""} key={`f${c.fuel_plan}`}
               onBlur={(e) => e.target.value.trim() !== (c.fuel_plan ?? "") && save({ fuel_plan: e.target.value })} />
      </div>

      {isRace && (
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Cut-off times</p>
          <input className={input} placeholder="Temps tall@13:30; 225@19:00 Sa Granja"
                 defaultValue={c.cutoffs ?? ""} key={`c${c.cutoffs}`}
                 onBlur={(e) => e.target.value.trim() !== (c.cutoffs ?? "") && save({ cutoffs: e.target.value })} />
          <p className="text-xs text-[#52525B] mt-1">
            km or a waypoint name, @ local time. Coll beeps when the projected margin drops under 15 min.
            {s.waypoint_names?.length ? <> Waypoints: {s.waypoint_names.slice(0, 8).join(", ")}{s.waypoint_names.length > 8 ? "…" : ""}</> : null}
          </p>
        </div>
      )}

      {c.turns.length > 0 && (
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">What Coll will say</p>
          <div className="bg-[#18181B] rounded-xl divide-y divide-[#27272A]">
            {turns.map((t, i) => (
              <div key={i} className="px-3 py-1.5 flex gap-3 text-xs">
                <span className="text-[#52525B] w-16 shrink-0 tabular-nums">km {(t.at / 1000).toFixed(1)}</span>
                <span className={t.kind === 1 ? "text-[#F59E0B]" : "text-[#A1A1AA]"}>{turnText(t)}</span>
              </div>
            ))}
          </div>
          {c.turns.length > 12 && (
            <button onClick={() => setAllTurns(!allTurns)} className={`${small} mt-1`}>
              {allTurns ? "Fewer" : `All ${c.turns.length}`}
            </button>
          )}
          {(s.keeps ?? 0) > 0 && <p className="text-xs text-[#52525B] mt-1">KEEP prompts (amber) are the ones worth checking against the map.</p>}
        </div>
      )}

      {err && <p className="text-xs text-rose-400">{err}</p>}
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-1.5 text-xs text-[#71717A]">
          <input type="checkbox" checked={c.on_device} onChange={(e) => save({ on_device: e.target.checked })} />
          On Coll
        </label>
        <button className={small} disabled={c.status === "building"}
                onClick={async () => { qc.setQueryData(COLL_KEYS.course(id), await collApi.rebuild(id)); onChange(); }}>
          <RefreshCw size={12} />Rebuild
        </button>
        {!c.auto && (
          <button className={`${small} hover:text-rose-400`}
                  onClick={async () => { if (confirm(`Delete ${c.name}?`)) { await collApi.remove(id); onGone(); } }}>
            <Trash2 size={12} />Delete
          </button>
        )}
      </div>
    </div>
  );
}

function SettingsBlock({ settings: s, onChange }: { settings: CollSettings; onChange: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  async function put(body: Parameters<typeof collApi.putSettings>[0]) {
    setErr(null);
    try {
      qc.setQueryData(COLL_KEYS.settings, await collApi.putSettings(body));
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Block title="What Coll rides with" note="From Daybook: weight, age, HR zones (ride), timezone. Changes reach Coll at its next sync.">
      <Panel className="p-4 space-y-4">
        <Stats cols={3}>
          <Stat label="Weight" value={s.profile.weight_kg ?? "—"} unit="kg" />
          <Stat label="Age" value={s.profile.age ?? "—"} sub={s.profile.sex ?? undefined} />
          <Stat label="Max HR" value={s.max_hr ?? "—"} />
        </Stats>
        {s.hr_zones && (
          <p className="text-xs text-[#71717A]">
            Zones (top bpm) {s.hr_zones.map((z, i) => `Z${i + 1} ${z}`).join(" · ")} · {s.timezone}
          </p>
        )}
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Carb product for the fuel plans</p>
          <select value={s.fuel_product?.id ?? ""} onChange={(e) => put({ fuel_product_id: e.target.value ? Number(e.target.value) : null })}
                  className={input}>
            {s.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.carbs_g} g{p.caffeine_mg ? ` · ${p.caffeine_mg} mg caffeine` : ""}</option>)}
          </select>
          <p className="text-xs text-[#52525B] mt-1">
            Products come from <Link href="/omyra?tab=fuel" className="underline hover:text-[#A1A1AA]">Fuel</Link>; each ride&apos;s
            carbs/h and fluid follow its session (length, zone, gut training as the race gets closer, sweat rate).
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[#52525B] uppercase tracking-widest mb-1">Default for rides without a course</p>
          <input className={input} placeholder="Drink:20,Gel:40:25" defaultValue={s.fuel_plan ?? ""} key={`d${s.fuel_plan}`}
                 onBlur={(e) => e.target.value.trim() !== (s.fuel_plan ?? "") && put({ fuel_plan: e.target.value })} />
        </div>
        {err && <p className="text-xs text-rose-400">{err}</p>}
      </Panel>
    </Block>
  );
}
