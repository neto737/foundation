import {
  readObject,
  readString,
  requireUuid,
  RequestError,
} from "./contracts.js";
import {
  isCivilDate,
  memberTextLimits,
  type MemberInput,
  type MemberStatus,
  type MemberEditInput,
} from "./member-types.js";

function invalid(): never {
  throw new RequestError(
    400,
    "ENTRADA_INVALIDA",
    "Confira os campos do membro e os filtros informados.",
  );
}
function optionalText(
  input: Record<string, unknown>,
  key: string,
  max: number,
): string | null {
  if (input[key] === undefined || input[key] === null || input[key] === "")
    return null;
  if (typeof input[key] !== "string") invalid();
  return readString(input, key, 0, max) || null;
}
export async function readMember(
  request: Request,
): Promise<Required<MemberInput>> {
  const input = await readObject(request, [
    "churchId",
    "name",
    "status",
    "birthDate",
    "phone",
    "email",
    "joinedOn",
    "address",
    "baptismDate",
    "churchRole",
  ]);
  const status = input.status;
  if (status !== "Ativo" && status !== "Inativo") invalid();
  return {
    churchId: requireUuid(readString(input, "churchId", 36, 36)),
    status,
    ...readProfile(input),
  };
}
function readProfile(input: Record<string, unknown>) {
  const date = (key: string) => {
    const value = optionalText(input, key, 10);
    if (value && !isCivilDate(value)) invalid();
    return value;
  };
  const email = optionalText(input, "email", memberTextLimits.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid();
  return {
    name: readString(input, "name", 1, memberTextLimits.name),
    birthDate: date("birthDate"),
    joinedOn: date("joinedOn"),
    baptismDate: date("baptismDate"),
    phone: optionalText(input, "phone", memberTextLimits.phone),
    email,
    address: optionalText(input, "address", memberTextLimits.address),
    churchRole: optionalText(input, "churchRole", memberTextLimits.churchRole),
  };
}
export async function readMemberEdit(
  request: Request,
): Promise<MemberEditInput> {
  const input = await readObject(request, [
    "version",
    "name",
    "birthDate",
    "phone",
    "email",
    "joinedOn",
    "address",
    "baptismDate",
    "churchRole",
  ]);
  if (
    !Number.isSafeInteger(input.version) ||
    Number(input.version) < 1 ||
    Number(input.version) >= 2147483647
  )
    invalid();
  return { ...readProfile(input), version: Number(input.version) };
}

export function readMemberFilters(url: URL): {
  name: string;
  churchId: string | null;
  status: MemberStatus | null;
  page: number;
  pageSize: number;
} {
  const params = url.searchParams;
  for (const key of params.keys()) {
    if (
      !["name", "churchId", "status", "page", "pageSize"].includes(key) ||
      params.getAll(key).length !== 1
    )
      invalid();
  }
  const integer = (key: string, fallback: number, max: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > max
    )
      invalid();
    return Number(value);
  };
  const name = (params.get("name") ?? "").trim();
  if (name.length > memberTextLimits.name || name.includes("\0")) invalid();
  const churchId = params.get("churchId");
  const status = params.get("status");
  if (status !== null && status !== "Ativo" && status !== "Inativo") invalid();
  return {
    name,
    churchId: churchId === null ? null : requireUuid(churchId),
    status,
    page: integer("page", 1, 10000),
    pageSize: integer("pageSize", 20, 100),
  };
}
export function readMemberRequestKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key))
    throw new RequestError(
      400,
      "CHAVE_NECESSARIA",
      "Envie uma chave de idempotência de 16 a 128 caracteres.",
    );
  return key;
}
