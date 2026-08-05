"use client";

import { useEffect, useState } from "react";

// Botón flotante de tema (claro/oscuro). El tema se aplica ANTES del render por un script
// inline en el layout (evita el parpadeo), así que aquí solo leemos data-theme y lo
// alternamos, persistiendo en localStorage ('tito.theme'). El ícono hace un morfeo
// sol↔luna (rotar + fundir) al cambiar. Reconstruido tras la pérdida del trabajo original.

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    setTheme(current);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("tito.theme", next); } catch { /* modo privado, etc. */ }
    setTheme(next);
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-fab"
      onClick={toggle}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      suppressHydrationWarning
    >
      <span className="theme-orb" aria-hidden="true">
        {/* Sol: círculo + rayos */}
        <svg className="ic ic-sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" />
          <g className="rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="1.5" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22.5" y2="12" />
            <line x1="4.2" y1="4.2" x2="6" y2="6" />
            <line x1="18" y1="18" x2="19.8" y2="19.8" />
            <line x1="19.8" y1="4.2" x2="18" y2="6" />
            <line x1="6" y1="18" x2="4.2" y2="19.8" />
          </g>
        </svg>
        {/* Luna: creciente */}
        <svg className="ic ic-moon" viewBox="0 0 24 24">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      </span>
      <span className="theme-fab-txt" suppressHydrationWarning>
        {mounted ? (isDark ? "Claro" : "Oscuro") : "Tema"}
      </span>
    </button>
  );
}
