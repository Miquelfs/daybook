// On the server: API_INTERNAL_URL (localhost) takes precedence.
// On the client: NEXT_PUBLIC_API_URL is baked in at build time.
const BASE =
  (typeof window === "undefined"
    ? process.env.API_INTERNAL_URL
    : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

// Mutations use the Next.js proxy to avoid browser CORS issues.
const PROXY_BASE = typeof window === "undefined" ? BASE : "";

export type SleepData = {
  duration_seconds: number | null;
  deep_seconds: number | null;
  light_seconds: number | null;
  rem_seconds: number | null;
  awake_seconds: number | null;
  avg_hrv: number | null;
  avg_spo2: number | null;
  score: number | null;
};

export type DailyStats = {
  steps: number | null;
  active_calories: number | null;
  total_calories: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  body_battery_low: number | null;
  body_battery_high: number | null;
};

export type HRVData = {
  last_night_avg: number | null;
  weekly_avg: number | null;
  status: string | null;
};

export type Activity = {
  id: string;
  date: string;
  source: string;
  strava_id: string | null;
  activity_type: string | null;
  name: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  calories: number | null;
  has_polyline: boolean;
  user_notes: string | null;
  user_rating: number | null;
};

export type ActivityStreams = {
  distance: number[];
  time: number[];
  heartrate: number[] | null;
  altitude: number[] | null;
  velocity: number[] | null;
  cadence: number[] | null;
  hr_zones: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  available: string[];
};

export type ActivityComputedMetrics = {
  normalized_power_w: number | null;
  intensity_factor: number | null;
  variability_index: number | null;
  efficiency_factor: number | null;
  decoupling_pct: number | null;
  relative_effort: number | null;
  hr_tss: number | null;
  zones_json: string | null;
  garmin_aerobic_te: number | null;
  garmin_anaerobic_te: number | null;
  garmin_activity_load: number | null;
};

export type ActivitySplit = {
  split_index: number;
  type: string | null;
  distance_m: number | null;
  time_s: number | null;
  avg_pace_s_per_km: number | null;
  gap_s_per_km: number | null;
  avg_hr: number | null;
  avg_power_w: number | null;
  avg_cadence: number | null;
  elev_gain_m: number | null;
  avg_grade: number | null;
};

export type TennisPlayer = {
  contact_id: number;
  name: string;
  emoji: string | null;
  role: "partner" | "opponent" | "coach";
};

export type TennisSession = {
  session_type: "match" | "training";
  format: "singles" | "doubles" | null;
  result: "win" | "loss" | "draw" | null;
  score: string | null;
  surface: "hard" | "clay" | "grass" | "indoor" | null;
  focus: string | null;
  coaching_notes: string | null;
  players: TennisPlayer[];
};

export type TennisSessionWrite = {
  session_type: "match" | "training";
  format?: string | null;
  result?: string | null;
  score?: string | null;
  surface?: string | null;
  focus?: string | null;
  coaching_notes?: string | null;
  partner_ids: number[];
  opponent_ids: number[];
  coach_ids: number[];
};

export type PlanSessionStep = {
  kind: "steady" | "intervals" | "swim_set";
  label: string;
  zone?: string;
  work_zone?: string;
  rest_zone?: string;
  duration_min?: number;
  reps?: number;
  work_min?: number;
  rest_min?: number;
  distance_m?: number;
  rest_s?: number;
  cue?: string;
};

export type LinkedPlanSession = {
  id: number;
  goal_id: number;
  session_type: string;
  discipline: string;
  intensity_zone: string;
  duration_min: number;
  effective_duration_min: number | null;
  week_number: number;
  structure: PlanSessionStep[] | null;
  fueling: Record<string, unknown> | null;
};

// Real activity stats merged onto a plan session that was completed by (auto- or
// manually) linking the activity logged that day. Present when a session has a
// completed_activity_id.
export type SessionActual = {
  activity_id: string;
  name: string | null;
  activity_type: string | null;
  distance_m: number | null;
  moving_time_s: number | null;
  duration_s: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed_mps: number | null;
  tss: number | null;
};

export type FuelingLog = {
  carbs_g: number | null;
  fluids_ml: number | null;
  sodium_mg: number | null;
  gi_severity: number | null;
  gi_notes: string | null;
};

export type ActivityDetail = Activity & {
  moving_time_seconds: number | null;
  avg_speed_mps: number | null;
  avg_power_watts: number | null;
  training_stress_score: number | null;
  start_lat: number | null;
  start_lng: number | null;
  polyline: string | null;
  segment_efforts: SegmentEffort[];
  computed: ActivityComputedMetrics | null;
  splits: ActivitySplit[];
  tennis: TennisSession | null;
  plan_session: LinkedPlanSession | null;
  fueling_log: FuelingLog | null;
};

export type SegmentEffort = {
  id: number;
  segment_name: string;
  segment_distance_meters: number | null;
  segment_type: string | null;
  duration_seconds: number;
  avg_heart_rate: number | null;
  avg_power_watts: number | null;
  is_personal_record: boolean;
};

export type SyncStatus = {
  source: string;
  last_attempt_at: string;
  last_success_at: string | null;
  last_error: string | null;
  records_synced: number;
};

export type LocationVisit = {
  start_time: string;
  end_time: string;
  semantic_type: string | null;
  place_name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

export type DayTagSummary = {
  tag_id: number;
  slug: string;
  name: string;
  icon: string | null;
  category: string;
  color: string | null;
  note: string | null;
};

export type DaySubjective = {
  energy: number | null;
  mood: number | null;
  stress: number | null;
  sleep_quality: number | null;
  notes: string | null;
  daily_question: string | null;
  daily_answer: string | null;
  tags: string | null;
  mood_note: string | null;
  duty_day: boolean;
  away_from_base: boolean;
  timezone_offset: number | null;
  gratitude: string | null;
  intention: string | null;
  learning: string | null;
  focus_score: number | null;
  error_log: string | null;
};

export type WeatherData = {
  condition: string | null;
  temp_min: number | null;
  temp_max: number | null;
  temp_mean: number | null;
  precipitation: number | null;
  weather_code: number | null;
  wind_speed_max: number | null;
};

export type LoadIndexData = {
  fatigue_score: number | null;
  hrv_load: number | null;
  sleep_debt: number | null;
  tss_load: number | null;
  timezone_penalty: number | null;
  recovery_status: string | null;
};

export type DayDetail = {
  date: string;
  subjective: DaySubjective;
  sleep: SleepData | null;
  daily_stats: DailyStats | null;
  hrv: HRVData | null;
  activities: Activity[];
  location: { cities: string[]; total_distance_meters: number } | null;
  visits: LocationVisit[];
  companions: string[];
  photo_url: string | null;
  tags: DayTagSummary[];
  weather: WeatherData | null;
  load_index: LoadIndexData | null;
};

export type Contact = {
  id: number;
  name: string;
  emoji: string | null;
  group_: string | null;
};

export type DaySummary = {
  date: string;
  energy: number | null;
  mood: number | null;
  stress: number | null;
  sleep_duration_seconds: number | null;
  steps: number | null;
  resting_hr: number | null;
  hrv_last_night: number | null;
  activity_count: number;
  flight_count: number;
  cities: string[];
  duty_day: boolean;
  away_from_base: boolean;
  daily_question: string | null;
  daily_answer: string | null;
  photo_path: string | null;
  tags: string | null;
  tags_list: string[];
};

export type CoreQuestion = {
  id: string;
  text: string;
  type: "scale" | "boolean" | "text";
  field: string;
  tag?: string;
  hint?: string;
};

export type Questionnaire = {
  date: string;
  core: CoreQuestion[];
  rotating: { id: string; text: string; type: string; field: string };
};

export type DayPatch = Partial<{
  energy: number;
  mood: number;
  stress: number;
  sleep_quality: number;
  notes: string;
  daily_question: string;
  daily_answer: string;
  tags: string;
  mood_note: string;
  duty_day: boolean;
  away_from_base: boolean;
  gratitude: string;
  intention: string;
  learning: string;
  focus_score: number;
  error_log: string;
}>;

// ─── Aviation types ───────────────────────────────────────────────────────────

export type FlightSummary = {
  id: string;
  date: string;
  source: string;
  dep_icao: string | null;
  arr_icao: string | null;
  dep_iata: string | null;
  arr_iata: string | null;
  flight_number: string | null;
  aircraft_reg: string | null;
  aircraft_type: string | null;
  operator: string | null;
  crew_role: string | null;
  pic_name: string | null;
  off_block_utc: string | null;
  on_block_utc: string | null;
  block_seconds: number | null;
  airborne_seconds: number | null;
  pic_seconds: number;
  sic_seconds: number;
  night_seconds: number;
  distance_nm: number | null;
  takeoffs_day: number;
  takeoffs_night: number;
  landings_day: number;
  landings_night: number;
  is_sim: boolean;
  landing_rating: number | null;
};

export type AirportInfo = {
  icao: string;
  iata: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type FlightDetail = FlightSummary & {
  takeoff_utc: string | null;
  landing_utc: string | null;
  takeoff_crew: string | null;
  landing_crew: string | null;
  sim_type: string | null;
  ifr_seconds: number;
  pax_total: number | null;
  pax_adult: number | null;
  pax_child: number | null;
  pax_infant: number | null;
  freight_kg: number | null;
  baggage_kg: number | null;
  fuel_block_kg: number | null;
  fuel_trip_kg: number | null;
  fuel_reserves_kg: number | null;
  fuel_uplift_kg: number | null;
  fuel_burn_kg: number | null;
  fuel_burn_diff_kg: number | null;
  delay_minutes: number | null;
  delay_code: string | null;
  delay_reason: string | null;
  notes: string | null;
  remarks: string | null;
  dep_airport: AirportInfo | null;
  arr_airport: AirportInfo | null;
};

export type LogbookTotals = {
  block_hours: number;
  pic_hours: number;
  sic_hours: number;
  night_hours: number;
  ifr_hours: number;
  sim_hours: number;
  sim_sessions: number;
  distance_nm: number;
  sectors: number;
  takeoffs_day: number;
  takeoffs_night: number;
  landings_day: number;
  landings_night: number;
};

export type LogbookStats = {
  totals: LogbookTotals;
  by_year: { year: string; sectors: number; block_hours: number; pic_hours: number; sic_hours: number; night_hours: number; takeoffs: number; landings: number }[];
  by_month: { month: string; sectors: number; block_hours: number }[];
  by_role: { role: string; sectors: number; block_hours: number }[];
  by_aircraft_type: { aircraft_type: string; sectors: number; block_hours: number }[];
  airports_visited: number;
  countries_visited: number;
};

export type RouteFrequency = {
  dep_icao: string;
  arr_icao: string;
  dep_iata: string | null;
  arr_iata: string | null;
  dep_lat: number | null;
  dep_lon: number | null;
  arr_lat: number | null;
  arr_lon: number | null;
  count: number;
  total_block_hours: number;
  operator: string | null;
  source: string | null;
};

export type AirportVisit = {
  icao: string;
  iata: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  visit_count: number;
  first_visit: string | null;
  last_visit: string | null;
};

export type CurrencyStatus = {
  reference_date: string;
  takeoffs_landings_90d: number;
  takeoffs_90d: number;
  landings_90d: number;
  night_takeoffs_90d: number;
  night_landings_90d: number;
  next_expiry_date: string | null;
  night_current: boolean;
  night_expiry_date: string | null;
};

export type LimitWindow = {
  label: string;
  hours: number;
  limit_hours: number;
  window_start: string;
  window_end: string;
};

export type FlightTimeLimits = {
  reference_date: string;
  days_28: LimitWindow;
  calendar_year: LimitWindow;
  months_12: LimitWindow;
};

export type NightCalcResult = {
  night_seconds: number;
  duration_seconds: number;
  night_takeoff: boolean;
  night_landing: boolean;
};

export type PilotLicense = {
  id: number;
  category: string;   // licence | rating | medical | training | other
  name: string;
  number: string | null;
  issued_date: string | null;
  valid_until: string | null;
  remarks: string | null;
};

export type PilotLicenseIn = {
  category: string;
  name: string;
  number?: string | null;
  issued_date?: string | null;
  valid_until?: string | null;
  remarks?: string | null;
};

type AnalyticFlight = { id: string; date: string; dep_icao: string | null; arr_icao: string | null; dep_iata: string | null; arr_iata: string | null; block_seconds: number; dep_city: string | null; arr_city: string | null };

export type FlightAnalytics = {
  longest_flight: AnalyticFlight | null;
  shortest_flight: AnalyticFlight | null;
  top_route: { dep_icao: string; arr_icao: string; dep_iata: string | null; arr_iata: string | null; cnt: number; total_hours: number } | null;
  top_airport: { icao: string; iata: string | null; city: string | null; country: string | null; visits: number } | null;
  busiest_month: { month: string; sectors: number; block_hours: number } | null;
  year_over_year: { year: string; sectors: number; block_hours: number; pic_hours: number; night_hours: number }[];
  countries: string[];
  top_destinations: { arr_icao: string; arr_iata: string | null; city: string | null; country: string | null; visits: number }[];
  aircraft_breakdown: { aircraft_type: string; sectors: number; block_hours: number }[];
  avg_sector_by_year: { year: string; avg_block_hours: number }[];
  top_registrations: { aircraft_reg: string; aircraft_type: string | null; sectors: number; block_hours: number }[];
  fuel_stats: { avg_burn_kg: number; total_burn_kg: number; avg_uplift_kg: number; flights_with_fuel: number } | null;
  burn_by_type: { aircraft_type: string; avg_burn_kg: number; kg_per_nm: number | null; flights: number }[];
  pax_stats: { avg_pax: number; total_pax: number; max_pax: number; flights_with_pax: number } | null;
  night_stats: {
    night_hours: number;
    block_hours: number;
    night_takeoffs: number;
    night_landings: number;
    night_sectors: number;
    full_night_sectors: number;
    night_pct: number;
    darkest_month: { month: string; night_hours: number; night_sectors: number } | null;
    most_night_flight: (AnalyticFlight & { night_seconds: number }) | null;
  } | null;
  operators: { op_label: string; sectors: number; block_hours: number }[];
  delay_stats: { delayed_flights: number; avg_delay_min: number; max_delay_min: number; total_delay_min: number } | null;
  delay_by_code: { delay_code: string; cnt: number; avg_min: number }[];
};

export type FlightIn = {
  date: string;
  dep_icao?: string;
  arr_icao?: string;
  dep_iata?: string;
  arr_iata?: string;
  flight_number?: string;
  aircraft_reg?: string;
  aircraft_type?: string;
  operator?: string;
  crew_role?: string;
  off_block_utc?: string;
  on_block_utc?: string;
  takeoff_utc?: string;
  landing_utc?: string;
  block_seconds?: number;
  airborne_seconds?: number;
  is_sim?: boolean;
  sim_type?: string;
  pic_name?: string;
  takeoffs_day?: number;
  takeoffs_night?: number;
  landings_day?: number;
  landings_night?: number;
  night_seconds?: number;
  notes?: string;
  pax_total?: number;
  pax_adult?: number;
  pax_child?: number;
  pax_infant?: number;
  freight_kg?: number;
  baggage_kg?: number;
  fuel_uplift_kg?: number;
  fuel_block_kg?: number;
  fuel_burn_kg?: number;
  delay_minutes?: number;
  delay_code?: string;
  delay_reason?: string;
};

// ─── Life in Weeks types ──────────────────────────────────────────────────────

export type LifeEventType = "career" | "relationship" | "travel" | "loss" | "achievement" | "other";

export type LifeProfile = {
  birthdate: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type LifePeriod = {
  id: number;
  label: string;
  category: string;
  layer: string;
  color: string;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LifePeriodIn = {
  label: string;
  category: string;
  layer?: string;
  color: string;
  start_date: string;
  end_date?: string | null;
  notes?: string | null;
  sort_order?: number;
};

export type AutoCappedPeriod = {
  id: number;
  label: string;
  old_end_date: string | null;
  new_end_date: string;
};

export type LifePeriodCreateResponse = {
  period: LifePeriod;
  auto_capped: AutoCappedPeriod[];
};

export type LifeEvent = {
  id: number;
  event_date: string;
  label: string;
  type: LifeEventType;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
};

export type LifeEventIn = {
  event_date: string;
  label: string;
  type: LifeEventType;
  notes?: string | null;
};

export type LifeWeekCell = {
  row: number;
  col: number;
  week_start: string;
  week_end: string;
  is_past: boolean;
  is_current: boolean;
  periods: LifePeriod[];
  events: LifeEvent[];
};

export type LifeGridResponse = {
  birthdate: string;
  today: string;
  cells: LifeWeekCell[];
};

// Tailwind ramp → hex (full curated palette — mirrors LifeGrid.tsx TAILWIND_HEX)
export const LIFE_PALETTE: Record<string, string> = {
  "slate-400":"#94a3b8","slate-500":"#64748b","slate-600":"#475569",
  "zinc-400":"#a1a1aa","zinc-500":"#71717a","zinc-600":"#52525b",
  "red-400":"#f87171","red-500":"#ef4444","red-600":"#dc2626",
  "orange-400":"#fb923c","orange-500":"#f97316",
  "amber-400":"#fbbf24","amber-500":"#f59e0b",
  "yellow-300":"#fde047","yellow-400":"#facc15",
  "lime-400":"#a3e635","lime-500":"#84cc16",
  "green-400":"#4ade80","green-500":"#22c55e","green-600":"#16a34a",
  "emerald-400":"#34d399","emerald-500":"#10b981","emerald-600":"#059669",
  "teal-400":"#2dd4bf","teal-500":"#14b8a6",
  "cyan-400":"#22d3ee","cyan-500":"#06b6d4",
  "sky-300":"#7dd3fc","sky-400":"#38bdf8","sky-500":"#0ea5e9","sky-600":"#0284c7",
  "blue-300":"#93c5fd","blue-400":"#60a5fa","blue-500":"#3b82f6","blue-600":"#2563eb",
  "indigo-400":"#818cf8","indigo-500":"#6366f1",
  "violet-400":"#a78bfa","violet-500":"#8b5cf6",
  "purple-400":"#c084fc","purple-500":"#a855f7",
  "fuchsia-400":"#e879f9","fuchsia-500":"#d946ef",
  "pink-400":"#f472b6","pink-500":"#ec4899",
  "rose-400":"#fb7185","rose-500":"#f43f5e","rose-600":"#e11d48",
};

async function get<T>(path: string): Promise<T> {
  // Timeout so one slow endpoint can never hang a server-rendered page —
  // callers already .catch() and render without the section.
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export type GeoFeature = {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Point"; coordinates: [number, number] };
  properties: {
    segment_start: string;
    segment_end: string;
    place_name: string | null;
    semantic_type: string | null;
    city: string | null;
    country: string | null;
  };
};

export type TracksGeoJSON = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

export type HeatmapData = {
  points: [number, number, number][];   // [lat, lng, weight]
  countries: { country: string; days: number }[];
  cities: { city: string; country: string; days: number }[];
  years: string[];
  distinct_days: number;                // days with any location data (no double counting)
};

export type TopPlace = {
  place: string;
  city: string | null;
  country: string | null;
  days: number;
  visits: number;
  total_hours: number;
};

export type CityStay = {
  city: string;
  country: string;
  first_date: string;
  last_date: string;
  days: number;
};

export type PlaceDate = {
  date: string;
  city: string | null;
  country: string | null;
  mood: number | null;
  energy: number | null;
  mood_note: string | null;
};

// ── Maps narrative layer (Plan Phase B) ──────────────────────────────────────

export type WorldCoverage = {
  countries_visited: number;
  countries_total: number;
  pct_world: number;
  continents: Record<string, { visited: string[]; visited_count: number; total: number }>;
  country_details: {
    country: string;
    iso2: string | null;
    continent: string;
    first_visit: string;
    last_visit: string;
    total_days: number;
    cities_visited: number;
  }[];
  all_countries: Record<string, { iso2: string; continent: string }>;
};

export type FunFactCard = {
  label: string;
  value: string | number;
  unit: string;
  subtitle: string;
  icon: string;
};

export type CurveBucket = {
  bucket: number;                 // distance in meters
  all_time_best: number | null;   // pace s/km at that distance
  last_90d_best: number | null;
};

export type Trip = {
  id: number;
  start_date: string;
  end_date: string;
  primary_country: string | null;
  countries: string[];
  cities: string[];
  total_km: number | null;
  max_distance_from_home_km: number | null;
  name: string;
  auto_name: string | null;
  user_name: string | null;
  cover_photo_path: string | null;
  home_at_start: string | null;
  n_days: number;
  n_nights: number;                     // nights away from home
};

export type PlaceSummary = {
  place: string;
  total_days: number;
  first_visit: string | null;
  last_visit: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

// ─── Restaurants types ────────────────────────────────────────────────────────

export type Restaurant = {
  id: number;
  name: string;
  date_visited: string | null;
  city: string | null;
  country: string | null;
  cuisine: string | null;
  rating_mf: number | null;
  rating_ad: number | null;
  companions: string | null;
  google_maps_url: string | null;
  notes: string | null;
  trip_context: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type RestaurantStats = {
  total: number;
  by_year: Record<string, number>;
  by_cuisine: Record<string, number>;
  by_country: Record<string, number>;
  by_city: { city: string; country: string; count: number }[];
  avg_rating_mf: number | null;
  avg_rating_ad: number | null;
  top_rated: { id: number; name: string; city: string | null; country: string | null; cuisine: string | null; rating_mf: number; rating_ad: number | null }[];
};

export type RestaurantIn = {
  name: string;
  date_visited?: string;
  city?: string;
  country?: string;
  cuisine?: string;
  rating_mf?: number;
  rating_ad?: number;
  companions?: string;
  google_maps_url?: string;
  notes?: string;
  trip_context?: string;
};

export type Decision = {
  id: string;
  date: string;
  description: string;
  expected_outcome: string | null;
  confidence: number | null;
  horizon_date: string | null;
  actual_outcome: string | null;
  outcome_score: number | null;
  created_at: string;
  resolved_at: string | null;
};

export type DecisionCreate = {
  date: string;
  description: string;
  expected_outcome?: string;
  confidence?: number;
  horizon_date?: string;
};

export type DecisionResolve = {
  actual_outcome: string;
  outcome_score?: number;
};

export type MovementStats = {
  yearly: { year: string; total_km: number; avg_km: number; max_km: number; days_with_data: number }[];
  monthly: { month: string; total_km: number; avg_km: number; days_with_data: number }[];
  weekly: { week: string; week_start: string; total_km: number; days_with_data: number }[];
  top_days: { date: string; km: number; unique_places: number; top_place: string | null; top_place_city: string | null }[];
  summary: { total_km: number; avg_km_per_day: number; max_km: number; days_tracked: number } | Record<string, never>;
};

export type PantryItem = {
  id: string;
  mercadona_id: string | null;
  name: string;
  unit: string | null;
  category: string | null;
  is_active: number;
  created_at: string;
  latest_price: number | null;
  price_date: string | null;
};

export type PricePoint = {
  date: string;
  price_eur: number;
  unit_price: number | null;
  store: string;
};

export type GroceryPurchase = {
  id: string;
  date: string;
  total_eur: number | null;
  store: string;
  source: string;
  item_count: number;
};

export type MealPlanMeal = {
  day: string;
  name: string;
  ingredients: { name: string; qty: string; estimated_eur: number }[];
  meal_cost_eur: number;
  notes?: string;
};

export type MealPlan = {
  plan_id: string;
  week_start: string;
  meals: MealPlanMeal[];
  total_estimated_eur: number;
  shopping_list: { name: string; qty: string; estimated_eur: number }[];
};

export const api = {
  day: (date: string) => get<DayDetail>(`/days/${date}`),
  today: () => get<DayDetail>("/days/today"),
  range: (start: string, end: string) =>
    get<DaySummary[]>(`/days?start=${start}&end=${end}`),
  questionnaire: (date: string) =>
    get<Questionnaire>(`/questionnaire/${date}`),
  tracks: (date: string) => get<TracksGeoJSON>(`/locations/tracks/${date}`),
  heatmap: (year?: number) =>
    get<HeatmapData>(`/locations/heatmap${year ? `?year=${year}` : ""}`),
  topPlaces: (year?: number) =>
    get<TopPlace[]>(`/locations/top-places?limit=30${year ? `&year=${year}` : ""}`),
  cityTimeline: (year?: number) =>
    get<CityStay[]>(`/locations/city-timeline${year ? `?year=${year}` : ""}`),
  placeDates: (place: string, opts?: { year?: number; limit?: number; offset?: number }) =>
    get<PlaceDate[]>(
      `/locations/place-dates?place=${encodeURIComponent(place)}` +
        (opts?.year ? `&year=${opts.year}` : "") +
        `&limit=${opts?.limit ?? 100}&offset=${opts?.offset ?? 0}`
    ),
  placeSummary: (place: string) =>
    get<PlaceSummary>(`/locations/place-summary?place=${encodeURIComponent(place)}`),
  movementStats: (year?: number) =>
    get<MovementStats>(`/locations/movement/stats${year ? `?year=${year}` : ""}`),
  worldCoverage: (year?: number) =>
    get<WorldCoverage>(`/locations/world-coverage${year ? `?year=${year}` : ""}`),
  funFacts: (year?: number) =>
    get<{ cards: FunFactCard[] }>(`/locations/fun-facts${year ? `?year=${year}` : ""}`),
  trips: (limit = 100, year?: number) =>
    get<{ trips: Trip[]; total: number }>(`/locations/trips?limit=${limit}${year ? `&year=${year}` : ""}`),
  trainingCurve: (sport: "run" | "ride" | "swim") =>
    get<CurveBucket[]>(`/training/curve?sport=${sport}&channel=pace`),

  activity: (id: string) => get<ActivityDetail>(`/activities/${id}`),
  activities: (start: string, end: string) =>
    get<Activity[]>(`/activities?start=${start}&end=${end}`),
  syncStatus: () => get<SyncStatus[]>("/activities/sync-status"),

  syncGarmin: async (): Promise<void> => {
    await fetch(`${BASE}/sync/garmin`, { method: "POST", cache: "no-store" }).catch(() => {});
  },
  syncStrava: async (): Promise<void> => {
    await fetch(`${BASE}/sync/strava`, { method: "POST", cache: "no-store" }).catch(() => {});
  },

  patch: async (date: string, body: DayPatch): Promise<DayDetail> => {
    const res = await fetch(`${PROXY_BASE}/api/days/${date}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
    return res.json();
  },

  deletePhoto: async (date: string): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/days/${date}/photo`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deletePhoto failed ${res.status}`);
  },

  contacts: () => get<Contact[]>("/contacts"),

  createContact: async (body: { name: string; emoji?: string; group_?: string }): Promise<Contact> => {
    const res = await fetch(`${PROXY_BASE}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createContact failed ${res.status}`);
    return res.json();
  },

  updateContact: async (id: number, body: { name?: string; emoji?: string | null; group_?: string | null }): Promise<Contact> => {
    const res = await fetch(`${PROXY_BASE}/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail ?? `updateContact failed ${res.status}`);
    }
    return res.json();
  },

  deleteContact: async (id: number): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/contacts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deleteContact failed ${res.status}`);
  },

  setCompanions: async (date: string, contactIds: number[]): Promise<string[]> => {
    const res = await fetch(`${PROXY_BASE}/api/days/${date}/companions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_ids: contactIds }),
    });
    if (!res.ok) throw new Error(`setCompanions failed ${res.status}`);
    return res.json();
  },

  // ─── Aviation ───────────────────────────────────────────────────────────────

  flights: (params?: { start?: string; end?: string; dep?: string; arr?: string; role?: string }) => {
    const q = new URLSearchParams();
    if (params?.start) q.set("start", params.start);
    if (params?.end) q.set("end", params.end);
    if (params?.dep) q.set("dep", params.dep);
    if (params?.arr) q.set("arr", params.arr);
    if (params?.role) q.set("role", params.role);
    return get<FlightSummary[]>(`/flights?${q}`);
  },
  flight: (id: string) => get<FlightDetail>(`/flights/${id}`),
  flightStats: () => get<LogbookStats>("/flights/stats"),
  flightCurrency: () => get<CurrencyStatus>("/flights/currency"),
  flightLimits: () => get<FlightTimeLimits>("/flights/limits"),

  nightCalc: (params: { date: string; dep: string; arr: string; takeoff: string; landing: string }) => {
    const q = new URLSearchParams(params);
    return get<NightCalcResult>(`/flights/night-calc?${q}`);
  },

  licenses: () => get<PilotLicense[]>("/flights/licenses"),

  createLicense: async (body: PilotLicenseIn): Promise<PilotLicense> => {
    const res = await fetch(`${PROXY_BASE}/api/flights/licenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createLicense failed ${res.status}`);
    return res.json();
  },

  updateLicense: async (id: number, body: PilotLicenseIn): Promise<PilotLicense> => {
    const res = await fetch(`${PROXY_BASE}/api/flights/licenses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`updateLicense failed ${res.status}`);
    return res.json();
  },

  deleteLicense: async (id: number): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/flights/licenses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deleteLicense failed ${res.status}`);
  },
  flightAnalytics: () => get<FlightAnalytics>("/flights/analytics"),
  flightRoutes: (year?: string) => get<RouteFrequency[]>(`/flights/routes${year ? `?year=${year}` : ""}`),
  flightAirports: (year?: string) => get<AirportVisit[]>(`/flights/airports${year ? `?year=${year}` : ""}`),
  searchAirports: (q: string) => get<AirportInfo[]>(`/flights/airports/search?q=${encodeURIComponent(q)}`),

  createFlight: async (body: FlightIn): Promise<FlightSummary> => {
    const res = await fetch(`${PROXY_BASE}/api/flights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createFlight failed ${res.status}`);
    return res.json();
  },

  patchFlight: async (id: string, body: Partial<FlightIn & { notes: string; remarks: string; ifr_seconds: number; landing_rating: number }>): Promise<FlightSummary> => {
    const res = await fetch(`${PROXY_BASE}/api/flights/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patchFlight failed ${res.status}`);
    return res.json();
  },

  deleteFlight: async (id: string): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/flights/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deleteFlight failed ${res.status}`);
  },

  flightCaptains: () =>
    get<{ raw: string; display: string }[]>("/flights/captains").catch(() => []),

  captainHistory: (name: string) =>
    get<{
      name: string;
      total_flights: number;
      total_block_seconds: number;
      total_night_seconds: number;
      first_flight: string;
      last_flight: string;
      aircraft_types: string[];
      flights: Record<string, unknown>[];
    }>(`/flights/captains/${encodeURIComponent(name)}`).catch(() => null),

  airportFlights: (icao: string) =>
    get<{
      icao: string;
      iata: string | null;
      name: string | null;
      city: string | null;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
      total_movements: number;
      departures: number;
      arrivals: number;
      total_block_seconds: number;
      total_night_seconds: number;
      night_movements: number;
      first_visit: string | null;
      last_visit: string | null;
      flights: Record<string, unknown>[];
    }>(`/flights/airports/${encodeURIComponent(icao)}/flights`).catch(() => null),

  aircraftHistory: (reg: string) =>
    get<{
      registration: string;
      aircraft_type: string | null;
      total_flights: number;
      total_block_seconds: number;
      total_night_seconds: number;
      first_flight: string;
      last_flight: string;
      flights: Record<string, unknown>[];
    }>(`/flights/aircraft/${encodeURIComponent(reg)}`).catch(() => null),

  // ─── Restaurants ────────────────────────────────────────────────────────────

  restaurants: (params?: { year?: number; date?: string; city?: string; country?: string; cuisine?: string }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set("date", params.date);
    else if (params?.year) q.set("year", String(params.year));
    if (params?.city) q.set("city", params.city);
    if (params?.country) q.set("country", params.country);
    if (params?.cuisine) q.set("cuisine", params.cuisine);
    const qs = q.toString();
    return get<Restaurant[]>(`/restaurants${qs ? `?${qs}` : ""}`);
  },
  restaurantStats: (year?: number) =>
    get<RestaurantStats>(`/restaurants/stats${year ? `?year=${year}` : ""}`),

  createRestaurant: async (body: RestaurantIn): Promise<Restaurant> => {
    const res = await fetch(`${PROXY_BASE}/api/restaurants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createRestaurant failed ${res.status}`);
    return res.json();
  },

  patchRestaurant: async (id: number, body: Partial<RestaurantIn>): Promise<Restaurant> => {
    const res = await fetch(`${PROXY_BASE}/api/restaurants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patchRestaurant failed ${res.status}`);
    return res.json();
  },

  deleteRestaurant: async (id: number): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/restaurants/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deleteRestaurant failed ${res.status}`);
  },

  // ─── Life in Weeks ──────────────────────────────────────────────────────────

  lifeProfile: () => get<LifeProfile>("/life/profile"),
  lifeGrid: () => get<LifeGridResponse>("/life/grid"),
  lifePeriods: () => get<LifePeriod[]>("/life/periods"),
  lifeEvents: () => get<LifeEvent[]>("/life/events"),
  lifeEventsOnThisDay: (date: string) => get<LifeEvent[]>(`/life/events/on-this-day?date=${date}`),

  // ─── Sleep ──────────────────────────────────────────────────────────────────
  sleepSummary: (days = 30) =>
    get<Record<string, number | null>>(`/health/sleep/summary?days=${days}`),
  sleepStages: (days = 60) =>
    get<Record<string, number | null>[]>(`/health/sleep/stages?days=${days}`),
  sleepCorrelations: (days = 90) =>
    get<{ correlations: { metric_a: string; metric_b: string; lag: number; r: number | null; n: number }[] }>(`/health/sleep/correlations?days=${days}`),

  // ─── AI ─────────────────────────────────────────────────────────────────────
  morningBrief: (date: string) =>
    get<{ date: string; brief: string | null; available: boolean }>(`/ai/morning-brief/${date}`),
  aiStatus: () =>
    get<{ ollama_available: boolean; ollama_host: string; model_fast: string; model_default: string }>("/ai/status"),

  upsertProfile: async (body: { birthdate: string; display_name?: string }): Promise<LifeProfile> => {
    const res = await fetch(`${PROXY_BASE}/api/life/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`upsertProfile failed ${res.status}`);
    return res.json();
  },

  createPeriod: async (body: LifePeriodIn): Promise<LifePeriodCreateResponse> => {
    const res = await fetch(`${PROXY_BASE}/api/life/periods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createPeriod failed ${res.status}`);
    return res.json();
  },

  patchPeriod: async (id: number, body: Partial<LifePeriodIn>): Promise<LifePeriodCreateResponse> => {
    const res = await fetch(`${PROXY_BASE}/api/life/periods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patchPeriod failed ${res.status}`);
    return res.json();
  },

  deletePeriod: async (id: number): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/life/periods/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deletePeriod failed ${res.status}`);
  },

  createEvent: async (body: LifeEventIn): Promise<LifeEvent> => {
    const res = await fetch(`${PROXY_BASE}/api/life/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createEvent failed ${res.status}`);
    return res.json();
  },

  patchEvent: async (id: number, body: Partial<LifeEventIn>): Promise<LifeEvent> => {
    const res = await fetch(`${PROXY_BASE}/api/life/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`patchEvent failed ${res.status}`);
    return res.json();
  },

  deleteEvent: async (id: number): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/life/events/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deleteEvent failed ${res.status}`);
  },

  // ─── Decisions (Horizon 3) ──────────────────────────────────────────────────

  decisions: (day?: string) =>
    get<Decision[]>(`/decisions${day ? `?day=${day}` : ""}`),
  pendingDecisions: () => get<Decision[]>("/decisions/pending"),

  createDecision: async (body: DecisionCreate): Promise<Decision> => {
    const res = await fetch(`${PROXY_BASE}/api/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`createDecision failed ${res.status}`);
    return res.json();
  },

  resolveDecision: async (id: string, body: DecisionResolve): Promise<Decision> => {
    const res = await fetch(`${PROXY_BASE}/api/decisions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`resolveDecision failed ${res.status}`);
    return res.json();
  },

  deleteDecision: async (id: string): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/decisions/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deleteDecision failed ${res.status}`);
  },

  // ─── Groceries ────────────────────────────────────────────────────────────

  pantryItems: (activeOnly = true) =>
    get<PantryItem[]>(`/groceries/pantry?active_only=${activeOnly}`),

  addPantryItem: async (body: { name: string; mercadona_id?: string; unit?: string; category?: string }): Promise<PantryItem> => {
    const res = await fetch(`${PROXY_BASE}/api/groceries/pantry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`addPantryItem failed ${res.status}`);
    return res.json();
  },

  deletePantryItem: async (itemId: string): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/groceries/pantry/${itemId}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`deletePantryItem failed ${res.status}`);
  },

  priceHistory: (itemId: string, days = 90) =>
    get<{ item: PantryItem; history: PricePoint[] }>(`/groceries/prices/${itemId}/history?days=${days}`),

  syncPrices: async (): Promise<{ synced: number; skipped: number; errors: number }> => {
    const res = await fetch(`${PROXY_BASE}/api/groceries/prices/sync`, { method: "POST" });
    if (!res.ok) throw new Error(`syncPrices failed ${res.status}`);
    return res.json();
  },

  groceryPurchases: (month?: string) =>
    get<GroceryPurchase[]>(`/groceries/purchases${month ? `?month=${month}` : ""}`),

  latestMealPlan: () =>
    get<{ plan: MealPlan | null }>("/groceries/meal-plan/latest"),

  generateMealPlan: async (body: { meals: number; budget_eur: number; constraints?: string }): Promise<MealPlan> => {
    const res = await fetch(`${PROXY_BASE}/api/groceries/meal-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`generateMealPlan failed ${res.status}`);
    return res.json();
  },
};

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function fmtDistance(meters: number | null): string {
  if (!meters) return "—";
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

export function moodEmoji(mood: number | null): string {
  if (!mood) return "·";
  if (mood >= 9) return "😄";
  if (mood >= 7) return "🙂";
  if (mood >= 5) return "😐";
  if (mood >= 3) return "😕";
  return "😞";
}

export function activityIcon(type: string | null): string {
  const t = type?.toLowerCase() ?? "";
  if (t.includes("run")) return "🏃";
  if (t.includes("cycl") || t.includes("bike") || t.includes("ride")) return "🚴";
  if (t.includes("swim")) return "🏊";
  if (t.includes("walk") || t.includes("hike")) return "🚶";
  if (t.includes("strength") || t.includes("gym") || t.includes("weight")) return "🏋";
  if (t.includes("yoga") || t.includes("pilates")) return "🧘";
  if (t.includes("ski") || t.includes("snow")) return "⛷️";
  return "⚡";
}

export function fmtPace(speed_mps: number | null, activity_type: string | null): string {
  if (!speed_mps || speed_mps === 0) return "—";
  const t = activity_type?.toLowerCase() ?? "";
  if (t.includes("cycl") || t.includes("bike") || t.includes("ride")) {
    // km/h for cycling
    return `${(speed_mps * 3.6).toFixed(1)} km/h`;
  }
  // min/km for running
  const secPerKm = 1000 / speed_mps;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")} /km`;
}
