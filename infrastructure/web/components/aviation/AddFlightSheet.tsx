"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader, PlaneTakeoff, PlaneLanding, ChevronDown, ChevronRight } from "lucide-react";
import { api, type FlightIn, type AirportInfo } from "@/lib/api";

interface Props {
  date: string;
  isOpen: boolean;
  onClose: () => void;
}

const ROLES = ["pic", "first_officer", "other"] as const;
const SIM_TYPES = ["FFS", "FNPTII", "FNPTI", "FTD", "Other"] as const;
const OPERATORS = ["Norwegian", "Ryanair", "Aerolink", "Other"] as const;
const AIRCRAFT_PRESETS = ["Boeing 737-800", "Boeing 737 MAX 8", "Other"] as const;
const PIC_NAMES_KEY = "daybook_pic_names";

function hhmm_to_seconds(hhmm: string): number | undefined {
  if (!hhmm || !hhmm.includes(":")) return undefined;
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return undefined;
  return h * 3600 + m * 60;
}

function seconds_to_hhmm(s: number | undefined): string {
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function utc_diff_seconds(a: string, b: string): number | undefined {
  if (!a || !b || !a.includes(":") || !b.includes(":")) return undefined;
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  if (isNaN(ah) || isNaN(am) || isNaN(bh) || isNaN(bm)) return undefined;
  let diff = (bh * 60 + bm) - (ah * 60 + am);
  if (diff <= 0) diff += 24 * 60; // midnight crossing
  return diff * 60;
}

function getPicNames(): string[] {
  try { return JSON.parse(localStorage.getItem(PIC_NAMES_KEY) || "[]"); }
  catch { return []; }
}

function savePicName(name: string) {
  const names = getPicNames();
  if (name && !names.includes(name)) {
    localStorage.setItem(PIC_NAMES_KEY, JSON.stringify([name, ...names].slice(0, 20)));
  }
}

// ─── AirportInput hoisted OUTSIDE parent to prevent focus loss ────────────────

const inputCls = "w-full bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#52525B] focus:outline-none focus:border-sky-500";
const labelCls = "block text-xs text-[#71717A] mb-1";

interface AirportInputProps {
  label: string;
  value: string;
  query: string;
  setQuery: (v: string) => void;
  setValue: (v: string) => void;
  suggestions: AirportInfo[];
  clearSuggestions: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function AirportInput({ label, value, query, setQuery, setValue, suggestions, clearSuggestions, inputRef }: AirportInputProps) {
  return (
    <div className="relative">
      <label className={labelCls}>{label}</label>
      <input
        ref={inputRef}
        className={inputCls}
        placeholder="ICAO or IATA (e.g. LEMD)"
        value={value || query}
        onChange={e => { setQuery(e.target.value); setValue(""); }}
      />
      {suggestions.length > 0 && !value && (
        <div className="absolute z-50 top-full left-0 right-0 bg-[#18181B] border border-[#27272A] rounded-lg mt-1 max-h-40 overflow-y-auto">
          {suggestions.map(s => (
            <button
              key={s.icao}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#27272A] text-[#A1A1AA]"
              onClick={() => {
                setValue(s.icao);
                setQuery(`${s.icao}${s.iata ? ` / ${s.iata}` : ""}${s.city ? ` ${s.city}` : ""}`);
                clearSuggestions();
              }}
            >
              <span className="text-[#FAFAFA] font-mono">{s.icao}</span>
              {s.iata && <span className="text-[#52525B] ml-1">/ {s.iata}</span>}
              {s.city && <span className="ml-2">{s.city}{s.country ? `, ${s.country}` : ""}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function formatPicDisplay(raw: string): string {
  // 6-letter crew code → keep as-is
  if (/^[A-Za-z]{6}$/.test(raw.trim())) return raw.trim().toUpperCase();
  // Full name "Firstname Lastname" → "F.LASTNAME"
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return raw.toUpperCase();
  return `${parts[0][0].toUpperCase()}.${parts.slice(1).join(" ").toUpperCase()}`;
}

export function AddFlightSheet({ date, isOpen, onClose }: Props) {
  const qc = useQueryClient();

  const [flightDate, setFlightDate] = useState(date);
  const [depIcao, setDepIcao] = useState("");
  const [arrIcao, setArrIcao] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [reg, setReg] = useState("");
  const [typePreset, setTypePreset] = useState<string>("Boeing 737-800");
  const [typeCustom, setTypeCustom] = useState("");
  const [operatorPreset, setOperatorPreset] = useState<string>("Norwegian");
  const [operatorCustom, setOperatorCustom] = useState("");
  const [role, setRole] = useState<string>("first_officer");
  const [picName, setPicName] = useState("");
  const [picNameOpen, setPicNameOpen] = useState(false);
  const [savedPicNames, setSavedPicNames] = useState<string[]>([]);

  const { data: dbCaptains } = useQuery({
    queryKey: ["flightCaptains"],
    queryFn: api.flightCaptains,
    staleTime: 5 * 60 * 1000,
  });
  const [offBlock, setOffBlock] = useState("");
  const [onBlock, setOnBlock] = useState("");
  const [takeoffUtc, setTakeoffUtc] = useState("");
  const [landingUtc, setLandingUtc] = useState("");
  const [blockTime, setBlockTime] = useState("");
  const [flightTime, setFlightTime] = useState("");
  const [isSim, setIsSim] = useState(false);
  const [simType, setSimType] = useState("");
  const [todDay, setTodDay] = useState(0);
  const [todNight, setTodNight] = useState(0);
  const [ldgDay, setLdgDay] = useState(0);
  const [ldgNight, setLdgNight] = useState(0);
  const [notes, setNotes] = useState("");
  const [opDataOpen, setOpDataOpen] = useState(false);

  // Operational data
  const [paxTotal, setPaxTotal] = useState<string>("");
  const [paxAdult, setPaxAdult] = useState<string>("");
  const [paxChild, setPaxChild] = useState<string>("");
  const [paxInfant, setPaxInfant] = useState<string>("");
  const [freightKg, setFreightKg] = useState<string>("");
  const [baggageKg, setBaggageKg] = useState<string>("");
  const [fuelUplift, setFuelUplift] = useState<string>("");
  const [fuelBlock, setFuelBlock] = useState<string>("");
  const [fuelArrival, setFuelArrival] = useState<string>("");
  const [delayMin, setDelayMin] = useState<string>("");
  const [delayCode, setDelayCode] = useState<string>("");
  const [delayReason, setDelayReason] = useState<string>("");

  const [depSuggestions, setDepSuggestions] = useState<AirportInfo[]>([]);
  const [arrSuggestions, setArrSuggestions] = useState<AirportInfo[]>([]);
  const [depQ, setDepQ] = useState("");
  const [arrQ, setArrQ] = useState("");

  const depRef = useRef<HTMLInputElement>(null);

  const clearAllSuggestions = useCallback(() => {
    setDepSuggestions([]);
    setArrSuggestions([]);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setFlightDate(date);
      setDepIcao(""); setArrIcao("");
      setFlightNumber(""); setReg("");
      setOperatorPreset("Norwegian"); setOperatorCustom("");
      setRole("first_officer"); setPicName("");
      setTypePreset("Boeing 737-800"); setTypeCustom("");
      setOffBlock(""); setOnBlock(""); setTakeoffUtc(""); setLandingUtc("");
      setBlockTime(""); setFlightTime("");
      setIsSim(false); setSimType("");
      setTodDay(0); setTodNight(0); setLdgDay(0); setLdgNight(0);
      setNotes("");
      setOpDataOpen(false);
      setPaxTotal(""); setPaxAdult(""); setPaxChild(""); setPaxInfant("");
      setFreightKg(""); setBaggageKg(""); setFuelUplift(""); setFuelBlock(""); setFuelArrival("");
      setDelayMin(""); setDelayCode(""); setDelayReason("");
      setDepQ(""); setArrQ("");
      setSavedPicNames(getPicNames());
      setTimeout(() => depRef.current?.focus(), 80);
    }
  }, [isOpen, date]);

  // Auto-calculate block time from off/on block UTC
  useEffect(() => {
    const s = utc_diff_seconds(offBlock, onBlock);
    if (s !== undefined) setBlockTime(seconds_to_hhmm(s));
  }, [offBlock, onBlock]);

  // Auto-calculate flight time from takeoff/landing UTC
  useEffect(() => {
    const s = utc_diff_seconds(takeoffUtc, landingUtc);
    if (s !== undefined) setFlightTime(seconds_to_hhmm(s));
  }, [takeoffUtc, landingUtc]);

  // Airport search debounce — single char triggers search now
  useEffect(() => {
    if (depQ.length < 1) { setDepSuggestions([]); return; }
    const t = setTimeout(() => {
      api.searchAirports(depQ).then(setDepSuggestions).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [depQ]);

  useEffect(() => {
    if (arrQ.length < 1) { setArrSuggestions([]); return; }
    const t = setTimeout(() => {
      api.searchAirports(arrQ).then(setArrSuggestions).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [arrQ]);

  const { mutate: save, isPending, error } = useMutation({
    mutationFn: () => {
      const toNum = (s: string) => s !== "" ? Number(s) : undefined;
      const body: FlightIn = {
        date: flightDate,
        dep_icao: depIcao.toUpperCase() || undefined,
        arr_icao: arrIcao.toUpperCase() || undefined,
        flight_number: flightNumber || undefined,
        aircraft_reg: reg || undefined,
        aircraft_type: typePreset === "Other" ? (typeCustom || undefined) : typePreset,
        operator: operatorPreset === "Other" ? (operatorCustom || undefined) : operatorPreset,
        crew_role: role,
        pic_name: picName || undefined,
        off_block_utc: offBlock || undefined,
        on_block_utc: onBlock || undefined,
        takeoff_utc: takeoffUtc || undefined,
        landing_utc: landingUtc || undefined,
        block_seconds: hhmm_to_seconds(blockTime),
        airborne_seconds: hhmm_to_seconds(flightTime),
        is_sim: isSim,
        sim_type: isSim ? (simType || undefined) : undefined,
        takeoffs_day: todDay,
        takeoffs_night: todNight,
        landings_day: ldgDay,
        landings_night: ldgNight,
        notes: notes || undefined,
        pax_total: toNum(paxTotal),
        pax_adult: toNum(paxAdult),
        pax_child: toNum(paxChild),
        pax_infant: toNum(paxInfant),
        freight_kg: toNum(freightKg),
        baggage_kg: toNum(baggageKg),
        fuel_uplift_kg: toNum(fuelUplift),
        fuel_block_kg: toNum(fuelBlock),
        fuel_burn_kg: fuelBlock !== "" && fuelArrival !== ""
          ? Number(fuelBlock) - Number(fuelArrival)
          : undefined,
        delay_minutes: toNum(delayMin),
        delay_code: delayCode || undefined,
        delay_reason: delayReason || undefined,
      };
      return api.createFlight(body);
    },
    onSuccess: () => {
      if (picName) savePicName(picName);
      qc.invalidateQueries({ queryKey: ["flights"] });
      qc.invalidateQueries({ queryKey: ["flightStats"] });
      onClose();
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#09090B] border-t border-[#27272A] rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[#FAFAFA]">Add Flight</h2>
          <button onClick={onClose} className="text-[#52525B] hover:text-[#A1A1AA]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Date */}
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" className={inputCls} value={flightDate} onChange={e => setFlightDate(e.target.value)} />
          </div>

          {/* Route */}
          <div className="grid grid-cols-2 gap-3">
            <AirportInput
              label="Departure (ICAO / IATA)"
              value={depIcao}
              query={depQ}
              setQuery={setDepQ}
              setValue={setDepIcao}
              suggestions={depSuggestions}
              clearSuggestions={clearAllSuggestions}
              inputRef={depRef}
            />
            <AirportInput
              label="Arrival (ICAO / IATA)"
              value={arrIcao}
              query={arrQ}
              setQuery={setArrQ}
              setValue={setArrIcao}
              suggestions={arrSuggestions}
              clearSuggestions={clearAllSuggestions}
            />
          </div>

          {/* Flight number & Role */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Flight Number</label>
              <input className={inputCls} placeholder="e.g. DY1234" value={flightNumber} onChange={e => setFlightNumber(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Crew Role</label>
              <select className={inputCls} value={role} onChange={e => setRole(e.target.value)}>
                {ROLES.map(r => (
                  <option key={r} value={r}>{r === "pic" ? "PIC" : r === "first_officer" ? "First Officer" : "Other"}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Registration & Aircraft */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Registration</label>
              <input className={inputCls} placeholder="e.g. LN-NGK" value={reg} onChange={e => setReg(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Aircraft Type</label>
              <select className={inputCls} value={typePreset} onChange={e => setTypePreset(e.target.value)}>
                {AIRCRAFT_PRESETS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {typePreset === "Other" && (
            <div>
              <label className={labelCls}>Aircraft Type (custom)</label>
              <input className={inputCls} placeholder="e.g. A320" value={typeCustom} onChange={e => setTypeCustom(e.target.value)} />
            </div>
          )}

          {/* Operator & PIC name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Operator</label>
              <select className={inputCls} value={operatorPreset} onChange={e => setOperatorPreset(e.target.value)}>
                {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {operatorPreset === "Other" ? (
              <div>
                <label className={labelCls}>Company name</label>
                <input className={inputCls} placeholder="e.g. Vueling" value={operatorCustom} onChange={e => setOperatorCustom(e.target.value)} />
              </div>
            ) : (
              <div className="relative">
                <label className={labelCls}>PIC Name</label>
                <input
                  className={inputCls}
                  placeholder="Captain crew code or name"
                  value={picName}
                  onChange={e => { setPicName(e.target.value); setPicNameOpen(true); }}
                  onFocus={() => setPicNameOpen(true)}
                  onBlur={() => setTimeout(() => setPicNameOpen(false), 150)}
                />
                {picNameOpen && (() => {
                  const q = picName.toLowerCase();
                  // Merge DB captains (raw values) with local saved names, deduplicate
                  const dbRaws = (dbCaptains ?? []).map(c => c.raw);
                  const all = Array.from(new Set([...dbRaws, ...savedPicNames]));
                  const filtered = all.filter(n => n.toLowerCase().includes(q) && n !== picName);
                  if (!filtered.length) return null;
                  return (
                    <div className="absolute z-50 top-full left-0 right-0 bg-[#18181B] border border-[#27272A] rounded-lg mt-1 max-h-48 overflow-y-auto">
                      {filtered.map(n => (
                        <button
                          key={n}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[#27272A] flex items-center justify-between gap-2"
                          onClick={() => { setPicName(n); setPicNameOpen(false); }}
                        >
                          <span className="text-[#FAFAFA] font-mono">{formatPicDisplay(n)}</span>
                          <span className="text-[#52525B] text-xs truncate">{n}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Off/On block + Block time */}
          <div>
            <p className={labelCls}>Block Times (UTC)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-[#52525B] mb-1">Off Block</p>
                <input type="time" className={inputCls} value={offBlock} onChange={e => setOffBlock(e.target.value)} />
              </div>
              <div>
                <p className="text-xs text-[#52525B] mb-1">On Block</p>
                <input type="time" className={inputCls} value={onBlock} onChange={e => setOnBlock(e.target.value)} />
              </div>
              <div>
                <p className="text-xs text-[#52525B] mb-1">Block Time</p>
                <input
                  className={inputCls}
                  placeholder="HH:MM"
                  value={blockTime}
                  onChange={e => setBlockTime(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Takeoff/Landing + Flight time */}
          <div>
            <p className={labelCls}>Flight Times (UTC)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-[#52525B] mb-1">Takeoff</p>
                <input type="time" className={inputCls} value={takeoffUtc} onChange={e => setTakeoffUtc(e.target.value)} />
              </div>
              <div>
                <p className="text-xs text-[#52525B] mb-1">Landing</p>
                <input type="time" className={inputCls} value={landingUtc} onChange={e => setLandingUtc(e.target.value)} />
              </div>
              <div>
                <p className="text-xs text-[#52525B] mb-1">Flight Time</p>
                <input
                  className={inputCls}
                  placeholder="HH:MM"
                  value={flightTime}
                  onChange={e => setFlightTime(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* T/O and Landings */}
          <div>
            <p className={labelCls}>Personal Takeoffs / Landings</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "T/O Day", value: todDay, set: setTodDay },
                { label: "T/O Night", value: todNight, set: setTodNight },
                { label: "Ldg Day", value: ldgDay, set: setLdgDay },
                { label: "Ldg Night", value: ldgNight, set: setLdgNight },
              ].map(({ label, value, set }) => (
                <div key={label} className="text-center">
                  <p className="text-xs text-[#52525B] mb-1">{label}</p>
                  <input
                    type="number" min={0} max={9}
                    className={`${inputCls} text-center`}
                    value={value}
                    onChange={e => set(Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Simulator */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[#A1A1AA] cursor-pointer">
              <input type="checkbox" checked={isSim} onChange={e => setIsSim(e.target.checked)} className="w-4 h-4 rounded" />
              Simulator session
            </label>
            {isSim && (
              <select className={`${inputCls} flex-1`} value={simType} onChange={e => setSimType(e.target.value)}>
                <option value="">Type…</option>
                {SIM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          {/* Operational data (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setOpDataOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-[#71717A] hover:text-[#A1A1AA] transition-colors"
            >
              {opDataOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Operational Data (pax, fuel, cargo)
            </button>
            {opDataOpen && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className={labelCls}>Passengers</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Total", value: paxTotal, set: setPaxTotal },
                      { label: "Adult", value: paxAdult, set: setPaxAdult },
                      { label: "Child", value: paxChild, set: setPaxChild },
                      { label: "Infant", value: paxInfant, set: setPaxInfant },
                    ].map(({ label, value, set }) => (
                      <div key={label} className="text-center">
                        <p className="text-xs text-[#52525B] mb-1">{label}</p>
                        <input
                          type="number" min={0}
                          className={`${inputCls} text-center`}
                          value={value}
                          onChange={e => set(e.target.value)}
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Freight (kg)</label>
                    <input type="number" min={0} className={inputCls} placeholder="0" value={freightKg} onChange={e => setFreightKg(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Baggage (kg)</label>
                    <input type="number" min={0} className={inputCls} placeholder="0" value={baggageKg} onChange={e => setBaggageKg(e.target.value)} />
                  </div>
                </div>
                <div>
                  <p className={labelCls}>Fuel (kg)</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-[#52525B] mb-1">Uplift</p>
                      <input type="number" min={0} className={inputCls} placeholder="—" value={fuelUplift} onChange={e => setFuelUplift(e.target.value)} />
                    </div>
                    <div>
                      <p className="text-xs text-[#52525B] mb-1">Block out</p>
                      <input type="number" min={0} className={inputCls} placeholder="—" value={fuelBlock} onChange={e => setFuelBlock(e.target.value)} />
                    </div>
                    <div>
                      <p className="text-xs text-[#52525B] mb-1">Block in (arrival)</p>
                      <input type="number" min={0} className={inputCls} placeholder="—" value={fuelArrival} onChange={e => setFuelArrival(e.target.value)} />
                    </div>
                  </div>
                  {fuelBlock !== "" && fuelArrival !== "" && (
                    <p className="text-xs text-[#52525B] mt-1.5">
                      Burn: <span className="text-[#A1A1AA]">{Number(fuelBlock) - Number(fuelArrival)} kg</span>
                    </p>
                  )}
                </div>
                <div>
                  <p className={labelCls}>Delay</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs text-[#52525B] mb-1">Minutes</p>
                      <input type="number" min={0} className={inputCls} placeholder="0" value={delayMin} onChange={e => setDelayMin(e.target.value)} />
                    </div>
                    <div>
                      <p className="text-xs text-[#52525B] mb-1">Code</p>
                      <input className={inputCls} placeholder="e.g. 93" value={delayCode} onChange={e => setDelayCode(e.target.value)} />
                    </div>
                    <div>
                      <p className="text-xs text-[#52525B] mb-1">Reason</p>
                      <input className={inputCls} placeholder="—" value={delayReason} onChange={e => setDelayReason(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Optional remarks" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-xs text-red-400">{String(error)}</p>}

          <button
            onClick={() => save()}
            disabled={isPending || !flightDate}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? <Loader size={14} className="animate-spin" /> : <PlaneTakeoff size={14} />}
            {isPending ? "Saving…" : "Add Flight"}
          </button>
        </div>
      </div>
    </div>
  );
}
