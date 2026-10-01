let identity: string | undefined;
let generation = 0;

export function currentSessionGeneration() {
  return generation;
}

export function invalidateSessionGeneration() {
  generation++;
}

export function setSessionIdentity(next: string | undefined) {
  if (next === identity) return;
  identity = next;
  invalidateSessionGeneration();
}
