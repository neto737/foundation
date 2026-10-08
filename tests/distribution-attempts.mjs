import assert from "node:assert/strict";

export function distributionAttempts(value) {
  if (value === undefined) return [1, 2];
  assert(value === "1" || value === "2", "DISTRIBUTION_ATTEMPT must be 1 or 2");
  return [Number(value)];
}
