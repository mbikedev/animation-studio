"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ initial }: { initial: "dark" | "light" }) {
  const [theme, setTheme] = useState(initial);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre"}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
