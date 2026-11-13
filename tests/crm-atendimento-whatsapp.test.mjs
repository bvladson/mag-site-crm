// Atendimento com visual de WhatsApp (12/11/2026): regras puras da tela. node --test tests/crm-atendimento-whatsapp.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const format = await import("../src/components/interno/crm/chatFormat.ts");
const replies = await import("../src/components/interno/crm/quickReplies.ts");
const wav = await import("../src/components/interno/crm/audioWav.ts");

// 13/11/2026 10:00 em Fortaleza (UTC-3).
const NOW = new Date("2026-11-13T13:00:00.000Z");
const at = (iso) => new Date(iso).toISOString();

test("etiqueta do dia segue o fuso comercial: Hoje, Ontem, dia da semana e data por extenso", () => {
  assert.equal(format.dayLabel(at("2026-11-13T12:00:00Z"), NOW), "Hoje");
  assert.equal(format.dayLabel(at("2026-11-12T20:00:00Z"), NOW), "Ontem");
  // 02:30 UTC de 13/11 ainda é 12/11 (23:30) em Fortaleza.
  assert.equal(format.dayLabel(at("2026-11-13T02:30:00Z"), NOW), "Ontem");
  assert.equal(format.dayLabel(at("2026-11-10T15:00:00Z"), NOW), "Terça-feira");
  assert.equal(format.dayLabel(at("2026-11-03T15:00:00Z"), NOW), "3 de novembro de 2026");
  assert.equal(format.dayLabel("", NOW), "");
});

test("horário da lista: hora de hoje, Ontem, dia da semana ou data curta", () => {
  assert.equal(format.listTime(at("2026-11-13T12:05:00Z"), NOW), "09:05");
  assert.equal(format.listTime(at("2026-11-12T12:05:00Z"), NOW), "Ontem");
  assert.equal(format.listTime(at("2026-11-09T12:05:00Z"), NOW), "Segunda-feira");
  assert.equal(format.listTime(at("2026-10-30T12:05:00Z"), NOW), "30/10/26");
  assert.equal(format.listTime(undefined, NOW), "");
});

test("telefone legível no padrão brasileiro; outros países ficam como vieram", () => {
  assert.equal(format.formatPhone("5585987102000"), "+55 (85) 98710-2000");
  assert.equal(format.formatPhone("85987102000"), "+55 (85) 98710-2000");
  assert.equal(format.formatPhone("558532221234"), "+55 (85) 3222-1234");
  assert.equal(format.formatPhone("+55 85 98710-2000"), "+55 (85) 98710-2000");
  assert.equal(format.formatPhone("+1 415 555 0100"), "+1 415 555 0100");
  assert.equal(format.formatPhone("14155550100"), "14155550100", "11 dígitos sem forma de celular brasileiro");
  assert.equal(format.formatPhone("351912345678"), "351912345678", "Portugal sem +");
  assert.equal(format.formatPhone(""), "");
});

test("tiques do WhatsApp para cada situação de envio", () => {
  const expected = {
    pending: "clock",
    queued: "clock",
    sent: "single",
    delivered: "double",
    read: "read",
    played: "read",
    failed: "failed",
    uncertain: "uncertain",
    received: null,
  };
  for (const [status, kind] of Object.entries(expected)) assert.equal(format.tickFor(status), kind, status);
  assert.equal(format.STATUS_LABEL.read, "Lida");
  assert.equal(format.STATUS_LABEL.uncertain, "Envio não confirmado");
});

test("formatação do WhatsApp: negrito, itálico, tachado, monoespaçado e links seguros", () => {
  assert.deepEqual(format.parseRichText("Oi *Maria*, tudo _bem_? ~R$ 900~"), [
    { kind: "text", text: "Oi " },
    { kind: "bold", text: "Maria" },
    { kind: "text", text: ", tudo " },
    { kind: "italic", text: "bem" },
    { kind: "text", text: "? " },
    { kind: "strike", text: "R$ 900" },
  ]);
  assert.deepEqual(format.parseRichText("Código: ```CAD-014```"), [
    { kind: "text", text: "Código: " },
    { kind: "mono", text: "CAD-014" },
  ]);
  assert.deepEqual(format.parseRichText("Veja www.magmoveiscorporativos.com.br/cadeiras."), [
    { kind: "text", text: "Veja " },
    { kind: "link", text: "www.magmoveiscorporativos.com.br/cadeiras", href: "https://www.magmoveiscorporativos.com.br/cadeiras" },
    { kind: "text", text: "." },
  ]);
  assert.deepEqual(format.parseRichText("https://exemplo.com.br/a_b_c?x=1"), [
    { kind: "link", text: "https://exemplo.com.br/a_b_c?x=1", href: "https://exemplo.com.br/a_b_c?x=1" },
  ]);
  // Sem formatação acidental: nomes com sublinhado, contas e asterisco solto.
  for (const plain of ["arquivo_final_v2.pdf", "2*3*4 = 24", "* sem fechar", "preço *a combinar"])
    assert.deepEqual(format.parseRichText(plain), [{ kind: "text", text: plain }], plain);
  // HTML vindo da mensagem continua texto puro (a tela só monta elementos React).
  assert.deepEqual(format.parseRichText("<img src=x onerror=alert(1)>"), [
    { kind: "text", text: "<img src=x onerror=alert(1)>" },
  ]);
  // Só http(s): "javascript:" nunca vira link.
  assert.ok(format.parseRichText("javascript:alert(1)").every((piece) => piece.kind !== "link"));
});

