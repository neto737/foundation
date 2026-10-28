// Mesmo contrato de identidade: caixa/espaços, sem equivaler aliases ou +tag.
export function administrativeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 &&
    /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)
    ? email
    : null;
}
