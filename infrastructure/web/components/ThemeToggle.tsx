"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

// Dark (cockpit) is the default; light (paper chart) is opt-in and persisted.
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    if (next === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    // Persist server-side (durable — see /api/theme). iOS Safari's ITP caps
    // client-written cookies to ~7 days and evicts localStorage, which used to
    // silently revert the theme; a server-set cookie survives. localStorage is
    // kept only as an instant, offline-friendly fallback for the pre-paint read.
    try {
      localStorage.setItem("db-theme", next);
    } catch { /* private mode */ }
    fetch("/api/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
      keepalive: true,
    }).catch(() => { /* offline — localStorage still carries it */ });
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "light" ? "#F3EFE6" : "#09090B");
  };

  return (
    <button
      onClick={toggle}
      title={theme === "light" ? "Cockpit (dark)" : "Paper chart (light)"}
      className="flex items-center justify-center w-10 h-10 rounded-lg text-[#52525B] hover:text-[#F59E0B] hover:bg-[#18181B] transition-colors"
    >
      {theme === "light" ? <Moon size={16} strokeWidth={1.5} /> : <Sun size={16} strokeWidth={1.5} />}
    </button>
  );
}
