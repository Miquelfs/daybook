"use client";

export function YearSelect({ years, current }: { years: string[]; current: string | undefined }) {
  return (
    <select
      value={current ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        window.location.href = v ? `/explore?year=${v}` : "/explore";
      }}
      className="bg-[#18181B] border border-[#27272A] text-sm text-[#D4D4D8] rounded-lg
                 px-3 py-2 pr-8 focus:outline-none focus:border-[#F59E0B] transition-colors cursor-pointer"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717A' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        appearance: "none",
      }}
    >
      <option value="">All time</option>
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
    </select>
  );
}
