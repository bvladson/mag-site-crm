/**
 * Retenção de candidaturas (vaga e banco de talentos). O prazo é decisão da MAG, a ser fixado na Política de
 * Privacidade: enquanto RECRUITMENT_RETENTION_MONTHS não estiver definido, nenhuma data de expiração é calculada.
 * TALENT_BANK_RETENTION_MONTHS (opcional) vale para quem está no banco de talentos; sem ele, usa o mesmo prazo.
 * Este módulo só CALCULA — nada é apagado automaticamente (scripts/recruitment-retention.mjs é só relatório).
 * Sem imports: também roda no script de relatório, direto no Node, sem o bundler.
 */
export type RetentionPolicy = { jobMonths: number | null; bankMonths: number | null };
export type RecruitmentPurpose = "vaga" | "vaga+banco" | "banco";
type ApplicationDates = { created_at: string; job_slug?: unknown; talent_bank?: unknown };

export const purposeLabel: Record<RecruitmentPurpose, string> = {
  vaga: "Processo seletivo da vaga",
  "vaga+banco": "Processo seletivo da vaga + banco de talentos",
  banco: "Banco de talentos",
};

/** Meses válidos: inteiro de 1 a 120. Qualquer outro valor (vazio, texto, 0) = prazo não definido. */
function months(value: string | undefined) {
  const text = (value ?? "").trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 120 ? n : null;
}

export function retentionPolicy(env: Record<string, string | undefined> = process.env): RetentionPolicy {
  const jobMonths = months(env["RECRUITMENT_RETENTION_MONTHS"]);
  return { jobMonths, bankMonths: months(env["TALENT_BANK_RETENTION_MONTHS"]) ?? jobMonths };
}

/** Finalidade registrada na candidatura: só a vaga, a vaga e o banco (opção marcada) ou só o banco. */
export function purposeOf(app: { job_slug?: unknown; talent_bank?: unknown }): RecruitmentPurpose {
  if (!app.job_slug) return "banco";
  return app.talent_bank ? "vaga+banco" : "vaga";
}

/** Data da candidatura + prazo (quem está no banco de talentos usa o prazo do banco). null = política não definida. */
export function expiresAt(app: ApplicationDates, policy: RetentionPolicy): string | null {
  const purpose = purposeOf(app);
  const add = purpose === "vaga" ? policy.jobMonths : policy.bankMonths;
  const start = new Date(app.created_at);
  if (!add || !Number.isFinite(start.getTime())) return null;
  // Soma meses sem "transbordar" (31/01 + 1 mês = 28 ou 29/02, não 02/03).
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + add, 1,
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return target.toISOString();
}
