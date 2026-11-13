/**
 * Proposta comercial do orçamento interno — regras puras (navegador, servidor e testes; sem imports).
 * A proposta só leva o que o cliente pode ver: nada de estoque numérico, locais (Avaria, Licitação, Importação), custo,
 * margem, observações internas ou dados técnicos do Omie. Disponibilidade aparece só como "Pronta entrega".
 */

/** Dados institucionais da MAG no cabeçalho/rodapé (configurados pelo Admin; padrão = dados públicos do site). */
export type DadosEmitente = {
  nomeComercial: string; razaoSocial: string; cnpj: string; endereco: string; telefone: string; whatsapp: string; email: string; site: string;
  rodape: string; validadeDias: number;
  inscricaoEstadual?: string; dadosBancarios?: string; pix?: string;
};

export type ItemProposta = {
  posicao: number; produtoId: string; sku: string; nome: string; unidade: string; quantidade: number;
  precoCentavos: number; brutoCentavos: number; descontoCentavos: number; descontoRotulo: string | null; totalCentavos: number;
  /** Só "Pronta entrega" (sim/não) — nunca a quantidade em estoque. */
  prontaEntrega: boolean;
  /** Caminho da foto no catálogo do site (/catalog-images/…); usado só para achar o arquivo, nunca impresso. */
  foto: string | null;
};

export type TotaisProposta = {
  brutoCentavos: number; descontoItensCentavos: number; subtotalCentavos: number;
  descontoGeralCentavos: number; freteCentavos: number; montagemCentavos: number; totalCentavos: number;
};

/**
 * Consultor(a) na proposta = o perfil comercial do DONO do orçamento. Só entram os contatos marcados para exibição
 * (os demais ficam vazios). Versões do layout 1 têm só nome e e-mail.
 */
export type ConsultorProposta = { nome: string; email: string; cargo?: string; telefone?: string; whatsapp?: string; assinatura?: string };

/** Retrato imutável de uma versão da proposta (v1, v2…): o PDF é sempre refeito a partir dele. */
export type SnapshotProposta = {
  versao: number; numero: string; geradaEm: string;
  /** 2 = consultor com perfil comercial (cargo, contatos escolhidos, assinatura). Sem o campo = layout 1 (versões até 08/10/2026 tarde), refeito igual. */
  layout?: 2;
  emitente: DadosEmitente;
  cliente: { empresa: string; fantasia: string; contato: string; documento: string; cidade: string; uf: string; email: string; telefone: string };
  consultor: ConsultorProposta;
  itens: ItemProposta[];
  totais: TotaisProposta;
  /** `pagamentoCodigo` (código da condição no Omie) existe a partir do layout 2: o futuro Pedido usa a versão aceita. */
  condicoes: { pagamento: string | null; pagamentoCodigo?: string | null; previsao: string | null; validade: string };
  observacoes: string | null;
  opcoes: { mostrarSku: boolean };
  /** Dados do PEDIDO (desde 09/10/2026, tarde): vão ao Omie sem sair no PDF; mudaram depois → a versão não pode ser aceita. */
  pedido?: { conta: string; contaDescricao: string; consumidorFinal: boolean; observacoes: string };
};

