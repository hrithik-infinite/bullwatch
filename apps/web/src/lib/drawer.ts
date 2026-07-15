import { useSyncExternalStore } from "react";

export interface DrawerTarget {
  queue: string;
  id: string;
}

let current: DrawerTarget | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const drawer = {
  open(queue: string, id: string) {
    current = { queue, id };
    emit();
  },
  close() {
    current = null;
    emit();
  },
};

// Navigating (hash change) always dismisses an open job drawer.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    if (current) drawer.close();
  });
}

export function useDrawer(): DrawerTarget | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}

// Toast — small transient confirmation, shown by the drawer/actions.
let toastMsg: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toastListeners = new Set<() => void>();

export const toast = {
  show(msg: string) {
    toastMsg = msg;
    for (const l of toastListeners) l();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMsg = null;
      for (const l of toastListeners) l();
    }, 2600);
  },
};

export function useToast(): string | null {
  return useSyncExternalStore(
    (cb) => {
      toastListeners.add(cb);
      return () => toastListeners.delete(cb);
    },
    () => toastMsg,
    () => null,
  );
}
