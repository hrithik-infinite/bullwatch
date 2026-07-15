import { fmt } from "../lib/format.js";
import { type Route, navigate, useRoute } from "../lib/router.js";
import { Icons } from "./icons.js";
import { mono } from "./primitives.js";

interface NavItemProps {
  route: Route;
  current: boolean;
  icon: () => JSX.Element;
  label: string;
  trailing?: JSX.Element;
}

function NavItem({ route, current, icon, label, trailing }: NavItemProps) {
  return (
    <button
      type="button"
      data-bw-nav=""
      aria-current={current ? "page" : undefined}
      onClick={() => navigate(route)}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "7px 10px 7px 11px",
        border: 0,
        background: "transparent",
        font: "inherit",
        fontSize: 13,
        borderRadius: 7,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {current && (
        <span
          style={{
            position: "absolute",
            left: -2,
            top: "50%",
            transform: "translateY(-50%)",
            width: 3,
            height: 15,
            borderRadius: 3,
            background: "var(--accent)",
          }}
        />
      )}
      {icon()}
      <span style={{ flex: 1 }}>{label}</span>
      {trailing}
    </button>
  );
}

const groupLabel = (text: string, first = false) => (
  <div
    style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: ".07em",
      color: "var(--text-3)",
      padding: first ? "10px 8px 5px" : "12px 8px 5px",
    }}
  >
    {text}
  </div>
);

export interface SidebarProps {
  conn: string;
  connOk: boolean;
  jobsTotal: number | null;
  dlqTotal: number | null;
  workersLabel: string | null;
  alertsFiring: boolean;
}

export function Sidebar({
  conn,
  connOk,
  jobsTotal,
  dlqTotal,
  workersLabel,
  alertsFiring,
}: SidebarProps) {
  const route = useRoute();
  const is = (n: Route["name"]) => route.name === n;

  return (
    <aside
      style={{
        width: 236,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border)",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "15px 14px 12px" }}>
        <svg width="22" height="22" viewBox="0 0 22 22" style={{ flex: "none" }}>
          <circle
            cx="11"
            cy="11"
            r="9.3"
            style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 1.5, opacity: 0.85 }}
          />
          <circle
            cx="11"
            cy="11"
            r="5"
            style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 1.5, opacity: 0.5 }}
          />
          <circle cx="11" cy="11" r="2.1" style={{ fill: "var(--accent)" }} />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.06, flex: 1 }}>
          <span style={{ fontWeight: 660, letterSpacing: "-.01em", fontSize: 14.5 }}>
            bullwatch
          </span>
          <span style={{ fontSize: 10, color: "var(--text-2)", letterSpacing: ".02em" }}>
            queue observability
          </span>
        </div>
      </div>

      <button
        type="button"
        data-bw-ghost=""
        title="Connected Redis instance"
        style={{
          margin: "0 10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 9px",
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--text-1)",
          font: "inherit",
          fontSize: 11.5,
          cursor: "pointer",
          transition: ".1s",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: connOk ? "var(--st-completed)" : "var(--st-failed)",
            flex: "none",
            boxShadow: `0 0 0 3px color-mix(in oklab, ${connOk ? "var(--st-completed)" : "var(--st-failed)"} 22%, transparent)`,
          }}
        />
        <span
          style={mono({
            flex: 1,
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {conn}
        </span>
        <span style={{ color: "var(--text-3)" }}>▾</span>
      </button>

      <nav
        style={{
          flex: 1,
          overflow: "auto",
          padding: "2px 10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {groupLabel("MONITOR", true)}
        <NavItem
          route={{ name: "overview" }}
          current={is("overview") || is("queue")}
          icon={Icons.overview}
          label="Overview"
          trailing={
            <span style={mono({ fontSize: 11, color: "var(--text-3)" })}>
              {jobsTotal === null ? "" : fmt(jobsTotal)}
            </span>
          }
        />
        <NavItem
          route={{ name: "workers" }}
          current={is("workers")}
          icon={Icons.workers}
          label="Workers"
          trailing={
            workersLabel ? (
              <span style={mono({ fontSize: 11, color: "var(--st-delayed)" })}>{workersLabel}</span>
            ) : undefined
          }
        />
        <NavItem route={{ name: "flows" }} current={is("flows")} icon={Icons.flows} label="Flows" />

        {groupLabel("INVESTIGATE")}
        <NavItem
          route={{ name: "search" }}
          current={is("search")}
          icon={() => Icons.search()}
          label="Search"
        />
        <NavItem
          route={{ name: "metrics" }}
          current={is("metrics")}
          icon={Icons.metrics}
          label="Metrics"
        />
        <NavItem
          route={{ name: "dlq" }}
          current={is("dlq")}
          icon={() => Icons.dlq()}
          label="Dead-letter"
          trailing={
            dlqTotal ? (
              <span style={mono({ fontSize: 11, color: "var(--st-failed)" })}>{fmt(dlqTotal)}</span>
            ) : undefined
          }
        />

        {groupLabel("CONFIGURE")}
        <NavItem
          route={{ name: "alerts" }}
          current={is("alerts")}
          icon={Icons.alerts}
          label="Alerts"
          trailing={
            alertsFiring ? (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--st-delayed)",
                }}
              />
            ) : undefined
          }
        />
      </nav>

      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "8px 10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <NavItem
          route={{ name: "system" }}
          current={is("system")}
          icon={Icons.system}
          label="Design system"
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px 3px",
            color: "var(--text-3)",
            fontSize: 10.5,
          }}
        >
          <span style={mono()}>v0.9.2</span>
          <span style={{ flex: 1 }} />
          <span title="Payloads are read live and never written to disk">
            read live · never stored
          </span>
        </div>
      </div>
    </aside>
  );
}
