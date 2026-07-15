import { useState } from "react";
import { mono } from "./primitives.js";

const MASKED = "[masked]";

/** Count "[masked]" sentinel values anywhere in a payload. */
export function countMasked(value: unknown): number {
  if (value === MASKED) return 1;
  if (Array.isArray(value)) return value.reduce<number>((a, v) => a + countMasked(v), 0);
  if (value && typeof value === "object")
    return Object.values(value).reduce<number>((a, v) => a + countMasked(v), 0);
  return 0;
}

function Leaf({ value }: { value: unknown }) {
  if (value === MASKED) {
    return (
      <span
        style={mono({
          fontSize: 11.5,
          color: "var(--st-paused)",
          background: "color-mix(in oklab, var(--st-paused) 14%, transparent)",
          borderRadius: 4,
          padding: "0 6px",
        })}
        title="Redacted server-side — never sent to the browser"
      >
        🔒 masked
      </span>
    );
  }
  if (typeof value === "string")
    return <span style={mono({ fontSize: 11.5, color: "var(--st-completed)" })}>"{value}"</span>;
  if (typeof value === "number")
    return <span style={mono({ fontSize: 11.5, color: "var(--st-active)" })}>{value}</span>;
  if (typeof value === "boolean")
    return (
      <span style={mono({ fontSize: 11.5, color: "var(--st-delayed)" })}>{String(value)}</span>
    );
  if (value === null)
    return <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>null</span>;
  return <span style={mono({ fontSize: 11.5, color: "var(--text-2)" })}>{String(value)}</span>;
}

function Node({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const isObj = value && typeof value === "object";
  const [open, setOpen] = useState(depth < 2);
  const pad = { paddingLeft: depth * 14 };

  if (!isObj) {
    return (
      <div style={{ ...pad, padding: "1.5px 0 1.5px", paddingLeft: depth * 14 }}>
        {name !== null && (
          <span style={mono({ fontSize: 11.5, color: "var(--text-1)" })}>{name}: </span>
        )}
        <Leaf value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const brace = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          border: 0,
          background: "transparent",
          cursor: "pointer",
          padding: "1.5px 0",
          font: "inherit",
          color: "inherit",
          display: "block",
          textAlign: "left",
        }}
      >
        <span style={{ color: "var(--text-3)", fontSize: 10, marginRight: 4 }}>
          {open ? "▾" : "▸"}
        </span>
        {name !== null && (
          <span style={mono({ fontSize: 11.5, color: "var(--text-1)" })}>{name}: </span>
        )}
        <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>
          {brace[0]}
          {open ? "" : `${entries.length}${brace[1]}`}
        </span>
      </button>
      {open && (
        <div>
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
          <div style={{ paddingLeft: (depth + 1) * 14 - 14 }}>
            <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>{brace[1]}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function JsonTree({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span style={mono({ fontSize: 11.5, color: "var(--text-3)" })}>—</span>;
  if (typeof value !== "object") return <Leaf value={value} />;
  return <Node name={null} value={value} depth={0} />;
}
