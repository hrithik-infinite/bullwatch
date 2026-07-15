import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";

interface AppState {
  theme: Theme;
  density: Density;
  live: boolean;
  toggleTheme: () => void;
  setDensity: (d: Density) => void;
  toggleLive: () => void;
}

const AppContext = createContext<AppState | null>(null);

function persisted<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => persisted("bw.theme", "dark"));
  const [density, setDensityState] = useState<Density>(() =>
    persisted("bw.density", "comfortable"),
  );
  const [live, setLive] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-bw-theme", theme);
    root.setAttribute("data-bw-density", density);
    try {
      localStorage.setItem("bw.theme", theme);
      localStorage.setItem("bw.density", density);
    } catch {
      /* ignore */
    }
  }, [theme, density]);

  const value = useMemo<AppState>(
    () => ({
      theme,
      density,
      live,
      toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      setDensity: setDensityState,
      toggleLive: () => setLive((l) => !l),
    }),
    [theme, density, live],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
