import { ROTULO_ESTADO, type Estado } from "@/lib/orcamento-regras";

/** Peças comuns das telas do orçamento interno. */
const TOM: Record<Estado, string> = {
  rascunho: "bg-accent text-foreground", salvo: "bg-muted text-foreground", enviado: "bg-brand text-primary-foreground",
  aceito: "bg-success text-primary-foreground", enviado_omie: "bg-success-soft text-success", erro_omie: "bg-destructive text-primary-foreground",
  cancelado: "bg-muted text-muted-foreground",
};
export function SeloEstado({ estado }: { estado: Estado }) {
  return <span className={`inline-block whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold ${TOM[estado] ?? "bg-accent"}`}>{ROTULO_ESTADO[estado] ?? estado}</span>;
}
/** Mensagem de erro do servidor para a tela (sem o prefixo técnico de permissão). */
export const mensagemErro = (e: unknown) => (e instanceof Error ? e.message.replace(/^(Forbidden|Unauthorized): /, "") : "Não foi possível concluir");
