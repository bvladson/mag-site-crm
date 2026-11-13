// Inventário de acesso do servidor (módulo 1 — segurança): toda função de servidor (createServerFn) e toda rota de
// API, com o perfil exigido. Gera docs/seguranca/INVENTARIO-ACESSO.md. Uso: node docs/seguranca/gerar-inventario.mjs
// Leitura: os arquivos *.functions.ts usam auxiliares locais (guard, user, actor...) que chamam authorize(perfis) de
// local-auth.server. authorize() sem perfis = qualquer perfil do painel (PANEL_ROLES). Sai com código 1 se alguma função
// ficar sem classificação (pública não justificada) — serve de portão no teste tests/seguranca-inventario.test.mjs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const lib = join(root, "src/lib");
const routes = join(root, "src/routes");
const PANEL = "qualquer perfil do painel";

/** Fim do trecho balanceado que começa em `open` (parênteses, chaves, colchetes; ignora textos entre aspas). */
function balancedEnd(text, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return text.length - 1;
}
/** Chamadas NOME(args) dentro de um trecho, com os argumentos completos. */
function calls(text, names) {
  const out = [];
  for (const m of text.matchAll(/\b(\w+)\s*\(/g)) {
    if (!names.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    out.push({ name: m[1], args: text.slice(open + 1, balancedEnd(text, open)).trim() });
  }
  return out;
}
const roleList = (text) =>
  text.split(",").map((s) => s.trim().replace(/["'\s]/g, "")).filter(Boolean).join(", ");

function analyze(source) {
  const constants = {};
  for (const m of source.matchAll(/const\s+([A-Z][A-Z_]*)\s*(?::[^=]+)?=\s*\[([^\]]*)\]/g)) constants[m[1]] = roleList(m[2]);
  // Funções do arquivo (declaradas ou em const), com parâmetros e corpo.
  const fns = {};
  for (const m of source.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*async\s*\(/g)) {
    const name = m[1] ?? m[2];
    const open = m.index + m[0].length - 1;
    const close = balancedEnd(source, open);
    const params = source.slice(open + 1, close).split(",").map((p) => p.trim().split(/[?:=\s]/)[0]).filter(Boolean);
    // Corpo em bloco { ... } ou, em arrow function, a expressão até o fim da linha.
    const arrow = /^\s*(?::[^=]*)?=>\s*/.exec(source.slice(close + 1, close + 200));
    if (arrow && source[close + 1 + arrow[0].length] !== "{") {
      const start = close + 1 + arrow[0].length;
      fns[name] = { params, body: source.slice(start, source.indexOf("\n", start)) };
      continue;
    }
    const bodyOpen = source.indexOf("{", close);
    fns[name] = { params, body: source.slice(bodyOpen, balancedEnd(source, bodyOpen) + 1) };
  }
  const resolveArgs = (args, params = []) => {
    if (!args) return PANEL;
    const spread = /^\[\s*\.\.\.(\w+)\s*\]$/.exec(args);
    if (spread && constants[spread[1]]) return constants[spread[1]];
    if (args.startsWith("[")) return roleList(args.slice(1, args.indexOf("]")));
    if (constants[args]) return constants[args];
    if (params.includes(args)) return "param";
    return `?${args}`;
  };
  // Auxiliares: o que cada um exige (fixo, ou "param" quando o perfil vem de quem chama). Ponto fixo p/ auxiliares em cadeia.
  const helpers = { authorize: "param" };
  for (let round = 0; round < 5; round++) {
    for (const [name, fn] of Object.entries(fns)) {
      if (helpers[name]) continue;
      const inner = calls(fn.body, new Set(Object.keys(helpers)));
      for (const call of inner) {
        const rule = helpers[call.name];
        const value = rule === "param" ? resolveArgs(call.args, fn.params) : rule;
        if (value) {
          helpers[name] = value;
          break;
        }
      }
    }
  }
  return { constants, helpers, resolveArgs };
}
/** Trecho de cada `export const X = createServerFn(...)...` até o fim da expressão encadeada. */
function serverFunctions(source) {
  const out = [];
  for (const m of source.matchAll(/export const (\w+)\s*=\s*createServerFn\s*\(/g)) {
    let i = m.index + m[0].length - 1;
    let depth = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        for (i++; i < source.length && source[i] !== quote; i++) if (source[i] === "\\") i++;
        continue;
      }
      if ("({[".includes(c)) depth++;
      else if (")}]".includes(c)) depth--;
      else if (depth === 0 && c === ";") break;
      else if (depth === 0 && c === "\n" && !/^\s*\./.test(source.slice(i + 1, i + 200))) break;
    }
    out.push({ name: m[1], text: source.slice(m.index, i) });
  }
  return out;
}

const rows = [];
for (const file of readdirSync(lib).filter((f) => f.endsWith(".functions.ts")).sort()) {
  const source = readFileSync(join(lib, file), "utf8");
  const { helpers, resolveArgs } = analyze(source);
  for (const fn of serverFunctions(source)) {
    const method = fn.text.match(/method:\s*["'](GET|POST)["']/)?.[1] ?? "GET (padrão, sem método declarado)";
    const found = new Set();
    for (const call of calls(fn.text, new Set(Object.keys(helpers)))) {
      const rule = helpers[call.name];
      found.add(rule === "param" ? resolveArgs(call.args) : rule);
    }
    rows.push({ file, name: fn.name, method, access: [...found].join(" | ") || "PÚBLICA (sem login)" });
  }
}

/** Funções públicas por desenho (sem login): motivo e proteção. Toda função pública nova precisa entrar aqui. */
const PUBLIC_REASONS = {
  "auth.functions.ts:login": "entrada no painel (limite de tentativas + bloqueio)",
  "auth.functions.ts:logout": "saída do painel",
  "auth.functions.ts:getCurrentUser": "lê só a própria sessão",
  "careers.functions.ts:listOpenJobs": "vagas abertas do site",
  "careers.functions.ts:getPublicJob": "vaga aberta do site",
  "leads.functions.ts:submitQuoteRequest": "formulário do site (anti-robô + limite)",
  "leads.functions.ts:submitContactRequest": "formulário do site (anti-robô + limite)",
  "leads.functions.ts:submitJobApplication": "candidatura do site (anti-robô + limite)",
  "links.functions.ts:getPublicLinkTree": "página pública de links",
  "site-content.functions.ts:getPublicSiteContent": "conteúdo publicado do site",
  "social.functions.ts:getSocialProfiles": "perfis oficiais do site (sem tokens)",
  "social.functions.ts:getSocialHome": "seleção pública de publicações para a home",
  "social.functions.ts:getSocialPage": "página pública /redes",
  "units.functions.ts:getPublicUnits": "endereços públicos das unidades",
  "invitations.functions.ts:getInvitationInfo": "convite por código de uso único (64 hex, expira em 72 h)",
  "invitations.functions.ts:acceptPanelInvitation": "aceitar convite: código de uso único + senha forte",
};
/**
 * Rotas de API: proteção conferida à mão, presa a um padrão que precisa existir no código. Se a rota mudar e o padrão
 * sumir, o inventário falha e a rota volta para revisão. Rota nova sem entrada aqui também falha.
 */
const ROUTES = {
  "api.crm.webhooks.$provider.ts": [/handleWahaWebhook[\s\S]*handleCrmWebhook/, "webhooks: WAHA com HMAC-SHA512; Evolution/Meta/Google com segredo ou token de verificação (comparação em tempo constante)"],
  "api.csp-report.ts": [/csp/i, "pública: relatório de CSP do navegador (só registra, limite de tamanho)"],
  "api.health.ts": [/health|ok/i, "pública: saúde, sem dados"],
  "api.internal.link-images.$file.ts": [/authorize\(\["admin"\]\)/, "sessão admin"],
  "api.internal.site-images.$file.ts": [/authorize\(\["admin"\]\)/, "sessão admin"],
  "api.interno.crm.anexos.$id.ts": [/crmHttpUser[\s\S]*readCrmMedia/, "sessão admin/comercial + carteira do contato (requireCrmContact); anexo em preparação só de quem enviou"],
  "api.interno.crm.anexos.ts": [/crmHttpUser[\s\S]*assertCrmUploadOrigin[\s\S]*stageCrmMedia/, "sessão admin/comercial + mesma origem + carteira do contato; limite 7 MB"],
  "api.interno.curriculo.$id.ts": [/role === "admin" \|\| role === "dho"[\s\S]*audit\(/, "sessão admin/dho + auditoria de cada download"],
  "api.interno.orcamentos-internos.$id.proposta.$versao.ts": [/perfil === "admin" \|\| perfil === "comercial"[\s\S]*consumeRateLimit[\s\S]*audit\(/, "sessão admin/comercial + orçamento da própria carteira + limite + auditoria"],
  "api.interno.produtos.$id.ts": [/exigirPerfil\(request, \["admin", "comercial"\]\)[\s\S]*mesmaOrigem/, "sessão admin/comercial; POST (consultar Omie agora) só da própria origem, somente leitura"],
  "api.interno.produtos.index.ts": [/exigirPerfil\(request, \["admin", "comercial"\]\)/, "sessão admin/comercial (consulta de produtos)"],
  "api.links.events.ts": [/recordLinkEvent/, "pública: eventos de clique da página de links (origem do site + limite de tamanho)"],
};
const routeRows = [];
for (const file of readdirSync(routes).filter((f) => f.startsWith("api.")).sort()) {
  const source = readFileSync(join(routes, file), "utf8");
  const methods = [...new Set([...source.matchAll(/\b(GET|POST|PUT|DELETE|HEAD|PATCH)\s*:/g)].map((m) => m[1]))];
  const known = ROUTES[file];
  routeRows.push({ file, methods: methods.join(", "), checks: known && known[0].test(source) ? known[1] : "VERIFICAR" });
}
const staleReasons = Object.keys(PUBLIC_REASONS).filter((key) => !rows.some((r) => `${r.file}:${r.name}` === key));
const publicFns = rows.filter((r) => r.access.startsWith("PÚBLICA"));
const unresolved = rows.filter((r) => r.access.includes("?"));
const unjustified = publicFns.filter((r) => !PUBLIC_REASONS[`${r.file}:${r.name}`]);
const byAccess = {};
for (const r of rows) byAccess[r.access] = (byAccess[r.access] ?? 0) + 1;
const lines = [
  "# Inventário de acesso do servidor",
  "",
  "Gerado por `node docs/seguranca/gerar-inventario.mjs` a partir do código. Não editar à mão: rode o gerador.",
  "O teste `tests/seguranca-inventario.test.mjs` falha se surgir função pública sem justificativa ou perfil não resolvido.",
  "",
  `- Funções de servidor: **${rows.length}**; públicas por desenho: **${publicFns.length}**; rotas de API: **${routeRows.length}**.`,
  "- O perfil é conferido no servidor (`authorize`). A carteira (dono do registro) é conferida dentro de cada módulo e",
  "  provada nos testes `tests/seguranca-*.test.mjs` (ver `ISOLAMENTO-CARTEIRAS.md`).",
  "",
  "## Resumo por perfil exigido",
  "",
  "| Perfil exigido | Funções |",
  "| --- | --- |",
  ...Object.entries(byAccess).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Funções públicas (sem login) — por desenho",
  "",
  "| Arquivo | Função | Método | Motivo e proteção |",
  "| --- | --- | --- | --- |",
  ...publicFns.map((r) => `| ${r.file} | ${r.name} | ${r.method} | ${PUBLIC_REASONS[`${r.file}:${r.name}`] ?? "**SEM JUSTIFICATIVA**"} |`),
  "",
  "## Rotas de API",
  "",
  "| Arquivo | Métodos | Proteção |",
  "| --- | --- | --- |",
  ...routeRows.map((r) => `| ${r.file} | ${r.methods} | ${r.checks} |`),
  "",
  "## Todas as funções de servidor",
  "",
  "| Arquivo | Função | Método | Perfil exigido |",
  "| --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.file} | ${r.name} | ${r.method} | ${r.access} |`),
  "",
];
const target = join(root, "docs/seguranca/INVENTARIO-ACESSO.md");
const content = lines.join("\n");
let stale = false;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {}
  stale = current.replace(/\r\n/g, "\n") !== content;
  if (stale) console.log("INVENTÁRIO DESATUALIZADO: rode `node docs/seguranca/gerar-inventario.mjs` e confira a diferença.");
} else writeFileSync(target, content);
console.log(`funções: ${rows.length} | públicas: ${publicFns.length} | rotas: ${routeRows.length}`);
for (const r of unjustified) console.log("PÚBLICA SEM JUSTIFICATIVA:", r.file, r.name);
for (const r of unresolved) console.log("PERFIL NÃO RESOLVIDO:", r.file, r.name, r.access);
for (const r of routeRows.filter((x) => x.checks === "VERIFICAR")) console.log("ROTA SEM PROTEÇÃO RECONHECIDA:", r.file);
for (const key of staleReasons) console.log("JUSTIFICATIVA SEM FUNÇÃO (remover):", key);
if (stale || unjustified.length || unresolved.length || staleReasons.length || routeRows.some((x) => x.checks === "VERIFICAR"))
  process.exitCode = 1;
