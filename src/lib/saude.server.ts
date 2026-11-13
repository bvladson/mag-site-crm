/**
 * Saúde do sistema (módulo 1 — estabilidade): um painel só do administrador, somente leitura.
 *
 * - Do banco do próprio site: linhas e fila do WhatsApp, eventos com erro, integrações, Omie e tentativas de login.
 * - Do servidor: arquivo `saude-host.json` na pasta de dados, gravado a cada 5 min por deploy/bin/saude-host.py
 *   (disco, memória, contêineres, backups e o vigia do WhatsApp). Sem o arquivo, o painel avisa e segue.
 *
 * Nada aqui guarda ou mostra segredo, conteúdo de mensagem ou telefone completo (só os 4 últimos dígitos).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dataDirectory, getDb } from "./local-db.server.ts";
import { requireActiveUser, type SiteUser } from "./local-auth-core.server.ts";
import { estadoDaLinha } from "./saude.ts";

export type Nivel = "ok" | "atencao" | "critico";
export interface Problema { nivel: Exclude<Nivel, "ok">; area: string; texto: string }
type Row = Record<string, unknown>;

const MIN = 60_000;
const HORA = 60 * MIN;
const hasTable = (name: string) =>
  Boolean(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const num = (sql: string, ...params: (string | number)[]) =>
  Number((getDb().prepare(sql).get(...params) as Row | undefined)?.["n"] ?? 0);
const final4 = (phone: unknown) => String(phone ?? "").replace(/\D/g, "").slice(-4);
const iso = (ms: number) => new Date(ms).toISOString();
const mtime = (path: string) => (existsSync(path) ? statSync(path).mtimeMs : null);
const minutesSince = (value: string | number | null | undefined, now: number) => {
  const ms = typeof value === "number" ? value : value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? Math.max(0, Math.round((now - ms) / MIN)) : null;
};

/** Contêineres essenciais: parado ou sem saúde = crítico. Os demais (sincronizações) = atenção. */
const ESSENCIAIS = [/^mag-site-web/, /^mag-waha/];
const LIMITES = {
  servidorAtrasadoMin: 15,
  discoAtencao: 85,
  discoCritico: 95,
  memoriaAtencao: 90,
  backupHoras: 26,
  vigiaAtrasadoMin: 15,
  eventoParadoMin: 10,
  cadastroOmieHoras: 36,
  loginsRecusados24h: 20,
};

export interface SaudeServidor {
  geradoEm: string;
  disco?: { usoPct: number; livreGb: number };
  memoria?: { usoPct: number; disponivelMb: number };
  carga?: number[];
  cpus?: number;
  containers?: { nome: string; estado: string; saude: string | null }[];
  backups?: { projeto: string; ultimo: string | null; tamanhoMb: number | null; resultado: string | null; ok: boolean; falhaPendente: boolean }[];
  vigiaWhatsapp?: { ok: boolean | null; conferido: string | null; desde: string | null; motivo: string | null; silenciado: boolean; manutencao: boolean } | null;
}

function readHostFile(path: string): SaudeServidor | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as SaudeServidor & { versao?: number };
    return value && typeof value.geradoEm === "string" ? value : null;
  } catch {
    return null;
  }
}

