// /api/csp-report: recebe relatórios da CSP Report-Only, responde vazio e só registra linhas "[csp]" saneadas no log.
// Casos da auditoria de 05/10/2026. Pula se não houver build: rode `npm run build` antes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const server = join(root, ".output", "server", "index.mjs");
const ch = (...codes) => String.fromCharCode(...codes);
const RAW = [ch(10), ch(13), ch(27), ch(7), ch(0x85), ch(0x9b), ch(0x2028), ch(0x2029), ch(0x202e), ch(0x200b)];
const freePort = () => new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => done(port)); });
});

test("relatórios de CSP: só POST nos formatos dos navegadores, corpo limitado, log saneado e com teto por IP", { skip: !existsSync(server) && "sem build (.output): rode npm run build" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "mag-csp-"));
  await mkdir(join(dir, "data"));
  await writeFile(join(dir, "catalog.json"), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), products: [], redirects: {} }));
  const port = await freePort();
  let output = "";
  const child = spawn(process.execPath, [server], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production", SITE_TRUST_PROXY: "true", SITE_DATA_DIR: join(dir, "data"),
      OMIE_CATALOG_PATH: join(dir, "catalog.json"), OMIE_IMAGE_DIR: join(dir, "images") },
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const url = `http://127.0.0.1:${port}/api/csp-report`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await fetch(`http://127.0.0.1:${port}/api/health`); break; } catch { await new Promise((wait) => setTimeout(wait, 200)); }
    }
    const post = (body, type = "application/csp-report", ip = "198.51.100.1") =>
      fetch(url, { method: "POST", headers: { "content-type": type, "x-real-ip": ip }, body });
    const legacy = (tag, extra = {}) => JSON.stringify({ "csp-report": { "document-uri": `https://exemplo.test/${tag}`, "effective-directive": "img-src",
      "blocked-uri": "https://exemplo.test/x.png", disposition: "report", ...extra } });
    const lines = () => output.split("\n").filter((line) => line.includes("[csp]"));

    // formatos legítimos
    assert.equal((await post(legacy("legado"))).status, 204);
    assert.equal((await post(JSON.stringify([{ type: "csp-violation", body: { documentURL: "https://exemplo.test/moderno",
      effectiveDirective: "script-src-elem", blockedURL: "inline", sample: "alert(1)", disposition: "report" } }]), "application/reports+json")).status, 204);
    // método e tipo errados: resposta curta, nada no log
    const get = await fetch(url);
    assert.equal(get.status, 405); assert.equal(get.headers.get("allow"), "POST"); assert.equal((await get.text()).length, 0);
    assert.equal((await fetch(url, { method: "PUT", body: "x" })).status, 405);
    assert.equal((await post(legacy("texto-plano"), "text/plain")).status, 415);
    // lixo, corpo grande (com e sem tamanho declarado) e aninhamento profundo: 204 e nada no log
    assert.equal((await post("isto não é json")).status, 204);
    assert.equal((await post(legacy("grande", { "script-sample": "A".repeat(20000) }))).status, 204);
    // Sem Nginx na frente, o servidor para de ler em 16 KB e responde; o cliente que ainda envia pode levar um reset.
    // Atrás do Nginx (produção) o corpo inteiro chega ao Nginx primeiro e a resposta é 204.
    // Conexão própria (agent: false): o socket descartado pelo servidor não volta ao pool do fetch das próximas chamadas.
    const streamed = await new Promise((done) => {
      const req = request(url, { method: "POST", agent: false, headers: { "content-type": "application/csp-report" } }, (response) => { response.resume(); done(response.statusCode); });
      req.on("error", (error) => done(error?.code ?? "erro"));
      for (let i = 0; i < 40; i += 1) req.write("B".repeat(1024)); // sem content-length: corpo em fluxo (chunked)
      req.end();
    });
    assert.ok([204, "ECONNRESET", "EPIPE"].includes(streamed), `corpo em fluxo: ${streamed}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200, "servidor segue de pé");
    assert.equal((await post("[".repeat(15000))).status, 204);
    // tentativa de injeção no log: quebra de linha, ESC, C1, separadores Unicode, bidi e largura zero
    assert.equal((await post(legacy("injecao", { "blocked-uri": `x${RAW.join("y")}z${ch(10)}[csp] {"falso":1}` }))).status, 204);
    // array com 15 relatórios: no máximo 10 por requisição
    assert.equal((await post(JSON.stringify(Array.from({ length: 15 }, () => ({ body: { documentURL: "https://exemplo.test/lote", effectiveDirective: "img-src" } }))), "application/reports+json")).status, 204);
    // teto por IP: 25 relatórios do mesmo IP, no máximo 20 registrados no minuto
    const minuteBefore = Math.floor(Date.now() / 60000);
    for (let i = 0; i < 25; i += 1) await post(legacy("mesmo-ip"), "application/csp-report", "203.0.113.9");
    const sameMinute = Math.floor(Date.now() / 60000) === minuteBefore;
    await new Promise((wait) => setTimeout(wait, 300));

    const logged = lines();
    assert.ok(logged.some((line) => line.includes('"diretiva":"img-src"') && line.includes("exemplo.test/legado")));
    assert.ok(logged.some((line) => line.includes('"diretiva":"script-src-elem"') && line.includes('"amostra":"alert(1)"')));
    for (const tag of ["texto-plano", "grande", "BBBB"]) assert.ok(!logged.some((line) => line.includes(tag)), `não devia registrar ${tag}`);
    const injected = logged.filter((line) => line.includes("injecao"));
    assert.equal(injected.length, 1, "uma linha só, sem linha forjada");
    for (const char of RAW) assert.ok(!injected[0].includes(char), `caractere cru no log: ${char.charCodeAt(0)}`);
    assert.ok(!output.split("\n").some((line) => line.startsWith('[csp] {"falso"')));
    assert.equal(logged.filter((line) => line.includes("exemplo.test/lote")).length, 10);
    if (sameMinute) assert.equal(logged.filter((line) => line.includes("mesmo-ip")).length, 20);
  } finally {
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once("exit", done));
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
