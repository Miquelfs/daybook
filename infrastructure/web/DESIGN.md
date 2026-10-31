# Daybook UI — one style everywhere

The look is the one Omyra, Health and Plan already have: calm paper (light) / ink (dark), plain
panels, small grey uppercase labels, neutral numbers, **one** amber accent. Build pages from
`components/ui/kit.tsx`; when something new is needed, add it there rather than styling inline.

## Type scale (the only sizes)

| Use | Classes |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight` (+ `text-sm text-[#71717A]` subtitle) |
| Back link | `text-xs uppercase tracking-widest text-[#71717A]` |
| Section title | `<Block title>` → `text-xs uppercase tracking-widest text-[#52525B]` |
| Hero number — **one per page**, top card | `<Hero>` → `text-4xl font-semibold tracking-tight` |
| Stat value | `<Stat>` → `text-lg font-semibold` (label `text-[10px]` uppercase) |
| Card title / list item | `text-sm font-medium` |
| Body | `text-sm text-[#A1A1AA]` · meta `text-xs text-[#71717A]` · faint `text-[#52525B]` |

No `text-3xl`/`text-5xl`, no `text-[28px]`-style one-offs.

## Surfaces

- Card: `<Panel>` (`rounded-2xl border border-[#27272A] bg-[#0D0D0F]`), padding `p-4` (hero `p-5`).
- Inset tile inside a card: `bg-[#18181B] rounded-xl px-3 py-2.5` (`<Stat>`).
- List inside a card: rows `px-4 py-2.5`, `divide-y divide-[#18181B]`.
- Spacing: sections `mb-8` / `space-y-8`; grids `gap-2` (tiles) or `gap-3` (cards).
- No `rounded-3xl`, no shadows, no glows, no gradients, no oversized cards.

## Colour

- Numbers and text are neutral ink. Colour is information, not decoration.
- **Amber `#F59E0B`** is the only accent: selection, "new", the primary action (`<Chip accent>`, `<ActionButton>`).
- Green / rose only for a verdict that is good / needs attention (`text-emerald-400`, `text-rose-400`).
- Sport, duty and zone colours (`lib/sport.ts`, `lib/duty.ts`, `--viz-*`) live **inside charts, maps and
  small markers** (a dot, a bar, a chip edge) — never as big coloured numbers or filled badges.
- Accent hex as text goes through `ink()` (`lib/duty.ts`) so it stays readable on paper.

## Patterns

- Page: `<PageHeader title subtitle right tabs>` → `<Hero>` → `<Block>`s. An area's sub-pages use
  `<SectionTabs>` (link tabs: `HealthTabs`, `ExploreTabs`); in-page switches use `<TabBar>`.
- Loading: `<Skeleton h>` the size of what's coming — never a bare "Loading…". Empty: `<Empty>` one line.
- Anything that names a day, place, activity or trip is a link to it.
- Charts: recharts with `--viz-*` tokens, grid `var(--viz-grid)`, axis `var(--viz-axis)`, 10–11px ticks.
- Icons: lucide, 13–16px, `strokeWidth` default; no emoji in UI chrome except a sport/activity icon.
- Empty states: one `text-xs text-[#52525B]` line, not a card.
