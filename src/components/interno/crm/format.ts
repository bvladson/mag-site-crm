const TZ = "America/Fortaleza";
const dateKey = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});
const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const full = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
export const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dayKey = (value: string | Date) => dateKey.format(new Date(value));
export const fullDate = (value: string) => (value ? full.format(new Date(value)) : "—");
export const time = (value: string) => (value ? clock.format(new Date(value)) : "");
export const initials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function relative(value: string, now = new Date()) {
  if (!value) return "Sem interação";
  const diff = (now.getTime() - new Date(value).getTime()) / 60_000;
  if (diff >= 0 && diff < 60) return `há ${Math.max(1, Math.floor(diff))} min`;
  if (dayKey(value) === dayKey(now)) return `hoje ${time(value)}`;
  if (dayKey(value) === dayKey(new Date(now.getTime() - 86_400_000))) return `ontem ${time(value)}`;
  if (dayKey(value) === dayKey(new Date(now.getTime() + 86_400_000)))
    return `amanhã ${time(value)}`;
  return fullDate(value);
}
export function dueState(value: string): "atrasado" | "hoje" | "futuro" | "vazio" {
  if (!value) return "vazio";
  if (new Date(value).getTime() < Date.now()) return "atrasado";
  return dayKey(value) === dayKey(new Date()) ? "hoje" : "futuro";
}
export const isDueTodayOrLate = (value: string) =>
  Boolean(value) && dayKey(value) <= dayKey(new Date());
/** datetime-local is always displayed in the commercial timezone, independent of the computer. */
export function localDateTime(value: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
  return parts.replace(" ", "T");
}
export const toIsoDateTime = (value: string) => new Date(`${value}:00-03:00`).toISOString();
