/**
 * Orçamento interno — regras PURAS (sem banco e sem rede): dinheiro em centavos, totais, estados e o Pedido de Venda
 * que vai ao Omie. A mesma função monta/valida o pedido no painel (prévia), no servidor (valor oficial) e no serviço
 * omie-pedidos (segunda conferência antes de escrever no Omie). Sem imports: roda no navegador, no Node e nos testes.
 */
export const ESTADOS = ["rascunho", "salvo", "enviado", "aceito", "enviado_omie", "erro_omie", "cancelado"] as const;
export type Estado = (typeof ESTADOS)[number];
export const ROTULO_ESTADO: Record<Estado, string> = {
  rascunho: "Rascunho", salvo: "Salvo", enviado: "Enviado ao cliente", aceito: "Aceito pelo cliente",
  enviado_omie: "Pedido no Omie", erro_omie: "Erro no Omie", cancelado: "Cancelado",
};

export type Acao = "salvar" | "enviar" | "aceitar" | "reabrir" | "cancelar";
const TRANSICOES: Record<Acao, { de: readonly Estado[]; para: Estado }> = {
  salvar: { de: ["rascunho"], para: "salvo" },
  enviar: { de: ["salvo"], para: "enviado" },
  aceitar: { de: ["salvo", "enviado"], para: "aceito" },
  // Só antes de existir pedido no Omie (o servidor confere também a tentativa de envio).
  reabrir: { de: ["aceito", "erro_omie"], para: "salvo" },
  cancelar: { de: ["rascunho", "salvo", "enviado", "aceito", "erro_omie"], para: "cancelado" },
};
export function proximoEstado(atual: Estado, acao: Acao): Estado | null {
  const regra = TRANSICOES[acao];
  return regra.de.includes(atual) ? regra.para : null;
}
/** Itens, preços e condições só mudam antes do aceite: o pedido usa exatamente o que o cliente aceitou. */
export const editavel = (estado: Estado) => estado === "rascunho" || estado === "salvo" || estado === "enviado";
/** "Gerar Pedido no Omie" só existe para orçamento aceito (ou que deu erro no envio). */
export const podeGerarPedido = (estado: Estado) => estado === "aceito" || estado === "erro_omie";

export const NUMERO_ORCAMENTO = /^MAG-Q-\d{4}-\d{5}$/;
export const numeroOrcamento = (ano: number, sequencia: number) => `MAG-Q-${ano}-${String(sequencia).padStart(5, "0")}`;

