/**
 * PDF da proposta comercial (A4, timbrado MAG), gerado no servidor a partir do RETRATO da versão (nunca dos dados atuais).
 * Só o que o cliente pode ver: nada de estoque numérico, locais, custo, margem, notas internas ou códigos internos do
 * Omie. Determinístico: datas do PDF = momento da versão. Fotos: as do catálogo do site (WebP → JPEG pelo sharp que já
 * está na imagem para os workers); sem foto ou sem sharp, a célula fica neutra.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { dinheiro, dataBR, type SnapshotProposta } from "./proposta-regras.ts";

const LARGURA = 595.28;
const ALTURA = 841.89;
const ESQ = 42;
const DIR = LARGURA - 42;
const LARG = DIR - ESQ;
const TOPO = ALTURA - 34;
const BASE = 50; // o conteúdo para aqui; abaixo fica o rodapé
const COR = {
  vermelho: rgb(0.647, 0.118, 0.141), // #A51E24 — vermelho da marca (oklch 0.47 0.17 25)
  texto: rgb(0.12, 0.13, 0.15), cinza: rgb(0.42, 0.45, 0.5), linha: rgb(0.87, 0.88, 0.9), fundo: rgb(0.965, 0.965, 0.972), branco: rgb(1, 1, 1),
};
// Colunas da tabela de itens (somam a largura útil).
const COL = { foto: 54, produto: 223, qtd: 44, preco: 66, desconto: 58, total: 66 };
const X = { foto: ESQ, produto: ESQ + COL.foto, qtd: ESQ + COL.foto + COL.produto } as Record<string, number>;
X["preco"] = X["qtd"]! + COL.qtd; X["desconto"] = X["preco"]! + COL.preco; X["total"] = X["desconto"]! + COL.desconto;
const TROCAS: Record<string, string> = { "≥": ">=", "≤": "<=", "→": "->", "−": "-", "✓": "v" };

export type DependenciasPdf = {
  /** Bytes JPEG/PNG/WebP da foto (caminho /catalog-images/…); null = sem foto. */
  carregarFoto?: (caminho: string) => Promise<Uint8Array | null>;
  carregarLogo?: () => Promise<Uint8Array | null>;
};
export type PdfProposta = { bytes: Uint8Array; paginas: { textos: string[]; fotos: number }[] };

const ehPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const ehJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

type Sharp = (entrada: Uint8Array) => { resize: (...a: unknown[]) => { flatten: (o: unknown) => { jpeg: (o: unknown) => { toBuffer: () => Promise<Uint8Array> } } } };
let sharpCarregado: Sharp | null | undefined;
/** O sharp do container fica em /app/scripts (instalado para os workers); fora dele (testes locais) as fotos WebP ficam sem foto. */
async function carregarSharp(): Promise<Sharp | null> {
  if (sharpCarregado !== undefined) return sharpCarregado;
  try {
    const { createRequire } = await import("node:module");
    const { join } = await import("node:path");
    const modulo = createRequire(join(process.cwd(), "scripts", "package.json"))("sharp") as Sharp & { concurrency?: (n: number) => void; cache?: (v: boolean) => void };
    modulo.concurrency?.(1);
    modulo.cache?.(false);
    sharpCarregado = modulo;
  } catch {
    sharpCarregado = null;
  }
  return sharpCarregado;
}

