import type { CSSProperties, ReactNode } from "react";

export function Screen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section data-screen-label={label} style={{ animation: "bw-fade .18s ease" }}>
      {children}
    </section>
  );
}

export function headerCell(align: "left" | "right" = "left"): CSSProperties {
  return {
    textAlign: align,
    fontWeight: 600,
    fontSize: 10.5,
    letterSpacing: ".05em",
    padding: "8px var(--cell-px)",
    position: "sticky",
    top: 0,
    background: "var(--bg-1)",
    borderBottom: "1px solid var(--border)",
  };
}

export function Th({
  children,
  align = "left",
}: { children: ReactNode; align?: "left" | "right" }) {
  return <th style={headerCell(align)}>{children}</th>;
}

export function Placeholder({ label, note }: { label: string; note: string }) {
  return (
    <Screen label={label}>
      <div style={{ padding: "18px 18px 4px" }}>
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 640, letterSpacing: "-.01em" }}>
          {label}
        </h1>
      </div>
      <div
        style={{
          margin: "24px 18px",
          padding: "40px 18px",
          border: "1px dashed var(--border-strong)",
          borderRadius: 12,
          textAlign: "center",
          color: "var(--text-2)",
          fontSize: 13,
        }}
      >
        {note}
      </div>
    </Screen>
  );
}

export function ErrorBar({ message }: { message: string }) {
  return (
    <div
      style={{
        margin: "12px 18px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 13px",
        background: "color-mix(in oklab, var(--st-failed) 9%, var(--bg-1))",
        border: "1px solid color-mix(in oklab, var(--st-failed) 30%, transparent)",
        borderRadius: 10,
        fontSize: 12.5,
        color: "var(--text-1)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--st-failed)",
          flex: "none",
        }}
      />
      {message}
    </div>
  );
}
