/**
 * Brazilian mobile numbers may be registered on WhatsApp without the extra 9
 * (55 + DDD + 8 digits) while people type them with it (55 + DDD + 9 + 8 digits).
 * Both spellings are the same line. Landlines (local part starting with 2-5) never gain a 9.
 */
export function brPhoneVariants(value: unknown): string[] {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(digits)) return [digits, digits.slice(0, 4) + digits.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(digits))
    return [digits, `${digits.slice(0, 4)}9${digits.slice(4)}`];
  return digits ? [digits] : [];
}

/** Stored form: a Brazilian mobile always carries the 9th digit; every other number is kept as is. */
export function normalizeBrPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^55\d{2}[6-9]\d{7}$/.test(digits) ? `${digits.slice(0, 4)}9${digits.slice(4)}` : digits;
}

/** True when both values are the same phone line, accepting the Brazilian 9th-digit spellings. */
export function samePhone(a: unknown, b: unknown): boolean {
  const left = brPhoneVariants(a);
  if (!left.length) return false;
  return brPhoneVariants(b).some((item) => left.includes(item));
}
