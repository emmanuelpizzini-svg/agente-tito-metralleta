import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import ThemeToggle from "./components/ThemeToggle";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "HedgeFlow — Options AI",
  description: "HedgeFlow — AI Options Agent: scorecard, flujo y predicción.",
};

// Aplica el tema ANTES del primer pintado para que no haya parpadeo: lee 'tito.theme'
// de localStorage, y si no hay preferencia guardada usa la del sistema.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('tito.theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={spaceGrotesk.className}>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
