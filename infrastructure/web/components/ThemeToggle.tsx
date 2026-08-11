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
    // Persist to both localStorage and a cookie — localStorage gets evicted on
    // iOS Safari, so the cookie is a second line of defence for the preference.
    try {
      localStorage.setItem("db-theme", next);
    } catch { /* private mode */ }
    try {
      document.cookie = `db-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    } catch { /* ignore */ }
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
