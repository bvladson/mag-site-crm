import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ExternalLink, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { Loading, ErrorState, Empty, PageTitle } from "@/components/interno/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { buscarProdutos, CATEGORIAS, FILTROS, MAX_CONSULTA, quantidade, type FiltroId, type ProdutoInterno } from "@/lib/produtos-busca";

/**
 * Consulta rápida (só Admin e Comercial). A busca roda no navegador sobre o índice interno (carregado uma vez, sem Omie).
 * Por padrão, só os produtos publicados no site; "Mostrar todos os produtos do Omie" carrega também o cadastro completo
 * (sem estoque calculado: para esses, só o "Consultar Omie agora").
 * Os números de estoque desta tela são INTERNOS: vêm só de /api/interno/produtos, que exige sessão e perfil no servidor.
 */
export const Route = createFileRoute("/_authenticated/interno/produtos")({ component: ConsultaRapida });

type Cadastro = { geradoEm: string; total: number; foraDoSite: number; fresco: boolean; ultimaFalha: string | null };
type Indice = { ok: true; sincronizadoEm: string | null; fresco: boolean; cadastro: Cadastro | null; total: number; itens: ProdutoInterno[] };
type Local = { id: string; nome: string; comercial: boolean; padrao: boolean; saldo: number | null; fisico: number | null; pendente: number | null; reservado: number | null };
type ConsultaOk = {
  ok: true; fonte: "omie" | "cache"; consultadoEm: string; omie: { sku: string; descricao: string } | null; locais: Local[];
  resumo: { conhecido: boolean; brutoComercial: number; pendentes: number; reservas: number; comprometido: number; disponivel: number | null; totalFisico: number };
};
type ConsultaFalha = { ok: false; motivo: string; mensagem: string; ultimaSincronizacao: string | null };
const FALHA = "Não foi possível consultar o Omie agora.";

/** Erro com a mesma mensagem que o painel já usa ("Forbidden" = sem permissão). */
async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { credentials: "same-origin", ...init });
  if (!resposta.ok) {
    await resposta.text().catch(() => ""); // lê o corpo do erro: sem isso a requisição fica aberta no navegador
    if (resposta.status === 401) { window.location.href = "/interno/login"; throw new Error("Unauthorized: entre na sua conta"); }
    if (resposta.status === 403) throw new Error("Forbidden: sem permissão para esta área");
    throw new Error(`Falha ${resposta.status}`);
  }
  return resposta.json() as Promise<T>;
}

const quando = (iso: string | null | undefined, comData = false) => {
  if (!iso) return "—";
  const data = new Date(iso);
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) === data.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
  const hora = data.toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
  return hoje && !comData ? `hoje às ${hora}` : `${data.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })} às ${hora}`;
};

/** Categoria do site; fora do site sem categoria reconhecida, a família do Omie. */
const rotuloCategoria = (produto: ProdutoInterno) => CATEGORIAS[produto.categoria] ?? (produto.familia || "Sem categoria do site");

function Estoque({ produto, grande = false }: { produto: ProdutoInterno; grande?: boolean }) {
  const tamanho = grande ? "text-2xl" : "text-base";
  if (produto.estoque === null) return <p className={`${tamanho} font-semibold text-muted-foreground`}>Estoque: consultar no Omie</p>;
  if (produto.disponivel === null) return <p className={`${tamanho} font-semibold text-muted-foreground`}>Sem posição de estoque</p>;
  if (produto.disponivel <= 0) return <p className={`${tamanho} font-semibold text-muted-foreground`}>Sem estoque disponível</p>;
  return <p className={`${tamanho} font-bold text-success`}>{produto.estoque === "PRONTA_ENTREGA" ? "Pronta entrega" : "Disponível"}: {quantidade(produto.disponivel, produto.unidade)}</p>;
}

