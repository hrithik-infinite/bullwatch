// Icons ported from the design brief (bullwatch.dc.html). currentColor-driven.
import type { ReactNode } from "react";

const S = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ flex: "none" }}>
    {children}
  </svg>
);

const st = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } as const;

export const Icons = {
  overview: () =>
    S(
      <>
        <rect x="2" y="2" width="5.2" height="5.2" rx="1.4" style={st} />
        <rect x="8.8" y="2" width="5.2" height="5.2" rx="1.4" style={st} />
        <rect x="2" y="8.8" width="5.2" height="5.2" rx="1.4" style={st} />
        <rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.4" style={st} />
      </>,
    ),
  workers: () =>
    S(
      <>
        <rect x="2" y="2.6" width="12" height="4.6" rx="1.3" style={st} />
        <rect x="2" y="8.8" width="12" height="4.6" rx="1.3" style={st} />
        <circle cx="4.6" cy="4.9" r="0.9" style={{ fill: "currentColor" }} />
        <circle cx="4.6" cy="11.1" r="0.9" style={{ fill: "currentColor" }} />
      </>,
    ),
  flows: () =>
    S(
      <>
        <circle cx="4" cy="8" r="2" style={st} />
        <circle cx="12" cy="4" r="2" style={st} />
        <circle cx="12" cy="12" r="2" style={st} />
        <path d="M5.8 7 L10.2 4.6 M5.8 9 L10.2 11.4" style={{ ...st, strokeWidth: 1.4 }} />
      </>,
    ),
  search: (size?: number) =>
    S(
      <>
        <circle cx="7" cy="7" r="4.2" style={st} />
        <path d="M10.4 10.4 L14 14" style={{ ...st, strokeLinecap: "round" }} />
      </>,
      size,
    ),
  metrics: () =>
    S(
      <>
        <path
          d="M2.5 2 L2.5 13.5 L14 13.5"
          style={{ ...st, strokeLinecap: "round", opacity: 0.55 }}
        />
        <polyline
          points="3.5,10.5 6.5,7.2 9,9.2 13.2,3.5"
          style={{
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.6,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }}
        />
      </>,
    ),
  dlq: (size?: number) =>
    S(
      <>
        <path d="M8 2.4 L14.2 13 L1.8 13 Z" style={{ ...st, strokeLinejoin: "round" }} />
        <path d="M8 6.4 L8 9.3" style={{ ...st, strokeLinecap: "round" }} />
        <circle cx="8" cy="11.2" r="0.95" style={{ fill: "currentColor" }} />
      </>,
      size,
    ),
  alerts: () =>
    S(
      <>
        <path
          d="M4.5 11 C4.5 7.2 5.4 4.6 8 4.6 C10.6 4.6 11.5 7.2 11.5 11 Z"
          style={{ ...st, strokeLinejoin: "round" }}
        />
        <path d="M3.2 11.4 L12.8 11.4" style={{ ...st, strokeLinecap: "round" }} />
        <path d="M6.8 13.1 a1.2 1.2 0 0 0 2.4 0" style={{ ...st, strokeWidth: 1.4 }} />
      </>,
    ),
  system: () =>
    S(
      <>
        <rect
          x="2"
          y="3"
          width="3.4"
          height="10"
          rx="1.2"
          style={{ fill: "var(--st-active)", opacity: 0.9 }}
        />
        <rect
          x="6.3"
          y="3"
          width="3.4"
          height="10"
          rx="1.2"
          style={{ fill: "var(--accent)", opacity: 0.9 }}
        />
        <rect
          x="10.6"
          y="3"
          width="3.4"
          height="10"
          rx="1.2"
          style={{ fill: "var(--st-completed)", opacity: 0.9 }}
        />
      </>,
    ),
  moon: () =>
    S(
      <path
        d="M13 9.4 A5.2 5.2 0 1 1 7.1 3 A4.1 4.1 0 0 0 13 9.4 Z"
        style={{ fill: "currentColor" }}
      />,
      15,
    ),
  sun: () =>
    S(
      <>
        <circle cx="8" cy="8" r="3.1" style={st} />
        <path
          d="M8 1.4V3 M8 13V14.6 M1.4 8H3 M13 8H14.6 M3.3 3.3l1.1 1.1 M11.6 11.6l1.1 1.1 M12.7 3.3l-1.1 1.1 M4.4 11.6l-1.1 1.1"
          style={{ ...st, strokeLinecap: "round" }}
        />
      </>,
      15,
    ),
};

export type IconName = keyof typeof Icons;
