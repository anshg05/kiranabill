// KB-350: tells the billing screen - per shop database (by name) - that a sync pull moved what its catalog is built from
// (shop products, shop settings, learning). The screen reloads its catalog; lines already on the bill keep their price.

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeCatalogPulled(dbName: string, listener: Listener): () => void {
  const set = listeners.get(dbName) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(dbName, set);
  return () => {
    set.delete(listener);
  };
}

export function noteCatalogPulled(dbName: string): void {
  listeners.get(dbName)?.forEach((l) => l());
}