// ---------- Perfil comercial (Minha conta) ----------
export const CARGO_PADRAO = "Consultor(a) comercial";
export type PerfilComercial = {
  nome: string; cargo: string; telefone: string; whatsapp: string; email: string; assinatura: string;
  exibirTelefone: boolean; exibirWhatsapp: boolean; exibirEmail: boolean;
};
const SO_TELEFONE = (t: string) => t.replace(/\D/g, "");
/** Telefone brasileiro (10 ou 11 dígitos, com ou sem 55) ou vazio. */
const telefoneOk = (t: string) => !t.trim() || /^(55)?\d{10,11}$/.test(SO_TELEFONE(t));
export function validarPerfil(p: PerfilComercial): string[] {
  const erros: string[] = [];
  const limite = (rotulo: string, v: string, max: number) => { if (v.length > max) erros.push(`${rotulo}: no máximo ${max} caracteres`); };
  limite("Nome na proposta", p.nome, 80);
  limite("Cargo/função", p.cargo, 60);
  limite("E-mail", p.email, 120);
  limite("Assinatura", p.assinatura, 200);
  if (!telefoneOk(p.telefone)) erros.push("Telefone: use DDD + número");
  if (!telefoneOk(p.whatsapp)) erros.push("WhatsApp: use DDD + número");
  if (p.email.trim() && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(p.email.trim())) erros.push("E-mail: inválido");
  if (p.exibirTelefone && !p.telefone.trim()) erros.push("Telefone: preencha ou desmarque \"exibir\"");
  if (p.exibirWhatsapp && !p.whatsapp.trim()) erros.push("WhatsApp: preencha ou desmarque \"exibir\"");
  if (p.exibirEmail && !p.email.trim()) erros.push("E-mail: preencha ou desmarque \"exibir\"");
  return erros;
}
/** O que aparece para o cliente: contatos NÃO marcados para exibição nunca saem daqui. */
export function consultorDoPerfil(p: PerfilComercial): ConsultorProposta {
  return {
    nome: p.nome, cargo: p.cargo || CARGO_PADRAO, assinatura: p.assinatura,
    email: p.exibirEmail ? p.email.trim().toLowerCase() : "",
    telefone: p.exibirTelefone && p.telefone.trim() ? telefoneBR(p.telefone) : "",
    whatsapp: p.exibirWhatsapp && p.whatsapp.trim() ? telefoneBR(p.whatsapp) : "",
  };
}

export const LIMITE_VALOR_CENTAVOS = 10_000_000_000; // R$ 100 milhões

/** Total da proposta = itens (já com os descontos deles) − desconto geral + frete + montagem. */
export function totaisDaProposta(
  itens: { brutoCentavos: number; descontoCentavos: number; totalCentavos: number }[],
  extras: { descontoGeralCentavos: number; freteCentavos: number; montagemCentavos: number },
): TotaisProposta {
  const brutoCentavos = itens.reduce((s, i) => s + i.brutoCentavos, 0);
  const descontoItensCentavos = itens.reduce((s, i) => s + i.descontoCentavos, 0);
  const subtotalCentavos = itens.reduce((s, i) => s + i.totalCentavos, 0);
  const descontoGeralCentavos = Math.min(Math.max(0, extras.descontoGeralCentavos), subtotalCentavos);
  const freteCentavos = Math.max(0, extras.freteCentavos);
  const montagemCentavos = Math.max(0, extras.montagemCentavos);
  return { brutoCentavos, descontoItensCentavos, subtotalCentavos, descontoGeralCentavos, freteCentavos, montagemCentavos,
    totalCentavos: subtotalCentavos - descontoGeralCentavos + freteCentavos + montagemCentavos };
}

/** Problemas nos valores extras (a tela mostra todos de uma vez). */
export function validarExtras(extras: { descontoGeralCentavos: number | null; freteCentavos: number | null; montagemCentavos: number | null }, subtotalCentavos: number): string[] {
  const erros: string[] = [];
  const conferir = (rotulo: string, v: number | null) => {
    if (v === null || !Number.isSafeInteger(v) || v < 0 || v > LIMITE_VALOR_CENTAVOS) erros.push(`${rotulo} inválido`);
  };
  conferir("desconto geral", extras.descontoGeralCentavos);
  conferir("frete", extras.freteCentavos);
  conferir("montagem", extras.montagemCentavos);
  if ((extras.descontoGeralCentavos ?? 0) > subtotalCentavos) erros.push("o desconto geral não pode passar do subtotal dos itens");
  return erros;
}