/** Selos de produto fora do site (e situação no Omie). */
function Selos({ produto }: { produto: ProdutoInterno }) {
  if (produto.publicado && !produto.inativo && !produto.bloqueado) return null;
  const selo = "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold";
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {!produto.publicado && <span className={`${selo} bg-accent text-foreground`}>Fora do site</span>}
      {produto.inativo && <span className={`${selo} bg-destructive/10 text-destructive`}>Inativo no Omie</span>}
      {produto.bloqueado && <span className={`${selo} bg-destructive/10 text-destructive`}>Bloqueado no Omie</span>}
    </span>
  );
}

function ConsultaRapida() {
  const [todos, setTodos] = useState(false);
  const indice = useQuery({
    queryKey: ["interno", "produtos", todos ? "todos" : "site"],
    queryFn: () => pedir<Indice>(todos ? "/api/interno/produtos?todos=1" : "/api/interno/produtos"),
    staleTime: 5 * 60_000, placeholderData: keepPreviousData,
  });
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroId>("todos");
  const [aberto, setAberto] = useState<ProdutoInterno | null>(null);
  const termo = useDeferredValue(busca);
  const lista = useMemo(() => (indice.data?.itens ?? []).filter((produto) => todos || produto.publicado), [indice.data, todos]);
  const resultado = useMemo(() => buscarProdutos(lista, termo, filtro, 60), [lista, termo, filtro]);

  if (indice.isLoading) return <Loading />;
  if (indice.isError || !indice.data) return <ErrorState error={indice.error} />;
  const dados = indice.data;
  const cadastro = dados.cadastro;
  return (
    <>
      <PageTitle title="Consulta rápida" />
      <div className="sticky top-[100px] z-20 -mx-4 bg-surface px-4 pb-3 pt-1 lg:-mx-6 lg:px-6">
        <label className="relative block">
          <span className="sr-only">Buscar produto</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search" autoFocus value={busca} maxLength={MAX_CONSULTA} onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, SKU, código ou EAN" autoComplete="off" spellCheck={false}
            className="h-14 w-full rounded-md border bg-card pl-12 pr-4 text-lg shadow-sm outline-none focus:border-brand"
          />
        </label>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTROS.map((item) => (
            <button key={item.id} type="button" onClick={() => setFiltro(item.id)} aria-pressed={filtro === item.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${filtro === item.id ? "border-graphite bg-graphite text-graphite-foreground" : "bg-card hover:border-foreground/40"}`}>
              {item.rotulo}
            </button>
          ))}
        </div>
        <label className={`mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm ${cadastro || todos ? "cursor-pointer" : "cursor-not-allowed text-muted-foreground"}`}>
          <input type="checkbox" className="size-4 accent-brand" checked={todos} disabled={!cadastro && !todos} onChange={(e) => setTodos(e.target.checked)} />
          <span className="font-medium">Mostrar todos os produtos do Omie</span>
          <span className="text-xs text-muted-foreground">
            {cadastro ? `(+${cadastro.foraDoSite} fora do site, inclusive inativos)` : "(cadastro completo ainda não gerado: roda às 05:20)"}
          </span>
          {indice.isPlaceholderData && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {resultado.total} {resultado.total === 1 ? "produto" : "produtos"} · estoque sincronizado com o Omie {quando(dados.sincronizadoEm)}
          {todos && cadastro && <> · cadastro completo do Omie {quando(cadastro.geradoEm)}</>}
          {!dados.fresco && <span className="font-semibold text-destructive"> · sincronização atrasada: use "Consultar Omie agora"</span>}
          {todos && cadastro && (!cadastro.fresco || cadastro.ultimaFalha) && <span className="font-semibold text-destructive"> · cadastro completo desatualizado</span>}
        </p>
      </div>
      {resultado.total === 0 ? (
        <Empty>{busca ? `Nenhum produto encontrado para “${busca.slice(0, 60)}”.` : "Nenhum produto neste filtro."}</Empty>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {resultado.itens.map((produto) => (
              <li key={produto.id}>
                <button type="button" onClick={() => setAberto(produto)}
                  className="flex h-full w-full gap-3 rounded-md border bg-card p-3 text-left transition hover:border-brand focus:border-brand focus:outline-none">
                  <img src={produto.imagem} alt="" loading="lazy" className="size-20 shrink-0 rounded bg-surface object-contain" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-2 font-semibold leading-tight">{produto.nome}</span>
                    <span className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">SKU {produto.sku} · {rotuloCategoria(produto)}</span>
                    <Selos produto={produto} />
                    <span className="mt-1"><Estoque produto={produto} /></span>
                    <span className="mt-auto flex items-center justify-between pt-1 text-xs text-muted-foreground">
                      <span>{produto.publicado ? `Atualizado ${quando(dados.sincronizadoEm)}` : `Cadastro ${quando(cadastro?.geradoEm)}`}</span>
                      <span className="font-semibold text-brand">Detalhes</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {resultado.total > resultado.itens.length && (
            <p className="mt-4 text-center text-sm text-muted-foreground">Mostrando {resultado.itens.length} de {resultado.total}. Refine a busca para ver os demais.</p>
          )}
        </>
      )}
      <Sheet open={aberto !== null} onOpenChange={(open) => { if (!open) setAberto(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {aberto && <Detalhes key={aberto.id} produto={aberto} sincronizadoEm={dados.sincronizadoEm} cadastroEm={cadastro?.geradoEm ?? null} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Detalhes({ produto, sincronizadoEm, cadastroEm }: { produto: ProdutoInterno; sincronizadoEm: string | null; cadastroEm: string | null }) {
  const qc = useQueryClient();
  const chave = ["interno", "produtos", "omie", produto.id];
  const ultima = qc.getQueryData<ConsultaOk | ConsultaFalha>(chave);
  const [consulta, setConsulta] = useState<ConsultaOk | ConsultaFalha | null>(ultima ?? null);
  const [carregando, setCarregando] = useState(false);
  const consultar = async () => {
    setCarregando(true);
    try {
      const resposta = await pedir<ConsultaOk | ConsultaFalha>(`/api/interno/produtos/${produto.id}`, { method: "POST" });
      setConsulta(resposta);
      qc.setQueryData(chave, resposta);
    } catch (error) {
      setConsulta({ ok: false, motivo: "rede", mensagem: error instanceof Error && error.message.startsWith("Forbidden") ? "Sem permissão para consultar o Omie." : "Sem conexão com o servidor do site.", ultimaSincronizacao: sincronizadoEm });
    } finally {
      setCarregando(false);
    }
  };
  const familia = produto.familia && produto.familia !== rotuloCategoria(produto) ? ` · família ${produto.familia}` : "";
  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle className="pr-6 text-2xl leading-tight">{produto.nome}</SheetTitle>
        <SheetDescription className="[overflow-wrap:anywhere]">
          SKU {produto.sku} · {rotuloCategoria(produto)}{produto.marca ? ` · ${produto.marca}` : ""}{familia} · código Omie {produto.id}{produto.ean ? ` · EAN ${produto.ean}` : ""}
        </SheetDescription>
      </SheetHeader>
      <img src={produto.foto} alt="" className="mt-4 max-h-64 w-full rounded-md bg-surface object-contain" />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {produto.publicado && produto.slug ? (
          <>
            <span className="rounded-sm bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Publicado no site</span>
            <a href={`/produto/${produto.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand underline">
              Abrir produto no site <ExternalLink className="size-3.5" />
            </a>
          </>
        ) : (
          <>
            <Selos produto={produto} />
            <span className="text-xs text-muted-foreground">Não aparece no site (só nesta consulta interna).</span>
          </>
        )}
      </div>

      <section className="mt-5 rounded-md border p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-brand">Disponível para venda</h3>
        <div className="mt-1"><Estoque produto={produto} grande /></div>
        {produto.publicado ? (
          <p className="mt-1 text-xs text-muted-foreground">Última sincronização com o Omie: {quando(sincronizadoEm, true)}. Mesma regra do selo "Pronta entrega" do site.</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Produto fora do site: o estoque dele não entra na sincronização diária. Use “Consultar Omie agora” para ver o estoque
            por local. Cadastro completo do Omie: {quando(cadastroEm, true)}.
          </p>
        )}
      </section>

      <section className="mt-4 rounded-md border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-brand">Estoque no Omie</h3>
          <Button size="sm" onClick={consultar} disabled={carregando}>
            {carregando ? <Loader2 className="animate-spin" /> : <RefreshCw />} {carregando ? "Consultando..." : "Consultar Omie agora"}
          </Button>
        </div>
        {!consulta && <p className="mt-2 text-sm text-muted-foreground">Consulta pontual e somente leitura, feita pelo servidor. Resultados recentes (até 5 min) são reaproveitados.</p>}
        {consulta && !consulta.ok && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-destructive" /> {FALHA}</p>
            {consulta.mensagem !== FALHA && <p className="mt-1 text-muted-foreground">{consulta.mensagem}</p>}
            <p className="mt-1">Última informação sincronizada: <b>{quando(consulta.ultimaSincronizacao ?? sincronizadoEm, true)}</b></p>
          </div>
        )}
        {consulta && consulta.ok && <ResultadoOmie consulta={consulta} unidade={produto.unidade} />}
      </section>
    </>
  );
}

function ResultadoOmie({ consulta, unidade }: { consulta: ConsultaOk; unidade: string }) {
  const r = consulta.resumo;
  const linha = "flex justify-between gap-3 py-1";
  return (
    <div className="mt-3 space-y-4 text-sm">
      <p className="text-muted-foreground">
        Consultado no Omie em <b className="text-foreground">{quando(consulta.consultadoEm, true)}</b>
        {consulta.fonte === "cache" && " (resultado recente reaproveitado, sem nova chamada ao Omie)"}
      </p>
      <div className="rounded-md bg-surface p-3">
        <p className="font-semibold">Disponível comercial (agora)</p>
        <p className="text-3xl font-bold text-success">{r.disponivel === null ? "Sem posição" : quantidade(r.disponivel, unidade)}</p>
        <div className="mt-2 divide-y">
          <p className={linha}><span>Estoque comercial bruto</span><span className="font-medium">{quantidade(r.brutoComercial, unidade)}</span></p>
          <p className={linha}><span>Pedidos pendentes</span><span className="font-medium">{quantidade(r.pendentes, unidade)}</span></p>
          <p className={linha}><span>Reservas</span><span className="font-medium">{quantidade(r.reservas, unidade)}</span></p>
          <p className={linha}><span>Comprometido considerado</span><span className="font-medium">− {quantidade(r.comprometido, unidade)}</span></p>
          <p className={`${linha} font-semibold`}><span>Disponível para venda</span><span>{r.disponivel === null ? "—" : quantidade(r.disponivel, unidade)}</span></p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Só locais comerciais (disponíveis para venda no Omie, fora Avaria, Licitação e Importação). Em cada local conta o maior
          valor entre pendente e reservado — a mesma regra do site.
        </p>
      </div>
      <div>
        <p className="font-semibold">Estoque Omie por local (físico)</p>
        <ul className="mt-1 divide-y rounded-md border">
          {consulta.locais.map((local) => (
            <li key={local.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{local.nome}</span>
                <span className={`text-[11px] font-semibold uppercase ${local.comercial ? "text-success" : "text-muted-foreground"}`}>{local.comercial ? "comercial" : "fora da venda"}{local.padrao ? " · padrão" : ""}</span>
              </span>
              <span className="shrink-0 text-right font-medium">{quantidade(local.fisico ?? 0, unidade)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 bg-surface px-3 py-2 font-semibold"><span>Total físico Omie</span><span>{quantidade(r.totalFisico, unidade)}</span></li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Total físico Omie (todos os locais) não é o disponível para venda.</p>
      </div>
      {consulta.omie && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Omie: SKU {consulta.omie.sku} · {consulta.omie.descricao}</p>}
    </div>
  );
}
