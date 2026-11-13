import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ExternalLink, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { Loading, ErrorState, Empty, PageTitle } from "@/components/interno/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { buscarProdutos, CATEGORIAS, FILTROS, MAX_CONSULTA, quantidade, type FiltroId, type ProdutoInterno } from "@/lib/produtos-busca";
import { Estoque, FALHA, pedir, quando, ResultadoOmie, rotuloCategoria, Selos, type ConsultaFalha, type ConsultaOk, type Indice } from "@/components/interno/produtos-compartilhado";

/**
 * Consulta rápida (só Admin e Comercial). A busca roda no navegador sobre o índice interno (carregado uma vez, sem Omie).
 * Por padrão, só os produtos publicados no site; "Mostrar todos os produtos do Omie" carrega também o cadastro completo
 * (sem estoque calculado: para esses, só o "Consultar Omie agora").
 * Os números de estoque desta tela são INTERNOS: vêm só de /api/interno/produtos, que exige sessão e perfil no servidor.
 */
export const Route = createFileRoute("/_authenticated/interno/produtos")({ component: ConsultaRapida });


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