const SEM_ACENTO = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "");
const SUFIXOS = new Set(["LTDA", "ME", "EPP", "EIRELI", "SA", "S/A", "S.A", "S.A.", "MEI", "SS", "LTDA-ME", "LTDA.", "CIA", "CIA."]);

/**
 * Nome do arquivo: MAG-Orcamento-<número>-<Cliente-Sem-Acento>[-vN].pdf — nunca CPF/CNPJ nem e-mail. Trechos com 5 ou mais
 * dígitos saem (a razão social de MEI começa com a raiz do CNPJ, ex.: "12.345.678 JOAO DA SILVA").
 */
export function nomeArquivoProposta(numero: string, empresa: string, versao: number): string {
  const palavras = SEM_ACENTO(empresa).toUpperCase().split(/[\s,;]+/).filter((p) => p && !SUFIXOS.has(p) && p.replace(/\D/g, "").length < 5)
    .map((p) => p.replace(/[^A-Z0-9]/g, "")).filter(Boolean).slice(0, 6)
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase());
  const cliente = palavras.join("-").slice(0, 60).replace(/-+$/, "");
  const seguro = numero.replace(/[^A-Za-z0-9-]/g, "");
  return `MAG-Orcamento-${seguro}${cliente ? `-${cliente}` : ""}${versao > 1 ? `-v${versao}` : ""}.pdf`;
}

/** R$ no padrão brasileiro com espaço comum (texto de WhatsApp/e-mail/PDF). */
export const dinheiro = (centavos: number) =>
  `R$ ${(centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dataBR = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const quantidadeBR = (q: number) => q.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Celular/fixo brasileiro em formato do WhatsApp (55 + DDD + número) ou null. */
export function telefoneWhatsApp(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) return d;
  if (/^\d{10,11}$/.test(d)) return `55${d}`;
  return null;
}
/** "5585998610074" / "85998610074" → "(85) 99861-0074"; o que não for telefone brasileiro volta como veio. */
export function telefoneBR(telefone: string | null | undefined): string {
  const bruto = String(telefone ?? "").trim();
  let d = bruto.replace(/\D/g, "");
  if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return bruto;
}

const limparNome = (t: string) => t.replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim();
const tituloNome = (t: string) => t.toLowerCase().split(" ").filter(Boolean)
  .map((p, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
/**
 * Nome do(a) consultor(a) na proposta: o que a pessoa escolheu em "Minha conta" → o do vendedor vinculado no Omie
 * (sem o sufixo interno, ex.: "CAIO - VAR" → "Caio") → o do e-mail ("mateus.oliveira@" → "Mateus Oliveira").
 */
export function nomeDeExibicao(escolhido: string | null | undefined, vendedorOmie: string | null | undefined, email: string): string {
  const proprio = limparNome(String(escolhido ?? ""));
  if (proprio) return proprio.slice(0, 80);
  const omie = limparNome(String(vendedorOmie ?? "").split(/\s+-\s+/)[0] ?? "");
  if (omie) return tituloNome(omie).slice(0, 80);
  const local = limparNome((email.split("@")[0] ?? "").replace(/[._-]+/g, " ").replace(/\d+/g, " "));
  return local ? tituloNome(local).slice(0, 80) : "Equipe comercial";
}

/** Rótulo do desconto do item na proposta ("10%"); desconto em R$ não tem rótulo (o valor já aparece). */
export const rotuloDesconto = (tipo: string | null | undefined, valor: number) =>
  (tipo === "percentual" && valor > 0 ? `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : null);
