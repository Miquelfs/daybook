"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Upload, Check, Link2, EyeOff, Plus, RotateCcw, Trash2, ArrowRightLeft, Scale } from "lucide-react";
import { moneyApi, fmtAmount } from "@/lib/money-api";
import { statementsApi, STMT_KIND_LABEL, type StmtLine, type StmtTxn } from "@/lib/statements-api";
import { ActionButton, Block, Empty, Hero, Panel, Pill, Skeleton, Stat, Stats } from "@/components/ui/kit";

const signed = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${fmtAmount(n)}`;
const day = (d: string) => format(parseISO(d), "d MMM");
const dayYear = (d: string) => format(parseISO(d), "d MMM yyyy");

function DayLink({ d }: { d: string }) {
  return <Link href={`/day/${d}`} className="text-xs text-[#71717A] hover:text-[#FAFAFA] tabular-nums w-12 shrink-0">{day(d)}</Link>;
}

function Amount({ n }: { n: number }) {
  return <span className={`text-sm tabular-nums shrink-0 ${n > 0 ? "text-emerald-400" : ""}`}>{signed(n)}</span>;
}

const btn = "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#27272A] text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors disabled:opacity-50";
const input = "bg-[#18181B] border border-[#27272A] rounded-lg px-3 py-1.5 text-base sm:text-sm text-[#FAFAFA] placeholder:text-[#3F3F46] outline-none focus:border-[#52525B] min-w-0";

// A bank line Daybook doesn't have: add it (prefilled from a past entry that looks like it),
// pair it with an entry that's there under another name / amount, or ignore it.
function MissingRow({ line, categories, mirror, onDone }: {
  line: StmtLine; categories: string[]; mirror?: string | null; onDone: () => void;
}) {
  const [mode, setMode] = useState<null | "add" | "pair">(null);
  const [name, setName] = useState(line.suggest?.name ?? "");
  const [category, setCategory] = useState(line.suggest?.category ?? (line.amount > 0 ? "Income" : categories[0] ?? "Other"));
  const [sub, setSub] = useState(line.suggest?.subcategory ?? "");
  const [mirrorOn, setMirrorOn] = useState(line.kind === "investment");
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: onDone,
  });
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <DayLink d={line.date} />
        <p className="text-sm flex-1 min-w-0 truncate" title={line.description}>{line.description}</p>
        {line.kind && line.kind !== "card" && line.kind !== "other" && (
          <span className="text-[10px] uppercase tracking-widest text-[#71717A] shrink-0">{STMT_KIND_LABEL[line.kind]}</span>
        )}
        <Amount n={line.amount} />
      </div>
      {line.elsewhere?.map((t) => (
        <button key={t.id} disabled={act.isPending} onClick={() => act.mutate(() => statementsApi.move(line.id, t.id))}
                className="mt-2 ml-[3.75rem] w-[calc(100%-3.75rem)] flex items-center gap-2 text-left bg-[#F59E0B]/5 border border-[#F59E0B]/20 hover:bg-[#F59E0B]/10 rounded-lg px-3 py-1.5">
          <ArrowRightLeft size={12} className="text-[#F59E0B] shrink-0" />
          <span className="text-xs flex-1 min-w-0 truncate">
            Logged on <span className="text-[#FAFAFA]">{t.account}</span> as “{t.name}” ({day(t.date)}) — move it here
          </span>
        </button>
      ))}
      <div className="flex flex-wrap gap-1.5 mt-2 pl-[3.75rem]">
        <button className={btn} onClick={() => setMode(mode === "add" ? null : "add")}><Plus size={12} />Add to Daybook</button>
        {(line.candidates?.length ?? 0) > 0 && (
          <button className={btn} onClick={() => setMode(mode === "pair" ? null : "pair")}><Link2 size={12} />Pair</button>
        )}
        <button className={btn} disabled={act.isPending}
                onClick={() => act.mutate(() => statementsApi.ignore(line.id))}><EyeOff size={12} />Ignore</button>
      </div>
      {mode === "add" && (
        <form className="mt-2 flex flex-wrap gap-2 items-center"
              onSubmit={(e) => {
                e.preventDefault();
                act.mutate(() => statementsApi.add(line.id, {
                  name, category, subcategory: sub || undefined,
                  mirror_account: category === "Transfer" && mirror && mirrorOn ? mirror : undefined,
                }));
              }}>
          <input className={`${input} flex-1 basis-40`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {[...new Set([category, ...categories])].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className={`${input} basis-28`} value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Subcategory" />
          <button type="submit" disabled={!name.trim() || act.isPending}
                  className="inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 disabled:opacity-50">
            <Check size={12} />Save
          </button>
          {category === "Transfer" && mirror && (
            <label className="w-full flex items-center gap-2 text-xs text-[#71717A]">
              <input type="checkbox" checked={mirrorOn} onChange={(e) => setMirrorOn(e.target.checked)} />
              Also {signed(-line.amount)} on {mirror}
            </label>
          )}
        </form>
      )}
      {mode === "pair" && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-[#52525B]">The same thing, logged differently:</p>
          {line.candidates!.map((t) => (
            <button key={t.id} disabled={act.isPending} onClick={() => act.mutate(() => statementsApi.link(line.id, t.id))}
                    className="w-full flex items-center gap-3 text-left bg-[#18181B] hover:bg-[#27272A] rounded-lg px-3 py-1.5">
              <span className="text-xs text-[#71717A] w-12 tabular-nums">{day(t.date)}</span>
              <span className="text-sm flex-1 truncate">{t.name}</span>
              <span className="text-xs text-[#71717A]">{t.category}</span>
              <Amount n={t.amount} />
            </button>
          ))}
        </div>
      )}
      {act.error && <p className="text-xs text-rose-400 mt-1">{(act.error as Error).message}</p>}
    </div>
  );
}

function DiffersRow({ line, onDone }: { line: StmtLine; onDone: () => void }) {
  const t = line.txn!;
  const act = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: onDone });
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <DayLink d={line.date} />
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{t.name}</p>
          <p className="text-xs text-[#52525B] truncate" title={line.description}>{line.description}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm tabular-nums">{signed(line.amount)}</p>
          <p className="text-xs text-[#71717A] tabular-nums">Daybook {signed(t.amount)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <button className={btn} disabled={act.isPending}
                onClick={() => act.mutate(() => statementsApi.useBankAmount(line.id, t.id))}>
          <Check size={12} />Use the bank&apos;s {fmtAmount(line.amount)}
        </button>
        {line.how === "manual" && (
          <button className={btn} disabled={act.isPending} onClick={() => act.mutate(() => statementsApi.unlink(line.id))}>
            <RotateCcw size={12} />Unpair
          </button>
        )}
      </div>
    </div>
  );
}

function TxnRow({ t }: { t: StmtTxn }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <DayLink d={t.date} />
      <p className="text-sm flex-1 min-w-0 truncate">{t.name}</p>
      <span className="text-xs text-[#52525B] shrink-0">{t.category}</span>
      <Amount n={t.amount} />
    </div>
  );
}

function ReconcileInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showMatched, setShowMatched] = useState(false);
  const [range, setRange] = useState<{ start?: string; end?: string }>({});

  const { data: meta } = useQuery({ queryKey: ["money", "meta"], queryFn: () => moneyApi.meta() });
  const { data: status = [] } = useQuery({ queryKey: ["statements", "status"], queryFn: () => statementsApi.status() });
  const account = params.get("account") ?? status[0]?.account ?? meta?.defaults.account ?? meta?.accounts[0] ?? "";
  useEffect(() => setRange({}), [account]);

  const { data: rep, isLoading } = useQuery({
    queryKey: ["statements", "reconcile", account, range.start, range.end],
    queryFn: () => statementsApi.reconcile(account, range.start, range.end),
    enabled: !!account,
  });
  const { data: imports = [] } = useQuery({
    queryKey: ["statements", "imports", account],
    queryFn: () => statementsApi.imports(account),
    enabled: !!account,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["statements"] });
    qc.invalidateQueries({ queryKey: ["money"] });
  };
  const upload = useMutation({
    mutationFn: (f: File) => statementsApi.upload(account, f),
    onSuccess: () => { setRange({}); refresh(); },
  });
  const delImport = useMutation({ mutationFn: (id: number) => statementsApi.deleteImport(id), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (id: number) => statementsApi.ignore(id, false), onSuccess: refresh });
  const addAll = useMutation({ mutationFn: () => statementsApi.addAll(account, range.start, range.end), onSuccess: refresh });
  const settle = useMutation({ mutationFn: () => statementsApi.settle(account, range.start, range.end), onSuccess: refresh });

  const categories = (meta?.categories ?? []).map((c) => c.key);
  const accounts = [...new Set([...(meta?.accounts ?? []), ...status.map((s) => s.account)])];
  const b = rep?.balance;
  const gap = b ? b.closing_gap : null;
  const priorGap = b && Math.abs(b.opening_gap) >= 0.01 ? b.opening_gap : 0;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check against the bank</h1>
        <p className="text-sm text-[#71717A] mt-0.5">
          Keep logging by hand — drop the bank&apos;s export here now and then to see where the two disagree.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {accounts.map((a) => {
          const st = status.find((s) => s.account === a);
          const off = st && (st.missing > 0 || st.only_daybook > 0 || (st.closing_gap != null && Math.abs(st.closing_gap) >= 0.01));
          return (
            <Pill key={a} on={a === account} onClick={() => router.replace(`/money/reconcile?account=${encodeURIComponent(a)}`)}>
              {a}{off && <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
            </Pill>
          );
        })}
      </div>

      <Panel className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Import a statement for {account || "…"}</p>
            <p className="text-xs text-[#71717A] mt-0.5">
              CSV, Excel (.xlsx / .xls) or PDF from the bank&apos;s app or website. Re-importing an overlapping period is fine.
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          <button disabled={!account || upload.isPending} onClick={() => fileRef.current?.click()}
                  className="shrink-0 inline-flex items-center gap-1 text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] hover:bg-[#F59E0B]/20 rounded-lg px-3 py-1.5 disabled:opacity-50">
            <Upload size={13} />{upload.isPending ? "Reading…" : "Choose file"}
          </button>
        </div>
        {upload.data && (
          <p className="text-xs text-[#A1A1AA] mt-3">
            {upload.data.bank ? `${upload.data.bank} · ` : ""}{dayYear(upload.data.period_start)} → {dayYear(upload.data.period_end)}:
            {" "}{upload.data.lines_new} new line{upload.data.lines_new === 1 ? "" : "s"}
            {upload.data.lines_total > upload.data.lines_new && ` (${upload.data.lines_total - upload.data.lines_new} already here)`}
            {upload.data.skipped > 0 && ` · ${upload.data.skipped} pending/reverted skipped`}
            {upload.data.notes.map((n) => ` · ${n}`)}
          </p>
        )}
        {upload.error && <p className="text-xs text-rose-400 mt-3">{(upload.error as Error).message}</p>}
      </Panel>

      {isLoading || !rep ? (account ? <Skeleton h={140} /> : null) : !rep.has_statement ? (
        <Empty>No statement for {account} yet — export the last month or two from the bank and drop it above.</Empty>
      ) : (
        <>
          <Hero
            eyebrow={b ? `Balance on ${dayYear(b.closing_date)}` : `${dayYear(rep.start!)} → ${dayYear(rep.end!)}`}
            value={gap == null ? `${rep.counts!.missing + rep.counts!.only_daybook + rep.counts!.differs}`
              : Math.abs(gap) < 0.01 ? "Matches" : signed(gap)}
            unit={gap == null ? "to look at" : Math.abs(gap) < 0.01 ? undefined : gap > 0 ? "more in Daybook" : "less in Daybook"}
            sub={b ? `Bank ${signed(b.bank_closing)} · Daybook ${signed(b.daybook_closing)}`
              : "This statement has no running balance — only the lines are compared"}
          >
            {priorGap !== 0 && b && (
              <p className="text-xs text-[#71717A] mt-3">
                {signed(priorGap)} of it was already off on {dayYear(b.opening_date)}, before this statement starts —
                import an older one, or fix the account&apos;s opening balance.
              </p>
            )}
            {b && (Math.abs(b.closing_gap) >= 0.01 || (rep.adjustments?.length ?? 0) > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className={btn} disabled={settle.isPending}
                        onClick={() => {
                          if (confirm("Book what's still off as 🚨 adjustments (never counted as spending)? Do it after adding / moving what you can; pressing it again recomputes them.")) settle.mutate();
                        }}>
                  <Scale size={12} />{(rep.adjustments?.length ?? 0) > 0 ? "Settle again" : "Settle the gap"}
                </button>
                {rep.adjustments?.map((a) => (
                  <span key={a.id} className="text-xs text-[#71717A]">{day(a.date)} {signed(a.amount)}</span>
                ))}
                {settle.error && <span className="text-xs text-rose-400">{(settle.error as Error).message}</span>}
              </div>
            )}
            {b && b.chain_breaks > 0 && (
              <p className="text-xs text-[#71717A] mt-2">
                The bank&apos;s running balance skips in {b.chain_breaks} place{b.chain_breaks === 1 ? "" : "s"} — lines may be missing from the export.
              </p>
            )}
          </Hero>

          <Stats cols={4}>
            <Stat label="Matched" value={rep.counts!.matched} sub={`of ${rep.counts!.lines} lines`} />
            <Stat label="Only in bank" value={rep.counts!.missing} sub={rep.counts!.missing ? signed(rep.totals!.missing) : undefined} />
            <Stat label="Amount differs" value={rep.counts!.differs} sub={rep.counts!.differs ? signed(rep.totals!.differs) : undefined} />
            <Stat label="Only in Daybook" value={rep.counts!.only_daybook} sub={rep.counts!.only_daybook ? signed(rep.totals!.only_daybook) : undefined} />
          </Stats>

          <div className="flex items-center gap-2 text-xs text-[#71717A]">
            <span>Period</span>
            <input type="date" className={input} value={range.start ?? rep.start} min={rep.coverage![0]} max={rep.coverage![1]}
                   onChange={(e) => setRange((r) => ({ ...r, start: e.target.value || undefined }))} />
            <span>→</span>
            <input type="date" className={input} value={range.end ?? rep.end} min={rep.coverage![0]} max={rep.coverage![1]}
                   onChange={(e) => setRange((r) => ({ ...r, end: e.target.value || undefined }))} />
          </div>

          {rep.missing!.length > 0 && (
            <Block title="Only in the bank"
                   note="On the statement, not in Daybook. Add it, pair it with what you logged, move it from the account you logged it on, or ignore it. Add all files investments, interest, cashback and fees by their kind and the rest as 🚨 Alert."
                   action={<ActionButton icon={Plus} onClick={() => {
                     if (!addAll.isPending && confirm(`Add the ${rep.missing!.length} lines to Daybook? Spending goes in as 🚨 Alert to look at later; lines logged on another account are left for you to move.`)) addAll.mutate();
                   }}>{addAll.isPending ? "Adding…" : "Add all"}</ActionButton>}>
              {addAll.data && (
                <p className="text-xs text-[#A1A1AA] mb-2">
                  {addAll.data.alert} as 🚨 Alert · {addAll.data.filed} filed by kind
                  {addAll.data.left > 0 && ` · ${addAll.data.left} left to move from another account`}
                </p>
              )}
              <Panel className="divide-y divide-[#18181B]">
                {rep.missing!.map((l) => <MissingRow key={l.id} line={l} categories={categories} mirror={rep.mirror_account} onDone={refresh} />)}
              </Panel>
            </Block>
          )}

          {rep.differs!.length > 0 && (
            <Block title="Amount differs" note="Paired, but the bank charged something else — a tip, a currency fee, a typo.">
              <Panel className="divide-y divide-[#18181B]">
                {rep.differs!.map((l) => <DiffersRow key={l.id} line={l} onDone={refresh} />)}
              </Panel>
            </Block>
          )}

          {rep.only_daybook!.length > 0 && (
            <Block title="Only in Daybook" note={`Logged on ${account} but not on the statement — a wrong account or date, a duplicate, or something paid another way.`}>
              <Panel className="divide-y divide-[#18181B]">
                {rep.only_daybook!.map((t) => <TxnRow key={t.id} t={t} />)}
              </Panel>
            </Block>
          )}

          {rep.counts!.missing + rep.counts!.differs + rep.counts!.only_daybook === 0 && (
            <Empty>Every line on the statement is in Daybook, and nothing extra. </Empty>
          )}

          {rep.ignored!.length > 0 && (
            <Block title="Ignored">
              <Panel className="divide-y divide-[#18181B]">
                {rep.ignored!.map((l) => (
                  <div key={l.id} className="px-4 py-2.5 flex items-center gap-3">
                    <DayLink d={l.date} />
                    <p className="text-sm text-[#71717A] flex-1 min-w-0 truncate">{l.description}</p>
                    <Amount n={l.amount} />
                    <button className={btn} onClick={() => restore.mutate(l.id)}><RotateCcw size={12} /></button>
                  </div>
                ))}
              </Panel>
            </Block>
          )}

          {rep.matched!.length > 0 && (
            <Block title={`Matched · ${rep.matched!.length}`}
                   action={<button className="text-xs text-[#71717A] hover:text-[#FAFAFA]" onClick={() => setShowMatched(!showMatched)}>
                     {showMatched ? "Hide" : "Show"}</button>}>
              {showMatched && (
                <Panel className="divide-y divide-[#18181B]">
                  {rep.matched!.map((l) => (
                    <div key={l.id} className="px-4 py-2 flex items-center gap-3">
                      <DayLink d={l.date} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{l.txn!.name}</p>
                        <p className="text-xs text-[#52525B] truncate">
                          {l.description}{l.days_off ? ` · logged ${Math.abs(l.days_off)}d ${l.days_off < 0 ? "before" : "after"}` : ""}
                        </p>
                      </div>
                      <Amount n={l.amount} />
                    </div>
                  ))}
                </Panel>
              )}
            </Block>
          )}
        </>
      )}

      {imports.length > 0 && (
        <Block title="Statements imported">
          <Panel className="divide-y divide-[#18181B]">
            {imports.map((i) => (
              <div key={i.id} className="px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{i.filename ?? "statement"}</p>
                  <p className="text-xs text-[#71717A]">
                    {dayYear(i.period_start)} → {dayYear(i.period_end)} · {i.lines_new} new of {i.lines_total}
                  </p>
                </div>
                <button className={btn} disabled={delImport.isPending}
                        onClick={() => { if (confirm("Forget this statement's lines?")) delImport.mutate(i.id); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </Panel>
        </Block>
      )}
    </main>
  );
}

export default function ReconcilePage() {
  return <Suspense fallback={<div className="max-w-2xl mx-auto px-4"><Skeleton h={200} /></div>}><ReconcileInner /></Suspense>;
}