const FOTO = /^\/catalog-images\/([a-f0-9]{64})(?:-p)?\.(jpg|png|webp)$/;
/** Foto do catálogo (a versão pequena "-p"), convertida para JPEG quando é WebP. */
export async function fotoDoCatalogo(caminho: string): Promise<Uint8Array | null> {
  const m = FOTO.exec(caminho);
  if (!m) return null;
  const { readFile } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const pasta = resolve(process.env["OMIE_IMAGE_DIR"] || "./data/catalog-images");
  let bytes: Uint8Array | null = null;
  for (const nome of [`${m[1]}-p.${m[2]}`, `${m[1]}.${m[2]}`]) {
    try { bytes = await readFile(join(pasta, nome)); break; } catch { /* tenta a outra */ }
  }
  if (!bytes) return null;
  if (ehJpeg(bytes) || ehPng(bytes)) return bytes;
  const sharp = await carregarSharp();
  if (!sharp) return null;
  try { return await sharp(bytes).resize(220, 220, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer(); } catch { return null; }
}
async function logoPadrao(): Promise<Uint8Array | null> {
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  for (const caminho of [".output/public/images/mag-logo.png", "public/images/mag-logo.png"]) {
    try { return await readFile(resolve(process.cwd(), caminho)); } catch { /* próximo */ }
  }
  return null;
}
const dataLocal = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
const quantidadeBR = (q: number) => q.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const documentoComRotulo = (doc: string) => (doc ? `${doc.replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ"}: ${doc}` : "");

export async function renderizarProposta(s: SnapshotProposta, dep: DependenciasPdf = {}): Promise<PdfProposta> {
  const pdf = await PDFDocument.create();
  const momento = new Date(s.geradaEm);
  pdf.setTitle(`Proposta ${s.numero} v${s.versao}`);
  pdf.setAuthor(s.emitente.nomeComercial);
  pdf.setSubject("Proposta comercial");
  pdf.setCreator("Painel MAG");
  pdf.setProducer("Painel MAG");
  pdf.setCreationDate(momento);
  pdf.setModificationDate(momento);
  pdf.setLanguage("pt-BR");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const suportados = new Set(normal.getCharacterSet());
  const limpar = (t: string) => Array.from(String(t ?? "").replace(/[\r\t\n]+/g, " ")).map((c) => (suportados.has(c.codePointAt(0)!) ? c : TROCAS[c] ?? "")).join("");

  const embutir = async (bytes: Uint8Array | null): Promise<PDFImage | null> => {
    if (!bytes) return null;
    try { return ehPng(bytes) ? await pdf.embedPng(bytes) : ehJpeg(bytes) ? await pdf.embedJpg(bytes) : null; } catch { return null; }
  };
  const logo = await embutir(await (dep.carregarLogo ?? logoPadrao)());
  const fotos = new Map<string, PDFImage | null>();
  const fotoDe = async (caminho: string) => {
    if (!fotos.has(caminho)) fotos.set(caminho, await embutir(await (dep.carregarFoto ?? fotoDoCatalogo)(caminho)));
    return fotos.get(caminho) ?? null;
  };

  const paginas: { p: PDFPage; textos: string[]; fotos: number }[] = [];
  let atual!: { p: PDFPage; textos: string[]; fotos: number };
  let y = 0;
  let topoConteudo = 0; // onde o conteúdo começa numa página nova (logo abaixo do cabeçalho)
  const escrever = (t: string, x: number, yy: number, f: PDFFont, tam: number, cor = COR.texto) => {
    const tx = limpar(t);
    if (!tx) return 0;
    atual.p.drawText(tx, { x, y: yy, size: tam, font: f, color: cor });
    atual.textos.push(tx);
    return f.widthOfTextAtSize(tx, tam);
  };
  const direita = (t: string, xDir: number, yy: number, f: PDFFont, tam: number, cor = COR.texto) => {
    const tx = limpar(t);
    escrever(tx, xDir - f.widthOfTextAtSize(tx, tam), yy, f, tam, cor);
  };
  /** Quebra de linha por palavras (palavra maior que a linha é cortada). */
  const quebrar = (t: string, f: PDFFont, tam: number, largura: number): string[] => {
    const linhas: string[] = [];
    for (const paragrafo of String(t ?? "").split(/\r?\n/)) {
      let linha = "";
      for (const palavra of limpar(paragrafo).split(/\s+/).filter(Boolean)) {
        const tentativa = linha ? `${linha} ${palavra}` : palavra;
        if (f.widthOfTextAtSize(tentativa, tam) <= largura) { linha = tentativa; continue; }
        if (linha) linhas.push(linha);
        let resto = palavra;
        while (f.widthOfTextAtSize(resto, tam) > largura && resto.length > 1) {
          let n = resto.length - 1;
          while (n > 1 && f.widthOfTextAtSize(resto.slice(0, n), tam) > largura) n -= 1;
          linhas.push(resto.slice(0, n));
          resto = resto.slice(n);
        }
        linha = resto;
      }
      linhas.push(linha);
    }
    while (linhas.length && !linhas[linhas.length - 1]) linhas.pop();
    return linhas;
  };

  const cabecalho = () => {
    const p = atual.p;
    if (logo) {
      const d = logo.scaleToFit(92, 46);
      p.drawImage(logo, { x: ESQ, y: TOPO - d.height, width: d.width, height: d.height });
    }
    const e = s.emitente;
    const linhas: [string, PDFFont, number, ReturnType<typeof rgb>][] = [
      [e.nomeComercial, negrito, 11, COR.texto],
      [[e.razaoSocial, e.cnpj && `CNPJ ${e.cnpj}`, e.inscricaoEstadual && `IE ${e.inscricaoEstadual}`].filter(Boolean).join(" · "), normal, 7.6, COR.cinza],
      [e.endereco, normal, 7.6, COR.cinza],
      [[e.telefone, e.whatsapp && `WhatsApp ${e.whatsapp}`, e.email, e.site].filter(Boolean).join(" · "), normal, 7.6, COR.cinza],
    ];
    let yy = TOPO - 9;
    for (const [t, f, tam, cor] of linhas) {
      if (!t) continue;
      let tamanho = tam;
      while (tamanho > 6 && f.widthOfTextAtSize(limpar(t), tamanho) > LARG - 110) tamanho -= 0.2;
      direita(t, DIR, yy, f, tamanho, cor);
      yy -= tamanho + 3.4;
    }
    const linhaVermelha = Math.min(TOPO - 52, yy - 2);
    p.drawRectangle({ x: ESQ, y: linhaVermelha, width: LARG, height: 1.8, color: COR.vermelho });
    y = linhaVermelha - 18;
    topoConteudo = y;
  };
  const nova = () => {
    atual = { p: pdf.addPage([LARGURA, ALTURA]), textos: [], fotos: 0 };
    paginas.push(atual);
    cabecalho();
  };
  const caber = (altura: number) => { if (y - altura < BASE) nova(); };

  // ---------- Página 1: título, número, validade, cliente e consultor
  nova();
  escrever("PROPOSTA COMERCIAL", ESQ, y - 12, negrito, 17, COR.vermelho);
  direita(`Nº ${s.numero}`, DIR, y - 4, negrito, 10.5);
  direita(`Versão ${s.versao} · Emitida em ${dataLocal(s.geradaEm)}`, DIR, y - 17, normal, 8.4, COR.cinza);
  direita(`Válida até ${dataBR(s.condicoes.validade)}`, DIR, y - 29, negrito, 8.4, COR.vermelho);
  y -= 46;

  const c = s.cliente;
  const larguraCaixa = (LARG - 12) / 2;
  const blocoCliente: [string, PDFFont, number][] = ([
    [c.empresa, negrito, 9.6], [c.fantasia && c.fantasia !== c.empresa ? c.fantasia : "", normal, 8.6], [c.contato ? `A/C: ${c.contato}` : "", normal, 8.6],
    [documentoComRotulo(c.documento), normal, 8.6], [[c.cidade, c.uf].filter(Boolean).join("/"), normal, 8.6],
    [[c.email, c.telefone].filter(Boolean).join(" · "), normal, 8.6],
  ] as [string, PDFFont, number][]).filter(([t]) => t);
  // Layout 2: perfil comercial do dono (cargo e só os contatos marcados para exibir). Layout 1 (versões antigas): igual a antes.
  const consultor = s.consultor;
  const blocoConsultor: [string, PDFFont, number][] = ((s.layout === 2 ? [
    [consultor.nome, negrito, 9.6], [consultor.cargo ?? "", normal, 8.6], [consultor.email, normal, 8.6],
    [[consultor.whatsapp && `WhatsApp ${consultor.whatsapp}`, consultor.telefone && `Tel. ${consultor.telefone}`].filter(Boolean).join(" · "), normal, 8.6],
  ] : [
    [s.consultor.nome, negrito, 9.6], [s.consultor.email, normal, 8.6],
    [[s.emitente.whatsapp && `WhatsApp ${s.emitente.whatsapp}`, s.emitente.telefone].filter(Boolean).join(" · "), normal, 8.6],
  ]) as [string, PDFFont, number][]).filter(([t]) => t);
  const linhasDe = (bloco: [string, PDFFont, number][]) => bloco.flatMap(([t, f, tam]) => quebrar(t, f, tam, larguraCaixa - 20).map((l) => [l, f, tam] as const));
  const lc = linhasDe(blocoCliente); const lv = linhasDe(blocoConsultor);
  const alturaCaixa = 24 + Math.max(lc.length, lv.length) * 12 + 6;
  for (const [i, [titulo, linhas]] of ([["CLIENTE", lc], ["CONSULTOR(A)", lv]] as const).entries()) {
    const x = ESQ + i * (larguraCaixa + 12);
    atual.p.drawRectangle({ x, y: y - alturaCaixa, width: larguraCaixa, height: alturaCaixa, color: COR.fundo });
    escrever(titulo, x + 10, y - 14, negrito, 7.4, COR.vermelho);
    let yy = y - 27;
    for (const [t, f, tam] of linhas) { escrever(t, x + 10, yy, f, tam); yy -= 12; }
  }
  y -= alturaCaixa + 18;

  // ---------- Itens
  const cabecalhoTabela = () => {
    atual.p.drawRectangle({ x: ESQ, y: y - 18, width: LARG, height: 18, color: COR.fundo });
    escrever("PRODUTO", X["produto"]! + 4, y - 12, negrito, 7.4, COR.cinza);
    direita("QTD", X["qtd"]! + COL.qtd - 4, y - 12, negrito, 7.4, COR.cinza);
    direita("PREÇO UNIT.", X["preco"]! + COL.preco - 4, y - 12, negrito, 7.4, COR.cinza);
    direita("DESCONTO", X["desconto"]! + COL.desconto - 4, y - 12, negrito, 7.4, COR.cinza);
    direita("TOTAL", X["total"]! + COL.total - 4, y - 12, negrito, 7.4, COR.cinza);
    y -= 20;
  };
  caber(20 + 60);
  cabecalhoTabela();
  for (const item of s.itens) {
    const nome = quebrar(item.nome, negrito, 8.8, COL.produto - 10);
    const detalhes = [s.opcoes.mostrarSku && item.sku ? `SKU ${item.sku}` : "", item.prontaEntrega ? "Pronta entrega" : ""].filter(Boolean);
    const altura = Math.max(56, nome.length * 11 + detalhes.length * 10.5 + 16);
    if (y - altura < BASE) { nova(); cabecalhoTabela(); }
    const topo = y;
    const foto = item.foto ? await fotoDe(item.foto) : null;
    if (foto) {
      const d = foto.scaleToFit(46, 46);
      atual.p.drawImage(foto, { x: X["foto"]! + 3 + (46 - d.width) / 2, y: topo - 51 + (46 - d.height) / 2, width: d.width, height: d.height });
      atual.fotos += 1;
    } else {
      atual.p.drawRectangle({ x: X["foto"]! + 3, y: topo - 51, width: 46, height: 46, color: COR.fundo });
    }
    let yy = topo - 14;
    for (const linha of nome) { escrever(linha, X["produto"]! + 4, yy, negrito, 8.8); yy -= 11; }
    for (const d of detalhes) {
      if (d === "Pronta entrega") {
        atual.p.drawCircle({ x: X["produto"]! + 6.5, y: yy + 2.6, size: 2.1, color: COR.vermelho });
        escrever(d, X["produto"]! + 11, yy, negrito, 7.4, COR.vermelho);
      } else escrever(d, X["produto"]! + 4, yy, normal, 7.4, COR.cinza);
      yy -= 10.5;
    }
    direita(`${quantidadeBR(item.quantidade)} ${item.unidade}`, X["qtd"]! + COL.qtd - 4, topo - 14, normal, 8.8);
    direita(dinheiro(item.precoCentavos), X["preco"]! + COL.preco - 4, topo - 14, normal, 8.8);
    if (item.descontoCentavos > 0) {
      direita(`– ${dinheiro(item.descontoCentavos)}`, X["desconto"]! + COL.desconto - 4, topo - 14, normal, 8.8);
      if (item.descontoRotulo) direita(item.descontoRotulo, X["desconto"]! + COL.desconto - 4, topo - 25, normal, 7.2, COR.cinza);
    } else direita("–", X["desconto"]! + COL.desconto - 4, topo - 14, normal, 8.8, COR.cinza);
    direita(dinheiro(item.totalCentavos), X["total"]! + COL.total - 4, topo - 14, negrito, 8.8);
    y = topo - altura;
    atual.p.drawLine({ start: { x: ESQ, y }, end: { x: DIR, y }, thickness: 0.5, color: COR.linha });
  }
  y -= 14;

  // ---------- Fechamento: totais, condições, observações e assinatura ficam juntos na mesma página sempre que couberem
  // numa página (nada de assinatura ou condições sozinhas no alto da última folha).
  const t = s.totais;
  const linhasTotais: [string, string][] = [];
  if (t.descontoItensCentavos > 0) {
    linhasTotais.push(["Produtos", dinheiro(t.brutoCentavos)], ["Descontos nos itens", `– ${dinheiro(t.descontoItensCentavos)}`]);
  }
  linhasTotais.push(["Subtotal", dinheiro(t.subtotalCentavos)]);
  if (t.descontoGeralCentavos > 0) linhasTotais.push(["Desconto geral", `– ${dinheiro(t.descontoGeralCentavos)}`]);
  if (t.freteCentavos > 0) linhasTotais.push(["Frete", dinheiro(t.freteCentavos)]);
  if (t.montagemCentavos > 0) linhasTotais.push(["Montagem", dinheiro(t.montagemCentavos)]);
  const linhasRodape = s.emitente.rodape ? quebrar(s.emitente.rodape, normal, 7.8, LARG) : [];
  const linhasPagamento = [s.emitente.dadosBancarios ? `Dados bancários: ${s.emitente.dadosBancarios}` : "", s.emitente.pix ? `PIX: ${s.emitente.pix}` : ""].filter(Boolean).flatMap((v) => quebrar(v, normal, 8.2, LARG));
  const linhasObservacoes = s.observacoes ? quebrar(s.observacoes, normal, 8.8, LARG) : [];
  const linhasAssinatura = s.layout === 2 && s.consultor.assinatura ? quebrar(s.consultor.assinatura, normal, 8, LARG) : [];
  const alturaFechamento = (linhasTotais.length * 15 + 46) + (24 + 3 * 13 + (linhasRodape.length ? 3 + linhasRodape.length * 10.5 : 0))
    + linhasPagamento.length * 12.5 + (linhasObservacoes.length ? 8 + 24 + linhasObservacoes.length * 12.5 : 0) + (14 + 52 + linhasAssinatura.length * 10.5);
  if (y - alturaFechamento < BASE && topoConteudo - alturaFechamento >= BASE) nova();
  caber(linhasTotais.length * 15 + 34);
  const xTotais = DIR - 232;
  for (const [rotulo, valor] of linhasTotais) {
    escrever(rotulo, xTotais + 8, y - 10, normal, 8.8, COR.cinza);
    direita(valor, DIR - 8, y - 10, normal, 8.8);
    y -= 15;
  }
  y -= 4;
  atual.p.drawRectangle({ x: xTotais, y: y - 24, width: DIR - xTotais, height: 24, color: COR.vermelho });
  escrever("TOTAL DA PROPOSTA", xTotais + 8, y - 15.5, negrito, 9.2, COR.branco);
  direita(dinheiro(t.totalCentavos), DIR - 8, y - 16, negrito, 12, COR.branco);
  y -= 42;

  // ---------- Condições, observações e assinatura
  const secao = (titulo: string) => { caber(40); escrever(titulo, ESQ, y - 10, negrito, 8, COR.vermelho); y -= 24; };
  const linhaRotulo = (rotulo: string, valor: string) => {
    caber(14);
    const w = escrever(`${rotulo}: `, ESQ, y, negrito, 8.8);
    escrever(valor, ESQ + w, y, normal, 8.8);
    y -= 13;
  };
  secao("CONDIÇÕES");
  linhaRotulo("Condição de pagamento", s.condicoes.pagamento || "a combinar");
  linhaRotulo("Previsão de faturamento", dataBR(s.condicoes.previsao) || "a combinar");
  linhaRotulo("Validade da proposta", `até ${dataBR(s.condicoes.validade)}`);
  for (const linha of linhasPagamento) { caber(13); escrever(linha, ESQ, y, normal, 8.2); y -= 12.5; }
  if (linhasRodape.length) {
    y -= 3;
    for (const l of linhasRodape) { caber(11); escrever(l, ESQ, y, normal, 7.8, COR.cinza); y -= 10.5; }
  }
  if (linhasObservacoes.length) {
    y -= 8;
    secao("OBSERVAÇÕES");
    for (const l of linhasObservacoes) { caber(13); escrever(l, ESQ, y, normal, 8.8); y -= 12.5; }
  }
  y -= 14;
  caber(52 + linhasAssinatura.length * 10.5);
  escrever("Atenciosamente,", ESQ, y, normal, 8.8);
  escrever(s.consultor.nome, ESQ, y - 16, negrito, 9.6);
  escrever(`${s.layout === 2 ? s.consultor.cargo || "Consultor(a) comercial" : "Consultor(a) comercial"} · ${s.emitente.nomeComercial}`, ESQ, y - 28, normal, 8, COR.cinza);
  linhasAssinatura.forEach((linha, i) => escrever(linha, ESQ, y - 40 - i * 10.5, normal, 8, COR.cinza));

  // ---------- Rodapé com paginação (depois de saber o total de páginas)
  paginas.forEach((pagina, i) => {
    atual = pagina;
    const { p } = pagina;
    p.drawLine({ start: { x: ESQ, y: 34 }, end: { x: DIR, y: 34 }, thickness: 0.6, color: COR.linha });
    escrever([s.emitente.nomeComercial, s.emitente.site].filter(Boolean).join(" · "), ESQ, 22, normal, 7.4, COR.cinza);
    direita(`Proposta ${s.numero} · v${s.versao} · Página ${i + 1} de ${paginas.length}`, DIR, 22, normal, 7.4, COR.cinza);
  });
  return { bytes: await pdf.save(), paginas: paginas.map(({ textos, fotos }) => ({ textos, fotos })) };
}