/** Dia (AAAA-MM-DD) + n dias, sem fuso. */
export const somarDias = (dia: string, dias: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

/** Dados institucionais que o Admin pode gravar (todos os textos com limite; a validade padrão entre 1 e 90 dias). */
export function validarEmitente(e: DadosEmitente): string[] {
  const erros: string[] = [];
  const limite = (rotulo: string, v: string, max: number, obrigatorio = false) => {
    if (obrigatorio && !v.trim()) erros.push(`${rotulo}: obrigatório`);
    if (v.length > max) erros.push(`${rotulo}: no máximo ${max} caracteres`);
  };
  limite("Nome comercial", e.nomeComercial, 80, true);
  limite("Razão social", e.razaoSocial, 120);
  limite("CNPJ", e.cnpj, 20);
  limite("Endereço", e.endereco, 200);
  limite("Telefone", e.telefone, 30);
  limite("WhatsApp", e.whatsapp, 30);
  limite("E-mail", e.email, 120);
  limite("Site", e.site, 80);
  limite("Texto das condições", e.rodape, 400);
  limite("Inscrição estadual", e.inscricaoEstadual ?? "", 30);
  limite("Dados bancários", e.dadosBancarios ?? "", 300);
  limite("Chave PIX", e.pix ?? "", 140);
  if (e.cnpj && !/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(e.cnpj.trim())) erros.push("CNPJ: formato inválido");
  if (e.email && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e.email.trim())) erros.push("E-mail: inválido");
  if (e.site && /^\s*[a-z]+:/i.test(e.site) && !/^\s*https?:\/\//i.test(e.site)) erros.push("Site: use só o endereço (ex.: magmoveiscorporativos.com.br)");
  if (!Number.isInteger(e.validadeDias) || e.validadeDias < 1 || e.validadeDias > 90) erros.push("Validade padrão: de 1 a 90 dias");
  return erros;
}

function disponibilidade(s: SnapshotProposta): string | null {
  const prontos = s.itens.filter((i) => i.prontaEntrega).length;
  if (!s.itens.length || !prontos) return null;
  return prontos === s.itens.length ? "Os produtos estão disponíveis para pronta entrega." : "Os itens marcados como pronta entrega na proposta estão disponíveis.";
}
function resumoItens(s: SnapshotProposta): string {
  const linhas = s.itens.slice(0, 3).map((i) => `• ${quantidadeBR(i.quantidade)} ${i.unidade} — ${i.nome}`);
  if (s.itens.length > 3) linhas.push(`• e mais ${s.itens.length - 3} ${s.itens.length - 3 === 1 ? "item" : "itens"}`);
  return linhas.join("\n");
}
const saudacaoNome = (s: SnapshotProposta) => (s.cliente.contato || s.cliente.fantasia || s.cliente.empresa).trim();

/** Mensagem do WhatsApp (o vendedor anexa o PDF baixado; nada de estoque numérico). */
export function mensagemWhatsApp(s: SnapshotProposta): string {
  const partes = [
    `Olá, ${saudacaoNome(s)}! Segue a proposta MAG nº ${s.numero}, conforme conversamos.`,
    resumoItens(s),
    `Valor total: ${dinheiro(s.totais.totalCentavos)}.`,
    s.condicoes.pagamento ? `Condição: ${s.condicoes.pagamento}.` : "",
    disponibilidade(s) ?? "",
    `Validade: até ${dataBR(s.condicoes.validade)}.`,
    "Segue a proposta para sua análise. Fico à disposição para qualquer dúvida.",
    `${s.consultor.nome} — ${s.emitente.nomeComercial}`,
  ];
  return partes.filter(Boolean).join("\n");
}

export const assuntoEmail = (s: SnapshotProposta) => `Proposta MAG nº ${s.numero} — ${s.cliente.fantasia || s.cliente.empresa}`;

/** Texto do e-mail (mostrado antes de enviar; nunca vai para log). Contatos: os que o consultor marcou para exibir. */
export function mensagemEmail(s: SnapshotProposta): string {
  const c = s.consultor;
  const daEmpresa = [s.emitente.telefone && `Telefone: ${s.emitente.telefone}`, s.emitente.whatsapp && `WhatsApp: ${s.emitente.whatsapp}`];
  const proprios = [c.telefone && `Telefone: ${c.telefone}`, c.whatsapp && `WhatsApp: ${c.whatsapp}`, c.email];
  const contatos = (s.layout === 2 ? (proprios.some(Boolean) ? proprios : daEmpresa) : [...daEmpresa, c.email]).filter(Boolean).join(" · ");
  const linhas: (string | null)[] = [
    `Olá, ${saudacaoNome(s)},`,
    "",
    `Segue em anexo a proposta MAG nº ${s.numero}, conforme conversamos.`,
    "",
    resumoItens(s),
    "",
    `Valor total: ${dinheiro(s.totais.totalCentavos)}`,
    s.condicoes.pagamento ? `Condição de pagamento: ${s.condicoes.pagamento}` : null,
    s.condicoes.previsao ? `Previsão de faturamento: ${dataBR(s.condicoes.previsao)}` : null,
    `Validade da proposta: até ${dataBR(s.condicoes.validade)}`,
    disponibilidade(s),
    "",
    "Fico à disposição para qualquer dúvida.",
    "",
    "Atenciosamente,",
    c.nome,
    s.layout === 2 ? c.cargo || CARGO_PADRAO : null,
    s.emitente.nomeComercial,
    contatos || null,
  ];
  return linhas.filter((linha): linha is string => linha !== null)
    .filter((linha, i, todas) => linha !== "" || (i > 0 && todas[i - 1] !== "")).join("\n");
}

// ---------- Comparação de versões ----------
export type LinhaComparacao = { item: string; mudanca: "incluído" | "removido" | "alterado"; campos: string[]; antes: string; depois: string };
export type Comparacao = { itens: LinhaComparacao[]; gerais: { campo: string; antes: string; depois: string }[] };

/**
 * Diferenças entre duas versões (A = anterior, B = posterior): produtos incluídos/removidos/alterados (quantidade, preço,
 * desconto), descontos, frete, montagem, condição, validade, previsão e total. O mesmo produto em várias linhas é
 * comparado na ordem em que aparece.
 */
export function compararRetratos(a: SnapshotProposta, b: SnapshotProposta): Comparacao {
  const chaves = (s: SnapshotProposta) => {
    const vistos = new Map<string, number>();
    return s.itens.map((i) => { const n = (vistos.get(i.produtoId) ?? 0) + 1; vistos.set(i.produtoId, n); return [`${i.produtoId}#${n}`, i] as const; });
  };
  const ma = new Map(chaves(a)); const mb = new Map(chaves(b));
  const nomeDe = (i: ItemProposta) => `${i.nome}${i.sku ? ` (SKU ${i.sku})` : ""}`;
  const descreve = (i: ItemProposta) => `${quantidadeBR(i.quantidade)} ${i.unidade} × ${dinheiro(i.precoCentavos)}`
    + `${i.descontoCentavos ? ` − ${dinheiro(i.descontoCentavos)}${i.descontoRotulo ? ` (${i.descontoRotulo})` : ""}` : ""} = ${dinheiro(i.totalCentavos)}`;
  const itens: LinhaComparacao[] = [];
  for (const [chave, ia] of ma) {
    const ib = mb.get(chave);
    if (!ib) { itens.push({ item: nomeDe(ia), mudanca: "removido", campos: [], antes: descreve(ia), depois: "—" }); continue; }
    const campos: string[] = [];
    if (ia.quantidade !== ib.quantidade) campos.push("quantidade");
    if (ia.precoCentavos !== ib.precoCentavos) campos.push("preço");
    if (ia.descontoCentavos !== ib.descontoCentavos || (ia.descontoRotulo ?? "") !== (ib.descontoRotulo ?? "")) campos.push("desconto");
    if (ia.nome !== ib.nome) campos.push("descrição");
    if (ia.totalCentavos !== ib.totalCentavos && !campos.length) campos.push("total");
    if (campos.length) itens.push({ item: nomeDe(ib), mudanca: "alterado", campos, antes: descreve(ia), depois: descreve(ib) });
  }
  for (const [chave, ib] of mb) if (!ma.has(chave)) itens.push({ item: nomeDe(ib), mudanca: "incluído", campos: [], antes: "—", depois: descreve(ib) });
  const gerais: Comparacao["gerais"] = [];
  const geral = (campo: string, x: string, y: string) => { if (x !== y) gerais.push({ campo, antes: x || "—", depois: y || "—" }); };
  geral("Descontos nos itens", dinheiro(a.totais.descontoItensCentavos), dinheiro(b.totais.descontoItensCentavos));
  geral("Desconto geral", dinheiro(a.totais.descontoGeralCentavos), dinheiro(b.totais.descontoGeralCentavos));
  geral("Frete", dinheiro(a.totais.freteCentavos), dinheiro(b.totais.freteCentavos));
  geral("Montagem", dinheiro(a.totais.montagemCentavos), dinheiro(b.totais.montagemCentavos));
  geral("Condição de pagamento", a.condicoes.pagamento ?? "", b.condicoes.pagamento ?? "");
  geral("Validade", dataBR(a.condicoes.validade), dataBR(b.condicoes.validade));
  geral("Previsão de faturamento", dataBR(a.condicoes.previsao), dataBR(b.condicoes.previsao));
  // Dados do pedido (não saem no PDF, mas vão ao Omie): só entre versões que os registram.
  if (a.pedido && b.pedido) {
    const conta = (p: NonNullable<SnapshotProposta["pedido"]>) => (p.conta ? `${p.contaDescricao || "?"} · ${p.conta}` : "");
    geral("Conta corrente da venda", conta(a.pedido), conta(b.pedido));
    geral("Consumidor final", a.pedido.consumidorFinal ? "Sim" : "Não", b.pedido.consumidorFinal ? "Sim" : "Não");
    geral("Observações do pedido", a.pedido.observacoes, b.pedido.observacoes);
  }
  geral("Subtotal dos itens", dinheiro(a.totais.subtotalCentavos), dinheiro(b.totais.subtotalCentavos));
  geral("Total da proposta", dinheiro(a.totais.totalCentavos), dinheiro(b.totais.totalCentavos));
  return { itens, gerais };
}

/**
 * O que identifica o CONTEÚDO da proposta (para avisar "Orçamento alterado depois da última proposta gerada"):
 * cliente, itens, preços, descontos, extras, condições e observações da proposta. Notas internas, e-mail da NF e
 * observações do pedido no Omie não entram (não aparecem para o cliente).
 */
export function conteudoComparavel(q: {
  cliente: { empresa: string; fantasia: string; contato: string; documento: string; cidade: string; uf: string; email: string; telefone: string };
  itens: { produtoId: string; sku: string; nome: string; unidade: string; quantidade: number; precoCentavos: number; descontoTipo: string | null; descontoValor: number; totalCentavos: number }[];
  extras: { descontoGeralCentavos: number; freteCentavos: number; montagemCentavos: number };
  condicoes: { pagamento: string | null; previsao: string | null; validade: string | null };
  observacoes: string | null;
}): string {
  return JSON.stringify([
    [q.cliente.empresa, q.cliente.fantasia, q.cliente.contato, q.cliente.documento, q.cliente.cidade, q.cliente.uf, q.cliente.email, q.cliente.telefone],
    q.itens.map((i) => [i.produtoId, i.sku, i.nome, i.unidade, i.quantidade, i.precoCentavos, i.descontoTipo ?? "", i.descontoValor, i.totalCentavos]),
    [q.extras.descontoGeralCentavos, q.extras.freteCentavos, q.extras.montagemCentavos],
    [q.condicoes.pagamento ?? "", q.condicoes.previsao ?? "", q.condicoes.validade ?? ""],
    q.observacoes ?? "",
  ]);
}
