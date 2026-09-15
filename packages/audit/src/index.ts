export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface AuditEvent {
  actor: string;
  action: string;
  target: string;
  tenant: string;
  timestamp: Date;
  metadata: JsonObject;
  requestId: string | null;
  result: string;
}

/** An append-only destination for immutable audit events. */
export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
}

export function serializeAuditMetadata(metadata: JsonObject): string {
  return JSON.stringify(copyJsonValue(metadata, new Set(), "$"));
}

export function parseAuditMetadata(value: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError("Audit metadata must be valid JSON", { cause: error });
  }

  const metadata = copyJsonValue(parsed, new Set(), "$metadata");
  if (!isJsonObject(metadata)) {
    throw new TypeError("Audit metadata must be a JSON object");
  }
  return metadata;
}

function copyJsonValue(
  value: unknown,
  ancestors: Set<object>,
  path: string,
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError(
      `Audit metadata at ${path} must contain a finite number`,
    );
  }
  if (typeof value !== "object") {
    throw new TypeError(`Audit metadata at ${path} is not JSON-compatible`);
  }
  if (ancestors.has(value))
    throw new TypeError(`Audit metadata at ${path} contains a cycle`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        copyJsonValue(item, ancestors, `${path}[${index}]`),
      );
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Audit metadata at ${path} must be a plain object`);
    }

    const copy: JsonObject = Object.create(null) as JsonObject;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TypeError(
          `Audit metadata at ${path} cannot contain symbol keys`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      if (!("value" in descriptor)) {
        throw new TypeError(
          `Audit metadata at ${path}.${key} cannot contain accessors`,
        );
      }
      copy[key] = copyJsonValue(descriptor.value, ancestors, `${path}.${key}`);
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
