/** Textos compartilhados do painel "Saúde do sistema" (tela e servidor). */

/** Estados de uma linha de WhatsApp (WAHA) em português; o código técnico continua visível entre parênteses. */
const ESTADO_LINHA: Record<string, string> = {
  WORKING: "conectada",
  SCAN_QR_CODE: "aguardando leitura do QR",
  STARTING: "iniciando",
  STOPPED: "parada",
  FAILED: "desconectada",
};
export function estadoDaLinha(estado: string, erro?: string | null) {
  if (erro === "number_mismatch") return "conectada a outro número";
  if (estado === "sem estado") return "nunca conectada";
  return ESTADO_LINHA[estado] ? `${ESTADO_LINHA[estado]}${estado === "WORKING" ? "" : ` (${estado})`}` : estado;
}

/** "(24 h)" sem quebrar entre o número e a unidade. */
export const EM_24H = `(24${String.fromCharCode(160)}h)`;