// ---------- Dinheiro e quantidades ----------
/** "1.234,56", "1234,56", "1234.56" ou número → centavos inteiros; null se inválido ou negativo. */
export function centavos(valor: string | number): number | null {
  let texto = typeof valor === "number" ? String(valor) : String(valor ?? "").trim().replace(/^R\$\s*/i, "");
  if (typeof valor !== "number") {
    if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const numero = Math.round(Number(texto) * 100);
  return Number.isSafeInteger(numero) && numero <= 100_000_000_00 ? numero : null;
}
/** Quantidade com até 3 casas ("2", "1,5", "1.500" = mil e quinhentos); entre 0,001 e 100.000. */
export function quantidade(valor: string | number): number | null {
  let texto = typeof valor === "number" ? String(valor) : String(valor ?? "").trim();
  if (typeof valor !== "number") {
    if (texto.includes(",")) texto = texto.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) texto = texto.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,3})?$/.test(texto)) return null;
  const numero = Math.round(Number(texto) * 1000) / 1000;
  return numero > 0 && numero <= 100_000 ? numero : null;
}
/** Percentual de desconto 0–100 com até 2 casas. */
export function percentual(valor: string | number): number | null {
  const texto = typeof valor === "number" ? String(valor) : String(valor ?? "").trim().replace(",", ".").replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const numero = Number(texto);
  return numero >= 0 && numero <= 100 ? numero : null;
}
export const reais = (valorCentavos: number) => (valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const decimal = (valorCentavos: number) => Math.round(valorCentavos) / 100;

// ---------- Itens e totais ----------
export type DescontoTipo = "percentual" | "valor";
export type ItemEntrada = {
  quantidade: number; precoCentavos: number;
  /** percentual: 0–100; valor: centavos sobre o item inteiro (não por unidade). */
  descontoTipo: DescontoTipo | null; descontoValor: number;
};
export type ItemCalculado = { brutoCentavos: number; descontoCentavos: number; totalCentavos: number; precoAplicadoCentavos: number };

/** Bruto = quantidade × preço; desconto vira SEMPRE valor em centavos (é o que vai ao Omie, sem arredondamento divergente). */
export function calcularItem(item: ItemEntrada): ItemCalculado {
  const bruto = Math.round(item.quantidade * item.precoCentavos);
  let desconto = 0;
  if (item.descontoTipo === "percentual") desconto = Math.round((bruto * item.descontoValor) / 100);
  else if (item.descontoTipo === "valor") desconto = Math.round(item.descontoValor);
  desconto = Math.min(Math.max(desconto, 0), bruto);
  const total = bruto - desconto;
  return { brutoCentavos: bruto, descontoCentavos: desconto, totalCentavos: total, precoAplicadoCentavos: item.quantidade > 0 ? Math.round(total / item.quantidade) : 0 };
}
export function calcularTotais(itens: ItemCalculado[]) {
  return itens.reduce((soma, item) => ({
    brutoCentavos: soma.brutoCentavos + item.brutoCentavos, descontoCentavos: soma.descontoCentavos + item.descontoCentavos,
    totalCentavos: soma.totalCentavos + item.totalCentavos,
  }), { brutoCentavos: 0, descontoCentavos: 0, totalCentavos: 0 });
}

// ---------- Datas (Fortaleza, UTC−3, sem horário de verão) ----------
export const hojeFortaleza = (agora = Date.now()) => new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const dataOmie = (dia: string) => { const m = DIA.exec(dia); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

// ---------- Documento do cliente ----------
export const digitos = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");
/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos. */
export function documentoValido(valor: string) {
  const d = digitos(valor);
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (base: string, pesos: number[]) => {
    const resto = base.split("").reduce((soma, n, i) => soma + Number(n) * pesos[i]!, 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  if (d.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2]; const p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(d.slice(0, 9), p1) === Number(d[9]) && dv(d.slice(0, 10), p2) === Number(d[10]);
  }
  const q1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const q2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(d.slice(0, 12), q1) === Number(d[12]) && dv(d.slice(0, 13), q2) === Number(d[13]);
}
/** Formato do Omie: 00.000.000/0000-00 ou 000.000.000-00. */
export function documentoFormatado(valor: string) {
  const d = digitos(valor);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}
/** Para tela e log: só os 2 primeiros e os 2 últimos dígitos. */
export const documentoMascarado = (valor: string) => { const d = digitos(valor); return d.length >= 8 ? `${d.slice(0, 2)}…${d.slice(-2)}` : "—"; };
/** E-mails só mascarados na tela (ex.: c•••@c•••.com.br); lista separada por vírgula ou ponto e vírgula. */
export function mascararEmails(lista: string | null | undefined): string {
  return String(lista ?? "").split(/[,;]/).map((e) => e.trim().toLowerCase()).filter(Boolean).map((e) => {
    const [local = "", dominio = ""] = e.split("@");
    const [nome = "", ...resto] = dominio.split(".");
    return `${local.slice(0, 1)}•••@${nome.slice(0, 1)}•••${resto.length ? `.${resto.join(".")}` : ""}`;
  }).join(", ");
}

// ---------- Conta corrente da venda (escolhida em cada orçamento; NÃO há conta padrão) ----------
export const REGRA_CONTA = "Sugestão MAG: vendas maiores, cliente com CNPJ ou pagamento por depósito → Bradesco; vendas menores → Stone. A sugestão não substitui a escolha de quem faz a venda.";
/**
 * Dica de conta para o orçamento — NUNCA escolhe sozinha (a pessoa confirma selecionando). Sem limite de valor definido pela
 * MAG para "venda maior", a dica automática usa só o que é inequívoco: cliente com CNPJ ou condição de pagamento por depósito
 * → a (única) conta Bradesco. Nos outros casos vale o texto de REGRA_CONTA.
 */
export function sugestaoDeConta(d: { documento: string; condicao: string }, contas: { codigo: string; descricao: string }[]) {
  const bradesco = contas.filter((c) => /bradesco/i.test(c.descricao));
  const motivos = [...(digitos(d.documento).length === 14 ? ["cliente com CNPJ"] : []), ...(/dep[oó]sito/i.test(d.condicao) ? ["pagamento por depósito"] : [])];
  return motivos.length && bradesco.length === 1 ? { codigo: bradesco[0]!.codigo, descricao: bradesco[0]!.descricao, motivo: motivos.join(" e ") } : null;
}
/** Bradesco e Stone (as contas de venda da MAG) primeiro; as demais contas ativas do Omie depois. */
export function contasDaVenda<T extends { descricao: string }>(contas: T[]) {
  const deVenda = (c: T) => /bradesco|stone/i.test(c.descricao);
  return { principais: contas.filter(deVenda), outras: contas.filter((c) => !deVenda(c)) };
}

// ---------- Pedido de Venda do Omie (produtos/pedido IncluirPedido) ----------
/** Etapas aceitas na inclusão. "50" = Faturar: NUNCA (o painel não fatura). */
export const ETAPAS_PERMITIDAS = ["10", "20", "30", "40"] as const;
/** "Tipo de Frete" do Omie (códigos da NF-e): 0 CIF (remetente), 1 FOB (destinatário), 2 terceiros, 3 transporte próprio do
 * remetente, 4 transporte próprio do destinatário, 9 sem frete. */
export const MODALIDADES_FRETE = ["0", "1", "2", "3", "4", "9"] as const;
export type ModalidadeFrete = (typeof MODALIDADES_FRETE)[number];
/**
 * Desconto geral e frete da proposta no Pedido do Omie — suporte PREPARADO (montagem, validação, conferência com a versão
 * aceita e leitura de volta), mas DESLIGADO até a MAG decidir: desconto geral → desconto na capa do pedido
 * (`tipo_desconto_pedido` "V" + `valor_desconto_pedido`, que o Omie distribui proporcionalmente nos itens); frete → bloco
 * `frete` do Omie (`modalidade` + `valor_frete`; falta a MAG definir a modalidade). Montagem NÃO tem suporte: depende de
 * regra fiscal/contábil da MAG (produto × serviço) e sempre bloqueia. Ligar = mudar AQUI (vale para o painel e para o
 * serviço omie-pedidos, que recusa os dois enquanto desligados) + testes + homologação (totais lidos de volta) + release.
 */
export type PoliticaExtras = { descontoPedido: boolean; frete: boolean; modalidadeFrete: ModalidadeFrete | null };
export const EXTRAS_NO_PEDIDO: Readonly<PoliticaExtras> = Object.freeze({ descontoPedido: false, frete: false, modalidadeFrete: null });
export type DadosPedido = {
  numero: string; codigoClienteOmie: string; dataPrevisao: string; etapa: string; codigoParcela: string;
  categoria: string; contaCorrente: string; codVend: string; consumidorFinal: boolean; emailsNf: string; observacoes: string;
  itens: { codigoProdutoOmie: string; quantidade: number; precoCentavos: number; descontoCentavos: number }[];
  /** Só com EXTRAS_NO_PEDIDO ligado (hoje desligado): desconto geral → desconto na capa do pedido. */
  descontoPedidoCentavos?: number;
  /** Só com EXTRAS_NO_PEDIDO ligado (hoje desligado): frete → bloco `frete` do Omie. */
  frete?: { modalidade: string; valorCentavos: number };
};
const inteiroPositivo = (valor: string) => /^\d{1,18}$/.test(valor) && Number(valor) > 0 && Number.isSafeInteger(Number(valor));

/** Monta o corpo do IncluirPedido só com campos conhecidos (lista branca). Sem desconto geral/frete: nenhum campo a mais. */
export function montarPedidoOmie(d: DadosPedido) {
  return {
    cabecalho: {
      codigo_pedido_integracao: d.numero, codigo_cliente: Number(d.codigoClienteOmie), data_previsao: dataOmie(d.dataPrevisao),
      etapa: d.etapa, codigo_parcela: d.codigoParcela, quantidade_itens: d.itens.length,
      ...(d.descontoPedidoCentavos ? { tipo_desconto_pedido: "V", valor_desconto_pedido: decimal(d.descontoPedidoCentavos) } : {}),
    },
    det: d.itens.map((item, indice) => ({
      ide: { codigo_item_integracao: String(indice + 1) },
      produto: {
        codigo_produto: Number(item.codigoProdutoOmie), quantidade: item.quantidade, valor_unitario: decimal(item.precoCentavos),
        tipo_desconto: "V", valor_desconto: decimal(item.descontoCentavos),
        // O painel nunca reserva estoque (campo do item "(S/N) Indica se o estoque do produto será reservado").
        reservado: "N",
      },
    })),
    ...(d.frete ? { frete: { modalidade: d.frete.modalidade, valor_frete: decimal(d.frete.valorCentavos) } } : {}),
    informacoes_adicionais: {
      codigo_categoria: d.categoria, codigo_conta_corrente: Number(d.contaCorrente), consumidor_final: d.consumidorFinal ? "S" : "N",
      // Só enviar_email: a documentação do Omie permite preencher apenas UMA das tags enviar_email/enviar_pix; o padrão
      // das duas é "N" (a leitura de volta confere que o Omie gravou enviar_pix = "N").
      codVend: Number(d.codVend), enviar_email: "N", utilizar_emails: d.emailsNf,
    },
    observacoes: { obs_venda: d.observacoes },
  };
}
export type PedidoOmie = ReturnType<typeof montarPedidoOmie>;

/** Problemas que impedem o envio (lista vazia = pode enviar). Usada no painel e de novo no serviço omie-pedidos. */
export function validarPedidoOmie(p: PedidoOmie, hoje = hojeFortaleza(), politica: Readonly<PoliticaExtras> = EXTRAS_NO_PEDIDO): string[] {
  const erros: string[] = [];
  const c = p?.cabecalho; const info = p?.informacoes_adicionais;
  if (!c || !info || !Array.isArray(p?.det)) return ["estrutura do pedido inválida"];
  if (!NUMERO_ORCAMENTO.test(String(c.codigo_pedido_integracao))) erros.push("código de integração inválido");
  if (!inteiroPositivo(String(c.codigo_cliente))) erros.push("cliente do Omie não informado");
  const prev = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(c.data_previsao));
  if (!prev) erros.push("previsão de faturamento inválida");
  else if (`${prev[3]}-${prev[2]}-${prev[1]}` < hoje) erros.push("previsão de faturamento anterior a hoje");
  if (!(ETAPAS_PERMITIDAS as readonly string[]).includes(String(c.etapa))) erros.push("etapa não permitida (o painel nunca usa a etapa de faturamento)");
  if (!/^[0-9A-Z]{3}$/.test(String(c.codigo_parcela)) || c.codigo_parcela === "999") erros.push("condição de pagamento inválida");
  if (p.det.length < 1 || p.det.length > 199) erros.push("o pedido precisa ter de 1 a 199 itens");
  if (c.quantidade_itens !== p.det.length) erros.push("quantidade de itens não confere");
  p.det.forEach((linha, i) => {
    const prod = linha?.produto;
    if (linha?.ide?.codigo_item_integracao !== String(i + 1)) erros.push(`item ${i + 1}: identificação inválida`);
    if (!prod || !inteiroPositivo(String(prod.codigo_produto))) { erros.push(`item ${i + 1}: produto do Omie inválido`); return; }
    if (!(prod.quantidade > 0 && prod.quantidade <= 100_000)) erros.push(`item ${i + 1}: quantidade inválida`);
    if (!(prod.valor_unitario >= 0 && prod.valor_unitario <= 100_000_000)) erros.push(`item ${i + 1}: preço inválido`);
    if (prod.tipo_desconto !== "V" || !(prod.valor_desconto >= 0) || prod.valor_desconto > Math.round(prod.quantidade * prod.valor_unitario * 100) / 100) {
      erros.push(`item ${i + 1}: desconto inválido`);
    }
    if (prod.reservado !== "N") erros.push(`item ${i + 1}: o painel nunca reserva estoque`);
  });
  if (!/^\d+(\.\d+)*$/.test(String(info.codigo_categoria))) erros.push("categoria do Omie não configurada");
  if (!inteiroPositivo(String(info.codigo_conta_corrente))) erros.push("conta corrente do Omie não configurada");
  if (!inteiroPositivo(String(info.codVend))) erros.push("vendedor do Omie não informado");
  if (info.consumidor_final !== "S" && info.consumidor_final !== "N") erros.push("consumidor final não informado");
  if (info.enviar_email !== "N") erros.push("o painel não pede envio de e-mail pelo Omie");
  if (!String(info.utilizar_emails ?? "").trim()) erros.push("e-mail para a nota fiscal obrigatório (o Omie exige)");
  if (String(info.utilizar_emails).length > 500 || (info.utilizar_emails && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(,[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(info.utilizar_emails))) {
    erros.push("e-mail para a nota inválido");
  }
  if (String(p.observacoes?.obs_venda ?? "").length > 2000) erros.push("observações longas demais (máx. 2.000)");
  // Desconto na capa e frete: enquanto desligados (EXTRAS_NO_PEDIDO), o pedido que os trouxer é RECUSADO (nunca descartado).
  const capa = c as Record<string, unknown>;
  if (capa["tipo_desconto_pedido"] !== undefined || capa["valor_desconto_pedido"] !== undefined || capa["perc_desconto_pedido"] !== undefined) {
    const itens = p.det.reduce((s, d) => s + Math.round(Number(d?.produto?.quantidade) * Math.round(Number(d?.produto?.valor_unitario) * 100))
      - Math.round(Number(d?.produto?.valor_desconto) * 100), 0);
    const valor = Math.round(Number(capa["valor_desconto_pedido"]) * 100);
    if (!politica.descontoPedido) erros.push("desconto geral no pedido ainda não habilitado (regra da MAG pendente)");
    else if (capa["tipo_desconto_pedido"] !== "V" || capa["perc_desconto_pedido"] !== undefined || !(valor > 0 && valor <= itens)) erros.push("desconto do pedido inválido");
  }
  const frete = (p as Record<string, unknown>)["frete"];
  if (frete !== undefined) {
    const f = (frete && typeof frete === "object" ? frete : {}) as Record<string, unknown>;
    if (!politica.frete) erros.push("frete no pedido ainda não habilitado (falta a MAG definir a modalidade)");
    else if (!(MODALIDADES_FRETE as readonly string[]).includes(String(f["modalidade"])) || !(Number(f["valor_frete"]) >= 0 && Number(f["valor_frete"]) <= 100_000_000)) {
      erros.push("frete inválido");
    }
  }
  return erros;
}

// ---------- Desconto geral, frete e montagem da versão aceita ----------
export type ExtrasAceitos = { descontoGeralCentavos: number; freteCentavos: number; montagemCentavos: number };
/** O que vai ao Pedido além dos itens: só o que a política liga (hoje nada — o pedido sai igual ao de antes). */
export function extrasDoPedido(t: ExtrasAceitos, politica: Readonly<PoliticaExtras> = EXTRAS_NO_PEDIDO): Pick<DadosPedido, "descontoPedidoCentavos" | "frete"> {
  return {
    ...(politica.descontoPedido && t.descontoGeralCentavos > 0 ? { descontoPedidoCentavos: t.descontoGeralCentavos } : {}),
    ...(politica.frete && politica.modalidadeFrete && t.freteCentavos > 0 ? { frete: { modalidade: politica.modalidadeFrete, valorCentavos: t.freteCentavos } } : {}),
  };
}
/** Por que a versão aceita não vira Pedido por causa de desconto geral, frete ou montagem (vazio = pode). */
export function bloqueiosDeExtras(t: ExtrasAceitos, politica: Readonly<PoliticaExtras> = EXTRAS_NO_PEDIDO): string[] {
  const saida = "lance o pedido direto no Omie, ou use \"Criar nova revisão\" sem esse valor e registre novo aceite";
  const bloqueios: string[] = [];
  if (t.descontoGeralCentavos > 0 && !politica.descontoPedido) {
    bloqueios.push(`Desconto geral (${reais(t.descontoGeralCentavos)}): o suporte está preparado (vira o desconto na capa do Pedido, que o Omie distribui nos itens), mas ainda NÃO foi habilitado — ${saida}.`);
  }
  if (t.freteCentavos > 0 && !(politica.frete && politica.modalidadeFrete)) {
    bloqueios.push(`Frete (${reais(t.freteCentavos)}): o suporte está preparado (bloco de frete do Omie), mas ainda NÃO foi habilitado — falta a MAG definir a modalidade do frete; ${saida}.`);
  }
  if (t.montagemCentavos > 0) {
    bloqueios.push(`Montagem (${reais(t.montagemCentavos)}): não vai ao Pedido no Omie até a MAG definir a regra fiscal/contábil (produto ou serviço) — ${saida}.`);
  }
  return bloqueios;
}

// ---------- Conferência explícita ANTES de enviar: versão aceita × pedido montado para o Omie ----------
/** A versão aceita no formato da conferência (o retrato da proposta serve direto). */
export type VersaoParaConferir = {
  itens: { produtoId: string; sku: string; nome?: string; quantidade: number; precoCentavos: number; descontoCentavos: number; totalCentavos: number }[];
  totais: ExtrasAceitos & { totalCentavos: number };
  condicoes: { pagamentoCodigo?: string | null; previsao: string | null };
};
/** Valores de um item; do lado do Omie, null = campo ausente ou inválido no pedido. */
export type ValoresItem = { produtoId: string; quantidade: number | null; precoCentavos: number | null; descontoCentavos: number | null; totalCentavos: number | null };
export type ConferenciaAceita = {
  confere: boolean;
  /** `skuOmie`: o SKU que o Omie informou agora para o código do produto (null = não conferido no Omie). */
  itens: { item: number; sku: string; nome: string; skuOmie: string | null; aceito: ValoresItem | null; omie: ValoresItem | null; diferencas: string[] }[];
  gerais: { campo: string; aceito: string; omie: string; confere: boolean }[];
  totalAceitoCentavos: number; totalOmieCentavos: number; diferencaCentavos: number;
  divergencias: string[];
};
const emCentavosOuNulo = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const qtdTexto = (q: number | null) => (q === null ? "—" : q.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const valorTexto = (v: number | null) => (v === null ? "—" : reais(v));

/**
 * O pedido que vai ao Omie confere com a versão que o cliente aceitou? Item a item (código do produto e SKU, quantidade,
 * preço, desconto e total), condição, previsão, desconto geral, frete, montagem e total. Qualquer diferença = não confere
 * (bloqueia na revisão e de novo na criação). `skusOmie`: SKU que o Omie informou agora por código de produto (consulta
 * de estoque da revisão); sem ele o SKU fica "não conferido no Omie", mas o código do produto é sempre conferido.
 */
export function conferirAceitaComPedido(v: VersaoParaConferir, p: PedidoOmie, skusOmie: Record<string, string | null> = {}): ConferenciaAceita {
  const divergencias: string[] = [];
  const det = Array.isArray(p?.det) ? p.det : [];
  const itens: ConferenciaAceita["itens"] = [];
  for (let i = 0; i < Math.max(v.itens.length, det.length); i += 1) {
    const a = v.itens[i];
    const d = det[i]?.produto;
    const aceito: ValoresItem | null = a ? { produtoId: a.produtoId, quantidade: a.quantidade, precoCentavos: a.precoCentavos, descontoCentavos: a.descontoCentavos, totalCentavos: a.totalCentavos } : null;
    let omie: ValoresItem | null = null;
    if (d) {
      const quantidade = Number.isFinite(Number(d.quantidade)) ? Number(d.quantidade) : null;
      const preco = emCentavosOuNulo(d.valor_unitario);
      const desconto = emCentavosOuNulo(d.valor_desconto);
      omie = { produtoId: String(d.codigo_produto ?? ""), quantidade, precoCentavos: preco, descontoCentavos: desconto,
        totalCentavos: quantidade === null || preco === null || desconto === null ? null : Math.round(quantidade * preco) - desconto };
    }
    const sku = a?.sku ?? "";
    const skuOmie = omie ? (skusOmie[omie.produtoId] ?? null) : null;
    const diferencas: string[] = [];
    const rotulo = `item ${i + 1}${sku ? ` (SKU ${sku})` : ""}`;
    const comparar = (campo: string, igual: boolean, x: string, y: string) => {
      if (!igual) { diferencas.push(campo); divergencias.push(`${rotulo}: ${campo} — aceito ${x}, Omie ${y}`); }
    };
    if (!aceito) { diferencas.push("item"); divergencias.push(`${rotulo}: está no Pedido e não na proposta aceita`); }
    else if (!omie) { diferencas.push("item"); divergencias.push(`${rotulo}: está na proposta aceita e não no Pedido`); }
    else {
      comparar("produto", aceito.produtoId === omie.produtoId, `código ${aceito.produtoId}`, `código ${omie.produtoId}`);
      if (skuOmie !== null) comparar("SKU", sku.trim() === skuOmie.trim(), sku, skuOmie);
      comparar("quantidade", omie.quantidade !== null && Math.round(omie.quantidade * 1000) === Math.round(Number(aceito.quantidade) * 1000), qtdTexto(aceito.quantidade), qtdTexto(omie.quantidade));
      comparar("preço", omie.precoCentavos === aceito.precoCentavos, valorTexto(aceito.precoCentavos), valorTexto(omie.precoCentavos));
      comparar("desconto", omie.descontoCentavos === aceito.descontoCentavos && d?.tipo_desconto === "V", valorTexto(aceito.descontoCentavos),
        d?.tipo_desconto === "V" ? valorTexto(omie.descontoCentavos) : `tipo "${String(d?.tipo_desconto ?? "")}"`);
      comparar("total", omie.totalCentavos === aceito.totalCentavos, valorTexto(aceito.totalCentavos), valorTexto(omie.totalCentavos));
    }
    itens.push({ item: i + 1, sku, nome: a?.nome ?? "", skuOmie, aceito, omie, diferencas });
  }
  const gerais: ConferenciaAceita["gerais"] = [];
  const geral = (campo: string, aceito: string, omie: string) => {
    gerais.push({ campo, aceito, omie, confere: aceito === omie });
    if (aceito !== omie) divergencias.push(`${campo}: aceito ${aceito}, Omie ${omie}`);
  };
  const cab = (p?.cabecalho ?? {}) as Record<string, unknown>;
  geral("Condição de pagamento", String(v.condicoes.pagamentoCodigo || "—"), String(cab["codigo_parcela"] || "—"));
  geral("Previsão de faturamento", v.condicoes.previsao ? dataOmie(v.condicoes.previsao) : "—", String(cab["data_previsao"] || "—"));
  const temDescontoPedido = cab["tipo_desconto_pedido"] !== undefined || cab["valor_desconto_pedido"] !== undefined || cab["perc_desconto_pedido"] !== undefined;
  const descontoPedido = !temDescontoPedido ? 0 : cab["tipo_desconto_pedido"] === "V" && cab["perc_desconto_pedido"] === undefined ? emCentavosOuNulo(cab["valor_desconto_pedido"]) : null;
  const freteBloco = (p as Record<string, unknown> | null)?.["frete"] as Record<string, unknown> | undefined;
  const frete = freteBloco === undefined ? 0 : emCentavosOuNulo(freteBloco?.["valor_frete"]);
  // Sempre à vista (inclusive R$ 0,00 ✓): o que o cliente aceitou fora dos itens também precisa bater com o Pedido.
  geral("Desconto geral", reais(v.totais.descontoGeralCentavos), valorTexto(descontoPedido));
  geral("Frete", reais(v.totais.freteCentavos), valorTexto(frete));
  geral("Montagem", reais(v.totais.montagemCentavos), v.totais.montagemCentavos ? "não vai ao Omie" : reais(0));
  const totalOmie = itens.reduce((s, l) => s + (l.omie?.totalCentavos ?? 0), 0) - (descontoPedido ?? 0) + (frete ?? 0);
  const diferenca = totalOmie - v.totais.totalCentavos;
  if (diferenca !== 0) divergencias.push(`total: aceito ${reais(v.totais.totalCentavos)}, Omie ${reais(totalOmie)} (diferença ${reais(diferenca)})`);
  return { confere: divergencias.length === 0, itens, gerais, totalAceitoCentavos: v.totais.totalCentavos, totalOmieCentavos: totalOmie, diferencaCentavos: diferenca, divergencias };
}

/** Cliente e itens (produto + quantidade) de um pedido: o que identifica "este orçamento" num pedido achado no Omie. */
export type ResumoPedido = { codigoCliente: string; itens: { produto: string; quantidade: number }[] };
export const resumoDoPedido = (p: PedidoOmie): ResumoPedido => ({
  codigoCliente: String(p.cabecalho.codigo_cliente), itens: p.det.map((d) => ({ produto: String(d.produto.codigo_produto), quantidade: Number(d.produto.quantidade) })),
});

/**
 * O pedido achado no Omie com o NOSSO código de integração é mesmo este orçamento? Mesmo cliente e mesmos itens. Se o
 * número se repetir (ex.: banco restaurado de um backup antigo), o orçamento nunca é ligado ao pedido de outro cliente.
 */
export function pedidoConfere(esperado: ResumoPedido, achado: ResumoPedido): boolean {
  if (!achado.codigoCliente || achado.codigoCliente !== esperado.codigoCliente) return false;
  const chave = (itens: ResumoPedido["itens"]) => itens.map((i) => `${i.produto}:${Math.round(i.quantidade * 1000)}`).sort().join("|");
  return achado.itens.length === 0 || chave(achado.itens) === chave(esperado.itens);
}

/** Leitura de volta logo depois de incluir (ConsultarPedido): o que o Omie gravou, campo a campo, contra o revisado. */
export type ConferenciaPedido = {
  confere: boolean;
  divergencias: string[];
  lido: {
    cliente: string; vendedor: string; etapa: string; condicao: string; categoria: string; conta: string; enviarEmail: string; enviarPix: string;
    itens: { produto: string; quantidade: number; valorUnitario: number; valorDesconto: number; reservado: string }[];
    valorMercadorias: number | null; valorTotal: number | null;
  };
  esperado: { valorMercadorias: number; valorTotal: number };
};
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const textoDe = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const numeroDe = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const emCentavos = (v: number) => Math.round(v * 100);

export function conferirPedidoLido(p: PedidoOmie, corpo: unknown): ConferenciaPedido {
  const pv = objeto(objeto(corpo)["pedido_venda_produto"] ?? corpo);
  const cab = objeto(pv["cabecalho"]); const info = objeto(pv["informacoes_adicionais"]); const tot = objeto(pv["total_pedido"]);
  const det = (Array.isArray(pv["det"]) ? (pv["det"] as unknown[]) : []).map(objeto);
  const itens = det.map((d) => {
    const prod = objeto(d["produto"]);
    return { ide: textoDe(objeto(d["ide"])["codigo_item_integracao"]), produto: textoDe(prod["codigo_produto"]), quantidade: numeroDe(prod["quantidade"]) ?? 0,
      valorUnitario: numeroDe(prod["valor_unitario"]) ?? 0, valorDesconto: numeroDe(prod["valor_desconto"]) ?? 0, reservado: textoDe(prod["reservado"]).toUpperCase() };
  });
  const lido = {
    cliente: textoDe(cab["codigo_cliente"]), vendedor: textoDe(info["codVend"]), etapa: textoDe(cab["etapa"]), condicao: textoDe(cab["codigo_parcela"]),
    categoria: textoDe(info["codigo_categoria"]), conta: textoDe(info["codigo_conta_corrente"]), enviarEmail: textoDe(info["enviar_email"]).toUpperCase(),
    enviarPix: textoDe(info["enviar_pix"]).toUpperCase(),
    itens: itens.map(({ produto, quantidade, valorUnitario, valorDesconto, reservado }) => ({ produto, quantidade, valorUnitario, valorDesconto, reservado })),
    valorMercadorias: numeroDe(tot["valor_mercadorias"]), valorTotal: numeroDe(tot["valor_total_pedido"]),
  };
  const divergencias: string[] = [];
  const igual = (nome: string, esperado: unknown, achado: string) => { if (textoDe(esperado) !== achado) divergencias.push(nome); };
  igual("cliente", p.cabecalho.codigo_cliente, lido.cliente);
  igual("vendedor", p.informacoes_adicionais.codVend, lido.vendedor);
  igual("etapa", p.cabecalho.etapa, lido.etapa);
  igual("condição de pagamento", p.cabecalho.codigo_parcela, lido.condicao);
  igual("categoria", p.informacoes_adicionais.codigo_categoria, lido.categoria);
  igual("conta corrente", p.informacoes_adicionais.codigo_conta_corrente, lido.conta);
  if (lido.enviarEmail && lido.enviarEmail !== "N") divergencias.push("envio de e-mail");
  if (lido.enviarPix && lido.enviarPix !== "N") divergencias.push("envio de PIX");
  if (itens.length !== p.det.length) divergencias.push("quantidade de itens");
  // Desconto na capa e frete (preparados, desligados — EXTRAS_NO_PEDIDO): o Omie distribui o desconto da capa nos itens, então
  // confere a SOMA dos descontos, não item a item; o frete entra no total. A confirmar na homologação antes de ligar.
  const descontoPedido = p.cabecalho.valor_desconto_pedido ? emCentavos(Number(p.cabecalho.valor_desconto_pedido)) : 0;
  const freteEnviado = p.frete ? emCentavos(Number(p.frete.valor_frete)) : 0;
  p.det.forEach((d, i) => {
    const l = itens.find((x) => x.ide === d.ide.codigo_item_integracao) ?? itens[i];
    if (!l) return;
    if (l.produto !== textoDe(d.produto.codigo_produto)) divergencias.push(`item ${i + 1}: produto`);
    if (Math.abs(l.quantidade - d.produto.quantidade) > 0.0005) divergencias.push(`item ${i + 1}: quantidade`);
    if (emCentavos(l.valorUnitario) !== emCentavos(d.produto.valor_unitario)) divergencias.push(`item ${i + 1}: preço`);
    if (!descontoPedido && emCentavos(l.valorDesconto) !== emCentavos(d.produto.valor_desconto)) divergencias.push(`item ${i + 1}: desconto`);
    if (l.reservado === "S") divergencias.push(`item ${i + 1}: estoque reservado`);
  });
  const descontosItens = p.det.reduce((s, d) => s + emCentavos(d.produto.valor_desconto), 0);
  if (descontoPedido && itens.reduce((s, l) => s + emCentavos(l.valorDesconto), 0) !== descontosItens + descontoPedido) divergencias.push("desconto geral do pedido");
  if (p.frete) {
    const lidoFrete = objeto(pv["frete"]);
    if (textoDe(lidoFrete["modalidade"]) !== textoDe(p.frete.modalidade)) divergencias.push("modalidade do frete");
    if (numeroDe(lidoFrete["valor_frete"]) === null || emCentavos(Number(lidoFrete["valor_frete"])) !== freteEnviado) divergencias.push("frete");
  }
  const mercadorias = p.det.reduce((s, d) => s + emCentavos(d.produto.quantidade * d.produto.valor_unitario), 0);
  const total = mercadorias - descontosItens - descontoPedido + freteEnviado;
  if (lido.valorMercadorias === null || emCentavos(lido.valorMercadorias) !== mercadorias) divergencias.push("valor das mercadorias");
  if (lido.valorTotal === null || emCentavos(lido.valorTotal) !== total) divergencias.push("total do pedido");
  return { confere: divergencias.length === 0, divergencias, lido, esperado: { valorMercadorias: mercadorias / 100, valorTotal: total / 100 } };
}
