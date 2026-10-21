const PALETTE = ["#DB2777", "#7C3AED", "#2563EB", "#0D9488", "#65A30D", "#D97706", "#EA580C", "#E11D48", "#0891B2"];

function hue(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A person: their emoji if they have one, else initials on a colour that stays theirs. */
export function Avatar({ name, emoji, size = 36, ring }: {
  name: string;
  emoji?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const c = hue(name);
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full font-semibold select-none"
      style={{
        width: size, height: size,
        fontSize: emoji ? size * 0.5 : size * 0.36,
        background: `${c}26`, color: c,
        boxShadow: ring ? `0 0 0 2px ${c}` : undefined,
      }}
      aria-hidden
    >
      {emoji || initials(name)}
    </span>
  );
}
