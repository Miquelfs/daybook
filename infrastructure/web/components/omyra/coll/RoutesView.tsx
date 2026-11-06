"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Upload } from "lucide-react";
import { ActionButton, Block, Empty, Panel } from "@/components/ui/kit";
import { GradeProfile } from "@/components/training/StageProfile";
import { CollMap } from "@/components/omyra/CollMap";
import { collApi, type CollCourse, type CollMapLine } from "@/lib/coll-api";
import { daysTo, quiet, routeLine, routeState, StateTag, whenText } from "./parts";

function RouteRow({ c, onOpen }: { c: CollCourse; onOpen: () => void }) {
  const b = c.brief;
  const day = b?.date;
  return (
    <button onClick={onOpen} className="w-full text-left px-4 py-3 hover:bg-[#18181B] transition-colors group">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{c.name}</p>
          <p className="text-xs text-[#71717A] mt-0.5 truncate tabular-nums">
            {day && <span className="text-[#A1A1AA]">{whenText(day)} · </span>}
            {routeLine(b) ?? (c.status === "failed" ? "couldn't read this GPX" : "reading the route…")}
            {c.goal_id !== null && " · race course"}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 pt-0.5">
          <StateTag step={routeState(c)} />
          <ChevronRight size={14} className="text-[#3F3F46] group-hover:text-[#71717A]" />
        </div>
      </div>
      {b && b.profile.length > 2 && <div className="mt-2 opacity-90"><GradeProfile profile={b.profile} compact height={26} /></div>}
    </button>
  );
}

/** Every route: what's coming up, the library of uploads, and the past planned days. */
export function RoutesView({ courses, lines, onOpen, onChange }: {
  courses: CollCourse[]; lines: CollMapLine[]; onOpen: (id: number) => void; onChange: () => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    setBusy(true);
    const notes: string[] = [];
    let last: number | null = null;
    for (const f of Array.from(files)) {
      try {
        const r = await collApi.upload(await f.text(), f.name.replace(/\.gpx$/i, ""));
        last = r.id;
        if (r.duplicate) notes.push(`${f.name} is already here`);
      } catch (e) {
        notes.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (file.current) file.current.value = "";
    setBusy(false);
    setMsg(notes.join(" · ") || null);
    onChange();
    if (files.length === 1 && last && !notes.length) onOpen(last);
  }

  const dated = courses.filter((c) => c.brief?.date ?? c.session_date);
  const dateOf = (c: CollCourse) => (c.brief?.date ?? c.session_date)!;
  const upcoming = dated.filter((c) => daysTo(dateOf(c)) >= -1).sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const past = dated.filter((c) => daysTo(dateOf(c)) < -1).sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  const library = courses.filter((c) => !dated.includes(c));

  const list = (items: CollCourse[]) => (
    <Panel className="divide-y divide-[#18181B] overflow-hidden">
      {items.map((c) => <RouteRow key={c.id} c={c} onOpen={() => onOpen(c.id)} />)}
    </Panel>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#71717A]">
          Import a GPX, or give a day in the plan a route. Daybook converts it, Coll takes it at home, the ride comes back.
        </p>
        <ActionButton icon={Upload} onClick={() => file.current?.click()}>{busy ? "Importing…" : "Import GPX"}</ActionButton>
        <input ref={file} type="file" accept=".gpx,application/gpx+xml" multiple className="hidden"
               onChange={(e) => upload(e.target.files)} />
      </div>
      {msg && <p className="text-xs text-[#71717A] -mt-6">{msg}</p>}

      {lines.length > 0 && (
        <Panel className="overflow-hidden">
          <CollMap lines={lines} onSelect={onOpen} height="300px" bare />
          <p className="px-4 py-2 text-[11px] text-[#52525B] border-t border-[#18181B]">
            Solid: on Coll now · dashed: not on Coll · tap a route to open it
          </p>
        </Panel>
      )}

      <Block title="Coming up">
        {upcoming.length ? list(upcoming) : <Empty>Nothing planned with a route. Give a ride in the plan a GPX, or import one.</Empty>}
      </Block>

      <Block title="Library" note="Routes without a day: race courses, loops from home. They stay on Coll until you switch them off.">
        {library.length ? list(library) : <Empty>No routes yet.</Empty>}
      </Block>

      {past.length > 0 && (
        <div>
          <button onClick={() => setShowPast(!showPast)} className={quiet}>
            {showPast ? <ChevronUp size={12} /> : <ChevronDown size={12} />}Past days ({past.length})
          </button>
          {showPast && <div className="mt-3">{list(past)}</div>}
        </div>
      )}
    </div>
  );
}
