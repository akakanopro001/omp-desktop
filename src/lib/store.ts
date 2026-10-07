import { useSyncExternalStore } from "react";

type Listener = () => void;

export interface Atom<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (listener: Listener) => () => void;
}

/**
 * Minimal atom store — the renderer's state ownership layer. The desktop shell
 * keeps its gateway-bound state in atoms and wipes them on a soft workspace
 * switch (profile / connection change) instead of cold-booting the window.
 */
export function atom<T>(initial: T): Atom<T> {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useAtomValue<T>(target: Atom<T>): T {
  return useSyncExternalStore(target.subscribe, target.get, target.get);
}

export type Updater<T> = (prev: T) => T;

export function mapAtom<T>(target: Atom<T>, updater: (value: T) => T) {
  target.set((prev) => updater(prev));
}

/** Immutably patch one item of an array atom by id. */
export function patchById<T extends { id: string }>(items: T[], id: string, patch: Partial<T> | ((item: T) => Partial<T>)): T[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const resolved = typeof patch === "function" ? patch(item) : patch;
    return { ...item, ...resolved };
  });
}
