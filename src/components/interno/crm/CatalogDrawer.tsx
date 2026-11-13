import { useDeferredValue, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Minus, PackageSearch, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createQuoteFromDraft, getOpportunityDraft, saveOpportunityDraft } from "@/lib/crm-catalogo.functions";
import { quantidade, type ProdutoInterno } from "@/lib/produtos-busca";
import { STAGE_LABEL, type Stage } from "@/lib/crm";
import {
  Estoque,
  FALHA,
  pedir,
  quando,
  ResultadoOmie,
  Selos,
  type ConsultaFalha,
  type ConsultaOk,
  type Indice,
} from "@/components/interno/produtos-compartilhado";

type Opportunity = { id: string; title: string; stage: Stage };
type Filtro = "todos" | "com-estoque" | "sem-estoque";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "com-estoque", rotulo: "Com estoque" },
  { id: "sem-estoque", rotulo: "Sem estoque" },
];
/** "2,5" → 2.5; vazio ou inválido → null (até 3 casas, como o motor da negociação). */
const lerQuantidade = (texto: string) => {
  const valor = Number(texto.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(valor) && valor > 0 && valor <= 100_000 && Math.round(valor * 1000) === valor * 1000 ? valor : null;
};
const erro = (error: unknown) => (error instanceof Error ? error.message.replace(/^Forbidden: ?/, "") : "Não foi possível concluir.");

/**
 * Catálogo no Atendimento (somente leitura do Omie): busca e estoque da Consulta rápida sem sair da conversa, rascunho de
 * itens da oportunidade (sem preço) e "Gerar orçamento" pelo motor da negociação. Nada é enviado ao cliente daqui:
 * "Inserir na conversa" só escreve no campo de mensagem.
 */
export function CatalogDrawer({
  open,
  onOpenChange,
  opportunity,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Opportunity | undefined;
  onInsert: (text: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [todos, setTodos] = useState(false);
  const [aberto, setAberto] = useState<ProdutoInterno | null>(null);
  const termo = useDeferredValue(busca.trim());
  const lista = useQuery({
    queryKey: ["interno", "crm", "catalogo", termo, filtro, todos],
    queryFn: () =>
      pedir<Indice>(`/api/interno/produtos/?q=${encodeURIComponent(termo)}&filtro=${filtro}${todos ? "&todos=1" : ""}`),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="mag-crm flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <PackageSearch className="size-5" aria-hidden="true" /> Catálogo
          </SheetTitle>
          <SheetDescription>
            Consulta somente leitura do Omie. Preço, desconto e condições ficam na negociação.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {opportunity && <DraftSection opportunity={opportunity} onInsert={onInsert} />}
          <div className="space-y-3 p-4">
            <label className="relative block">
              <span className="sr-only">Buscar produto</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={busca}
                onChange={(event) => setBusca(event.target.value.slice(0, 120))}
                placeholder="Nome, SKU, EAN ou família"
                className="pl-9"
                autoFocus
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtro de estoque">
              {FILTROS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filtro === item.id}
                  onClick={() => setFiltro(item.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${filtro === item.id ? "border-brand bg-brand-soft text-brand" : "bg-card"}`}
                >
                  {item.rotulo}
                </button>
              ))}
              <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={todos} onChange={(event) => setTodos(event.target.checked)} />
                Incluir fora do site
              </label>
            </div>
            {lista.data && (
              <p className="text-xs text-muted-foreground">
                Estoque da sincronização de {quando(lista.data.sincronizadoEm, true)}
                {!lista.data.fresco && <span className="font-semibold text-destructive"> · atrasada: consulte o Omie agora</span>}
                {" · "}
                {lista.data.total} produto(s){lista.data.total > lista.data.itens.length ? `, mostrando ${lista.data.itens.length}` : ""}
              </p>
            )}
            {lista.isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Carregando…</p>}
            {lista.error && <p className="text-sm text-destructive">{erro(lista.error)}</p>}
            <ul className="divide-y rounded-md border" aria-label="Produtos">
              {(lista.data?.itens ?? []).map((produto) => (
                <li key={produto.id}>
                  <button
                    type="button"
                    onClick={() => setAberto(aberto?.id === produto.id ? null : produto)}
                    aria-expanded={aberto?.id === produto.id}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent"
                  >
                    <img src={produto.imagem} alt="" className="size-12 shrink-0 rounded bg-surface object-contain" loading="lazy" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{produto.nome}</span>
                      <span className="block text-xs text-muted-foreground">SKU {produto.sku} · {produto.unidade}</span>
                      <Selos produto={produto} />
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {produto.disponivel !== null ? quantidade(produto.disponivel, produto.unidade) : "—"}
                    </span>
                  </button>
                  {aberto?.id === produto.id && (
                    <ProductDetail
                      produto={produto}
                      sincronizadoEm={lista.data?.sincronizadoEm ?? null}
                      opportunity={opportunity}
                      onInsert={onInsert}
                    />
                  )}
                </li>
              ))}
              {lista.data && !lista.data.itens.length && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</li>
              )}
            </ul>
            <a
              href="/interno/produtos"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-brand underline"
            >
              Abrir a Consulta rápida completa <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function useDraft(opportunityId: string) {
  const read = useServerFn(getOpportunityDraft);
  return useQuery({
    queryKey: ["interno", "crm", "rascunho", opportunityId],
    queryFn: () => read({ data: { opportunityId } }),
    enabled: Boolean(opportunityId),
  });
}

function ProductDetail({
  produto,
  sincronizadoEm,
  opportunity,
  onInsert,
}: {
  produto: ProdutoInterno;
  sincronizadoEm: string | null;
  opportunity: Opportunity | undefined;
  onInsert: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [consulta, setConsulta] = useState<ConsultaOk | ConsultaFalha | null>(
    qc.getQueryData<ConsultaOk | ConsultaFalha>(["interno", "produtos", "omie", produto.id]) ?? null,
  );
  const [consultando, setConsultando] = useState(false);
  const [qtd, setQtd] = useState("1");
  const draft = useDraft(opportunity?.id ?? "");
  const save = useServerFn(saveOpportunityDraft);
  const encerrada = opportunity ? opportunity.stage === "fechado" || opportunity.stage === "perdido" : true;
  const add = useMutation({
    mutationFn: async () => {
      const value = lerQuantidade(qtd);
      if (!opportunity || value === null) throw new Error("Informe uma quantidade válida.");
      const current = draft.data ?? (await draft.refetch()).data;
      if (!current) throw new Error("Não foi possível ler o rascunho.");
      const existing = current.itens.find((item) => item.produtoId === produto.id);
      const itens = existing
        ? current.itens.map((item) => ({ produtoId: item.produtoId, quantidade: item.produtoId === produto.id ? Math.round((item.quantidade + value) * 1000) / 1000 : item.quantidade }))
        : [...current.itens.map((item) => ({ produtoId: item.produtoId, quantidade: item.quantidade })), { produtoId: produto.id, quantidade: value }];
      return save({ data: { opportunityId: opportunity.id, revision: current.revision, itens } });
    },
    onSuccess: (saved) => {
      qc.setQueryData(["interno", "crm", "rascunho", saved.opportunityId], saved);
      toast.success(`${produto.nome} no rascunho.`);
    },
    onError: (error) => toast.error(erro(error)),
  });
  const consultar = async () => {
    setConsultando(true);
    try {
      const resposta = await pedir<ConsultaOk | ConsultaFalha>(`/api/interno/produtos/${produto.id}`, { method: "POST" });
      setConsulta(resposta);
      qc.setQueryData(["interno", "produtos", "omie", produto.id], resposta);
    } catch (error) {
      setConsulta({ ok: false, motivo: "rede", mensagem: erro(error), ultimaSincronizacao: sincronizadoEm });
    } finally {
      setConsultando(false);
    }
  };
  return (
    <div className="space-y-3 border-t bg-surface/60 px-3 py-3 text-sm">
      <Estoque produto={produto} />
      <p className="text-xs text-muted-foreground">
        {produto.publicado
          ? `Disponível da sincronização de ${quando(sincronizadoEm, true)} (mesma regra do site).`
          : "Fora do site: estoque só pela consulta ao Omie."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={consultar} disabled={consultando}>
          {consultando ? <Loader2 className="animate-spin" /> : <RefreshCw />} {consultando ? "Consultando…" : "Consultar estoque agora"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onInsert(`${produto.nome} (SKU ${produto.sku})`)}>
          Inserir na conversa
        </Button>
      </div>
      {consulta && !consulta.ok && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <p className="font-semibold">{FALHA}</p>
          {consulta.mensagem !== FALHA && <p>{consulta.mensagem}</p>}
          <p>Última informação sincronizada: {quando(consulta.ultimaSincronizacao ?? sincronizadoEm, true)}</p>
        </div>
      )}
      {consulta && consulta.ok && <ResultadoOmie consulta={consulta} unidade={produto.unidade} />}
      {opportunity ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-2"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <label className="text-xs">
            Quantidade ({produto.unidade})
            <Input value={qtd} onChange={(event) => setQtd(event.target.value)} inputMode="decimal" className="mt-1 h-9 w-24" />
          </label>
          <Button size="sm" type="submit" disabled={add.isPending || encerrada || lerQuantidade(qtd) === null}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar ao rascunho
          </Button>
          {encerrada && <p className="w-full text-xs text-muted-foreground">Negociação {STAGE_LABEL[opportunity.stage].toLowerCase()}: reabra para montar um rascunho.</p>}
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Abra uma oportunidade do cliente para montar um rascunho.</p>
      )}
    </div>
  );
}

function DraftSection({ opportunity, onInsert }: { opportunity: Opportunity; onInsert: (text: string) => void }) {
  const qc = useQueryClient();
  const draft = useDraft(opportunity.id);
  const save = useServerFn(saveOpportunityDraft);
  const generate = useServerFn(createQuoteFromDraft);
  const [gerado, setGerado] = useState<{ numero: string; detailUrl: string } | null>(null);
  const update = useMutation({
    mutationFn: (itens: { produtoId: string; quantidade: number }[]) =>
      save({ data: { opportunityId: opportunity.id, revision: draft.data?.revision ?? 0, itens } }),
    onSuccess: (saved) => qc.setQueryData(["interno", "crm", "rascunho", opportunity.id], saved),
    onError: (error) => {
      toast.error(erro(error));
      void draft.refetch();
    },
  });
  const convert = useMutation({
    mutationFn: () => generate({ data: { opportunityId: opportunity.id, revision: draft.data?.revision ?? 0 } }),
    onSuccess: async (result) => {
      setGerado({ numero: result.numero, detailUrl: result.detailUrl });
      toast.success(`Negociação ${result.numero}: ${result.adicionados} item(ns) incluído(s). Defina preços no editor.`);
      await qc.invalidateQueries({ queryKey: ["interno", "crm"] });
    },
    onError: (error) => toast.error(erro(error)),
  });
  const itens = draft.data?.itens ?? [];
  const change = (produtoId: string, delta: number) =>
    update.mutate(
      itens
        .map((item) => ({ produtoId: item.produtoId, quantidade: item.produtoId === produtoId ? Math.round((item.quantidade + delta) * 1000) / 1000 : item.quantidade }))
        .filter((item) => item.quantidade > 0),
    );
  return (
    <section className="space-y-2 border-b bg-brand-soft/40 p-4" aria-label="Rascunho da oportunidade">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-brand">Rascunho · {opportunity.title}</h3>
        {draft.data?.atualizadoEm && <span className="text-[11px] text-muted-foreground">salvo {quando(draft.data.atualizadoEm)}</span>}
      </div>
      {draft.isLoading && <p className="text-xs text-muted-foreground">Carregando o rascunho…</p>}
      {draft.error && <p className="text-xs text-destructive">{erro(draft.error)}</p>}
      {!draft.isLoading && !itens.length && (
        <p className="text-xs text-muted-foreground">Vazio. Abra um produto abaixo e use “Adicionar ao rascunho”.</p>
      )}
      {itens.length > 0 && (
        <ul className="divide-y rounded-md border bg-card text-sm">
          {itens.map((item) => (
            <li key={item.produtoId} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.nome}</span>
                <span className="text-xs text-muted-foreground">SKU {item.sku}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Diminuir ${item.nome}`} disabled={update.isPending} onClick={() => change(item.produtoId, -1)}>
                  <Minus className="size-3.5" />
                </Button>
                <span className="min-w-14 text-center tabular-nums">{quantidade(item.quantidade, item.unidade)}</span>
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Aumentar ${item.nome}`} disabled={update.isPending} onClick={() => change(item.produtoId, 1)}>
                  <Plus className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Tirar ${item.nome}`} disabled={update.isPending} onClick={() => change(item.produtoId, -item.quantidade)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!itens.length || convert.isPending || update.isPending} onClick={() => convert.mutate()}>
          {convert.isPending && <Loader2 className="animate-spin" />} Gerar orçamento
        </Button>
        {itens.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onInsert(itens.map((item) => `• ${quantidade(item.quantidade, item.unidade)} ${item.nome} (SKU ${item.sku})`).join("\n"))}
          >
            Inserir lista na conversa
          </Button>
        )}
      </div>
      {gerado && (
        <a href={gerado.detailUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand underline">
          Abrir a negociação {gerado.numero} para definir preços <ExternalLink className="size-3" />
        </a>
      )}
      <p className="text-[11px] text-muted-foreground">
        Os itens entram na negociação sem preço; preço, desconto, condições e a proposta seguem no editor da negociação.
      </p>
    </section>
  );
}
