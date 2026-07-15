import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueSummary } from "../api/types.js";
import { type Route, navigate } from "../lib/router.js";
import { mono } from "./primitives.js";

interface Command {
  id: string;
  label: string;
  hint: string;
  route: Route;
}

export function CommandPalette({
  open,
  onClose,
  queues,
}: {
  open: boolean;
  onClose: () => void;
  queues: QueueSummary[] | null;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = [
      { id: "overview", label: "Overview", hint: "monitor", route: { name: "overview" } },
      { id: "workers", label: "Workers", hint: "monitor", route: { name: "workers" } },
      { id: "flows", label: "Flows", hint: "monitor", route: { name: "flows" } },
      { id: "search", label: "Search", hint: "investigate", route: { name: "search" } },
      { id: "metrics", label: "Metrics", hint: "investigate", route: { name: "metrics" } },
      { id: "dlq", label: "Dead-letter", hint: "investigate", route: { name: "dlq" } },
      { id: "alerts", label: "Alerts", hint: "configure", route: { name: "alerts" } },
    ];
    const qcmds: Command[] = (queues ?? []).map((q) => ({
      id: `q:${q.name}`,
      label: q.name,
      hint: "queue",
      route: { name: "queue", queue: q.name },
    }));
    return [...nav, ...qcmds];
  }, [queues]);

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(s) || c.hint.includes(s));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const choose = (c: Command | undefined) => {
    if (!c) return;
    navigate(c.route);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      onKeyDown={() => {}}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
        zIndex: 50,
        animation: "bw-fade .12s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(filtered.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(filtered[sel]);
          }
        }}
        role="dialog"
        aria-modal="true"
        style={{
          width: 560,
          maxWidth: "92vw",
          background: "var(--bg-1)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
          animation: "bw-pop .14s ease",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or jump to…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "14px 16px",
            background: "transparent",
            border: 0,
            borderBottom: "1px solid var(--border)",
            outline: "none",
            color: "var(--text-0)",
            font: "inherit",
            fontSize: 14,
          }}
        />
        <div style={{ maxHeight: 360, overflow: "auto", padding: 6 }}>
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              data-bw-cmd=""
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(c)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "8px 10px",
                border: 0,
                background: "transparent",
                borderRadius: 8,
                cursor: "pointer",
                font: "inherit",
                textAlign: "left",
                color: "var(--text-0)",
              }}
            >
              <span style={mono({ fontSize: 13 })}>{c.label}</span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  letterSpacing: ".05em",
                }}
              >
                {c.hint}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "16px", color: "var(--text-2)", fontSize: 12.5 }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
