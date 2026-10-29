// Ask — questions about your own data, answered by Claude over read-only SQL.
// Client-side only: everything goes through the Next.js /api/ask proxy.

export interface AskQuery {
  sql: string;
  purpose: string | null;
  rows?: number;
  error?: string;
}

export interface AskMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** The SQL the answer was built on (assistant turns only). */
  queries: AskQuery[];
  created_at: string;
}

export interface AskThread {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
  messages: AskMessage[];
}

export interface AskThreadSummary {
  id: number;
  title: string;
  updated_at: string;
  turns: number;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ask${path}`, { cache: "no-store", ...init });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? `${res.status}`);
  return data as T;
}

export const askApi = {
  ask: (question: string, thread_id?: number | null) =>
    req<AskThread>("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, thread_id: thread_id ?? null }),
    }),
  threads: () => req<AskThreadSummary[]>("/threads"),
  thread: (id: number) => req<AskThread>(`/threads/${id}`),
  remove: (id: number) => req<void>(`/threads/${id}`, { method: "DELETE" }),
};
