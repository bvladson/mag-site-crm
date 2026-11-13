import { createFileRoute, Link, useNavigate, useBlocker } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  QuoteDiscountPanel,
  DiscountLineWarning,
  useQuoteDiscount,
} from "@/components/interno/Discounts";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  Eye,
  FileDown,
  FileText,
  GitCompare,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Share2,
  Trash2,
} from "lucide-react";
import {
  lerOrcamentoInterno,
  opcoesDoOrcamento,
  salvarOrcamentoInterno,
  mudarEstadoOrcamento,
  revisarPedidoOmie,
  gerarPedidoOmie,
  vincularClienteOmie,
  criarClienteNoOmie,
  buscarClientesNoOmie,
  verificarPedidoOmie,
  atualizarStatusOmie,
  usarEmailDoCadastroOmie,
  duplicarOrcamentoInterno,
} from "@/lib/orcamentos.functions";
import {
  gerarPropostaComercial,
  dadosDeEnvioDaProposta,
  registrarAcaoDaProposta,
  enviarPropostaPorEmail,
  gerenciarVersoesDaProposta,
  compararVersoesDaProposta,
  marcarPropostaEnviada,
  marcarPropostaRecusada,
} from "@/lib/propostas.functions";
import {
  calcularItem,
  centavos,
  quantidade,
  percentual,
  reais,
  editavel,
  podeGerarPedido,
  documentoMascarado,
  hojeFortaleza,
  digitos,
  ROTULO_ESTADO,
  REGRA_CONTA,
  sugestaoDeConta,
  contasDaVenda,
  type DescontoTipo,
  type ConferenciaPedido,
  type ConferenciaAceita,
  type Estado,
} from "@/lib/orcamento-regras";
import { totaisDaProposta, telefoneBR, telefoneWhatsApp } from "@/lib/proposta-regras";
import { buscarProdutos, type ProdutoInterno } from "@/lib/produtos-busca";
import { Loading, ErrorState, Card, Rows, fmtDate } from "@/components/interno/ui";
import { SeloEstado, mensagemErro } from "@/components/interno/orcamento";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * Orçamento interno: edição até o aceite; depois, só leitura e a conversão em Pedido de Venda no Omie (revisão + confirmação).
 * Todos os valores mostrados aqui são recalculados no servidor ao salvar; o navegador só faz a prévia.
 */
export const Route = createFileRoute("/_authenticated/interno/orcamentos-internos/$id")({
  component: Pagina,
});

type Dados = Awaited<ReturnType<typeof lerOrcamentoInterno>>;
type Revisao = Awaited<ReturnType<typeof revisarPedidoOmie>>;
type Item = {
  produtoId: string;
  sku: string;
  nome: string;
  unidade: string;
  quantidade: string;
  preco: string;
  descontoTipo: DescontoTipo | "";
  desconto: string;
};
const valorBR = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtdBR = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const campo =
  "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-foreground/40 disabled:bg-surface";

