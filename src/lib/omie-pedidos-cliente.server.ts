/**
 * Cliente do serviço interno omie-pedidos (http://omie-pedidos:3200, token OMIE_PEDIDOS_TOKEN). O site nunca tem as
 * chaves do Omie. Sem imports: também roda no script do cron (node scripts/omie-referencias.mjs dentro do container).
 */
export type RespostaOmie = { ok: boolean; motivo?: string; mensagem?: string; simulado?: boolean; existente?: boolean; erros?: string[]; [chave: string]: unknown };

/** POST /pedidos e POST /clientes são escritas: se a conexão cair, o serviço pode já ter falado com o Omie → "incerto". */
const ESCRITAS = new Set(["/pedidos", "/clientes"]);

export async function servicoOmie(caminho: string, corpo?: unknown, timeoutMs = corpo === undefined ? 60_000 : 120_000): Promise<RespostaOmie> {
  const base = process.env["OMIE_PEDIDOS_URL"];
  const token = process.env["OMIE_PEDIDOS_TOKEN"];
  if (!base || !token) return { ok: false, motivo: "nao_configurado" };
  const escrita = corpo !== undefined && ESCRITAS.has(caminho);
  for (let tentativa = 1; ; tentativa++) {
    try {
      const resposta = await fetch(`${base.replace(/\/$/, "")}${caminho}`, {
        method: corpo === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await resposta.json().catch(() => null)) as RespostaOmie | null;
      if (!json || typeof json !== "object") return { ok: false, motivo: escrita ? "incerto" : "indisponivel" };
      return resposta.status === 200 ? json : { ok: false, motivo: String(json.motivo ?? `http_${resposta.status}`) };
    } catch (erro) {
      // Leitura: mais uma tentativa se a conexão caiu (não em tempo esgotado). Escrita: nunca repete às cegas.
      if (!escrita && tentativa === 1 && (erro as Error | null)?.name !== "TimeoutError") continue;
      return { ok: false, motivo: escrita ? "incerto" : "indisponivel" };
    }
  }
}

/** Mensagens para o usuário (o motivo técnico fica na auditoria). */
export const MENSAGEM_OMIE: Record<string, string> = {
  nao_configurado: "A integração com o Omie não está configurada neste servidor.",
  indisponivel: "O Omie não respondeu. Tente de novo em instantes.",
  incerto: "O Omie não confirmou a tempo. O pedido PODE ter sido criado: o sistema consulta o Omie antes de qualquer nova tentativa.",
  bloqueado: "O Omie pediu uma pausa nas consultas. Tente de novo mais tarde.",
  pausado: "A integração está em pausa por alguns minutos (proteção do Omie).",
  limite: "O Omie pediu para aguardar. Tente de novo em alguns minutos.",
  teto_horario: "Limite de chamadas ao Omie por hora atingido. Tente mais tarde.",
  credenciais: "O Omie recusou as chaves de acesso. Avise o administrador.",
  omie_recusou: "O Omie recusou a operação.",
  pedido_invalido: "O pedido tem dados inválidos.",
  cliente_invalido: "Os dados do cliente estão incompletos.",
  escrita_desligada: "Simulação: a escrita no Omie está desligada (OMIE_ORDER_WRITE_ENABLED=false). Nada foi enviado.",
  repetir_em: "O Omie só aceita repetir a mesma consulta depois de 1 minuto. Aguarde um pouco e tente de novo.",
  conflito_integracao: "Já existe no Omie um pedido com o número deste orçamento que NÃO corresponde a ele (outro cliente ou outros itens). Nada foi enviado nem vinculado. Avise o administrador.",
};
export const mensagemOmie = (motivo: string | undefined) => MENSAGEM_OMIE[motivo ?? ""] ?? "Não foi possível falar com o Omie agora.";
