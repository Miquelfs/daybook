const BASE =
  (typeof window === "undefined" ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000";

const PROXY_BASE = typeof window === "undefined" ? BASE : "";

export type Tag = {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  category: string;
  color: string | null;
  is_system: boolean;
  is_negative: boolean;
  usage_count: number;
};

export type DayTag = {
  tag_id: number;
  slug: string;
  name: string;
  icon: string | null;
  category: string;
  color: string | null;
  note: string | null;
};

export const CATEGORY_LABELS: Record<string, string> = {
  work: "Work",
  location: "Location",
  social: "Social",
  activity: "Activity",
  health: "Health",
  emotion: "Emotion",
  environment: "Environment",
};

// Tags that show an inline input when active
export const COUNTER_SLUGS = new Set(["nap", "sex", "alcohol", "personal"]);

// "counter" = numeric stepper (1,2,3…), "text" = free text
export const COUNTER_TYPE: Record<string, "counter" | "text"> = {
  nap:      "text",    // free text duration e.g. "45min"
  sex:      "counter", // number of times
  alcohol:  "counter", // number of drinks
  personal: "counter", // number of times
};

export const COUNTER_PLACEHOLDER: Record<string, string> = {
  nap:      "Duration (e.g. 45min)",
  sex:      "Times",
  alcohol:  "Drinks",
  personal: "Times",
};

export const tagsApi = {
  list: (category?: string): Promise<Tag[]> => {
    const qs = category ? `?category=${category}` : "";
    return fetch(`${BASE}/tags${qs}`, { cache: "no-store" }).then((r) => r.json());
  },

  createTag: async (body: {
    slug: string;
    name: string;
    icon?: string;
    category: string;
    color?: string;
  }): Promise<Tag> => {
    const res = await fetch(`${PROXY_BASE}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `createTag failed ${res.status}`);
    }
    return res.json();
  },

  updateTag: async (
    id: number,
    body: { name?: string; icon?: string; category?: string; color?: string; is_negative?: boolean }
  ): Promise<Tag> => {
    const res = await fetch(`${PROXY_BASE}/api/tags/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`updateTag failed ${res.status}`);
    return res.json();
  },

  deleteTag: async (id: number): Promise<void> => {
    const res = await fetch(`${PROXY_BASE}/api/tags/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? `deleteTag failed ${res.status}`);
    }
  },

  getDayTags: (date: string): Promise<DayTag[]> =>
    fetch(`${BASE}/days/${date}/tags`, { cache: "no-store" }).then((r) => r.json()),

  addDayTag: async (date: string, tag_id: number, note?: string): Promise<DayTag[]> => {
    const res = await fetch(`${PROXY_BASE}/api/days/${date}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id, note: note ?? null }),
    });
    if (!res.ok) throw new Error(`addDayTag failed ${res.status}`);
    return res.json();
  },

  removeDayTag: async (date: string, tag_id: number): Promise<void> => {
    await fetch(`${PROXY_BASE}/api/days/${date}/tags/${tag_id}`, {
      method: "DELETE",
    });
  },
};