function Pagina() {
  const { id } = Route.useParams();
  const ler = useServerFn(lerOrcamentoInterno);
  const q = useQuery({
    queryKey: ["interno", "orcamento-interno", id],
    queryFn: () => ler({ data: { id } }),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  return <Orcamento key={`${q.data.orcamento.id}:${q.data.orcamento.versao}`} dados={q.data} />;
}

function Orcamento({ dados }: { dados: Dados }) {
  const { orcamento, envio } = dados;
  const qc = useQueryClient();
  const recarregar = () =>
    qc.invalidateQueries({ queryKey: ["interno", "orcamento-interno", orcamento.id] });
  const salvarFn = useServerFn(salvarOrcamentoInterno);
  const estadoFn = useServerFn(mudarEstadoOrcamento);
  const opcoesFn = useServerFn(opcoesDoOrcamento);
  const opcoes = useQuery({
    queryKey: ["interno", "orcamento-opcoes"],
    queryFn: () => opcoesFn(),
    staleTime: 5 * 60_000,
  });
  const podeEditar = editavel(orcamento.estado);
  const [cliente, setCliente] = useState(orcamento.cliente);
  const [itens, setItens] = useState<Item[]>(
    dados.itens.map((i) => ({
      produtoId: i.produtoId,
      sku: i.sku,
      nome: i.nome,
      unidade: i.unidade,
      quantidade: qtdBR(i.quantidade),
      preco: i.precoCentavos ? valorBR(i.precoCentavos) : "",
      descontoTipo: i.descontoTipo ?? "",
      desconto:
        i.descontoTipo === "percentual"
          ? String(i.descontoValor).replace(".", ",")
          : i.descontoTipo === "valor"
            ? valorBR(i.descontoValor)
            : "",
    })),
  );
  const [condicoes, setCondicoes] = useState({
    ...orcamento.condicoes,
    formaPagamento:
      orcamento.condicoes.formaPagamento ||
      (orcamento.estado === "rascunho" ? (opcoes.data?.formaPadrao ?? "") : ""),
  });
  const propostaInicial = useMemo(
    () => ({
      contato: orcamento.proposta.contato,
      validade: orcamento.proposta.validade,
      observacoes: orcamento.proposta.observacoes,
      descontoGeral: orcamento.proposta.descontoGeralCentavos
        ? valorBR(orcamento.proposta.descontoGeralCentavos)
        : "",
      frete: orcamento.proposta.freteCentavos ? valorBR(orcamento.proposta.freteCentavos) : "",
      montagem: orcamento.proposta.montagemCentavos
        ? valorBR(orcamento.proposta.montagemCentavos)
        : "",
    }),
    [orcamento],
  );
  const [proposta, setProposta] = useState(propostaInicial);
  const [ocupado, setOcupado] = useState(false);
  const [activeSection, setActiveSection] = useState("quote-client:0");
  const [revisando, setRevisando] = useState(false);
  const inicial = useMemo(
    () =>
      JSON.stringify({
        c: orcamento.cliente,
        i: dados.itens.length,
        cond: orcamento.condicoes,
        p: propostaInicial,
      }),
    [orcamento, dados.itens.length, propostaInicial],
  );
  const itensMudaram = itens.some((it, n) => {
    const orig = dados.itens[n];
    return (
      !orig ||
      orig.produtoId !== it.produtoId ||
      centavos(it.preco || "0") !== orig.precoCentavos ||
      quantidade(it.quantidade) !== orig.quantidade ||
      (it.descontoTipo || null) !== orig.descontoTipo ||
      (it.descontoTipo === "percentual"
        ? percentual(it.desconto || "0")
        : it.descontoTipo === "valor"
          ? centavos(it.desconto || "0")
          : 0) !== orig.descontoValor
    );
  });
  const sujo =
    JSON.stringify({ c: cliente, i: itens.length, cond: condicoes, p: proposta }) !== inicial ||
    itensMudaram;
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      podeEditar &&
      sujo &&
      current.pathname !== next.pathname &&
      !window.confirm("Há alterações não salvas nesta negociação. Sair e descartar as alterações?"),
    enableBeforeUnload: podeEditar && sujo,
    withResolver: false,
  });
  // Aceite (09/10/2026, tarde): só da vigente gerada com TODOS os dados que vão ao Pedido (inclusive conta, consumidor final e
  // observações do pedido), marcada como enviada, nunca aceita antes; qualquer mudança → nova versão → enviada → aceite.
  const vigenteInfo = dados.propostas.versoes.find((v) => v.vigente);
  const vN = `v${dados.propostas.vigente}`;
  const novaVersao = "gere nova versão, marque como enviada e registre o aceite";
  const approval = useQuoteDiscount(orcamento.id);
  const discountBlocked =
    approval.data?.enabled && !["livre", "aprovado"].includes(approval.data.state);
  const bloqueioAceite = discountBlocked
    ? "O desconto precisa ser aprovado antes do envio e do aceite."
    : !dados.propostas.vigente
      ? "Para marcar o aceite, gere a proposta: o aceite é sempre de uma versão."
      : vigenteInfo?.recusada
        ? `O cliente recusou a ${vN}: gere uma nova versão.`
        : vigenteInfo?.aceita
          ? `A ${vN} já foi aceita e depois revisada: não pode ser aceita de novo — ${novaVersao}.`
          : sujo
            ? `Há alterações não salvas: salve, ${novaVersao}.`
            : dados.propostas.alterado || dados.propostas.pedidoAlterado
              ? `O orçamento mudou depois da ${vN}: ${novaVersao}.`
              : dados.propostas.semDadosDoPedido
                ? `A ${vN} é anterior ao registro da conta corrente, do consumidor final e das observações do pedido: ${novaVersao}.`
                : !orcamento.condicoes.conta
                  ? `Escolha e salve a conta corrente desta venda; depois ${novaVersao}.`
                  : !vigenteInfo?.enviada
                    ? `Marque a ${vN} como enviada ao cliente ("✓ Marcar como enviada ao cliente") antes do aceite.`
                    : null;

  const previa = itens.map((it) =>
    calcularItem({
      quantidade: quantidade(it.quantidade) ?? 0,
      precoCentavos: centavos(it.preco) ?? 0,
      descontoTipo: it.descontoTipo || null,
      descontoValor:
        it.descontoTipo === "percentual"
          ? (percentual(it.desconto || "0") ?? 0)
          : it.descontoTipo === "valor"
            ? (centavos(it.desconto || "0") ?? 0)
            : 0,
    }),
  );
  // Prévia no navegador; o servidor recalcula ao salvar e ao gerar a proposta.
  const totais = totaisDaProposta(
    podeEditar ? previa : dados.itens,
    podeEditar
      ? {
          descontoGeralCentavos: centavos(proposta.descontoGeral || "0") ?? 0,
          freteCentavos: centavos(proposta.frete || "0") ?? 0,
          montagemCentavos: centavos(proposta.montagem || "0") ?? 0,
        }
      : {
          descontoGeralCentavos: orcamento.proposta.descontoGeralCentavos,
          freteCentavos: orcamento.proposta.freteCentavos,
          montagemCentavos: orcamento.proposta.montagemCentavos,
        },
  );
  const temExtras =
    totais.descontoGeralCentavos + totais.freteCentavos + totais.montagemCentavos > 0;

  const salvar = async () => {
    const r = await salvarFn({
      data: {
        id: orcamento.id,
        dados: {
          versao: orcamento.versao,
          cliente,
          condicoes,
          proposta,
          itens: itens.map((it) => ({
            produtoId: it.produtoId,
            quantidade: it.quantidade,
            preco: it.preco,
            descontoTipo: it.descontoTipo,
            desconto: it.desconto,
          })),
        },
      },
    });
    return r.versao;
  };
  const executar = async (acao: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const transicao = (
    acao: "salvar" | "enviar" | "aceitar" | "reabrir" | "cancelar",
    ok: string,
    confirmar?: string,
  ) =>
    executar(async () => {
      if (confirmar && !window.confirm(confirmar)) throw new Error("Operação não confirmada");
      const versao = podeEditar && sujo ? await salvar() : orcamento.versao;
      await estadoFn({ data: { id: orcamento.id, acao, versao } });
    }, ok);
  const duplicarFn = useServerFn(duplicarOrcamentoInterno);
  const navigate = useNavigate();
  const duplicar = async () => {
    if (
      !window.confirm(
        `Duplicar ${orcamento.numero}? Cria um orçamento NOVO (número novo) com o mesmo cliente, itens e condições; o histórico e as propostas deste ficam separados.`,
      )
    )
      return;
    setOcupado(true);
    try {
      const r = await duplicarFn({ data: { id: orcamento.id } });
      toast.success(`Orçamento duplicado: ${r.numero}`);
      await navigate({ to: "/interno/orcamentos-internos/$id", params: { id: r.id } });
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Link to="/interno/orcamentos-internos" className="text-sm text-muted-foreground">
        ← Negociações e propostas
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{orcamento.cliente.nome || "Nova negociação"}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{orcamento.numero}</p>
        </div>
        <SeloEstado estado={orcamento.estado} />
        {dados.propostas.vigente && (
          <span className="rounded-sm border px-2 py-0.5 text-xs font-semibold">
            Proposta vigente v{dados.propostas.vigente}
          </span>
        )}
        {dados.propostas.aceita && (
          <span className="rounded-sm bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
            Aceita: v{dados.propostas.aceita}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={ocupado}
          onClick={duplicar}
        >
          <Copy /> Duplicar orçamento
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Responsável: {orcamento.donoEmail ?? "-"} · criado em {fmtDate(orcamento.criadoEm)} ·
        atualizado {fmtDate(orcamento.atualizadoEm)}
        {orcamento.aceitoEm && <> · aceito em {fmtDate(orcamento.aceitoEm)}</>}
      </p>
      <Fluxo estado={orcamento.estado} temProposta={dados.propostas.versoes.length > 0} />
      <QuoteDiscountPanel id={orcamento.id} dirty={sujo} />
      <nav
        aria-label="Seções da negociação"
        className="mt-5 flex flex-wrap gap-1 rounded-lg border bg-card p-2"
      >
        {(
          [
            ["quote-client", "Cliente"],
            ["quote-items", "Itens"],
            ["quote-conditions", "Condições"],
            ["quote-proposal", "Proposta"],
            ["quote-proposal", "Envio"],
            ["quote-actions", "Aceite"],
            ["quote-omie", "Revisão Omie"],
            ["quote-summary", "Resultado"],
          ] as const
        ).map(([section, label], i) => (
          <button
            type="button"
            key={label}
            aria-pressed={activeSection === `${section}:${i}`}
            className={`rounded-md px-3 py-2 text-sm transition-colors ${activeSection === `${section}:${i}` ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            onClick={() => {
              setActiveSection(`${section}:${i}`);
              document.getElementById(section)?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? "instant"
                  : "smooth",
                block: "start",
              });
            }}
          >
            <span className="mr-1 opacity-60">{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <p className="mt-2 text-xs text-muted-foreground">
        Navegue pelas seções. Envio, aceite e pedido são registrados somente pelas ações de
        confirmação.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section id="quote-client" className="scroll-mt-24">
            <Card title="Cliente">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Razão social / nome *">
                  <input
                    className={campo}
                    disabled={!podeEditar}
                    value={cliente.nome}
                    maxLength={120}
                    onChange={(e) => setCliente({ ...cliente, nome: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Nome fantasia">
                  <input
                    className={campo}
                    disabled={!podeEditar}
                    value={cliente.fantasia}
                    maxLength={120}
                    onChange={(e) => setCliente({ ...cliente, fantasia: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="CPF/CNPJ (para achar o cliente no Omie)">
                  <input
                    className={campo}
                    disabled={!podeEditar}
                    value={cliente.documento}
                    maxLength={20}
                    inputMode="numeric"
                    onChange={(e) => setCliente({ ...cliente, documento: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="E-mail">
                  <input
                    className={campo}
                    disabled={!podeEditar}
                    value={cliente.email}
                    maxLength={120}
                    type="email"
                    onChange={(e) => setCliente({ ...cliente, email: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Telefone">
                  <input
                    className={campo}
                    disabled={!podeEditar}
                    value={cliente.telefone}
                    maxLength={20}
                    onChange={(e) => setCliente({ ...cliente, telefone: e.target.value })}
                  />
                </Campo>
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <Campo rotulo="Cidade">
                    <input
                      className={campo}
                      disabled={!podeEditar}
                      value={cliente.cidade}
                      maxLength={60}
                      onChange={(e) => setCliente({ ...cliente, cidade: e.target.value })}
                    />
                  </Campo>
                  <Campo rotulo="UF">
                    <input
                      className={campo}
                      disabled={!podeEditar}
                      value={cliente.uf}
                      maxLength={2}
                      onChange={(e) => setCliente({ ...cliente, uf: e.target.value.toUpperCase() })}
                    />
                  </Campo>
                </div>
              </div>
              {orcamento.clienteOmie && (
                <p className="mt-3 text-xs text-success">
                  Vinculado ao cliente do Omie código {orcamento.clienteOmie}.
                </p>
              )}
            </Card>
          </section>

          <section id="quote-items" className="scroll-mt-24">
            <Card title="Itens">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-2">Produto</th>
                      <th className="w-24">Qtd</th>
                      <th className="w-32">Preço unit. (R$)</th>
                      <th className="w-40">Desconto</th>
                      <th className="w-28 text-right">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((it, n) => (
                      <tr key={`${it.produtoId}-${n}`} className="border-t align-top">
                        <td className="py-2 pr-2">
                          <span className="block font-medium leading-tight">{it.nome}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            SKU {it.sku} · {it.unidade} · Omie {it.produtoId}
                          </span>
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            aria-label="Quantidade"
                            className={`${campo} mt-0 h-9`}
                            disabled={!podeEditar}
                            value={it.quantidade}
                            onChange={(e) =>
                              setItens(
                                itens.map((x, k) =>
                                  k === n ? { ...x, quantidade: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            aria-label="Preço unitário"
                            className={`${campo} mt-0 h-9`}
                            disabled={!podeEditar}
                            value={it.preco}
                            placeholder="0,00"
                            onChange={(e) =>
                              setItens(
                                itens.map((x, k) =>
                                  k === n ? { ...x, preco: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex gap-1">
                            <select
                              aria-label="Tipo de desconto"
                              className={`${campo} mt-0 h-9 w-16 px-1`}
                              disabled={!podeEditar}
                              value={it.descontoTipo}
                              onChange={(e) =>
                                setItens(
                                  itens.map((x, k) =>
                                    k === n
                                      ? {
                                          ...x,
                                          descontoTipo: e.target.value as DescontoTipo | "",
                                          desconto: "",
                                        }
                                      : x,
                                  ),
                                )
                              }
                            >
                              <option value="">—</option>
                              <option value="percentual">%</option>
                              <option value="valor">R$</option>
                            </select>
                            {it.descontoTipo && (
                              <input
                                aria-label="Desconto"
                                className={`${campo} mt-0 h-9`}
                                disabled={!podeEditar}
                                value={it.desconto}
                                placeholder={it.descontoTipo === "percentual" ? "0" : "0,00"}
                                onChange={(e) =>
                                  setItens(
                                    itens.map((x, k) =>
                                      k === n ? { ...x, desconto: e.target.value } : x,
                                    ),
                                  )
                                }
                              />
                            )}
                          </div>
                          <DiscountLineWarning
                            id={orcamento.id}
                            percentage={
                              it.descontoTipo === "percentual"
                                ? (percentual(it.desconto || "0") ?? undefined)
                                : undefined
                            }
                            gross={
                              podeEditar
                                ? previa[n]!.brutoCentavos
                                : (dados.itens[n]?.brutoCentavos ?? 0)
                            }
                            discount={
                              podeEditar
                                ? previa[n]!.descontoCentavos
                                : (dados.itens[n]?.descontoCentavos ?? 0)
                            }
                          />
                        </td>
                        <td className="py-2 text-right font-semibold">
                          {reais(
                            podeEditar
                              ? previa[n]!.totalCentavos
                              : (dados.itens[n]?.totalCentavos ?? 0),
                          )}
                          {(podeEditar
                            ? previa[n]!.descontoCentavos
                            : (dados.itens[n]?.descontoCentavos ?? 0)) > 0 && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              −{" "}
                              {reais(
                                podeEditar
                                  ? previa[n]!.descontoCentavos
                                  : (dados.itens[n]?.descontoCentavos ?? 0),
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {podeEditar && (
                            <button
                              type="button"
                              aria-label="Remover item"
                              className="p-1 text-muted-foreground hover:text-destructive"
                              onClick={() => setItens(itens.filter((_, k) => k !== n))}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!itens.length && (
                <p className="py-3 text-sm text-muted-foreground">Nenhum item ainda.</p>
              )}
              {podeEditar && itens.length < 199 && (
                <SeletorProduto
                  onEscolher={(p) =>
                    setItens([
                      ...itens,
                      {
                        produtoId: p.id,
                        sku: p.sku,
                        nome: p.nome,
                        unidade: p.unidade,
                        quantidade: "1",
                        preco: "",
                        descontoTipo: "",
                        desconto: "",
                      },
                    ])
                  }
                />
              )}
            </Card>
          </section>

          <Card title="Dados da proposta (aparecem para o cliente)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Contato (A/C)">
                <input
                  className={campo}
                  disabled={!podeEditar}
                  value={proposta.contato}
                  maxLength={120}
                  placeholder="Nome de quem recebe a proposta"
                  onChange={(e) => setProposta({ ...proposta, contato: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Validade da proposta">
                <input
                  type="date"
                  className={campo}
                  disabled={!podeEditar}
                  min={hojeFortaleza()}
                  value={proposta.validade}
                  onChange={(e) => setProposta({ ...proposta, validade: e.target.value })}
                />
                {!proposta.validade && (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Vazio: {dados.validadePadraoDias} dias a partir da geração.
                  </span>
                )}
              </Campo>
              <Campo rotulo="Desconto geral (R$)">
                <input
                  className={campo}
                  disabled={!podeEditar}
                  value={proposta.descontoGeral}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(e) => setProposta({ ...proposta, descontoGeral: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Frete (R$)">
                <input
                  className={campo}
                  disabled={!podeEditar}
                  value={proposta.frete}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(e) => setProposta({ ...proposta, frete: e.target.value })}
                />
              </Campo>
              <Campo rotulo="Montagem (R$)">
                <input
                  className={campo}
                  disabled={!podeEditar}
                  value={proposta.montagem}
                  placeholder="0,00"
                  inputMode="decimal"
                  onChange={(e) => setProposta({ ...proposta, montagem: e.target.value })}
                />
              </Campo>
            </div>
            <div className="mt-3">
              <Campo rotulo="Observações comerciais (aparecem na proposta)">
                <textarea
                  className={`${campo} h-20 py-2`}
                  disabled={!podeEditar}
                  maxLength={2000}
                  value={proposta.observacoes}
                  placeholder="Ex.: entrega no térreo, montagem inclusa…"
                  onChange={(e) => setProposta({ ...proposta, observacoes: e.target.value })}
                />
              </Campo>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Frete, montagem e desconto geral entram só na proposta: ainda não vão para o Pedido no
              Omie. Notas internas e observações do pedido nunca aparecem na proposta.
            </p>
          </Card>
        </div>

        <div className="space-y-5">
          <section id="quote-summary" className="scroll-mt-24">
            <Card title="Resumo da negociação">
              <Rows
                rows={
                  [
                    ["Produtos", reais(totais.brutoCentavos)],
                    ["Descontos nos itens", `− ${reais(totais.descontoItensCentavos)}`],
                    ["Subtotal", reais(totais.subtotalCentavos)],
                    ...(totais.descontoGeralCentavos
                      ? [["Desconto geral", `− ${reais(totais.descontoGeralCentavos)}`]]
                      : []),
                    ...(totais.freteCentavos ? [["Frete", reais(totais.freteCentavos)]] : []),
                    ...(totais.montagemCentavos
                      ? [["Montagem", reais(totais.montagemCentavos)]]
                      : []),
                    [
                      "Total da proposta",
                      <b key="t" className="text-lg">
                        {reais(totais.totalCentavos)}
                      </b>,
                    ],
                  ] as [string, ReactNode][]
                }
              />
              {temExtras && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Pedido no Omie (só os itens): {reais(totais.subtotalCentavos)}.
                </p>
              )}
            </Card>
          </section>

          <section id="quote-proposal" className="scroll-mt-24">
            <SecaoProposta
              dados={dados}
              sujo={podeEditar && sujo}
              salvarAntes={salvar}
              recarregar={recarregar}
            />
          </section>
          <section id="quote-conditions" className="scroll-mt-24">
            <Card title="Condições">
              <div className="space-y-3">
                {podeEditar && (
                  <p className="text-xs text-muted-foreground">
                    Condição, previsão, conta corrente, consumidor final e observações do pedido
                    fazem parte da versão da proposta: preencha antes de gerar — mudar depois exige
                    nova versão (marcada como enviada) antes do aceite.
                  </p>
                )}
                <Campo rotulo="Condição de pagamento (Omie)">
                  <select
                    className={campo}
                    disabled={!podeEditar}
                    value={condicoes.formaPagamento}
                    onChange={(e) => setCondicoes({ ...condicoes, formaPagamento: e.target.value })}
                  >
                    <option value="">Escolha…</option>
                    {opcoes.data?.formasPagamento.map((f) => (
                      <option key={f.codigo} value={f.codigo}>
                        {f.codigo} — {f.descricao}
                      </option>
                    ))}
                    {!podeEditar && condicoes.formaPagamento && (
                      <option value={condicoes.formaPagamento}>
                        {condicoes.formaPagamento} — {condicoes.formaPagamentoDescricao}
                      </option>
                    )}
                  </select>
                  {!opcoes.data?.formasPagamento.length && (
                    <span className="mt-1 block text-xs text-destructive">
                      Sem condições sincronizadas do Omie: peça ao Admin para atualizar os dados do
                      Omie.
                    </span>
                  )}
                </Campo>
                <CampoConta
                  dados={dados}
                  conta={condicoes.conta}
                  documento={cliente.documento}
                  condicao={
                    opcoes.data?.formasPagamento.find((f) => f.codigo === condicoes.formaPagamento)
                      ?.descricao ?? ""
                  }
                  contas={opcoes.data?.contas ?? []}
                  podeEditar={podeEditar}
                  aoMudar={(conta) => setCondicoes({ ...condicoes, conta })}
                />
                {podeEditar ? (
                  <Campo rotulo="Previsão de faturamento">
                    <input
                      type="date"
                      className={campo}
                      min={hojeFortaleza()}
                      value={condicoes.previsao}
                      onChange={(e) => setCondicoes({ ...condicoes, previsao: e.target.value })}
                    />
                  </Campo>
                ) : (
                  <PrevisaoDepoisDoAceite dados={dados} />
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    disabled={!podeEditar}
                    checked={condicoes.consumidorFinal}
                    onChange={(e) =>
                      setCondicoes({ ...condicoes, consumidorFinal: e.target.checked })
                    }
                  />{" "}
                  Consumidor final (nota para uso e consumo)
                </label>
                <Campo rotulo="E-mail(s) para a nota fiscal">
                  <input
                    className={campo}
                    disabled={!podeEditar}
                    value={condicoes.emailNf}
                    placeholder="nf@cliente.com.br"
                    onChange={(e) => setCondicoes({ ...condicoes, emailNf: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Observações do pedido (vão para o Omie)">
                  <textarea
                    className={`${campo} h-20 py-2`}
                    disabled={!podeEditar}
                    maxLength={2000}
                    value={condicoes.observacoes}
                    onChange={(e) => setCondicoes({ ...condicoes, observacoes: e.target.value })}
                  />
                </Campo>
                <Campo rotulo="Notas internas (não vão ao Omie)">
                  <textarea
                    className={`${campo} h-20 py-2`}
                    disabled={!podeEditar}
                    maxLength={5000}
                    value={condicoes.notasInternas}
                    onChange={(e) => setCondicoes({ ...condicoes, notasInternas: e.target.value })}
                  />
                </Campo>
              </div>
            </Card>
          </section>

          <section id="quote-actions" className="scroll-mt-24">
            {!["enviado_omie", "cancelado"].includes(orcamento.estado) && (
              <Card title="Ações e aceite">
                <div className="flex flex-col gap-2">
                  {podeEditar && (
                    <Button
                      variant="outline"
                      disabled={ocupado || !sujo}
                      onClick={() => executar(salvar, "Alterações salvas")}
                    >
                      Salvar alterações
                    </Button>
                  )}
                  {orcamento.estado === "rascunho" && (
                    <Button
                      disabled={ocupado}
                      onClick={() => transicao("salvar", "Orçamento salvo")}
                    >
                      Salvar orçamento
                    </Button>
                  )}
                  {orcamento.estado === "salvo" && (
                    <Button
                      disabled={ocupado}
                      onClick={() => transicao("enviar", "Marcado como enviado ao cliente")}
                    >
                      Marcar como enviado ao cliente
                    </Button>
                  )}
                  {(orcamento.estado === "salvo" || orcamento.estado === "enviado") && (
                    <Button
                      disabled={ocupado || Boolean(bloqueioAceite)}
                      className="bg-success hover:bg-success/90"
                      onClick={() =>
                        transicao(
                          "aceitar",
                          "Orçamento aceito pelo cliente",
                          `Confirmar que o CLIENTE ACEITOU a proposta v${dados.propostas.vigente}? A versão fica congelada e itens e preços ficam travados.\n\nConta corrente desta venda: ${orcamento.condicoes.contaDescricao || "?"} — ${orcamento.condicoes.conta} (fica congelada com a versão aceita).`,
                        )
                      }
                    >
                      <CheckCircle2 /> Aceito pelo cliente
                    </Button>
                  )}
                  {(orcamento.estado === "salvo" || orcamento.estado === "enviado") &&
                    bloqueioAceite && (
                      <p className="text-xs text-muted-foreground">{bloqueioAceite}</p>
                    )}
                  {(orcamento.estado === "aceito" || orcamento.estado === "erro_omie") &&
                    !envioPendente(envio) && (
                      <Button
                        variant="outline"
                        disabled={ocupado}
                        onClick={() =>
                          transicao(
                            "reabrir",
                            "Nova revisão aberta: edite, gere nova versão e marque o aceite de novo",
                            `Criar nova revisão? O orçamento volta para edição e o aceite é desfeito${dados.propostas.aceita ? `: a proposta aceita (v${dados.propostas.aceita}) fica congelada no histórico` : ""}. Será preciso gerar nova versão e marcar o aceite de novo.`,
                          )
                        }
                      >
                        Criar nova revisão
                      </Button>
                    )}
                  {!["enviado_omie", "cancelado"].includes(orcamento.estado) &&
                    !envioPendente(envio) && (
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        disabled={ocupado}
                        onClick={() =>
                          transicao(
                            "cancelar",
                            "Orçamento cancelado",
                            "Cancelar este orçamento? Ele continua registrado.",
                          )
                        }
                      >
                        Cancelar orçamento
                      </Button>
                    )}
                  {ocupado && (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Salvando…
                    </span>
                  )}
                </div>
              </Card>
            )}
            {["enviado_omie", "cancelado"].includes(orcamento.estado) && (
              <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Negociação {ROTULO_ESTADO[orcamento.estado].toLowerCase()}. Consulte o resultado e o
                histórico da proposta.
              </p>
            )}
          </section>

          <section id="quote-omie" className="scroll-mt-24">
            {podeGerarPedido(orcamento.estado) || orcamento.estado === "enviado_omie" || envio ? (
              <SecaoOmie
                dados={dados}
                aoRevisar={() => setRevisando(true)}
                recarregar={recarregar}
              />
            ) : (
              <Card title="Revisão Omie">
                <p className="text-sm text-muted-foreground">
                  A revisão fica disponível depois do aceite da proposta vigente pelo cliente.
                </p>
              </Card>
            )}
          </section>
        </div>
      </div>
      {revisando && (
        <RevisaoPedido
          id={orcamento.id}
          aoFechar={() => {
            setRevisando(false);
            void recarregar();
          }}
        />
      )}
    </>
  );
}

const envioPendente = (envio: Dados["envio"]) =>
  Boolean(envio && ["enviando", "incerto", "criado"].includes(envio.estado));
function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {rotulo}
      {children}
    </label>
  );
}

/**
 * Conta corrente da VENDA (Omie): sem padrão — quem faz a venda escolhe; a sugestão MAG é só dica e nunca escolhe sozinha.
 * Fica congelada com a versão aceita no aceite (trocar depois = "Criar nova revisão" → nova proposta → novo aceite).
 */
function CampoConta({
  dados,
  conta,
  documento,
  condicao,
  contas,
  podeEditar,
  aoMudar,
}: {
  dados: Dados;
  conta: string;
  documento: string;
  condicao: string;
  contas: { codigo: string; descricao: string }[];
  podeEditar: boolean;
  aoMudar: (conta: string) => void;
}) {
  const aceita = dados.orcamento.contaAceita;
  if (!podeEditar) {
    const atual =
      aceita ??
      (conta
        ? { codigo: conta, descricao: dados.orcamento.condicoes.contaDescricao, versao: null }
        : null);
    return (
      <Campo rotulo="Conta corrente da venda (Omie)">
        <p className="mt-1 text-sm font-normal">
          {atual ? (
            <>
              <b>{atual.descricao || "?"}</b> · {atual.codigo}
              {aceita && (
                <span className="text-muted-foreground">
                  {" "}
                  — selecionada para esta venda, congelada no aceite da v{aceita.versao}
                </span>
              )}
            </>
          ) : (
            <span className="text-destructive">não escolhida</span>
          )}
        </p>
        {aceita && (
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Para trocar: "Criar nova revisão" → nova proposta → novo aceite.
          </span>
        )}
      </Campo>
    );
  }
  const { principais, outras } = contasDaVenda(contas);
  const sugestao = sugestaoDeConta({ documento, condicao }, contas);
  const fora = Boolean(conta) && !contas.some((c) => c.codigo === conta);
  return (
    <Campo rotulo="Conta corrente da venda (Omie) *">
      <select className={campo} value={conta} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">Escolha a conta desta venda…</option>
        {principais.length > 0 && (
          <optgroup label="Contas de venda">
            {principais.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.descricao} — {c.codigo}
              </option>
            ))}
          </optgroup>
        )}
        {outras.length > 0 && (
          <optgroup label="Outras contas do Omie">
            {outras.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.descricao} — {c.codigo}
              </option>
            ))}
          </optgroup>
        )}
        {fora && (
          <option value={conta}>
            {dados.orcamento.condicoes.contaDescricao || conta} (inativa ou fora da lista)
          </option>
        )}
      </select>
      <span className="mt-1 block text-xs font-normal text-muted-foreground">
        Sem conta padrão: escolha a conta desta venda ANTES de gerar a proposta — ela faz parte da
        versão (mudar depois exige nova versão) e fica congelada no aceite. {REGRA_CONTA}
      </span>
      {sugestao && sugestao.codigo !== conta && (
        <span className="mt-1 block text-xs font-normal text-amber-900">
          Dica para este orçamento: {sugestao.descricao} ({sugestao.motivo}) — só vale se você
          escolher acima.
        </span>
      )}
      {!contas.length && (
        <span className="mt-1 block text-xs font-normal text-destructive">
          Sem contas sincronizadas do Omie: peça ao Admin para atualizar os dados do Omie.
        </span>
      )}
    </Campo>
  );
}

/**
 * Depois do aceite a previsão COMERCIAL fica congelada (é a da versão aceita e vai ao Pedido como foi aceita). Antes do
 * Pedido: "Criar nova revisão". Depois do Pedido: a previsão operacional muda no próprio Omie, sem tocar na proposta.
 */
function PrevisaoDepoisDoAceite({ dados }: { dados: Dados }) {
  const previsao = dados.orcamento.condicoes.previsao;
  const noOmie = dados.orcamento.estado === "enviado_omie";
  return (
    <div className="text-sm">
      <p className="font-medium">Previsão comercial aceita</p>
      <p className="mt-1 rounded-md border bg-surface px-3 py-2 font-semibold">
        {previsao ? previsao.split("-").reverse().join("/") : "—"}{" "}
        <span className="text-xs font-normal text-muted-foreground">(congelada)</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {noOmie
          ? "Previsão operacional: ajuste no próprio Omie (a proposta aceita não muda)."
          : 'Para mudar antes do Pedido no Omie: "Criar nova revisão" → nova proposta → novo aceite.'}
      </p>
    </div>
  );
}

// ---------- Proposta comercial ----------
const PASSOS = [
  "Rascunho",
  "Proposta gerada",
  "Enviado ao cliente",
  "Aceito",
  "Pedido Omie criado",
] as const;
/** Andamento: gerar proposta ≠ enviar ≠ aceite (cada passo é marcado por alguém, nunca sozinho). */
function Fluxo({ estado, temProposta }: { estado: Estado; temProposta: boolean }) {
  if (estado === "cancelado") return null;
  const atual =
    estado === "rascunho"
      ? 0
      : estado === "salvo"
        ? temProposta
          ? 1
          : 0
        : estado === "enviado"
          ? 2
          : estado === "enviado_omie"
            ? 4
            : 3;
  return (
    <ol
      className="mt-3 flex flex-wrap items-center gap-1 text-xs"
      aria-label="Andamento do orçamento"
    >
      {PASSOS.map((passo, i) => (
        <li key={passo} className="flex items-center gap-1">
          <span
            aria-current={i === atual ? "step" : undefined}
            className={`rounded-full border px-2.5 py-0.5 font-medium ${i === atual ? "border-brand bg-brand text-primary-foreground" : i < atual && (i !== 1 || temProposta) ? "border-success/40 bg-success-soft text-success" : "bg-card text-muted-foreground"}`}
          >
            {passo}
          </span>
          {i < PASSOS.length - 1 && (
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

type ModoPdf = "visualizar" | "baixar" | "imprimir" | "compartilhar";
const urlProposta = (id: string, versao: number, modo: ModoPdf) =>
  `/api/interno/orcamentos-internos/${id}/proposta/${versao}?modo=${modo}`;
const diaHora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", "");

function SecaoProposta({
  dados,
  sujo,
  salvarAntes,
  recarregar,
}: {
  dados: Dados;
  sujo: boolean;
  salvarAntes: () => Promise<number>;
  recarregar: () => Promise<void>;
}) {
  const { orcamento, propostas } = dados;
  const gerarFn = useServerFn(gerarPropostaComercial);
  const gerenciarFn = useServerFn(gerenciarVersoesDaProposta);
  const enviadaFn = useServerFn(marcarPropostaEnviada);
  const recusadaFn = useServerFn(marcarPropostaRecusada);
  const vigente = propostas.versoes.find((v) => v.vigente) ?? null;
  const ativas = propostas.versoes.filter((v) => !v.arquivada);
  const arquivadas = propostas.versoes.filter((v) => v.arquivada);
  const [mostrarSku, setMostrarSku] = useState(vigente?.mostrarSku ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [dialogo, setDialogo] = useState<"whatsapp" | "email" | null>(null);
  const [podeCompartilhar, setPodeCompartilhar] = useState(false);
  const [arquivoPronto, setArquivoPronto] = useState<File | null>(null);
  const [selecionadas, setSelecionadas] = useState<number[]>([]);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [comparar, setComparar] = useState<[number, number] | null>(null);
  useEffect(() => {
    try {
      setPodeCompartilhar(
        typeof navigator.canShare === "function" &&
          navigator.canShare({
            files: [new File(["%PDF-"], "proposta.pdf", { type: "application/pdf" })],
          }),
      );
    } catch {
      setPodeCompartilhar(false);
    }
  }, []);
  const podeGerar = editavel(orcamento.estado);
  const c = propostas.consultor;
  const contatosConsultor = [
    c.telefone && `Tel. ${c.telefone}`,
    c.whatsapp && `WhatsApp ${c.whatsapp}`,
    c.email || "E-mail não informado na proposta.",
  ]
    .filter(Boolean)
    .join(" · ");
  const marcar = (versao: number, sim: boolean) =>
    setSelecionadas((atual) =>
      sim ? [...new Set([...atual, versao])] : atual.filter((v) => v !== versao),
    );
  const escolhidas = propostas.versoes.filter((v) => selecionadas.includes(v.versao));

  const gerar = async () => {
    if (
      propostas.versoes.length >= 5 &&
      !window.confirm(
        `Este orçamento já tem ${propostas.versoes.length} versões de proposta. Gerar a v${propostas.proxima}?`,
      )
    )
      return;
    setOcupado(true);
    try {
      const versaoOrcamento = sujo ? await salvarAntes() : orcamento.versao;
      const r = await gerarFn({ data: { id: orcamento.id, versaoOrcamento, mostrarSku } });
      toast.success(
        r.nova
          ? `Proposta v${r.versao} gerada (vigente)`
          : `A proposta v${r.versao} acabou de ser gerada com estes mesmos dados`,
      );
      await recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const gerenciar = async (acao: "arquivar" | "desarquivar" | "excluir", versoes: number[]) => {
    if (!versoes.length) return;
    const lista = versoes.map((v) => `v${v}`).join(", ");
    if (
      acao === "excluir" &&
      !window.confirm(
        `Excluir ${lista}? Somem do histórico, mas continuam registradas na auditoria; o número não é reutilizado.`,
      )
    )
      return;
    setOcupado(true);
    try {
      const r = await gerenciarFn({ data: { id: orcamento.id, acao, versoes } });
      const verbo =
        acao === "excluir"
          ? "excluída(s)"
          : acao === "arquivar"
            ? "arquivada(s)"
            : "desarquivada(s)";
      if (r.feitas.length) toast.success(`${r.feitas.map((v) => `v${v}`).join(", ")} ${verbo}`);
      if (r.recusadas.length)
        toast.error(
          `Não alteradas: ${r.recusadas.map((x) => `v${x.versao} (${x.motivo})`).join("; ")}`,
        );
      setSelecionadas([]);
      await recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  // Só a proposta (sem o painel), na aba nova; a impressão abre sozinha quando o navegador deixa.
  const imprimir = (versao: number) => {
    const janela = window.open(urlProposta(orcamento.id, versao, "imprimir"), "_blank");
    if (!janela) {
      toast.error(
        'O navegador bloqueou a nova aba. Use "Visualizar" e imprima pelo visualizador de PDF.',
      );
      return;
    }
    janela.addEventListener(
      "load",
      () => {
        try {
          janela.focus();
          janela.print();
        } catch {
          /* o visualizador de PDF tem o próprio botão de imprimir */
        }
      },
      { once: true },
    );
  };
  // Compartilhamento nativo do aparelho com o ARQUIVO (sem link público). Se o navegador exigir um novo toque, o botão muda.
  const compartilharArquivo = async (arquivo: File) => {
    try {
      await navigator.share({ files: [arquivo], title: `Proposta ${orcamento.numero}` });
      setArquivoPronto(null);
      toast.success(
        'Proposta compartilhada. Depois de enviar ao cliente, marque "Enviado ao cliente" em Ações.',
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setArquivoPronto(null);
        return;
      }
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setArquivoPronto(arquivo);
        return;
      }
      toast.error("Não foi possível compartilhar. Use Baixar PDF.");
    }
  };
  const compartilhar = async (versao: number, nome: string) => {
    setOcupado(true);
    try {
      const r = await fetch(urlProposta(orcamento.id, versao, "compartilhar"), {
        credentials: "same-origin",
      });
      if (!r.ok) {
        await r.text().catch(() => "");
        throw new Error(
          r.status === 403
            ? "Sem permissão"
            : r.status === 401
              ? "Sessão expirada: entre de novo"
              : `Falha ${r.status}`,
        );
      }
      await compartilharArquivo(new File([await r.blob()], nome, { type: "application/pdf" }));
      void recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const marcarEstado = async (qual: "enviada" | "recusada", versao: number) => {
    const pergunta =
      qual === "enviada"
        ? `Confirmar que a proposta v${versao} FOI ENVIADA ao cliente? (Abrir WhatsApp/e-mail não conta como envio.)`
        : `Confirmar que o cliente RECUSOU a proposta v${versao}? Ela fica registrada; para seguir, gere uma nova versão.`;
    if (!window.confirm(pergunta)) return;
    setOcupado(true);
    try {
      await (qual === "enviada" ? enviadaFn : recusadaFn)({ data: { id: orcamento.id, versao } });
      toast.success(
        qual === "enviada"
          ? `v${versao} marcada como enviada ao cliente`
          : `v${versao} marcada como recusada pelo cliente`,
      );
      await recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const abrirComparacao = () => {
    if (selecionadas.length === 2) {
      setComparar([selecionadas[0]!, selecionadas[1]!]);
      return;
    }
    const [a, b] = [
      vigente?.versao ?? propostas.versoes[0]?.versao,
      propostas.versoes.find((v) => v.versao !== (vigente?.versao ?? propostas.versoes[0]?.versao))
        ?.versao,
    ];
    if (a && b) setComparar([b, a]);
  };

  return (
    <Card title="Proposta comercial">
      {vigente ? (
        <p className="text-sm">
          Vigente: <b>v{vigente.versao}</b> — {diaHora(vigente.criadaEm)} — gerada por{" "}
          {vigente.geradaPor} · {reais(vigente.totalCentavos)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma proposta gerada ainda.</p>
      )}
      {propostas.aceita && (
        <p className="mt-1 text-sm font-semibold text-success">
          Aceita pelo cliente: v{propostas.aceita} (congelada; o futuro Pedido no Omie usa esta
          versão).
        </p>
      )}
      {vigente && (propostas.alterado || propostas.pedidoAlterado || sujo) && (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-2 text-sm font-medium text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Orçamento alterado depois da última
          proposta gerada
          {propostas.pedidoAlterado && !propostas.alterado
            ? " (conta corrente, consumidor final ou observações do pedido)"
            : ""}
          .
        </p>
      )}

      <div
        className="mt-3 rounded-md border bg-surface p-3 text-sm"
        aria-label="Consultor que aparecerá na proposta"
      >
        <p className="text-xs text-muted-foreground">Consultor(a) que aparecerá na proposta:</p>
        <p className="font-semibold">{c.nome}</p>
        <p>{c.cargo}</p>
        <p className="text-muted-foreground">{contatosConsultor}</p>
        {c.eDono ? (
          <Button asChild size="sm" variant="outline" className="mt-2">
            <Link to="/interno/conta">Editar meus dados da proposta</Link>
          </Button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Perfil do dono do orçamento ({orcamento.donoEmail ?? "-"}): só ele(a) altera, em Minha
            conta.
          </p>
        )}
      </div>

      {podeGerar ? (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand"
              checked={mostrarSku}
              onChange={(e) => setMostrarSku(e.target.checked)}
            />{" "}
            Mostrar SKU na proposta
          </label>
          <Button className="w-full" disabled={ocupado} onClick={gerar}>
            {ocupado ? <Loader2 className="animate-spin" /> : <FileText />}{" "}
            {vigente
              ? `Gerar nova versão (v${propostas.proxima})`
              : `Gerar proposta (v${propostas.proxima})`}
          </Button>
          {sujo && (
            <p className="text-xs text-muted-foreground">
              As alterações ainda não salvas serão salvas antes de gerar.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Orçamento {ROTULO_ESTADO[orcamento.estado].toLowerCase()}: não gera nova versão
          {orcamento.estado === "aceito" || orcamento.estado === "erro_omie"
            ? ' (para mudar o aceito, use "Criar nova revisão" em Ações)'
            : ""}
          ; as versões abaixo continuam disponíveis.
        </p>
      )}
      {vigente && (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ações da versão vigente (v{vigente.versao})
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <Button asChild variant="outline">
              <Link
                to="/interno/orcamentos-internos/$id/pdf"
                params={{ id: orcamento.id }}
                search={{ v: vigente.versao }}
              >
                <Eye /> Prévia PDF
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a
                href={urlProposta(orcamento.id, vigente.versao, "baixar")}
                download={vigente.arquivo}
              >
                <FileDown /> Baixar PDF
              </a>
            </Button>
            <Button variant="outline" onClick={() => imprimir(vigente.versao)}>
              <Printer /> Imprimir
            </Button>
            <Button variant="outline" onClick={() => setDialogo("whatsapp")}>
              <MessageCircle /> WhatsApp
            </Button>
            <Button variant="outline" onClick={() => setDialogo("email")}>
              <Mail /> E-mail
            </Button>
            {arquivoPronto ? (
              <Button onClick={() => void compartilharArquivo(arquivoPronto)}>
                <Share2 /> Compartilhar agora
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={!podeCompartilhar || ocupado}
                onClick={() => void compartilhar(vigente.versao, vigente.arquivo)}
              >
                <Share2 /> Compartilhar
              </Button>
            )}
          </div>
          {!podeCompartilhar && (
            <p className="mt-1 text-xs text-muted-foreground">
              Compartilhar: no celular e em navegadores compatíveis. Aqui, use Baixar PDF.
            </p>
          )}
          {podeGerar && !vigente.aceita && !vigente.recusada && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {!vigente.enviada ? (
                <Button
                  variant="outline"
                  className="border-success/50 text-success"
                  disabled={ocupado}
                  onClick={() => void marcarEstado("enviada", vigente.versao)}
                >
                  <CheckCircle2 /> Marcar como enviada ao cliente
                </Button>
              ) : (
                <p className="flex items-center gap-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="size-4" /> v{vigente.versao} enviada ao cliente
                </p>
              )}
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={ocupado}
                onClick={() => void marcarEstado("recusada", vigente.versao)}
              >
                Cliente recusou esta versão
              </Button>
            </div>
          )}
          {vigente.compartilhamentoIniciado && !vigente.enviada && !vigente.aceita && (
            <p className="mt-1 text-xs text-muted-foreground">
              Compartilhamento iniciado{vigente.canal ? ` (${vigente.canal})` : ""}: o painel não
              sabe se o cliente recebeu. Depois de enviar, use "Marcar como enviada ao cliente".
            </p>
          )}
        </>
      )}

      {propostas.versoes.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Propostas
            </p>
            {propostas.versoes.length >= 2 && (
              <Button size="sm" variant="ghost" onClick={abrirComparacao}>
                <GitCompare /> Comparar versões
              </Button>
            )}
          </div>
          <ul className="mt-1 divide-y text-sm">
            {(verAnteriores ? ativas : ativas.slice(0, 5)).map((p) => (
              <LinhaVersao
                key={p.versao}
                id={orcamento.id}
                p={p}
                marcada={selecionadas.includes(p.versao)}
                onMarcar={marcar}
              />
            ))}
          </ul>
          {ativas.length > 5 && (
            <button
              type="button"
              className="mt-1 text-xs font-medium underline"
              onClick={() => setVerAnteriores(!verAnteriores)}
            >
              {verAnteriores
                ? "Mostrar só as 5 mais recentes"
                : `Ver versões anteriores (${ativas.length - 5})`}
            </button>
          )}
          {arquivadas.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Arquivadas ({arquivadas.length})
              </summary>
              <ul className="mt-1 divide-y text-sm">
                {arquivadas.map((p) => (
                  <LinhaVersao
                    key={p.versao}
                    id={orcamento.id}
                    p={p}
                    marcada={selecionadas.includes(p.versao)}
                    onMarcar={marcar}
                  />
                ))}
              </ul>
            </details>
          )}
          {escolhidas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Ações das versões selecionadas">
              {escolhidas.some((v) => v.podeArquivar) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado}
                  onClick={() =>
                    void gerenciar(
                      "arquivar",
                      escolhidas.filter((v) => v.podeArquivar).map((v) => v.versao),
                    )
                  }
                >
                  <Archive /> Arquivar selecionadas
                </Button>
              )}
              {escolhidas.some((v) => v.arquivada) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado}
                  onClick={() =>
                    void gerenciar(
                      "desarquivar",
                      escolhidas.filter((v) => v.arquivada).map((v) => v.versao),
                    )
                  }
                >
                  <ArchiveRestore /> Desarquivar
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={ocupado || !escolhidas.some((v) => v.podeExcluir)}
                title="Só versões nunca marcadas como enviadas, recusadas ou aceitas (e que não sejam a vigente)"
                onClick={() =>
                  void gerenciar(
                    "excluir",
                    escolhidas.filter((v) => v.podeExcluir).map((v) => v.versao),
                  )
                }
              >
                <Trash2 /> Excluir rascunhos selecionados
              </Button>
              {escolhidas.length === 2 && (
                <Button size="sm" variant="outline" onClick={abrirComparacao}>
                  <GitCompare /> Comparar as 2
                </Button>
              )}
            </div>
          )}
          {propostas.excluidas > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {propostas.excluidas} versão(ões) excluída(s) (registradas na auditoria).
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Gerar a proposta não é aceite. Abrir WhatsApp/e-mail/compartilhar só inicia o
        compartilhamento; versões marcadas como enviadas, recusadas ou aceitas não podem ser
        excluídas; o número de uma versão nunca é reutilizado.
      </p>
      {dialogo && vigente && (
        <DialogoEnvio
          tipo={dialogo}
          id={orcamento.id}
          versao={vigente.versao}
          aoFechar={() => {
            setDialogo(null);
            void recarregar();
          }}
        />
      )}
      {comparar && (
        <DialogoComparar
          id={orcamento.id}
          versoes={propostas.versoes.map((v) => v.versao)}
          inicial={comparar}
          aoFechar={() => setComparar(null)}
        />
      )}
    </Card>
  );
}

type VersaoResumo = Dados["propostas"]["versoes"][number];
function LinhaVersao({
  id,
  p,
  marcada,
  onMarcar,
}: {
  id: string;
  p: VersaoResumo;
  marcada: boolean;
  onMarcar: (versao: number, sim: boolean) => void;
}) {
  const selo = (texto: string, tom: string) => (
    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${tom}`}>
      {texto}
    </span>
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
      <label className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-brand"
          aria-label={`Selecionar v${p.versao}`}
          checked={marcada}
          onChange={(e) => onMarcar(p.versao, e.target.checked)}
        />
        <span>
          <b>v{p.versao}</b> — {diaHora(p.criadaEm)} — gerada por {p.geradaPor}
        </span>
        <span className="flex flex-wrap gap-1">
          {p.vigente && selo("VIGENTE", "bg-brand text-primary-foreground")}
          {p.aceita &&
            selo(
              p.aceitaAtual ? "ACEITA" : "ACEITA (REVISADA)",
              "bg-success text-primary-foreground",
            )}
          {!p.aceita && p.recusada && selo("RECUSADA", "bg-destructive text-primary-foreground")}
          {!p.aceita &&
            !p.recusada &&
            p.substituida &&
            selo("SUBSTITUÍDA", "bg-muted text-muted-foreground")}
          {!p.aceita &&
            !p.recusada &&
            p.enviada &&
            selo("ENVIADA", "bg-graphite text-graphite-foreground")}
          {!p.aceita &&
            !p.recusada &&
            !p.enviada &&
            p.compartilhamentoIniciado &&
            selo("COMPARTILHAMENTO INICIADO", "border border-amber-500/60 text-amber-900")}
          {p.vigente &&
            !p.aceita &&
            !p.recusada &&
            !p.enviada &&
            !p.compartilhamentoIniciado &&
            selo("GERADA", "border text-muted-foreground")}
          {p.arquivada && selo("ARQUIVADA", "bg-muted text-muted-foreground")}
        </span>
      </label>
      <span className="flex gap-3 text-xs">
        <a
          className="underline"
          href={urlProposta(id, p.versao, "visualizar")}
          target="_blank"
          rel="noopener"
        >
          Ver
        </a>
        <a className="underline" href={urlProposta(id, p.versao, "baixar")} download={p.arquivo}>
          Baixar
        </a>
      </span>
    </li>
  );
}

/** Diferenças entre duas versões: produtos, quantidades, preços, descontos, frete, montagem, condição, validade e total. */
function DialogoComparar({
  id,
  versoes,
  inicial,
  aoFechar,
}: {
  id: string;
  versoes: number[];
  inicial: [number, number];
  aoFechar: () => void;
}) {
  const compararFn = useServerFn(compararVersoesDaProposta);
  const [a, setA] = useState(Math.min(...inicial));
  const [b, setB] = useState(Math.max(...inicial));
  const q = useQuery({
    queryKey: ["interno", "proposta-comparar", id, a, b],
    enabled: a !== b,
    queryFn: () => compararFn({ data: { id, a, b } }),
  });
  const escolha = (valor: number, mudar: (v: number) => void, rotulo: string) => (
    <label className="text-sm font-medium">
      {rotulo}
      <select
        className={`${campo} w-28`}
        value={valor}
        onChange={(e) => mudar(Number(e.target.value))}
      >
        {versoes.map((v) => (
          <option key={v} value={v}>
            v{v}
          </option>
        ))}
      </select>
    </label>
  );
  const r = q.data;
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Comparar versões da proposta</DialogTitle>
          <DialogDescription>
            Produtos, quantidades, preços, descontos, frete, montagem, condição, validade e total.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          {escolha(a, setA, "Antes")}
          {escolha(b, setB, "Depois")}
        </div>
        {a === b ? (
          <p className="text-sm text-muted-foreground">Escolha duas versões diferentes.</p>
        ) : q.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Comparando…
          </div>
        ) : q.isError || !r ? (
          <p className="text-sm text-destructive">{mensagemErro(q.error)}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              v{r.de} ({diaHora(r.deEm)}) → v{r.para} ({diaHora(r.paraEm)})
            </p>
            {!r.itens.length && !r.gerais.length && (
              <p className="rounded-md border bg-surface p-3">
                Nenhuma diferença entre as duas versões.
              </p>
            )}
            {r.itens.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-surface text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2">Mudança</th>
                      <th className="px-3 py-2">v{r.de}</th>
                      <th className="px-3 py-2">v{r.para}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.itens.map((l, n) => (
                      <tr key={`${l.item}-${n}`} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">{l.item}</td>
                        <td className="px-3 py-2">
                          {l.mudanca}
                          {l.campos.length ? `: ${l.campos.join(", ")}` : ""}
                        </td>
                        <td className="px-3 py-2">{l.antes}</td>
                        <td className="px-3 py-2">{l.depois}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.gerais.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[420px] text-sm">
                  <thead className="bg-surface text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Campo</th>
                      <th className="px-3 py-2">v{r.de}</th>
                      <th className="px-3 py-2">v{r.para}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.gerais.map((g) => (
                      <tr key={g.campo} className="border-t">
                        <td className="px-3 py-2 font-medium">{g.campo}</td>
                        <td className="px-3 py-2">{g.antes}</td>
                        <td className="px-3 py-2 font-semibold">{g.depois}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** WhatsApp e e-mail: textos prontos e editáveis; nada sai sem o clique do vendedor (e o PDF nunca vai por link público). */
function DialogoEnvio({
  tipo,
  id,
  versao,
  aoFechar,
}: {
  tipo: "whatsapp" | "email";
  id: string;
  versao: number;
  aoFechar: () => void;
}) {
  const dadosFn = useServerFn(dadosDeEnvioDaProposta);
  const acaoFn = useServerFn(registrarAcaoDaProposta);
  const emailFn = useServerFn(enviarPropostaPorEmail);
  const [d, setD] = useState<Awaited<ReturnType<typeof dadosDeEnvioDaProposta>> | null>(null);
  const [erro, setErro] = useState("");
  const [telefone, setTelefone] = useState("");
  const [texto, setTexto] = useState("");
  const [para, setPara] = useState("");
  const [assunto, setAssunto] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [conferido, setConferido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  useEffect(() => {
    dadosFn({ data: { id, versao } })
      .then((r) => {
        setD(r);
        setTelefone(r.whatsapp.telefone ? telefoneBR(r.whatsapp.telefone) : "");
        setTexto(r.whatsapp.texto);
        setPara(r.email.para);
        setAssunto(r.email.assunto);
        setMensagem(r.email.mensagem);
      })
      .catch((e) => setErro(mensagemErro(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const registrar = (acao: "whatsapp" | "email") => {
    void acaoFn({ data: { id, versao, acao } }).catch(() => {});
    toast.message(
      'Compartilhamento iniciado. Quando o cliente receber, marque "Marcar como enviada ao cliente".',
    );
  };
  const pdf = urlProposta(id, versao, "baixar");
  const numero = telefoneWhatsApp(telefone);
  const linkWhatsApp = `https://wa.me/${numero ?? ""}?text=${encodeURIComponent(texto)}`;
  const destinatarios = para
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((e) => encodeURIComponent(e).replace(/%40/g, "@"))
    .join(",");
  const linkEmail = `mailto:${destinatarios}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`;
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await emailFn({ data: { id, versao, para, assunto, mensagem, confirmado: true } });
      if (r.ok) {
        setEnviado(true);
        toast.success('E-mail enviado com o PDF anexado. Marque "Enviado ao cliente" em Ações.');
      } else toast.error(r.mensagem);
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !enviando) aoFechar();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {tipo === "whatsapp" ? "Enviar pelo WhatsApp" : "Enviar por e-mail"} — proposta v
            {versao}
          </DialogTitle>
          <DialogDescription>
            {tipo === "whatsapp"
              ? "O WhatsApp abre com a mensagem pronta. O PDF não vai junto sozinho: baixe e anexe na conversa."
              : "Confira Para, Assunto, Mensagem e o PDF. Nada é enviado sem o seu clique."}
          </DialogDescription>
        </DialogHeader>
        {!d ? (
          erro ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {erro}
            </p>
          ) : (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Preparando…
            </div>
          )
        ) : tipo === "whatsapp" ? (
          <div className="space-y-3 text-sm">
            <Campo rotulo="WhatsApp do cliente">
              <input
                className={campo}
                value={telefone}
                inputMode="tel"
                placeholder="(85) 99999-9999"
                onChange={(e) => setTelefone(e.target.value)}
              />
            </Campo>
            {!numero && (
              <p className="text-xs text-muted-foreground">
                Sem número válido: o WhatsApp abre para você escolher o contato.
              </p>
            )}
            <Campo rotulo="Mensagem">
              <textarea
                className={`${campo} h-56 py-2`}
                maxLength={4000}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </Campo>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <a href={pdf} download={d.arquivo}>
                  <FileDown /> 1. Baixar PDF
                </a>
              </Button>
              <Button asChild>
                <a
                  href={linkWhatsApp}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => registrar("whatsapp")}
                >
                  <MessageCircle /> 2. Abrir WhatsApp
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Arquivo: {d.arquivo}</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <Campo rotulo="Para">
              <input
                className={campo}
                value={para}
                type="email"
                multiple
                placeholder="cliente@empresa.com.br"
                onChange={(e) => setPara(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Assunto">
              <input
                className={campo}
                value={assunto}
                maxLength={200}
                onChange={(e) => setAssunto(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Mensagem">
              <textarea
                className={`${campo} h-64 py-2`}
                maxLength={6000}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
              />
            </Campo>
            <p className="rounded-md border bg-surface p-2">
              PDF anexado:{" "}
              <a className="font-medium underline" href={pdf} download={d.arquivo}>
                {d.arquivo}
              </a>
            </p>
            {d.envioPeloServidor ? (
              enviado ? (
                <p className="rounded-md border border-success/40 bg-success-soft p-2 font-semibold">
                  E-mail enviado.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="flex items-start gap-2 font-medium">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-brand"
                      checked={conferido}
                      onChange={(e) => setConferido(e.target.checked)}
                    />{" "}
                    Conferi destinatário, assunto, mensagem e o PDF.
                  </label>
                  <Button disabled={!conferido || enviando} onClick={enviar}>
                    {enviando ? <Loader2 className="animate-spin" /> : <Send />} Enviar e-mail
                  </Button>
                </div>
              )
            ) : (
              <div className="space-y-2">
                <p className="rounded-md border border-amber-500/50 bg-amber-50 p-2 text-amber-900">
                  O envio direto pelo painel ainda não está configurado. Abra no seu programa de
                  e-mail e anexe o PDF baixado.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a href={pdf} download={d.arquivo}>
                      <FileDown /> 1. Baixar PDF
                    </a>
                  </Button>
                  <Button asChild>
                    <a href={linkEmail} onClick={() => registrar("email")}>
                      <Mail /> 2. Abrir no programa de e-mail
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Busca no cadastro do Omie (publicados no site e os demais), sem chamar o Omie. */
function SeletorProduto({ onEscolher }: { onEscolher: (p: ProdutoInterno) => void }) {
  const indice = useQuery({
    queryKey: ["interno", "produtos", "todos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await fetch("/api/interno/produtos?todos=1", { credentials: "same-origin" });
      if (!r.ok) {
        await r.text().catch(() => "");
        throw new Error(r.status === 403 ? "Forbidden: sem permissão" : `Falha ${r.status}`);
      }
      return (await r.json()) as { itens: ProdutoInterno[] };
    },
  });
  const [busca, setBusca] = useState("");
  const resultado = useMemo(
    () =>
      busca.trim().length >= 2 ? buscarProdutos(indice.data?.itens ?? [], busca, "todos", 8) : null,
    [indice.data, busca],
  );
  return (
    <div className="mt-3 rounded-md border bg-surface p-3">
      <label className="relative block">
        <span className="sr-only">Adicionar produto</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Adicionar produto: nome, SKU, código ou EAN"
          className="h-10 w-full rounded-md border bg-card pl-9 pr-3 text-sm"
        />
      </label>
      {indice.isLoading && (
        <p className="mt-2 text-xs text-muted-foreground">Carregando produtos…</p>
      )}
      {resultado && (
        <ul className="mt-2 divide-y rounded-md border bg-card">
          {resultado.itens.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface"
                onClick={() => {
                  onEscolher(p);
                  setBusca("");
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.nome}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    SKU {p.sku} · {p.unidade}
                    {!p.publicado ? " · fora do site" : ""}
                    {p.inativo ? " · INATIVO no Omie" : ""}
                  </span>
                </span>
                <Plus className="size-4 shrink-0 text-brand" />
              </button>
            </li>
          ))}
          {!resultado.itens.length && (
            <li className="px-3 py-2 text-sm text-muted-foreground">Nenhum produto encontrado.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function SecaoOmie({
  dados,
  aoRevisar,
  recarregar,
}: {
  dados: Dados;
  aoRevisar: () => void;
  recarregar: () => Promise<void>;
}) {
  const { orcamento, envio, vendedorDono } = dados;
  const verificarFn = useServerFn(verificarPedidoOmie);
  const statusFn = useServerFn(atualizarStatusOmie);
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (acao: () => Promise<{ ok: boolean; mensagem?: string }>, ok: string) => {
    setOcupado(true);
    try {
      const r = await acao();
      if (r.ok) toast.success(ok);
      else toast.error(r.mensagem ?? "Não foi possível concluir");
      await recarregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  };
  if (envio?.estado === "criado") {
    return (
      <Card title="Pedido no Omie">
        <p className="text-2xl font-semibold">
          Pedido Omie #{envio.numeroPedido ?? envio.codigoPedido}
        </p>
        <Rows
          rows={[
            ["Código de integração", envio.integracao || orcamento.numero],
            ["Orçamento criado por", orcamento.donoEmail ?? "-"],
            ["Pedido criado por", envio.enviadoPorEmail ?? "-"],
            ["Enviado em", envio.enviadoEm ? fmtDate(envio.enviadoEm) : "-"],
            [
              "Vendedor",
              vendedorDono ? `${vendedorDono.nome} (${envio.vendedor})` : (envio.vendedor ?? "-"),
            ],
            ["Cliente", `${orcamento.cliente.nome} (Omie ${envio.cliente ?? "-"})`],
            ["Código do pedido (Omie)", envio.codigoPedido ?? "-"],
            ["Total", reais(orcamento.totais.totalCentavos)],
            [
              "Status",
              envio.status
                ? `Etapa ${envio.status.etapa}${envio.status.etapaDescricao ? ` — ${envio.status.etapaDescricao}` : ""}${envio.status.faturado ? " · faturado" : ""}${envio.status.cancelado ? " · cancelado" : ""}`
                : "ainda não consultado",
            ],
            ["Consultado em", envio.status ? fmtDate(envio.status.consultadoEm) : "-"],
          ]}
        />
        <ConferenciaOmie c={envio.conferencia} />
        <Button
          variant="outline"
          className="mt-3 w-full"
          disabled={ocupado}
          onClick={() => rodar(() => statusFn({ data: { id: orcamento.id } }), "Status atualizado")}
        >
          <RefreshCw /> Atualizar status do Omie
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          O painel só cria e consulta. Faturar, alterar (inclusive a previsão operacional) ou
          cancelar: diretamente no Omie — a proposta aceita não muda.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Pedido de Venda no Omie">
      {envio && (envio.estado === "incerto" || envio.estado === "enviando") && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-destructive" /> Envio sem confirmação do Omie
          </p>
          <p className="mt-1 text-muted-foreground">
            O pedido pode ter sido criado. Antes de qualquer nova tentativa o sistema consulta o
            Omie pelo código {orcamento.numero}.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={ocupado}
            onClick={() =>
              rodar(() => verificarFn({ data: { id: orcamento.id } }), "Verificado no Omie")
            }
          >
            Verificar no Omie
          </Button>
        </div>
      )}
      {envio?.estado === "erro" && envio.ultimoErro && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Última tentativa: {envio.ultimoErro}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Vendedor:{" "}
        {vendedorDono ? (
          <b className="text-foreground">
            {vendedorDono.nome} (código {vendedorDono.codigo})
          </b>
        ) : (
          <span className="text-destructive">responsável sem vendedor do Omie vinculado</span>
        )}
      </p>
      {podeGerarPedido(orcamento.estado) && (
        <Button className="mt-3 w-full" onClick={aoRevisar}>
          <Send /> Gerar Pedido no Omie
        </Button>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Abre a revisão obrigatória (estoque, vendedor, cliente e condições). Nada é enviado sem
        confirmação.
      </p>
    </Card>
  );
}

/** Leitura de volta do pedido no Omie logo depois de criado: o que foi gravado é igual ao revisado? */
function ConferenciaOmie({ c }: { c: ConferenciaPedido | null }) {
  if (!c)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Conferência no Omie não feita logo após criar: confira com "Atualizar status do Omie" e no
        próprio Omie.
      </p>
    );
  if (c.confere) {
    return (
      <p className="mt-2 rounded-md border border-success/40 bg-success-soft p-2 text-xs">
        Conferido no Omie: cliente, vendedor, itens (produto, quantidade, preço e desconto),
        condição, etapa, categoria, conta e total iguais ao revisado; estoque não reservado.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-md border-2 border-destructive bg-destructive/5 p-2 text-xs">
      <p className="font-semibold">
        Divergência entre o revisado e o gravado no Omie: {c.divergencias.join(", ")}.
      </p>
      <p className="mt-1">
        Total no Omie:{" "}
        {c.lido.valorTotal === null ? "-" : reais(Math.round(c.lido.valorTotal * 100))} · revisado:{" "}
        {reais(Math.round(c.esperado.valorTotal * 100))}. Confira o pedido no Omie.
      </p>
    </div>
  );
}

type Integridade = {
  versao: number;
  cliente: { nome: string | null; codigo: string | null; confere: boolean };
  vendedor: { nome: string | null; codigo: string | null; confere: boolean };
  conta: { nome: string | null; codigo: string | null; confere: boolean };
  integro: boolean;
};
/**
 * Integridade da conversão, antes de qualquer envio: versão aceita × pedido montado para o Omie — cliente, vendedor, itens
 * (SKU, quantidade, preço, desconto, total), condição, previsão, desconto geral, frete, montagem e total. Qualquer diferença,
 * inclusive R$ 0,01, deixa o pedido "não íntegro" e a criação bloqueada.
 */
function IntegridadeDaConversao({
  c,
  integridade,
}: {
  c: ConferenciaAceita;
  integridade: Integridade | null;
}) {
  const integro = integridade ? integridade.integro : c.confere;
  const valor = (v: number | null | undefined) => (v === null || v === undefined ? "—" : reais(v));
  const qtd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : qtdBR(v));
  const celula = (diferente: boolean, texto: string) => (
    <td className={`text-right ${diferente ? "font-semibold text-destructive" : ""}`}>{texto}</td>
  );
  const marca = (ok: boolean) => (
    <span className={ok ? "text-success" : "font-semibold text-destructive"}>{ok ? "✓" : "✗"}</span>
  );
  return (
    <section
      aria-label="Integridade da conversão"
      className={`rounded-md border-2 p-3 ${integro ? "border-success/50" : "border-destructive bg-destructive/5"}`}
    >
      <p className="flex flex-wrap items-center justify-between gap-2 font-semibold">
        <span>
          INTEGRIDADE DA CONVERSÃO · proposta aceita{integridade ? ` v${integridade.versao}` : ""} ×
          Pedido Omie
        </span>
        <span className={integro ? "text-success" : "text-destructive"}>
          {integro ? "✓ Íntegro" : "✗ Não íntegro"}
        </span>
      </p>
      {integridade && (
        <ul className="mt-2 space-y-0.5 text-xs">
          <li className={integridade.cliente.confere ? "" : "font-semibold text-destructive"}>
            Cliente: {integridade.cliente.nome ?? "—"} · Omie {integridade.cliente.codigo ?? "—"}{" "}
            {marca(integridade.cliente.confere)}
          </li>
          <li className={integridade.vendedor.confere ? "" : "font-semibold text-destructive"}>
            Vendedor: {integridade.vendedor.nome ?? "—"} · codVend{" "}
            {integridade.vendedor.codigo ?? "—"} {marca(integridade.vendedor.confere)}
          </li>
          <li className={integridade.conta.confere ? "" : "font-semibold text-destructive"}>
            Conta corrente: {integridade.conta.nome ?? "—"} · {integridade.conta.codigo ?? "—"} —
            selecionada para esta venda {marca(integridade.conta.confere)}
          </li>
        </ul>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[620px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-2">Item</th>
              <th>Origem</th>
              <th>SKU</th>
              <th className="text-right">Qtd</th>
              <th className="text-right">Preço</th>
              <th className="text-right">Desconto</th>
              <th className="text-right">Total</th>
              <th className="pl-2 text-right">Confere</th>
            </tr>
          </thead>
          <tbody>
            {c.itens.map((l) => {
              const d = new Set(l.diferencas);
              return (
                <Fragment key={l.item}>
                  <tr className="border-t">
                    <td className="py-1 pr-2 align-top" rowSpan={2}>
                      {l.item}
                    </td>
                    <td>Aceita</td>
                    <td>
                      <span className="font-mono">{l.sku || "—"}</span>
                      {l.nome && (
                        <span className="block text-[11px] text-muted-foreground">{l.nome}</span>
                      )}
                    </td>
                    <td className="text-right">{qtd(l.aceito?.quantidade)}</td>
                    <td className="text-right">{valor(l.aceito?.precoCentavos)}</td>
                    <td className="text-right">{valor(l.aceito?.descontoCentavos)}</td>
                    <td className="text-right">{valor(l.aceito?.totalCentavos)}</td>
                    <td className="pl-2 text-right align-top" rowSpan={2}>
                      {l.diferencas.length ? (
                        <span className="font-semibold text-destructive">
                          ✗ {l.diferencas.join(", ")}
                        </span>
                      ) : (
                        <span className="text-success">✓</span>
                      )}
                    </td>
                  </tr>
                  <tr className="text-muted-foreground">
                    <td className="pb-1">Omie</td>
                    <td
                      className={`font-mono ${d.has("produto") || d.has("SKU") || d.has("item") ? "font-semibold text-destructive" : ""}`}
                    >
                      {l.omie
                        ? `${l.skuOmie ?? "SKU não conferido"} · cód. ${l.omie.produtoId}`
                        : "—"}
                    </td>
                    {celula(d.has("quantidade"), qtd(l.omie?.quantidade))}
                    {celula(d.has("preço"), valor(l.omie?.precoCentavos))}
                    {celula(d.has("desconto"), valor(l.omie?.descontoCentavos))}
                    {celula(d.has("total"), valor(l.omie?.totalCentavos))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs">
        {c.gerais.map((g) => (
          <li key={g.campo} className={g.confere ? "" : "font-semibold text-destructive"}>
            {g.campo}: aceita {g.aceito} · Omie {g.omie} {g.confere ? "✓" : "✗"}
          </li>
        ))}
      </ul>
      <p
        className={`mt-2 grid gap-1 rounded bg-surface p-2 sm:grid-cols-3 ${c.confere ? "" : "font-semibold text-destructive"}`}
      >
        <span>
          Total aceito: <b>{reais(c.totalAceitoCentavos)}</b>
        </span>
        <span>
          Total Omie: <b>{reais(c.totalOmieCentavos)}</b>
        </span>
        <span>
          Diferença: <b>{reais(c.diferencaCentavos)}</b> {c.diferencaCentavos === 0 ? "✓" : "✗"}
        </span>
      </p>
      <p
        className={`mt-2 rounded p-2 text-center text-base font-bold tracking-wide ${integro ? "bg-success-soft text-success" : "bg-destructive/10 text-destructive"}`}
      >
        {integro ? "PEDIDO ÍNTEGRO" : "PEDIDO NÃO ÍNTEGRO — criação bloqueada"}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Qualquer diferença com a versão aceita, inclusive R$ 0,01, bloqueia a criação (conferido de
        novo no envio).
      </p>
    </section>
  );
}

function RevisaoPedido({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const revisarFn = useServerFn(revisarPedidoOmie);
  const gerarFn = useServerFn(gerarPedidoOmie);
  const vincularFn = useServerFn(vincularClienteOmie);
  const criarClienteFn = useServerFn(criarClienteNoOmie);
  const buscarFn = useServerFn(buscarClientesNoOmie);
  const emailFn = useServerFn(usarEmailDoCadastroOmie);
  const [rev, setRev] = useState<Revisao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [revisado, setRevisado] = useState(false);
  const [semEstoque, setSemEstoque] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{
    tipo: "ok" | "simulado" | "erro";
    texto: string;
    payload?: unknown;
    numero?: string | null;
    conferencia?: ConferenciaPedido | null;
  } | null>(null);
  const [buscaNome, setBuscaNome] = useState("");
  const [encontrados, setEncontrados] = useState<
    | {
        codigo: string;
        razaoSocial: string;
        cidade: string;
        estado: string;
        documento: string;
        inativo: boolean;
      }[]
    | null
  >(null);
  const [haMais, setHaMais] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setErro("");
    setRevisado(false);
    setSemEstoque(false);
    setResultado(null);
    try {
      setRev(await revisarFn({ data: { id } }));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => {
    void carregar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vincular = async (codigo: string) => {
    try {
      await vincularFn({ data: { id, codigoCliente: codigo } });
      toast.success("Cliente do Omie vinculado");
      await carregar();
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };
  const gerar = async () => {
    if (!rev || !("token" in rev) || !rev.token) return;
    setEnviando(true);
    try {
      const r = await gerarFn({ data: { id, token: rev.token, revisado: true, semEstoque } });
      if (r.ok) {
        const envio = "envio" in r ? r.envio : null;
        setResultado({
          tipo: "ok",
          texto:
            "jaExistia" in r && r.jaExistia
              ? "O pedido já existia no Omie com este código: vínculo registrado (nada foi duplicado)."
              : "Pedido de Venda criado no Omie.",
          numero: envio ? (envio.numeroPedido ?? envio.codigoPedido) : null,
          conferencia: envio ? envio.conferencia : null,
        });
      } else if ("simulado" in r && r.simulado)
        setResultado({
          tipo: "simulado",
          texto: r.mensagem ?? "",
          payload: "payload" in r ? r.payload : null,
        });
      else
        setResultado({
          tipo: "erro",
          texto: ("mensagem" in r && r.mensagem) || "Não foi possível criar o pedido.",
        });
    } catch (e) {
      setResultado({ tipo: "erro", texto: mensagemErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  const pronto = rev && "situacao" in rev && rev.situacao === "pronto";
  const resumo = rev && "resumo" in rev ? rev.resumo : null;
  const estoque = rev && "estoque" in rev ? rev.estoque : null;
  const escrita = Boolean(rev && "escrita" in rev && rev.escrita);
  const precisaConfirmarEstoque = Boolean(estoque?.falta && estoque.politica === "confirmar");
  const podeEnviar =
    pronto && revisado && (!precisaConfirmarEstoque || semEstoque) && !enviando && !resultado;

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !enviando) aoFechar();
      }}
    >
      {/* grid-cols-1 = minmax(0, 1fr): as tabelas largas rolam dentro da própria caixa, sem alargar o diálogo no celular. */}
      <DialogContent className="max-h-[92vh] grid-cols-1 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisão do Pedido de Venda</DialogTitle>
          <DialogDescription>
            Confira tudo abaixo. Estoque, vendedor e cliente foram consultados agora no Omie
            (somente leitura).
          </DialogDescription>
        </DialogHeader>
        {carregando ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Conferindo estoque, vendedor e cliente no
            Omie…
          </div>
        ) : erro ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {erro}
          </p>
        ) : rev && "mensagem" in rev && rev.situacao === "indisponivel" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {rev.mensagem}
          </p>
        ) : rev && rev.situacao === "ja_enviado" ? (
          <p className="rounded-md border border-success/40 bg-success-soft p-3 text-sm">
            Este orçamento já tem Pedido no Omie: #
            {rev.envio?.numeroPedido ?? rev.envio?.codigoPedido}. Nada foi enviado de novo.
          </p>
        ) : rev && resumo && estoque && "bloqueios" in rev ? (
          <div className="space-y-4 text-sm">
            {escrita ? (
              <p className="flex items-center gap-2 rounded-md border-2 border-destructive bg-destructive/5 p-3 font-semibold">
                <AlertTriangle className="size-5 text-destructive" /> Esta ação criará um Pedido de
                Venda no Omie.
              </p>
            ) : (
              <p className="rounded-md border border-amber-500/50 bg-amber-50 p-3 font-semibold text-amber-900">
                Modo simulação: a escrita no Omie está desligada. O pedido será montado e validado,
                mas NADA será enviado ao Omie.
              </p>
            )}
            {rev.bloqueios.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 pl-7">
                {rev.bloqueios.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {!resumo.emailNf && (
              <div className="rounded-md border p-3">
                <p className="font-semibold">E-mail para a nota fiscal</p>
                {resumo.emailCadastro ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={async () => {
                      try {
                        await emailFn({ data: { id } });
                        toast.success("E-mail da NF definido com o do cadastro do cliente no Omie");
                        await carregar();
                      } catch (e) {
                        toast.error(mensagemErro(e));
                      }
                    }}
                  >
                    Usar o e-mail do cadastro do cliente no Omie ({resumo.emailCadastro})
                  </Button>
                ) : (
                  <p className="text-muted-foreground">
                    Vincule o cliente do Omie para usar o e-mail do cadastro dele.
                  </p>
                )}
              </div>
            )}
            {rev.avisos.length > 0 && (
              <ul className="list-disc space-y-1 rounded-md border border-amber-500/40 bg-amber-50 p-3 pl-7 text-amber-900">
                {rev.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}

            {rev.candidatos && (
              <div className="rounded-md border p-3">
                <p className="font-semibold">Cliente no Omie</p>
                <p className="text-muted-foreground">
                  Orçamento: {resumo.clienteOrcamento.nome} · CPF/CNPJ{" "}
                  {resumo.clienteOrcamento.documento ?? "não informado"}
                </p>
                {rev.candidatos.length > 0 ? (
                  <ul className="mt-2 divide-y rounded-md border">
                    {rev.candidatos.map((c) => (
                      <li
                        key={c.codigo}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span>
                          <b>{c.razaoSocial}</b> · {c.cidade}
                          {c.estado ? `/${c.estado}` : ""} · doc. {c.documento} · Omie {c.codigo}
                          {c.inativo ? " · INATIVO" : ""}
                        </span>
                        <Button size="sm" disabled={c.inativo} onClick={() => vincular(c.codigo)}>
                          Usar este cliente
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 space-y-2">
                    <p>
                      {resumo.clienteOrcamento.documento
                        ? "Nenhum cliente com este CPF/CNPJ no Omie."
                        : "Sem CPF/CNPJ no orçamento: procure pelo nome e escolha manualmente (nunca por nome sozinho sem conferir)."}
                    </p>
                    {resumo.clienteOrcamento.documento && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Criar o cliente "${resumo.clienteOrcamento.nome}" (CPF/CNPJ ${resumo.clienteOrcamento.documento}) no Omie com os dados do orçamento?`,
                            )
                          )
                            return;
                          try {
                            const r = await criarClienteFn({ data: { id, confirmado: true } });
                            if (r.ok) {
                              toast.success("Cliente criado no Omie e vinculado");
                              await carregar();
                            } else toast.message(r.mensagem ?? "Não foi possível criar o cliente");
                          } catch (e) {
                            toast.error(mensagemErro(e));
                          }
                        }}
                      >
                        Criar cliente no Omie
                      </Button>
                    )}
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const doc = digitos(buscaNome);
                        try {
                          const r = await buscarFn({
                            data:
                              doc.length === 11 || doc.length === 14
                                ? { id, documento: doc }
                                : { id, nome: buscaNome.trim() },
                          });
                          if (r.ok && "clientes" in r && r.clientes) {
                            setEncontrados(r.clientes);
                            setHaMais("mais" in r && r.mais === true);
                          } else
                            toast.error(("mensagem" in r && r.mensagem) || "Busca indisponível");
                        } catch (e2) {
                          toast.error(mensagemErro(e2));
                        }
                      }}
                    >
                      <input
                        value={buscaNome}
                        onChange={(e) => setBuscaNome(e.target.value)}
                        placeholder="Razão social ou CPF/CNPJ"
                        className="h-9 flex-1 rounded-md border bg-card px-3"
                      />
                      <Button size="sm" type="submit" variant="outline">
                        Buscar no Omie
                      </Button>
                    </form>
                    {encontrados && (
                      <ul className="divide-y rounded-md border">
                        {encontrados.length ? (
                          encontrados.map((c) => (
                            <li
                              key={c.codigo}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <span>
                                <b>{c.razaoSocial}</b> · {c.cidade}
                                {c.estado ? `/${c.estado}` : ""} · doc. {c.documento} · Omie{" "}
                                {c.codigo}
                              </span>
                              <Button
                                size="sm"
                                disabled={c.inativo}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Vincular este orçamento ao cliente do Omie "${c.razaoSocial}" (código ${c.codigo})?`,
                                    )
                                  )
                                    void vincular(c.codigo);
                                }}
                              >
                                Escolher
                              </Button>
                            </li>
                          ))
                        ) : (
                          <li className="px-3 py-2 text-muted-foreground">
                            Nenhum cliente encontrado.
                          </li>
                        )}
                        {haMais && (
                          <li className="px-3 py-2 text-xs text-amber-900">
                            Há mais clientes com esse nome no Omie: mostrando os 20 primeiros.
                            Digite mais letras do nome (ou o CPF/CNPJ) para refinar.
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-x-6 sm:grid-cols-2">
              <Rows
                rows={[
                  ["Orçamento (código de integração)", resumo.numero],
                  [
                    "Proposta aceita (origem do pedido)",
                    resumo.propostaAceita
                      ? `v${resumo.propostaAceita.versao} — itens, preços, condição e previsão vêm só dela`
                      : "sem versão aceita",
                  ],
                  [
                    "Cliente (Omie)",
                    resumo.cliente
                      ? `${resumo.cliente.razaoSocial} · ${resumo.cliente.cidade}${resumo.cliente.estado ? `/${resumo.cliente.estado}` : ""} · doc. ${resumo.cliente.documento} · código ${resumo.cliente.codigo} · ativo`
                      : "não vinculado",
                  ],
                  ["Usuário (dono do orçamento)", resumo.responsavel || "-"],
                  ["Executor (quem cria o pedido)", resumo.executor],
                  [
                    "Vendedor Omie (do dono; não muda nesta tela)",
                    resumo.vendedor ? resumo.vendedor.nome : "não vinculado",
                  ],
                  ["Código (codVend)", resumo.vendedor ? resumo.vendedor.codigo : "-"],
                  ["Status do vendedor", resumo.vendedor ? "ativo (conferido agora no Omie)" : "-"],
                  [
                    "Etapa",
                    resumo.etapa
                      ? `${resumo.etapa.codigo} — ${resumo.etapa.descricao}`
                      : "não configurada",
                  ],
                ]}
              />
              <Rows
                rows={[
                  [
                    "Pagamento",
                    resumo.formaPagamento
                      ? `${resumo.formaPagamento.codigo} — ${resumo.formaPagamento.descricao}`
                      : "não informada",
                  ],
                  [
                    "Previsão",
                    resumo.previsao ? resumo.previsao.split("-").reverse().join("/") : "-",
                  ],
                  [
                    "Categoria",
                    resumo.categoria
                      ? `${resumo.categoria.codigo} ${resumo.categoria.descricao}`
                      : "-",
                  ],
                  [
                    "Conta corrente",
                    resumo.conta
                      ? `${resumo.conta.descricao} · ${resumo.conta.codigo} — selecionada para esta venda (congelada no aceite da v${resumo.conta.versao})${resumo.conta.ativa ? " ✓" : " — INATIVA no Omie ✗"}`
                      : "não registrada no aceite ✗",
                  ],
                  [
                    "Consumidor final / NF",
                    `${resumo.consumidorFinal ? "Sim" : "Não"} · ${resumo.emailNf ?? "sem e-mail"}`,
                  ],
                ]}
              />
            </div>
            {resumo.observacoes && (
              <p className="rounded-md bg-surface p-2">
                <b>Observações do pedido (vão ao Omie):</b> {resumo.observacoes}
              </p>
            )}
            {resumo.observacoesComerciais && (
              <p className="rounded-md bg-surface p-2 text-muted-foreground">
                As observações comerciais da proposta aceita ficam só na proposta: não vão ao Pedido
                no Omie.
              </p>
            )}

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="text-right">Qtd</th>
                    <th className="text-right">Preço unit.</th>
                    <th className="text-right">Desconto</th>
                    <th className="text-right">Total</th>
                    <th className="px-3 text-right">Disponível comercial (agora)</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.itens.map((i) => (
                    <tr
                      key={i.produtoId + i.sku}
                      className={`border-t ${i.falta ? "bg-destructive/5" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <span className="block font-medium">{i.nome}</span>
                        <span className="font-mono text-xs text-muted-foreground">SKU {i.sku}</span>
                      </td>
                      <td className="text-right">
                        {qtdBR(i.quantidade)} {i.unidade}
                      </td>
                      <td className="text-right">{reais(i.precoCentavos)}</td>
                      <td className="text-right">
                        {i.descontoCentavos ? `− ${reais(i.descontoCentavos)}` : "-"}
                      </td>
                      <td className="text-right font-semibold">{reais(i.totalCentavos)}</td>
                      <td className="px-3 text-right">
                        {i.disponivel === null ? (
                          <span className="font-semibold text-destructive">sem posição</span>
                        ) : (
                          <span className={i.falta ? "font-semibold text-destructive" : ""}>
                            {qtdBR(i.disponivel)} {i.unidade}
                          </span>
                        )}
                        {i.falta && (
                          <span className="block text-xs font-semibold text-destructive">
                            Estoque insuficiente
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-surface font-semibold">
                    <td className="px-3 py-2" colSpan={4}>
                      Total do pedido
                    </td>
                    <td className="text-right">{reais(resumo.totalCentavos)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            {estoque.consultadoEm && (
              <p className="text-xs text-muted-foreground">
                Estoque consultado no Omie em {fmtDate(estoque.consultadoEm)} (nada é reservado ou
                alterado).
              </p>
            )}
            {"conferencia" in rev && rev.conferencia && (
              <IntegridadeDaConversao
                c={rev.conferencia}
                integridade={"integridade" in rev ? rev.integridade : null}
              />
            )}

            {pronto && !resultado && (
              <div className="space-y-2 rounded-md border p-3">
                {precisaConfirmarEstoque && (
                  <label className="flex items-start gap-2 font-medium text-destructive">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-brand"
                      checked={semEstoque}
                      onChange={(e) => setSemEstoque(e.target.checked)}
                    />
                    Confirmo que o pedido segue mesmo com estoque insuficiente (encomenda).
                  </label>
                )}
                <label className="flex items-start gap-2 font-medium">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-brand"
                    checked={revisado}
                    onChange={(e) => setRevisado(e.target.checked)}
                  />
                  Revisei cliente, vendedor, itens, preços, condição de pagamento, previsão e etapa.
                </label>
                <Button
                  className={`w-full ${escrita ? "bg-destructive hover:bg-destructive/90" : ""}`}
                  disabled={!podeEnviar}
                  onClick={gerar}
                >
                  {enviando ? <Loader2 className="animate-spin" /> : <Send />}{" "}
                  {escrita ? "Criar Pedido de Venda no Omie" : "Simular envio (nada vai ao Omie)"}
                </Button>
              </div>
            )}
            {resultado && (
              <div
                className={`rounded-md border p-3 ${resultado.tipo === "ok" ? "border-success/40 bg-success-soft" : resultado.tipo === "simulado" ? "border-amber-500/50 bg-amber-50 text-amber-900" : "border-destructive/40 bg-destructive/5"}`}
              >
                <p className="font-semibold">{resultado.texto}</p>
                {resultado.tipo === "ok" && resultado.numero ? (
                  <p className="mt-1 text-lg font-semibold">Pedido Omie #{resultado.numero}</p>
                ) : null}
                {resultado.tipo === "ok" ? (
                  <ConferenciaOmie c={resultado.conferencia ?? null} />
                ) : null}
                {resultado.tipo === "simulado" && resultado.payload ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs">
                      Ver o pedido que seria enviado ao Omie
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-card p-2 text-[11px] text-foreground">
                      {JSON.stringify(resultado.payload, null, 2)}
                    </pre>
                  </details>
                ) : null}
                <Button size="sm" variant="outline" className="mt-2" onClick={aoFechar}>
                  Fechar
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
