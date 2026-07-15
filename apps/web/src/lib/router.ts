import { useSyncExternalStore } from "react";

export type Route =
  | { name: "overview" }
  | { name: "queue"; queue: string }
  | { name: "workers" }
  | { name: "flows" }
  | { name: "search" }
  | { name: "metrics" }
  | { name: "dlq" }
  | { name: "alerts" }
  | { name: "system" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\//, "");
  const [head, ...rest] = path.split("/");
  switch (head) {
    case "queue":
      return rest[0] ? { name: "queue", queue: decodeURIComponent(rest[0]) } : { name: "overview" };
    case "workers":
      return { name: "workers" };
    case "flows":
      return { name: "flows" };
    case "search":
      return { name: "search" };
    case "metrics":
      return { name: "metrics" };
    case "dlq":
      return { name: "dlq" };
    case "alerts":
      return { name: "alerts" };
    case "system":
      return { name: "system" };
    default:
      return { name: "overview" };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "overview":
      return "#/overview";
    case "queue":
      return `#/queue/${encodeURIComponent(route.queue)}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "#/overview",
  );
  return parseHash(hash);
}
