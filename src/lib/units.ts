import { z } from "zod";

export const UNIT_ACCENTS = ["red", "blue", "green", "amber"] as const;
const text = (max: number, min = 0) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !/[<>\u0000-\u001f\u007f]/.test(s), "Use somente texto");
const phone = text(30)
  .transform((s) => s.replace(/[\s()+.-]/g, ""))
  .refine((s) => !s || /^55\d{10,11}$/.test(s), "Informe 55, DDD e número");
const map = (kind: "google" | "waze") =>
  text(1500).refine((s) => {
    if (!s) return true;
    try {
      const u = new URL(s);
      if (u.protocol !== "https:" || u.username || u.password) return false;
      return kind === "waze"
        ? /^(www\.)?waze\.com$/.test(u.hostname)
        : ["maps.app.goo.gl", "maps.google.com", "maps.google.com.br"].includes(u.hostname) ||
            (/^(www\.)?google\.com(\.br)?$/.test(u.hostname) && u.pathname.startsWith("/maps")) ||
            (u.hostname === "goo.gl" && u.pathname.startsWith("/maps/"));
    } catch {
      return false;
    }
  }, "Use um link HTTPS do mapa correspondente");

export const unitSchema = z
  .object({
    id: z.string().uuid(),
    name: text(100, 2),
    address: text(320, 5),
    whatsapp: phone,
    phone,
    hours: text(120),
    mapUrl: map("google"),
    wazeUrl: map("waze"),
    accent: z.enum(UNIT_ACCENTS),
    active: z.boolean(),
    revision: z.number().int().min(0).safe(),
  })
  .strict();
export type Unit = z.infer<typeof unitSchema>;
export const unitMapUrl = (u: Pick<Unit, "mapUrl" | "address">) =>
  u.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(u.address)}`;
export const unitPhoneLabel = (s: string) => s.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
