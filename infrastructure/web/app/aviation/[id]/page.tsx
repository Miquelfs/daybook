"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, PlaneTakeoff, PlaneLanding, Clock, Users,
  Fuel, AlertTriangle, FileText, Loader, Pencil, X, Check, Trash2,
} from "lucide-react";
import { api } from "@/lib/api";

function hhmm(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m > 0 ? `${m}m` : ""}`.trim();
}

function utcTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.length >= 16 ? iso.slice(11, 16) + " UTC" : iso;
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#18181B] rounded-lg p-4 mb-3">
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-[#52525B]">{icon}</span>}
        <p className="text-xs font-medium text-[#71717A] uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#27272A] last:border-0">
      <span className="text-xs text-[#71717A]">{label}</span>
      <span className={`text-sm font-mono tabular-nums ${highlight ? "text-sky-400" : "text-[#FAFAFA]"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function NumInput({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit?: string }) {
  return (
    <div>
      <p className="text-xs text-[#52525B] mb-1">{label}{unit ? ` (${unit})` : ""}</p>
      <input
        type="number" min={0}
        className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-sky-500 tabular-nums"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="—"
      />
    </div>
  );
}

export default function FlightDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [editingOps, setEditingOps] = useState(false);
  const [editingTimes, setEditingTimes] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Operational data edit state
  const [epaxTotal, setEpaxTotal] = useState("");
  const [epaxAdult, setEpaxAdult] = useState("");
  const [epaxChild, setEpaxChild] = useState("");
  const [epaxInfant, setEpaxInfant] = useState("");
  const [efreight, setEfreight] = useState("");
  const [ebaggage, setEbaggage] = useState("");
  const [efuelUplift, setEfuelUplift] = useState("");
  const [efuelBlock, setEfuelBlock] = useState("");
  const [efuelArrival, setEfuelArrival] = useState("");
  const [edelayMin, setEdelayMin] = useState("");
  const [edelayCode, setEdelayCode] = useState("");
  const [edelayReason, setEdelayReason] = useState("");

  // Flight times / crew edit state
  const [etBlockSeconds, setEtBlockSeconds] = useState("");
  const [etAirborneSeconds, setEtAirborneSeconds] = useState("");
  const [etNightSeconds, setEtNightSeconds] = useState("");
  const [etIfrSeconds, setEtIfrSeconds] = useState("");
  const [etCrewRole, setEtCrewRole] = useState("");
  const [etPicName, setEtPicName] = useState("");
  const [etTodDay, setEtTodDay] = useState("");
  const [etTodNight, setEtTodNight] = useState("");
  const [etLdgDay, setEtLdgDay] = useState("");
  const [etLdgNight, setEtLdgNight] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["flight", id],
    queryFn: () => api.flight(id),
    enabled: !!id,
  });

  const { mutate: deleteFlight, isPending: deleting } = useMutation({
    mutationFn: () => api.deleteFlight(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flights"] });
      qc.invalidateQueries({ queryKey: ["flightStats"] });
      router.push("/aviation");
    },
  });

  const { mutate: saveNotes, isPending: savingNotes } = useMutation({
    mutationFn: () => api.patchFlight(id, { notes: notes ?? "" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flight", id] });
      setEditingNotes(false);
    },
  });

  const { mutate: saveOps, isPending: savingOps } = useMutation({
    mutationFn: () => {
      const toInt = (s: string) => s !== "" ? parseInt(s, 10) : undefined;
      const toFloat = (s: string) => s !== "" ? parseFloat(s) : undefined;
      return api.patchFlight(id, {
        pax_total: toInt(epaxTotal),
        pax_adult: toInt(epaxAdult),
        pax_child: toInt(epaxChild),
        pax_infant: toInt(epaxInfant),
        freight_kg: toFloat(efreight),
        baggage_kg: toFloat(ebaggage),
        fuel_uplift_kg: toFloat(efuelUplift),
        fuel_block_kg: toFloat(efuelBlock),
        fuel_burn_kg: efuelBlock !== "" && efuelArrival !== ""
          ? parseFloat(efuelBlock) - parseFloat(efuelArrival)
          : undefined,
        delay_minutes: toInt(edelayMin),
        delay_code: edelayCode || undefined,
        delay_reason: edelayReason || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flight", id] });
      setEditingOps(false);
    },
  });

  const { mutate: saveTimes, isPending: savingTimes } = useMutation({
    mutationFn: () => {
      const toInt = (s: string) => s !== "" ? parseInt(s, 10) : undefined;
      return api.patchFlight(id, {
        block_seconds: toInt(etBlockSeconds),
        airborne_seconds: toInt(etAirborneSeconds),
        night_seconds: toInt(etNightSeconds),
        ifr_seconds: toInt(etIfrSeconds),
        crew_role: etCrewRole || undefined,
        pic_name: etPicName || undefined,
        takeoffs_day: toInt(etTodDay),
        takeoffs_night: toInt(etTodNight),
        landings_day: toInt(etLdgDay),
        landings_night: toInt(etLdgNight),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flight", id] });
      qc.invalidateQueries({ queryKey: ["flightStats"] });
      setEditingTimes(false);
    },
  });

  function openTimesEdit(f: typeof data) {
    if (!f) return;
    setEtBlockSeconds(f.block_seconds?.toString() ?? "");
    setEtAirborneSeconds(f.airborne_seconds?.toString() ?? "");
    setEtNightSeconds(f.night_seconds?.toString() ?? "");
    setEtIfrSeconds(f.ifr_seconds?.toString() ?? "");
    setEtCrewRole(f.crew_role ?? "");
    setEtPicName((f as any).pic_name ?? "");
    setEtTodDay(f.takeoffs_day?.toString() ?? "");
    setEtTodNight(f.takeoffs_night?.toString() ?? "");
    setEtLdgDay(f.landings_day?.toString() ?? "");
    setEtLdgNight(f.landings_night?.toString() ?? "");
    setEditingTimes(true);
  }

  function openOpsEdit(f: typeof data) {
    if (!f) return;
    setEpaxTotal(f.pax_total?.toString() ?? "");
    setEpaxAdult(f.pax_adult?.toString() ?? "");
    setEpaxChild(f.pax_child?.toString() ?? "");
    setEpaxInfant(f.pax_infant?.toString() ?? "");
    setEfreight(f.freight_kg?.toString() ?? "");
    setEbaggage(f.baggage_kg?.toString() ?? "");
    setEfuelUplift(f.fuel_uplift_kg?.toString() ?? "");
    setEfuelBlock(f.fuel_block_kg?.toString() ?? "");
    // Pre-populate arrival fuel as block_out - burn if both exist
    const arrivalFuel = f.fuel_block_kg != null && f.fuel_burn_kg != null
      ? (f.fuel_block_kg - f.fuel_burn_kg).toString()
      : "";
    setEfuelArrival(arrivalFuel);
    setEdelayMin(f.delay_minutes?.toString() ?? "");
    setEdelayCode(f.delay_code ?? "");
    setEdelayReason(f.delay_reason ?? "");
    setEditingOps(true);
  }

  const f = data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader size={20} className="animate-spin text-[#52525B]" />
      </div>
    );
  }

  if (error || !f) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-8 text-center text-[#71717A]">
        Flight not found.{" "}
        <Link href="/aviation" className="text-sky-400 underline">Back to logbook</Link>
      </div>
    );
  }

  const depLabel = f.dep_icao ? (f.dep_iata ? `${f.dep_icao} / ${f.dep_iata}` : f.dep_icao) : "?";
  const arrLabel = f.arr_icao ? (f.arr_iata ? `${f.arr_icao} / ${f.arr_iata}` : f.arr_icao) : "?";
  const depCity = f.dep_airport ? `${f.dep_airport.name || ""}, ${f.dep_airport.country || ""}` : "";
  const arrCity = f.arr_airport ? `${f.arr_airport.name || ""}, ${f.arr_airport.country || ""}` : "";
  const role = f.crew_role === "pic" ? "PIC" : f.crew_role === "first_officer" ? "First Officer" : f.crew_role || "—";

  const hasPax = f.pax_total != null || f.freight_kg != null || f.baggage_kg != null;
  const hasFuel = f.fuel_block_kg != null || f.fuel_burn_kg != null || f.fuel_uplift_kg != null;
  const hasDelay = f.delay_minutes != null && f.delay_minutes > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-24">
      {/* Back */}
      <div className="flex items-center justify-between mb-4">
        <Link href="/aviation" className="flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#A1A1AA] transition-colors">
          <ArrowLeft size={14} />
          Logbook
        </Link>
        {f.source === "manual" && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#71717A]">Delete this flight?</span>
              <button
                onClick={() => deleteFlight()}
                disabled={deleting}
                className="flex items-center gap-1 px-2.5 py-1 text-xs bg-red-900/60 hover:bg-red-800 text-red-300 rounded-lg transition-colors disabled:opacity-40"
              >
                {deleting ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1 text-xs text-[#52525B] hover:text-[#A1A1AA] transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-[#52525B] hover:text-red-400 transition-colors"
            >
              <Trash2 size={13} />
              Delete
            </button>
          )
        )}
      </div>

      {/* Route header */}
      <div className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-[#FAFAFA] font-mono tracking-tight">
            {depLabel} → {arrLabel}
          </h1>
          {f.flight_number && (
            <span className="text-[#71717A] text-sm font-mono">{f.flight_number}</span>
          )}
        </div>
        {(depCity || arrCity) && (
          <p className="text-xs text-[#52525B] mt-1">
            {depCity}{depCity && arrCity ? " → " : ""}{arrCity}
          </p>
        )}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-sm text-[#71717A]">{f.date}</span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded ${f.crew_role === "pic" ? "bg-violet-900/50 text-violet-300" : "bg-[#27272A] text-[#71717A]"}`}>
            {role}
          </span>
          {f.is_sim && <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-400">FSTD</span>}
        </div>
      </div>

      {/* Times */}
      <Section title="Times" icon={<Clock size={14} />}>
        <div className="grid grid-cols-4 gap-2 text-center mb-3">
          {[
            { label: "Off Block", value: utcTime(f.off_block_utc), icon: <PlaneTakeoff size={10} /> },
            { label: "Takeoff", value: utcTime(f.takeoff_utc), icon: <PlaneTakeoff size={10} /> },
            { label: "Landing", value: utcTime(f.landing_utc), icon: <PlaneLanding size={10} /> },
            { label: "On Block", value: utcTime(f.on_block_utc), icon: <PlaneLanding size={10} /> },
          ].map(({ label, value, icon }) => (
            <div key={label} className="bg-[#09090B] rounded-lg p-2">
              <div className="flex justify-center text-[#52525B] mb-1">{icon}</div>
              <p className="text-sm font-mono text-[#FAFAFA] tabular-nums">{value}</p>
              <p className="text-xs text-[#52525B] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <Row label="Block time" value={hhmm(f.block_seconds)} highlight />
        <Row label="Airborne time" value={hhmm(f.airborne_seconds)} />
        {f.distance_nm && <Row label="Distance" value={`${f.distance_nm.toLocaleString()} NM`} />}
        <Row label="Night" value={hhmm(f.night_seconds)} />
        <Row label="IFR" value={hhmm(f.ifr_seconds)} />
      </Section>

      {/* Crew & Aircraft */}
      <Section title="Crew & Aircraft">
        <Row label="Role" value={role} />
        {f.takeoff_crew && <Row label="Takeoff crew" value={f.takeoff_crew} />}
        {f.landing_crew && <Row label="Landing crew" value={f.landing_crew} />}
        <Row label="Registration" value={f.aircraft_reg} />
        <Row label="Aircraft type" value={f.aircraft_type} />
        <Row label="Operator" value={f.operator} />
      </Section>

      {/* Personal T/O & Landings */}
      <Section title="Takeoffs & Landings" icon={<PlaneTakeoff size={14} />}>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: "T/O Day", value: f.takeoffs_day },
            { label: "T/O Night", value: f.takeoffs_night },
            { label: "Ldg Day", value: f.landings_day },
            { label: "Ldg Night", value: f.landings_night },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#09090B] rounded-lg p-3">
              <p className="text-xl font-semibold text-[#FAFAFA] tabular-nums">{value}</p>
              <p className="text-xs text-[#52525B] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* PIC / SIC hours */}
      <Section title="Flight Time">
        <Row label="PIC" value={hhmm(f.pic_seconds)} />
        <Row label="First Officer (SIC)" value={hhmm(f.sic_seconds)} />
      </Section>

      {/* Edit flight times / crew — available on all flights */}
      {editingTimes ? (
        <div className="bg-[#18181B] rounded-lg p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-[#71717A] uppercase tracking-wider">Edit Times & Crew</p>
            <button onClick={() => setEditingTimes(false)} className="text-[#52525B] hover:text-[#A1A1AA]"><X size={14} /></button>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-[#52525B] mb-2">Time (seconds)</p>
              <div className="grid grid-cols-2 gap-2">
                <NumInput label="Block" value={etBlockSeconds} onChange={setEtBlockSeconds} unit="s" />
                <NumInput label="Airborne" value={etAirborneSeconds} onChange={setEtAirborneSeconds} unit="s" />
                <NumInput label="Night" value={etNightSeconds} onChange={setEtNightSeconds} unit="s" />
                <NumInput label="IFR" value={etIfrSeconds} onChange={setEtIfrSeconds} unit="s" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-[#52525B] mb-1">Crew Role</p>
                <select
                  className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-sky-500"
                  value={etCrewRole}
                  onChange={e => setEtCrewRole(e.target.value)}
                >
                  <option value="pic">PIC</option>
                  <option value="first_officer">First Officer</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-[#52525B] mb-1">PIC Name</p>
                <input
                  className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-sky-500"
                  value={etPicName}
                  onChange={e => setEtPicName(e.target.value)}
                  placeholder="Captain's name"
                />
              </div>
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-2">Personal T/O & Landings</p>
              <div className="grid grid-cols-4 gap-2">
                <NumInput label="T/O Day" value={etTodDay} onChange={setEtTodDay} />
                <NumInput label="T/O Night" value={etTodNight} onChange={setEtTodNight} />
                <NumInput label="Ldg Day" value={etLdgDay} onChange={setEtLdgDay} />
                <NumInput label="Ldg Night" value={etLdgNight} onChange={setEtLdgNight} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => saveTimes()}
                disabled={savingTimes}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                {savingTimes ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                Save
              </button>
              <button onClick={() => setEditingTimes(false)} className="px-3 py-1.5 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => openTimesEdit(f)}
          className="flex items-center gap-2 text-xs text-[#52525B] hover:text-[#71717A] transition-colors mb-3 w-full justify-center py-2 border border-dashed border-[#27272A] rounded-lg"
        >
          <Pencil size={11} />
          Edit times, night, IFR, crew role, T/O &amp; landings
        </button>
      )}

      {/* Operational data: pax / fuel / delay — view or edit */}
      {editingOps ? (
        <div className="bg-[#18181B] rounded-lg p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-[#71717A] uppercase tracking-wider">Operational Data</p>
            <button onClick={() => setEditingOps(false)} className="text-[#52525B] hover:text-[#A1A1AA]">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-[#52525B] mb-2">Passengers</p>
              <div className="grid grid-cols-4 gap-2">
                <NumInput label="Total" value={epaxTotal} onChange={setEpaxTotal} />
                <NumInput label="Adult" value={epaxAdult} onChange={setEpaxAdult} />
                <NumInput label="Child" value={epaxChild} onChange={setEpaxChild} />
                <NumInput label="Infant" value={epaxInfant} onChange={setEpaxInfant} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumInput label="Freight" value={efreight} onChange={setEfreight} unit="kg" />
              <NumInput label="Baggage" value={ebaggage} onChange={setEbaggage} unit="kg" />
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-2">Fuel (kg)</p>
              <div className="grid grid-cols-3 gap-2">
                <NumInput label="Uplift" value={efuelUplift} onChange={setEfuelUplift} />
                <NumInput label="Block out" value={efuelBlock} onChange={setEfuelBlock} />
                <NumInput label="Block in (arrival)" value={efuelArrival} onChange={setEfuelArrival} />
              </div>
              {efuelBlock !== "" && efuelArrival !== "" && (
                <p className="text-xs text-[#52525B] mt-1.5">
                  Burn: <span className="text-[#A1A1AA]">{(parseFloat(efuelBlock) - parseFloat(efuelArrival)).toFixed(0)} kg</span>
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-[#52525B] mb-2">Delay</p>
              <div className="grid grid-cols-3 gap-2">
                <NumInput label="Minutes" value={edelayMin} onChange={setEdelayMin} />
                <div>
                  <p className="text-xs text-[#52525B] mb-1">Code</p>
                  <input
                    className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-sky-500"
                    value={edelayCode} onChange={e => setEdelayCode(e.target.value)} placeholder="—"
                  />
                </div>
                <div>
                  <p className="text-xs text-[#52525B] mb-1">Reason</p>
                  <input
                    className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-2 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:border-sky-500"
                    value={edelayReason} onChange={e => setEdelayReason(e.target.value)} placeholder="—"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => saveOps()}
                disabled={savingOps}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                {savingOps ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                Save
              </button>
              <button
                onClick={() => setEditingOps(false)}
                className="px-3 py-1.5 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Passengers */}
          {hasPax && (
            <Section title="Passengers" icon={<Users size={14} />}>
              <Row label="Total pax" value={f.pax_total} highlight />
              {f.pax_adult != null && <Row label="Adult" value={f.pax_adult} />}
              {f.pax_child != null && <Row label="Child" value={f.pax_child} />}
              {f.pax_infant != null && <Row label="Infant" value={f.pax_infant} />}
              {f.freight_kg != null && <Row label="Freight" value={`${f.freight_kg} kg`} />}
              {f.baggage_kg != null && <Row label="Baggage" value={`${f.baggage_kg} kg`} />}
            </Section>
          )}

          {/* Fuel */}
          {hasFuel && (
            <Section title="Fuel" icon={<Fuel size={14} />}>
              {f.fuel_uplift_kg != null && <Row label="Uplift" value={`${f.fuel_uplift_kg.toLocaleString()} kg`} />}
              {f.fuel_block_kg != null && <Row label="Block fuel out" value={`${f.fuel_block_kg.toLocaleString()} kg`} />}
              {f.fuel_trip_kg != null && <Row label="Trip fuel" value={`${f.fuel_trip_kg.toLocaleString()} kg`} />}
              {f.fuel_reserves_kg != null && <Row label="Reserves" value={`${f.fuel_reserves_kg.toLocaleString()} kg`} />}
              {f.fuel_burn_kg != null && <Row label="Actual burn" value={`${f.fuel_burn_kg.toLocaleString()} kg`} highlight />}
              {f.fuel_burn_diff_kg != null && (
                <Row
                  label="Burn diff (actual − planned)"
                  value={`${f.fuel_burn_diff_kg > 0 ? "+" : ""}${f.fuel_burn_diff_kg} kg`}
                />
              )}
            </Section>
          )}

          {/* Delay */}
          {hasDelay && (
            <Section title="Delay" icon={<AlertTriangle size={14} />}>
              <Row label="Delay" value={`${f.delay_minutes} min`} />
              {f.delay_code && <Row label="Code" value={f.delay_code} />}
              {f.delay_reason && <Row label="Reason" value={f.delay_reason} />}
            </Section>
          )}

          {/* Edit operational data button */}
          <button
            onClick={() => openOpsEdit(f)}
            className="flex items-center gap-2 text-xs text-[#52525B] hover:text-[#71717A] transition-colors mb-3 w-full justify-center py-2 border border-dashed border-[#27272A] rounded-lg"
          >
            <Pencil size={11} />
            {hasPax || hasFuel || hasDelay ? "Edit operational data (pax, fuel, delay)" : "Add operational data (pax, fuel, delay)"}
          </button>
        </>
      )}

      {/* Notes */}
      <Section title="Notes" icon={<FileText size={14} />}>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              className="w-full bg-[#09090B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-sky-500 resize-none"
              rows={4}
              value={notes ?? ""}
              onChange={e => setNotes(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => saveNotes()}
                disabled={savingNotes}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                {savingNotes ? <Loader size={12} className="animate-spin" /> : null}
                Save
              </button>
              <button
                onClick={() => { setEditingNotes(false); setNotes(null); }}
                className="px-3 py-1.5 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="cursor-pointer group"
            onClick={() => { setNotes(f.notes ?? ""); setEditingNotes(true); }}
          >
            {f.notes ? (
              <p className="text-sm text-[#A1A1AA] group-hover:text-[#FAFAFA] transition-colors">{f.notes}</p>
            ) : (
              <p className="text-sm text-[#52525B] group-hover:text-[#71717A] transition-colors italic">
                Click to add notes…
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
