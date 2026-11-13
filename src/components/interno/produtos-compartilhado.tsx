import { AlertTriangle } from "lucide-react";
import { CATEGORIAS, quantidade, type ProdutoInterno } from "@/lib/produtos-busca";

/**
 * Peças da Consulta rápida compartilhadas entre a página /interno/produtos e o catálogo do Atendimento: tipos das
 * respostas, pedido às rotas internas, datas, selos e o resultado da consulta ao Omie (somente leitura).
 */
export type Cadastro = { geradoEm: string; total: number; foraDoSite: number; fresco: boolean; ultimaFalha: string | null };
export type Indice = { ok: true; sincronizadoEm: string | null; fresco: boolean; cadastro: Cadastro | null; total: number; itens: ProdutoInterno[] };
export type Local = { id: string; nome: string; comercial: boolean; padrao: boolean; saldo: number | null; fisico: number | null; pendente: number | null; reservado: number | null };
export type ConsultaOk = {
  ok: true; fonte: "omie" | "cache"; consultadoEm: string; omie: { sku: string; descricao: string } | null; locais: Local[];
  resumo: { conhecido: boolean; brutoComercial: number; pendentes: number; reservas: number; comprometido: number; disponivel: number | null; totalFisico: number };
};
export type ConsultaFalha = { ok: false; motivo: string; mensagem: string; ultimaSincronizacao: string | null };
export const FALHA = "Não foi possível consultar o Omie agora.";

/** Erro com a mesma mensagem que o painel já usa ("Forbidden" = sem permissão). */
export async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { credentials: "same-origin", ...init });
  if (!resposta.ok) {
    await resposta.text().catch(() => ""); // lê o corpo do erro: sem isso a requisição fica aberta no navegador
    if (resposta.status === 401) { window.location.href = "/interno/login"; throw new Error("Unauthorized: entre na sua conta"); }
    if (resposta.status === 403) throw new Error("Forbidden: sem permissão para esta área");
    throw new Error(`Falha ${resposta.status}`);
  }
  return resposta.json() as Promise<T>;
}

export const quando = (iso: string | null | undefined, comData = false) => {
  if (!iso) return "—";
  const data = new Date(iso);
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" }) === data.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" });
  const hora = data.toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
  return hoje && !comData ? `hoje às ${hora}` : `${data.toLocaleDateString("pt-BR", { timeZone: "America/Fortaleza" })} às ${hora}`;
};

/** Categoria do site; fora do site sem categoria reconhecida, a família do Omie. */
export const rotuloCategoria = (produto: ProdutoInterno) => CATEGORIAS[produto.categoria] ?? (produto.familia || "Sem categoria do site");

export function Estoque({ produto, grande = false }: { produto: ProdutoInterno; grande?: boolean }) {
  const tamanho = grande ? "text-2xl" : "text-base";
  if (produto.estoque === null) return <p className={`${tamanho} font-semibold text-muted-foreground`}>Estoque: consultar no Omie</p>;
  if (produto.disponivel === null) return <p className={`${tamanho} font-semibold text-muted-foreground`}>Sem posição de estoque</p>;
  if (produto.disponivel <= 0) return <p className={`${tamanho} font-semibold text-muted-foreground`}>Sem estoque disponível</p>;
  return <p className={`${tamanho} font-bold text-success`}>{produto.estoque === "PRONTA_ENTREGA" ? "Pronta entrega" : "Disponível"}: {quantidade(produto.disponivel, produto.unidade)}</p>;
}

/** Selos de produto fora do site (e situação no Omie). */
export function Selos({ produto }: { produto: ProdutoInterno }) {
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

export function ResultadoOmie({ consulta, unidade }: { consulta: ConsultaOk; unidade: string }) {
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
