"use client";
import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "../ui-icons";
import {
  applyTheme,
  effectiveTheme,
  saveTheme,
  storedTheme,
  type ThemeChoice,
} from "../lib/theme";

// Applies a saved theme on every page, before any toggle is shown.
export function ThemeSync() {
  useEffect(() => applyTheme(storedTheme()), []);
  return null;
}

// Switches between light and dark. Until the person chooses, the page follows
// the device setting.
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [shown, setShown] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const initial = storedTheme();
    queueMicrotask(() => {
      setChoice(initial);
      setShown(effectiveTheme(initial));
    });
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const follow = () => setShown((current) => (storedTheme() === "system" ? effectiveTheme("system") : current));
    media?.addEventListener?.("change", follow);
    return () => media?.removeEventListener?.("change", follow);
  }, []);
  const next = shown === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className={`icon-button theme-toggle ${className}`.trim()}
      aria-label={shown ? `Switch to ${next} mode` : "Switch colour mode"}
      title={shown ? `Switch to ${next} mode` : undefined}
      data-choice={choice}
      onClick={() => {
        saveTheme(next);
        setChoice(next);
        setShown(next);
      }}
    >
      {shown === "light" ? <MoonIcon size={17} /> : <SunIcon size={17} />}
    </button>
  );
}
