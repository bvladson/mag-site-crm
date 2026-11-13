/**
 * Conteúdo institucional de Carreiras. Só o que já existe no site: os valores da página Sobre e as áreas do formulário
 * do banco de talentos. Nada de benefício trabalhista aqui — benefícios só entram quando o DHO os cadastrar na vaga.
 */
export const careerPillars = [
  { t: "Acolher", d: "Ouvir com atenção quem chega até a MAG." },
  { t: "Orientar", d: "Ajudar a escolher o que faz sentido para cada espaço." },
  { t: "Resolver", d: "Entregar, montar e acompanhar até o fim." },
  { t: "Evoluir", d: "Aprender todos os dias, como time e como empresa." },
] as const;

/** Áreas em que a MAG contrata (as mesmas do formulário). Ajustar aqui quando o DHO pedir. */
export const careerAreas = ["Comercial", "Operações / Montagem", "Logística", "Marketing", "Administrativo / Financeiro", "Atendimento"] as const;

export const WORK_MODELS = ["presencial", "híbrido", "remoto"] as const;
export type WorkModel = (typeof WORK_MODELS)[number];
export const workModelLabel: Record<WorkModel, string> = { presencial: "Presencial", "híbrido": "Híbrido", remoto: "Remoto" };

/** "Fortaleza – CE · Presencial · CLT" (só o que foi cadastrado). */
export const jobFacts = (j: Pick<PublicJob, "location" | "workModel" | "contractType">) =>
  [j.location, j.workModel ? workModelLabel[j.workModel] : null, j.contractType].filter(Boolean).join(" · ");

/** Data em dia de Fortaleza ("12/10/2026"), igual no servidor e no navegador. */
export const jobDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });

/** Tipo de contratação → employmentType do Schema.org (só os casos inequívocos; senão fica de fora). */
export function employmentType(contract: string | null) {
  if (!contract) return undefined;
  if (/est[aá]gi|aprendiz/i.test(contract)) return "INTERN";
  if (/tempor/i.test(contract)) return "TEMPORARY";
  if (/meio per[ií]odo|parcial/i.test(contract)) return "PART_TIME";
  if (/\bpj\b|prestador|aut[oô]nom/i.test(contract)) return "CONTRACTOR";
  if (/clt|efetiv|integral/i.test(contract)) return "FULL_TIME";
  return undefined;
}

/** Vaga como o site público recebe (sem id interno, sem datas de controle). */
export type PublicJob = {
  slug: string; title: string; area: string | null; location: string | null; workModel: WorkModel | null;
  contractType: string | null; schedule: string | null; summary: string | null; description: string | null;
  responsibilities: string[]; requirements: string[]; differentials: string[];
  openedAt: string | null; closesAt: string | null; open: boolean;
};