function whatsapp(now: number) {
  if (!hasTable("crm_waha_lines")) return null;
  const db = getDb();
  const runtime = hasTable("crm_waha_runtime");
  const recovery = hasTable("crm_waha_recovery");
  const linhas = (db
    .prepare(
      `SELECT l.session,l.expected_phone,l.status,COALESCE(NULLIF(u.display_name,''),u.email) vendedora
       ${runtime ? ",r.state,r.updated_at,r.error_code" : ""} ${recovery ? ",v.state recovery_state,v.error_code recovery_error" : ""}
       FROM crm_waha_lines l LEFT JOIN users u ON u.id=l.user_id
       ${runtime ? "LEFT JOIN crm_waha_runtime r ON r.session=l.session" : ""}
       ${recovery ? "LEFT JOIN crm_waha_recovery v ON v.session=l.session" : ""}
       ORDER BY l.status, vendedora`,
    )
    .all() as Row[]).map((r) => ({
    vendedora: String(r["vendedora"] ?? "—"),
    final: final4(r["expected_phone"]),
    ativa: r["status"] === "active",
    estado: r["state"] ? String(r["state"]) : "sem estado",
    desde: r["updated_at"] ? String(r["updated_at"]) : null,
    erro: r["error_code"] ? String(r["error_code"]) : null,
    recuperacao: r["recovery_state"] ? String(r["recovery_state"]) : null,
    erroRecuperacao: r["recovery_error"] ? String(r["recovery_error"]) : null,
  }));
  const dia = iso(now - 24 * HORA);
  const fila = hasTable("crm_waha_outbox")
    ? {
        enviando: num("SELECT count(*) n FROM crm_waha_outbox WHERE state='sending'"),
        incertos: num("SELECT count(*) n FROM crm_waha_outbox WHERE state='uncertain'"),
        comErro24h: num("SELECT count(*) n FROM crm_waha_outbox WHERE error_code IS NOT NULL AND updated_at>=?", dia),
      }
    : { enviando: 0, incertos: 0, comErro24h: 0 };
  const eventos = hasTable("crm_waha_events")
    ? {
        pendentes: num("SELECT count(*) n FROM crm_waha_events WHERE state='pending'"),
        comErro: num("SELECT count(*) n FROM crm_waha_events WHERE state='error'"),
        maisAntigoPendenteMin: minutesSince(
          (db.prepare("SELECT min(created_at) m FROM crm_waha_events WHERE state='pending'").get() as Row | undefined)?.["m"] as string | null,
          now,
        ),
      }
    : { pendentes: 0, comErro: 0, maisAntigoPendenteMin: null };
  const ultimaMensagem = hasTable("crm_messages")
    ? ((db.prepare("SELECT max(sent_at) m FROM crm_messages WHERE provider='waha' AND sender='cliente'").get() as Row | undefined)?.["m"] as string | null) ?? null
    : null;
  return { linhas, fila, eventos, ultimaMensagemRecebida: ultimaMensagem };
}

function omie(now: number) {
  const dia = iso(now - 24 * HORA);
  const pedidos = hasTable("omie_orders")
    ? { comErro: num("SELECT count(*) n FROM omie_orders WHERE state='erro'"), incertos: num("SELECT count(*) n FROM omie_orders WHERE state IN ('incerto','enviando')") }
    : { comErro: 0, incertos: 0 };
  const referencias = hasTable("omie_refs")
    ? ((getDb().prepare("SELECT max(synced_at) m FROM omie_refs").get() as Row | undefined)?.["m"] as string | null) ?? null
    : null;
  const catalogo = resolve(process.env["OMIE_CATALOG_PATH"] || "./data/catalog.json");
  const interno = resolve(process.env["OMIE_INDICE_DIR"] || join(dirname(catalogo), "interno"));
  let cadastro: { geradoEm: string | null; estado: string | null; erro: string | null } = { geradoEm: null, estado: null, erro: null };
  const cadastroMtime = mtime(join(interno, "omie-produtos.json"));
  try {
    const status = JSON.parse(readFileSync(join(interno, "omie-produtos.status.json"), "utf8")) as Row;
    cadastro = { geradoEm: null, estado: status["estado"] ? String(status["estado"]) : null, erro: status["erro"] ? String(status["erro"]).slice(0, 200) : null };
  } catch {}
  cadastro.geradoEm = cadastroMtime ? iso(cadastroMtime) : null;
  const catalogoMtime = mtime(catalogo);
  return {
    pedidos,
    referenciasSincronizadasEm: referencias,
    cadastroCompleto: cadastro,
    catalogoPublicoEm: catalogoMtime ? iso(catalogoMtime) : null,
    consultasComErro24h: num("SELECT count(*) n FROM audit_log WHERE action LIKE 'omie:consulta:erro%' AND created_at>=?", dia),
  };
}

