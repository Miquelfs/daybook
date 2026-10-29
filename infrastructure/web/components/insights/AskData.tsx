"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, Database, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { askApi, type AskMessage, type AskQuery } from "@/lib/ask-api";

const EXAMPLES = [
  "Could I do an Ironman given my training, with a structured plan and the Mallorca 312 first?",
  "How does flying affect my sleep and HRV the next day?",
  "What were my best training months, and what did those weeks have in common?",
  "Where does my money go on duty days compared with days off?",
];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-[#27272A] bg-[#0D0D0F] p-5 ${className}`}>{children}</section>;
}

const fmtWhen = (iso: string) =>
  new Date(iso.endsWith("Z") ? iso : `${iso}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Ask your data: a question goes to Claude on the Pi, which reads the databases
 * (read-only) and answers with the numbers it found. Conversations are kept, and
 * each answer shows the queries it was built on.
 */
export function AskData() {
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: threads = [] } = useQuery({ queryKey: ["ask-threads"], queryFn: askApi.threads, staleTime: 0 });
  const { data: thread } = useQuery({
    queryKey: ["ask-thread", threadId],
    queryFn: () => askApi.thread(threadId!),
    enabled: threadId != null,
  });

  const send = useMutation({
    mutationFn: (q: string) => askApi.ask(q, threadId),
    onMutate: (q) => { setPending(q); setDraft(""); },
    onSuccess: (t) => {
      qc.setQueryData(["ask-thread", t.id], t);
      setThreadId(t.id);
      qc.invalidateQueries({ queryKey: ["ask-threads"] });
    },
    onError: (_e, q) => setDraft(q),
    onSettled: () => setPending(null),
  });

  const remove = useMutation({
    mutationFn: (id: number) => askApi.remove(id),
    onSuccess: (_r, id) => {
      if (id === threadId) setThreadId(null);
      qc.invalidateQueries({ queryKey: ["ask-threads"] });
    },
  });

  useEffect(() => {
    if (pending || thread) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [pending, thread]);

  const submit = (q = draft) => {
    const text = q.trim();
    if (text.length >= 2 && !send.isPending) send.mutate(text);
  };

  const messages = threadId != null ? thread?.messages ?? [] : [];
  const active = threadId != null || pending != null;

  return (
    <div className="space-y-4">
      {active ? (
        <Card className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-widest text-[#71717A] truncate">
              {thread?.title ?? "New question"}
            </p>
            <button onClick={() => { setThreadId(null); send.reset(); }}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-[#71717A] hover:text-[#F59E0B]">
              <MessageSquarePlus size={13} /> New
            </button>
          </div>
          {messages.map((m) => <Message key={m.id} m={m} />)}
          {pending && (
            <>
              <UserBubble text={pending} />
              <Thinking />
            </>
          )}
          {send.isError && (
            <p className="text-sm text-red-400">{(send.error as Error).message}</p>
          )}
          <div ref={endRef} />
          <Composer value={draft} onChange={setDraft} onSubmit={() => submit()} busy={send.isPending}
                    placeholder="Ask a follow-up…" />
        </Card>
      ) : (
        <Card className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[#71717A] mb-1.5">Ask your data</p>
            <p className="text-sm text-[#A1A1AA]">
              Anything about your training, health, sleep, flying, money or places. Claude looks through
              the databases (read-only) and answers with the numbers.
            </p>
          </div>
          <Composer value={draft} onChange={setDraft} onSubmit={() => submit()} busy={send.isPending}
                    placeholder="e.g. Am I sleeping worse on standby weeks?" autoFocus />
          {send.isError && <p className="text-sm text-red-400">{(send.error as Error).message}</p>}
          <div className="flex flex-col gap-1.5">
            {EXAMPLES.map((q) => (
              <button key={q} onClick={() => submit(q)}
                      className="text-left text-xs text-[#A1A1AA] border border-[#27272A] rounded-lg px-3 py-2 hover:border-[#F59E0B]/50 hover:text-[#FAFAFA] transition-colors">
                {q}
              </button>
            ))}
          </div>
        </Card>
      )}

      {threads.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <p className="text-[10px] uppercase tracking-widest text-[#71717A] px-5 pt-4 pb-2">Earlier questions</p>
          <div className="divide-y divide-[#18181B]">
            {threads.map((t) => (
              <div key={t.id}
                   className={`group flex items-center gap-3 px-5 py-2.5 ${t.id === threadId ? "bg-[#131316]" : "hover:bg-[#131316]"}`}>
                <button onClick={() => { setThreadId(t.id); send.reset(); }} className="flex-1 min-w-0 text-left">
                  <p className="text-sm text-[#FAFAFA] truncate">{t.title}</p>
                  <p className="text-[11px] text-[#71717A] mt-0.5">
                    {fmtWhen(t.updated_at)}{t.turns > 1 ? ` · ${t.turns} questions` : ""}
                  </p>
                </button>
                <button onClick={() => remove.mutate(t.id)} aria-label="Delete conversation"
                        className="shrink-0 text-[#52525B] hover:text-red-400 opacity-60 group-hover:opacity-100">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Composer({ value, onChange, onSubmit, busy, placeholder, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex items-end gap-2 rounded-xl border border-[#27272A] bg-[#09090B] px-3 py-2 focus-within:border-[#3F3F46]">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
        }}
        rows={Math.min(5, Math.max(1, value.split("\n").length))}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={busy}
        className="flex-1 resize-none bg-transparent text-sm text-[#FAFAFA] placeholder:text-[#52525B] outline-none py-1 disabled:opacity-50"
      />
      <button onClick={onSubmit} disabled={busy || value.trim().length < 2} aria-label="Ask"
              className="shrink-0 w-7 h-7 rounded-lg bg-[#F59E0B] text-black flex items-center justify-center disabled:opacity-30">
        <ArrowUp size={15} />
      </button>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-xl rounded-br-sm bg-[#18181B] border border-[#27272A] px-3.5 py-2 text-sm text-[#FAFAFA] whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}

function Thinking() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="flex items-center gap-2 text-sm text-[#71717A]">
      <Sparkles size={14} className="text-[#F59E0B] animate-pulse" />
      Looking through your data… <span className="tabular-nums text-[#52525B]">{s}s</span>
    </p>
  );
}

function Message({ m }: { m: AskMessage }) {
  if (m.role === "user") return <UserBubble text={m.content} />;
  return (
    <div className="space-y-2">
      <Markdown text={m.content} />
      {m.queries.length > 0 && <Queries queries={m.queries} />}
    </div>
  );
}

function Queries({ queries }: { queries: AskQuery[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#71717A] hover:text-[#A1A1AA]">
        <Database size={11} />
        Based on {queries.length} quer{queries.length === 1 ? "y" : "ies"}
        <ChevronDown size={11} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {queries.map((q, i) => (
            <div key={i} className="rounded-lg border border-[#27272A] bg-[#09090B] px-3 py-2">
              <p className="text-[11px] text-[#A1A1AA] mb-1">
                {q.purpose || `Query ${i + 1}`}
                <span className={`ml-2 ${q.error ? "text-red-400" : "text-[#52525B]"}`}>
                  {q.error ? q.error : `${q.rows} row${q.rows === 1 ? "" : "s"}`}
                </span>
              </p>
              <pre className="text-[10px] leading-relaxed text-[#71717A] font-mono whitespace-pre-wrap break-words">{q.sql}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── A small Markdown renderer: headings, lists, tables, paragraphs, inline marks ──

function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:[^)\s]+)\)|\*([^*\s][^*]*)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k} className="font-semibold text-[#FAFAFA]">{m[2]}</strong>);
    else if (m[3]) out.push(<code key={k} className="font-mono text-[12px] bg-[#18181B] rounded px-1">{m[3]}</code>);
    else if (m[4]) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer" className="text-[#F59E0B] hover:underline">{m[4]}</a>);
    else if (m[6]) out.push(<em key={k}>{m[6]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      blocks.push(<p key={i} className="text-sm font-semibold text-[#FAFAFA] pt-1">{inline(h[2], i)}</p>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push(<hr key={i} className="border-[#27272A]" />);
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
      const [head, ...rest] = body.map(cells);
      blocks.push(
        <div key={i} className="overflow-x-auto -mx-1">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>{head?.map((c, j) => <th key={j} className="text-left font-medium text-[#A1A1AA] border-b border-[#27272A] px-1.5 py-1.5 align-bottom">{inline(c, j)}</th>)}</tr>
            </thead>
            <tbody>
              {rest.map((r, ri) => (
                <tr key={ri} className="border-b border-[#18181B] last:border-0">
                  {r.map((c, j) => <td key={j} className="px-1.5 py-1.5 text-[#D4D4D8] align-top">{inline(c, ri * 100 + j)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const ordered = /^\d+[.)]\s/.test(t);
    if (ordered || /^[-*•]\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const lt = l.trim();
        if (ordered ? /^\d+[.)]\s/.test(lt) : /^[-*•]\s/.test(lt)) items.push(lt.replace(/^(\d+[.)]|[-*•])\s+/, ""));
        else if (lt && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += " " + lt;
        else break;
        i++;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={i} className={`${ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1 marker:text-[#52525B]`}>
          {items.map((it, j) => <li key={j}>{inline(it, i * 100 + j)}</li>)}
        </Tag>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||[-*•]\s|\d+[.)]\s)/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length === 0) { para.push(t); i++; }     // a line no rule above claimed
    blocks.push(<p key={i}>{inline(para.join(" "), i)}</p>);
  }
  return <div className="space-y-2.5 text-sm leading-relaxed text-[#D4D4D8]">{blocks}</div>;
}
