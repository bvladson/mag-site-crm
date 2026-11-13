import { createFileRoute } from "@tanstack/react-router";

/**
 * Coleta das violações da CSP em modo Report-Only (cabeçalho no Nginx). Só registra no log do container:
 * `docker logs mag-site-web-1 2>&1 | grep "\[csp\]"` (resumo diário: /opt/mag-site/bin/csp-resumo.sh).
 * Sem banco, sem IP no log, resposta vazia. Aceita os dois formatos dos navegadores: report-uri (application/csp-report)
 * e Reporting API (application/reports+json). Limites: corpo de 16 KB lido em fluxo, 10 relatórios por requisição,
 * 20 linhas/min por IP e 60/min no total; caracteres de controle, de formatação (bidi, largura zero) e separadores
 * de linha viram "?" antes de ir para o log (auditoria de 05/10/2026).
 */
const MAX_BYTES = 16 * 1024;
const MAX_PER_MINUTE = 60;
const MAX_PER_IP = 20;
const TYPES = ["application/csp-report", "application/reports+json", "application/json"];
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
let minute = 0;
let logged = 0;
const perIp = new Map<string, number>();

const short = (value: unknown, max = 200) =>
  typeof value === "string" ? value.replace(UNSAFE, "?").slice(0, max) : typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Lê no máximo MAX_BYTES, com ou sem Content-Length; acima disso desiste sem acumular o resto. */
async function readCapped(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const empty = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store", ...(status === 405 ? { Allow: "POST" } : {}) } });
const notAllowed = () => empty(405);

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: {
      GET: notAllowed, HEAD: notAllowed, PUT: notAllowed, PATCH: notAllowed, DELETE: notAllowed, OPTIONS: notAllowed,
      POST: async ({ request }) => {
        const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (!TYPES.includes(type)) return empty(415);
        const now = Math.floor(Date.now() / 60000);
        if (now !== minute) { minute = now; logged = 0; perIp.clear(); }
        // Só o Nginx define X-Real-IP (sobrescreve o do cliente); fora dele todos dividem o mesmo limite.
        const ip = process.env["SITE_TRUST_PROXY"] === "true" ? (request.headers.get("x-real-ip") ?? "?").slice(0, 45) : "local";
        if (logged >= MAX_PER_MINUTE || (perIp.get(ip) ?? 0) >= MAX_PER_IP) return empty();
        const body = await readCapped(request).catch(() => null);
        if (!body) return empty();
        let data: unknown;
        try { data = JSON.parse(body); } catch { return empty(); }
        const reports: unknown[] = Array.isArray(data)
          ? data.map((item) => (item && typeof item === "object" ? (item as { body?: unknown }).body : undefined))
          : [data && typeof data === "object" ? (data as { "csp-report"?: unknown })["csp-report"] : undefined];
        for (const report of reports.slice(0, 10)) {
          if (!report || typeof report !== "object" || logged >= MAX_PER_MINUTE || (perIp.get(ip) ?? 0) >= MAX_PER_IP) continue;
          if (perIp.size >= 5000 && !perIp.has(ip)) break; // memória limitada mesmo sob muitos IPs
          logged += 1;
          perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
          const r = report as Record<string, unknown>;
          console.warn("[csp]", JSON.stringify({
            pagina: short(r["document-uri"] ?? r["documentURL"]),
            diretiva: short(r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"], 60),
            bloqueado: short(r["blocked-uri"] ?? r["blockedURL"]),
            arquivo: short(r["source-file"] ?? r["sourceFile"]),
            linha: short(r["line-number"] ?? r["lineNumber"]),
            amostra: short(r["script-sample"] ?? r["sample"], 80),
            modo: short(r["disposition"], 10),
          }));
        }
        return empty();
      },
    },
  },
});
