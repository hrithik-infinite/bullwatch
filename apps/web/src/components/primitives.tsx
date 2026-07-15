import type { CSSProperties, ReactNode } from "react";

export function Dot({
  color,
  size = 6,
  glow = false,
}: { color: string; size?: number; glow?: boolean }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flex: "none",
        boxShadow: glow ? `0 0 0 3px color-mix(in oklab, ${color} 22%, transparent)` : undefined,
      }}
    />
  );
}

/** A thin proportional bar (fail-rate meters, volume bars). */
export function Meter({ pct, color, width = 44 }: { pct: number; color: string; width?: number }) {
  return (
    <div
      style={{
        width,
        height: 5,
        borderRadius: 3,
        background: "var(--bg-3)",
        overflow: "hidden",
        flex: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: color,
          borderRadius: 3,
        }}
      />
    </div>
  );
}

/** SVG sparkline from a numeric series. */
export function Sparkline({
  values,
  width = 62,
  height = 20,
  color = "var(--accent)",
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block", flex: "none" }}>
      {fill && <path d={area} fill={color} opacity={0.12} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Pill({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      style={{
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: ".03em",
        color,
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        padding: "1px 5px",
        borderRadius: 4,
      }}
    >
      {children}
    </span>
  );
}

export function mono(style?: CSSProperties): CSSProperties {
  return { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", ...style };
}
