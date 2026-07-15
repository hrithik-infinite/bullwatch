import { useApp } from "../state.js";
import { Icons } from "./icons.js";
import { mono } from "./primitives.js";

export interface HeaderProps {
  crumbRoot: string;
  crumbLeaf?: string;
  onOpenPalette: () => void;
}

export function Header({ crumbRoot, crumbLeaf, onOpenPalette }: HeaderProps) {
  const { theme, density, setDensity, toggleTheme, live, toggleLive } = useApp();

  const seg = (active: boolean) => ({
    border: 0,
    background: "transparent",
    color: "var(--text-2)",
    font: "inherit",
    fontSize: 11.5,
    padding: "3px 8px",
    borderRadius: 6,
    cursor: "pointer",
    ...(active ? {} : {}),
  });

  return (
    <header
      style={{
        height: 52,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, minWidth: 0 }}>
        <span style={{ color: "var(--text-2)" }}>{crumbRoot}</span>
        {crumbLeaf && (
          <>
            <span style={{ color: "var(--text-3)" }}>/</span>
            <span style={mono({ color: "var(--text-0)", fontWeight: 560 })}>{crumbLeaf}</span>
          </>
        )}
      </div>
      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={onOpenPalette}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          padding: "0 9px 0 11px",
          width: 280,
          background: "var(--bg-3)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-2)",
          font: "inherit",
          fontSize: 12.5,
          cursor: "text",
        }}
      >
        {Icons.search(14)}
        <span style={{ flex: 1, textAlign: "left" }}>Search or jump to…</span>
        <span
          style={mono({
            fontSize: 10.5,
            padding: "1px 5px",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            color: "var(--text-2)",
          })}
        >
          ⌘K
        </span>
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-3)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 2,
          gap: 2,
        }}
      >
        <button
          type="button"
          data-bw-seg=""
          aria-current={density === "comfortable" ? "page" : undefined}
          onClick={() => setDensity("comfortable")}
          style={seg(density === "comfortable")}
          title="Comfortable density"
        >
          Comfortable
        </button>
        <button
          type="button"
          data-bw-seg=""
          aria-current={density === "compact" ? "page" : undefined}
          onClick={() => setDensity("compact")}
          style={seg(density === "compact")}
          title="Compact density"
        >
          Compact
        </button>
      </div>

      <button
        type="button"
        onClick={toggleLive}
        title={live ? "Live updates on" : "Live updates paused"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 32,
          padding: "0 10px",
          background: "var(--bg-3)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-1)",
          font: "inherit",
          fontSize: 11.5,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: live ? "var(--st-completed)" : "var(--text-3)",
            animation: live ? "bw-pulse 2.6s ease-in-out infinite" : undefined,
          }}
        />
        {live ? "Live" : "Paused"}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        title="Toggle theme"
        style={{
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          background: "var(--bg-3)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-1)",
          cursor: "pointer",
        }}
      >
        {theme === "dark" ? Icons.moon() : Icons.sun()}
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 10px",
          background: "color-mix(in oklab, var(--st-completed) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--st-completed) 26%, transparent)",
          borderRadius: 8,
        }}
        title="bullwatch makes zero external network calls. Everything stays on this machine."
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--st-completed)",
            flex: "none",
            animation: "bw-pulse 2.6s ease-in-out infinite",
          }}
        />
        <span style={{ fontSize: 11.5, color: "var(--text-1)" }}>
          Local · <span style={mono({ color: "var(--st-completed)" })}>0</span> external calls
        </span>
      </div>
    </header>
  );
}