function seguranca(now: number) {
  const dia = iso(now - 24 * HORA);
  return {
    loginsRecusados24h: num("SELECT count(*) n FROM audit_log WHERE action='auth:login:failed' AND created_at>=?", dia),
    contasVisadas24h: num("SELECT count(DISTINCT target_id) n FROM audit_log WHERE action='auth:login:failed' AND target_id IS NOT NULL AND created_at>=?", dia),
    mfaInvalidos24h: num("SELECT count(*) n FROM audit_log WHERE action='mfa:invalid' AND created_at>=?", dia),
    mfaBloqueios24h: num("SELECT count(*) n FROM audit_log WHERE action='mfa:locked' AND created_at>=?", dia),
  };
}

function banco() {
  const file = join(dataDirectory(), "site.sqlite");
  const mb = (path: string) => (existsSync(path) ? Math.round((statSync(path).size / 1_048_576) * 10) / 10 : 0);
  return { tamanhoMb: mb(file), walMb: mb(`${file}-wal`) };
}

/** Problemas a partir dos números, do mais grave ao mais leve. Exportado para teste. */
export function avaliar(
  data: { servidor: SaudeServidor | null; whatsapp: ReturnType<typeof whatsapp>; omie: ReturnType<typeof omie>; seguranca: ReturnType<typeof seguranca> },
  now: number,
): Problema[] {
  const out: Problema[] = [];
  const add = (nivel: Problema["nivel"], area: string, texto: string) => out.push({ nivel, area, texto });
  const s = data.servidor;
  if (!s) add("atencao", "Servidor", "Sem dados do servidor: o verificador (saude-host) ainda não gravou o arquivo de saúde.");
  else {
    const atraso = minutesSince(s.geradoEm, now);
    if (atraso === null || atraso > LIMITES.servidorAtrasadoMin) add("atencao", "Servidor", `Dados do servidor atrasados (${atraso ?? "?"} min).`);
    if (s.disco) {
      if (s.disco.usoPct >= LIMITES.discoCritico) add("critico", "Servidor", `Disco com ${s.disco.usoPct}% de uso.`);
      else if (s.disco.usoPct >= LIMITES.discoAtencao) add("atencao", "Servidor", `Disco com ${s.disco.usoPct}% de uso.`);
    }
    if (s.memoria && s.memoria.usoPct >= LIMITES.memoriaAtencao) add("atencao", "Servidor", `Memória com ${s.memoria.usoPct}% de uso.`);
    for (const c of s.containers ?? []) {
      const parado = c.estado !== "running";
      const doente = c.saude === "unhealthy";
      if (!parado && !doente) continue;
      const essencial = ESSENCIAIS.some((re) => re.test(c.nome));
      add(essencial ? "critico" : "atencao", "Servidor", `${c.nome}: ${parado ? `parado (${c.estado})` : "sem saúde"}.`);
    }
    for (const b of s.backups ?? []) {
      const horas = b.ultimo ? (now - Date.parse(b.ultimo)) / HORA : Infinity;
      if (b.falhaPendente || !b.ok) add("critico", "Backup", `Backup de ${b.projeto} com falha${b.resultado ? `: ${b.resultado}` : ""}.`);
      else if (horas > LIMITES.backupHoras) add("critico", "Backup", `Último backup de ${b.projeto} há ${Number.isFinite(horas) ? Math.round(horas) : "?"} h.`);
    }
    const vigia = s.vigiaWhatsapp;
    if (vigia) {
      if (vigia.ok === false) add("critico", "WhatsApp", `Vigia do WhatsApp em falha${vigia.motivo ? `: ${vigia.motivo}` : ""}.`);
      const atrasoVigia = minutesSince(vigia.conferido, now);
      if (!vigia.manutencao && (atrasoVigia === null || atrasoVigia > LIMITES.vigiaAtrasadoMin))
        add("atencao", "WhatsApp", `Vigia do WhatsApp sem conferir há ${atrasoVigia ?? "?"} min.`);
    }
  }
  const w = data.whatsapp;
  if (w) {
    for (const l of w.linhas.filter((x) => x.ativa)) {
      if (l.erro === "number_mismatch") add("critico", "WhatsApp", `Linha de ${l.vendedora} (final ${l.final || "?"}) conectada a outro número.`);
      else if (l.estado === "FAILED") add("critico", "WhatsApp", `Linha de ${l.vendedora} (final ${l.final || "?"}) desconectada (FAILED).`);
      else if (l.estado !== "WORKING") add("atencao", "WhatsApp", `Linha de ${l.vendedora} (final ${l.final || "?"}): ${estadoDaLinha(l.estado)}.`);
      if (l.recuperacao === "error" || l.recuperacao === "partial") add("atencao", "WhatsApp", `Conferência de mensagens da linha de ${l.vendedora} ficou ${l.recuperacao === "error" ? "com erro" : "parcial"}.`);
    }
    if (w.fila.incertos) add("atencao", "WhatsApp", `${w.fila.incertos} envio(s) com resultado incerto: conferir no celular antes de reenviar.`);
    if (w.fila.comErro24h) add("atencao", "WhatsApp", `${w.fila.comErro24h} envio(s) com erro nas últimas 24 h.`);
    if (w.eventos.comErro) add("atencao", "WhatsApp", `${w.eventos.comErro} evento(s) recebido(s) com erro de processamento.`);
    if ((w.eventos.maisAntigoPendenteMin ?? 0) > LIMITES.eventoParadoMin) add("atencao", "WhatsApp", `Fila de recebimento parada há ${w.eventos.maisAntigoPendenteMin} min.`);
  }
  const o = data.omie;
  if (o.pedidos.comErro) add("atencao", "Omie", `${o.pedidos.comErro} pedido(s) com erro no Omie.`);
  if (o.pedidos.incertos) add("atencao", "Omie", `${o.pedidos.incertos} pedido(s) em envio ou incerto(s) no Omie: conferir antes de repetir.`);
  if (o.cadastroCompleto.estado === "erro") add("atencao", "Omie", `Cadastro completo do Omie com erro${o.cadastroCompleto.erro ? `: ${o.cadastroCompleto.erro}` : ""}.`);
  const idadeCadastro = o.cadastroCompleto.geradoEm ? (now - Date.parse(o.cadastroCompleto.geradoEm)) / HORA : null;
  if (idadeCadastro !== null && idadeCadastro > LIMITES.cadastroOmieHoras) add("atencao", "Omie", `Cadastro completo do Omie sem atualizar há ${Math.round(idadeCadastro)} h.`);
  const idadeCatalogo = o.catalogoPublicoEm ? (now - Date.parse(o.catalogoPublicoEm)) / HORA : null;
  if (idadeCatalogo !== null && idadeCatalogo > LIMITES.cadastroOmieHoras) add("atencao", "Omie", `Catálogo do site sem atualizar há ${Math.round(idadeCatalogo)} h.`);
  if (data.seguranca.loginsRecusados24h >= LIMITES.loginsRecusados24h)
    add("atencao", "Segurança", `${data.seguranca.loginsRecusados24h} logins recusados em 24 h (${data.seguranca.contasVisadas24h} conta(s) existente(s) visada(s)).`);
  if (data.seguranca.mfaBloqueios24h) add("atencao", "Segurança", `${data.seguranca.mfaBloqueios24h} bloqueio(s) de verificação em duas etapas em 24 h.`);
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "critico" ? -1 : 1));
}

export function readSystemHealth(actor: SiteUser | null, options: { now?: number; hostFile?: string } = {}) {
  requireActiveUser(actor, ["admin"]);
  const now = options.now ?? Date.now();
  const servidor = readHostFile(options.hostFile ?? join(dataDirectory(), "saude-host.json"));
  const data = { servidor, whatsapp: whatsapp(now), omie: omie(now), seguranca: seguranca(now) };
  const problemas = avaliar(data, now);
  const estado: Nivel = problemas.some((p) => p.nivel === "critico") ? "critico" : problemas.length ? "atencao" : "ok";
  return {
    geradoEm: iso(now),
    estado,
    problemas,
    ...data,
    banco: banco(),
    aplicacao: { iniciadaHaMin: Math.round(process.uptime() / 60), memoriaMb: Math.round(process.memoryUsage().rss / 1_048_576) },
    limites: LIMITES,
  };
}
export type SaudeDoSistema = ReturnType<typeof readSystemHealth>;
