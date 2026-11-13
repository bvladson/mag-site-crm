import { z } from "zod";

export const INTERVIEW_STATUS = ["agendada", "realizada", "faltou", "cancelada"] as const;
export const interviewLocalTime = (iso: string) =>
  new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 16);
export function interviewInstant(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Informe data e hora válidas");
  const timestamp = Date.parse(`${local}:00-03:00`);
  if (
    !Number.isFinite(timestamp) ||
    interviewLocalTime(new Date(timestamp).toISOString()) !== local
  )
    throw new Error("Informe data e hora válidas");
  return new Date(timestamp).toISOString();
}
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (s) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),
      "Use somente texto",
    );
export const interviewInput = z
  .object({
    id: z.string().uuid().optional(),
    revision: z.number().int().min(0).safe(),
    applicationId: z.string().uuid(),
    interviewerId: z.string().uuid(),
    unitId: z.string().uuid().nullable(),
    online: z.boolean(),
    location: text(120),
    meetingUrl: text(1500).refine((s) => {
      if (!s) return true;
      try {
        const u = new URL(s);
        return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
      } catch {
        return false;
      }
    }, "Use um endereço HTTPS para a reunião"),
    startsAt: z.string().refine((s) => {
      try {
        interviewInstant(s);
        return true;
      } catch {
        return false;
      }
    }, "Informe data e hora válidas"),
    duration: z.number().int().min(15).max(240),
    status: z.enum(INTERVIEW_STATUS),
    rating: z.number().int().min(1).max(5).nullable(),
    notes: text(5000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.online && !v.unitId)
      ctx.addIssue({ code: "custom", path: ["unitId"], message: "Selecione a unidade" });
    if (v.online && v.unitId)
      ctx.addIssue({
        code: "custom",
        path: ["unitId"],
        message: "Reuniões online não usam unidade presencial",
      });
    if (v.rating !== null && v.status !== "realizada")
      ctx.addIssue({
        code: "custom",
        path: ["rating"],
        message: "Avalie somente entrevistas realizadas",
      });
  });
export type InterviewInput = z.infer<typeof interviewInput>;
export type Interview = {
  id: string;
  revision: number;
  applicationId: string;
  candidate: string;
  protocol: string;
  job: string;
  interviewerId: string;
  interviewer: string;
  unitId: string | null;
  unitName: string;
  online: boolean;
  location: string;
  meetingUrl: string;
  startsAt: string;
  duration: number;
  status: (typeof INTERVIEW_STATUS)[number];
  rating: number | null;
  notes: string;
};