test("mídia sem legenda: texto provisório some do balão e vira rótulo na lista", () => {
  for (const placeholder of ["[Áudio]", "[Imagem]", "[Documento]", "[Mensagem WhatsApp]", "[Áudio recebido no WhatsApp]", "[Imagem recebida no WhatsApp]"])
    assert.equal(format.isMediaPlaceholder(placeholder), true, placeholder);
  for (const text of ["[Áudio] segue", "Veja [Imagem]", "Oi", "", undefined])
    assert.equal(format.isMediaPlaceholder(text), false, String(text));
  assert.equal(format.previewText("[Áudio]"), "🎤 Áudio");
  assert.equal(format.previewText("[Imagem recebida no WhatsApp]"), "📷 Foto");
  assert.equal(format.previewText("[Documento]"), "📄 Documento");
  assert.equal(format.previewText("[Mensagem WhatsApp]"), "[Mensagem WhatsApp]");
  assert.equal(format.previewText("Bom dia"), "Bom dia");
  assert.equal(format.previewText(undefined), "");
});

test("filtros rápidos: não respondidas, aguardando cliente, retornos e com proposta", () => {
  const base = { unread: 0, lastFrom: undefined, awaitingReply: false, nextDue: [], hasProposal: false };
  const views = (patch) => [...format.inboxViews({ ...base, ...patch }, NOW)].sort();
  assert.deepEqual(views({}), ["todas"]);
  assert.deepEqual(views({ unread: 2, lastFrom: "cliente" }), ["responder", "todas"]);
  assert.deepEqual(views({ lastFrom: "cliente" }), ["responder", "todas"], "cliente escreveu por último");
  assert.deepEqual(views({ lastFrom: "vendedora", awaitingReply: true }), ["responder", "todas"]);
  assert.deepEqual(views({ lastFrom: "vendedora" }), ["aguardando", "todas"]);
  assert.deepEqual(views({ lastFrom: "vendedora", nextDue: [at("2026-11-13T20:00:00Z")] }), ["aguardando", "retornos", "todas"], "retorno hoje");
  assert.deepEqual(views({ nextDue: [at("2026-11-10T12:00:00Z")] }), ["retornos", "todas"], "retorno atrasado");
  assert.deepEqual(views({ nextDue: [at("2026-11-14T12:00:00Z")] }), ["todas"], "retorno amanhã não entra");
  assert.deepEqual(views({ hasProposal: true }), ["proposta", "todas"]);
  assert.equal(format.isLate([at("2026-11-13T12:00:00Z")], NOW), true);
  assert.equal(format.isLate([at("2026-11-13T20:00:00Z")], NOW), false);
  assert.deepEqual(format.INBOX_VIEWS.map((view) => view.id), ["todas", "responder", "aguardando", "retornos", "proposta"]);
});

test("respostas prontas: atalhos com /, sem termos comerciais inventados", () => {
  assert.equal(replies.matchQuickReplies("/").length, replies.QUICK_REPLIES.length);
  assert.deepEqual(replies.matchQuickReplies("/or").map((reply) => reply.id), ["orcamento"]);
  assert.deepEqual(replies.matchQuickReplies("/OLA").map((reply) => reply.id), ["saudacao"]);
  assert.deepEqual(replies.matchQuickReplies("/ola tudo bem"), []);
  assert.deepEqual(replies.matchQuickReplies("olá"), []);
  const shortcuts = replies.QUICK_REPLIES.map((reply) => reply.shortcut);
  assert.equal(new Set(shortcuts).size, shortcuts.length, "atalhos únicos");
  for (const reply of replies.QUICK_REPLIES) {
    assert.match(reply.shortcut, /^\/[a-z]+$/);
    // Prazo, preço, frete grátis e região só com os termos reais da MAG.
    assert.doesNotMatch(reply.text, /R\$|dias úteis|Grande SP|sem custo|grátis|\d+x/i, reply.id);
  }
});

test("áudio gravado vira WAV 16 kHz mono aceito pelo servidor", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
  const bytes = wav.encodeWav(samples, 16_000);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(12, 4), "fmt ");
  assert.equal(ascii(36, 4), "data");
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2);
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16, "16 bits");
  assert.equal(view.getUint32(40, true), samples.length * 2);
  const pcm = [...Array(samples.length).keys()].map((index) => view.getInt16(44 + index * 2, true));
  assert.deepEqual(pcm, [0, 16383, -16384, 32767, -32768, 32767, -32768], "valores fora de [-1, 1] são cortados");
  assert.equal(bytes.length, 44 + samples.length * 2);
  // 48 kHz -> 16 kHz: 1/3 das amostras, com média de cada trecho.
  const reduced = wav.downsample(new Float32Array([0.3, 0.3, 0.3, -0.6, -0.6, -0.6, 0.9]), 48_000, 16_000);
  assert.equal(reduced.length, 2);
  assert.ok(Math.abs(reduced[0] - 0.3) < 1e-6 && Math.abs(reduced[1] + 0.6) < 1e-6);
  assert.equal(wav.downsample(new Float32Array([1, 2]), 16_000, 16_000).length, 2, "sem reamostrar quando já é 16 kHz");
  // 3 minutos cabem no limite de 7 MB por anexo.
  assert.ok(44 + wav.MAX_RECORDING_SECONDS * wav.VOICE_SAMPLE_RATE * 2 < 7 * 1024 * 1024);
});
