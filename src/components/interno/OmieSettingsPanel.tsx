import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  painelOmie,
  sincronizarOmieAgora,
  confirmarVinculoVendedor,
  removerVinculoVendedor,
  salvarConfiguracaoOmie,
} from "@/lib/omie.functions";
import {
  Loading,
  ErrorState,
  PageTitle,
  Card,
  Rows,
  fmtDate,
  tableCls,
} from "@/components/interno/ui";
import { mensagemErro } from "@/components/interno/orcamento";
import { Button } from "@/components/ui/button";

/** Integração com o Omie (só Admin): dados sincronizados, padrões do Pedido de Venda e vínculo usuário → vendedor. */

type Painel = Awaited<ReturnType<typeof painelOmie>>;
const campo = "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 text-sm";

export function OmieSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const fn = useServerFn(painelOmie);
  const q = useQuery({ queryKey: ["interno", "omie"], queryFn: () => fn() });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  return <Conteudo painel={q.data} embedded={embedded} />;
}

function Conteudo({ painel, embedded = false }: { painel: Painel; embedded?: boolean }) {
  const qc = useQueryClient();
  const recarregar = () => qc.invalidateQueries({ queryKey: ["interno", "omie"] });
  const sincronizar = useServerFn(sincronizarOmieAgora);
  const confirmar = useServerFn(confirmarVinculoVendedor);
  const remover = useServerFn(removerVinculoVendedor);
  const salvar = useServerFn(salvarConfiguracaoOmie);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (acao: () => Promise<unknown>, ok: string) => {
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
  const ativos = painel.vendedores.filter((s) => !s.inativo && !s.removido);
  const { servico, situacao } = painel;
  return (
    <>
      <PageTitle as={embedded ? "h2" : "h1"} title="Integração Omie">
        <Button
          disabled={ocupado}
          onClick={() =>
            rodar(async () => {
              const r = await sincronizar();
              if (!r.ok)
                throw new Error(
                  `Atualização parcial: ${r.erros.join(", ")} (o último cache válido foi mantido)`,
                );
            }, "Dados do Omie atualizados")
          }
        >
          <RefreshCw /> Atualizar dados do Omie agora
        </Button>
      </PageTitle>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Situação">
          {servico.escrita ? (
            <p className="mb-3 flex items-center gap-2 rounded-md border-2 border-destructive bg-destructive/5 p-3 text-sm font-semibold">
              <ShieldAlert className="size-5 text-destructive" /> Escrita no Omie LIGADA: "Gerar
              Pedido" cria pedidos reais.
            </p>
          ) : (
            <p className="mb-3 flex items-center gap-2 rounded-md border bg-surface p-3 text-sm font-semibold">
              <ShieldCheck className="size-5 text-success" /> Escrita no Omie DESLIGADA: "Gerar
              Pedido" só simula (OMIE_ORDER_WRITE_ENABLED=false).
            </p>
          )}
          <Rows
            rows={[
              [
                "Serviço omie-pedidos",
                servico.ok ? "no ar" : `indisponível (${servico.motivo ?? "?"})`,
              ],
              ["Chaves do Omie", servico.chavesOmie ? "configuradas no serviço" : "ausentes"],
              [
                "Última atualização",
                situacao.sincronizadoEm ? fmtDate(situacao.sincronizadoEm) : "nunca",
              ],
              [
                "Última tentativa",
                situacao.tentativaEm
                  ? `${fmtDate(situacao.tentativaEm)}${situacao.erro ? ` — falhou: ${situacao.erro}` : " — ok"}`
                  : "-",
              ],
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Atualização automática todo dia às 05:40. Em falha, o último cadastro válido continua
            valendo.
          </p>
        </Card>

        <Padroes
          key={JSON.stringify(painel.configuracao)}
          painel={painel}
          ocupado={ocupado}
          aoSalvar={(config) => void rodar(() => salvar({ data: config }), "Configuração salva")}
        />
      </div>

      <div className="mt-5">
        <Card title="Usuários do painel → vendedor do Omie">
          <p className="mb-3 text-sm text-muted-foreground">
            O pedido usa SEMPRE o vendedor confirmado aqui para o responsável pelo orçamento
            (codVend). Sugestões por e-mail ou nome nunca viram vínculo sozinhas: confirme.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Vendedor vinculado</th>
                  <th>Sugestões</th>
                  <th>Escolher outro</th>
                </tr>
              </thead>
              <tbody>
                {painel.vinculos.map((v) => (
                  <tr key={v.usuario.id}>
                    <td>
                      <span className="block font-medium">{v.usuario.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {v.usuario.roles.join(", ")}
                      </span>
                    </td>
                    <td>
                      {v.vendedor ? (
                        <span>
                          <b>{v.vendedor.nome}</b>{" "}
                          <span className="font-mono text-xs">({v.vendedor.codigo})</span>
                          {(v.vendedor.inativo || v.vendedor.removido) && (
                            <span className="ml-1 font-semibold text-destructive">
                              {v.vendedor.removido ? "removido do Omie" : "inativo"}
                            </span>
                          )}
                          {v.confirmadoEm && (
                            <span className="block text-xs text-muted-foreground">
                              confirmado em {fmtDate(v.confirmadoEm)}
                            </span>
                          )}
                          <button
                            type="button"
                            className="text-xs text-destructive underline"
                            disabled={ocupado}
                            onClick={() => {
                              if (window.confirm(`Remover o vínculo de ${v.usuario.email}?`))
                                void rodar(
                                  () => remover({ data: { usuarioId: v.usuario.id } }),
                                  "Vínculo removido",
                                );
                            }}
                          >
                            remover
                          </button>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">sem vínculo</span>
                      )}
                    </td>
                    <td>
                      {v.sugestoes.length ? (
                        v.sugestoes.map((s) => (
                          <button
                            key={s.codigo}
                            type="button"
                            disabled={ocupado}
                            className="mb-1 mr-1 rounded-sm border px-2 py-1 text-left text-xs hover:border-brand"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Confirmar vínculo: ${v.usuario.email} → ${s.nome} (código Omie ${s.codigo})?`,
                                )
                              )
                                void rodar(
                                  () =>
                                    confirmar({
                                      data: { usuarioId: v.usuario.id, codigoVendedor: s.codigo },
                                    }),
                                  "Vínculo confirmado",
                                );
                            }}
                          >
                            Confirmar <b>{s.nome}</b>{" "}
                            <span className="text-muted-foreground">
                              ({s.codigo} · {s.motivo})
                            </span>
                          </button>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <select
                          className="h-9 rounded-md border bg-card px-2 text-xs"
                          value={escolha[v.usuario.id] ?? ""}
                          onChange={(e) =>
                            setEscolha({ ...escolha, [v.usuario.id]: e.target.value })
                          }
                        >
                          <option value="">Vendedor…</option>
                          {ativos.map((s) => (
                            <option key={s.codigo} value={s.codigo}>
                              {s.nome} ({s.codigo})
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={ocupado || !escolha[v.usuario.id]}
                          onClick={() => {
                            const s = ativos.find((x) => x.codigo === escolha[v.usuario.id]);
                            if (
                              s &&
                              window.confirm(
                                `Confirmar vínculo: ${v.usuario.email} → ${s.nome} (código Omie ${s.codigo})?`,
                              )
                            )
                              void rodar(
                                () =>
                                  confirmar({
                                    data: { usuarioId: v.usuario.id, codigoVendedor: s.codigo },
                                  }),
                                "Vínculo confirmado",
                              );
                          }}
                        >
                          Confirmar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-5">
        <Card title={`Vendedores no Omie (${painel.vendedores.length})`}>
          <div className="overflow-x-auto rounded-md border">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th>Código (codVend)</th>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Situação</th>
                  <th>Fatura pedido</th>
                </tr>
              </thead>
              <tbody>
                {painel.vendedores.map((s) => (
                  <tr
                    key={s.codigo}
                    className={s.inativo || s.removido ? "text-muted-foreground" : ""}
                  >
                    <td className="font-mono">{s.codigo}</td>
                    <td>{s.nome}</td>
                    <td>{s.email ?? "-"}</td>
                    <td>{s.removido ? "removido do Omie" : s.inativo ? "inativo" : "ativo"}</td>
                    <td>{s.faturaPedido ? "sim" : "não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/** Padrões do Pedido de Venda. Recomeça dos valores salvos a cada gravação — só este formulário: a escolha de vínculo
 *  na tabela ao lado não se perde quando a configuração recarrega. */
function Padroes({
  painel,
  ocupado,
  aoSalvar,
}: {
  painel: Painel;
  ocupado: boolean;
  aoSalvar: (config: Painel["configuracao"]) => void;
}) {
  const [config, setConfig] = useState(painel.configuracao);
  const { opcoes } = painel;
  return (
    <Card title="Padrões do Pedido de Venda">
      <div className="space-y-3">
        <label className="block text-sm font-medium">
          Etapa do pedido no Omie
          <select
            className={campo}
            value={config.etapa}
            onChange={(e) => setConfig({ ...config, etapa: e.target.value })}
          >
            <option value="">Escolha…</option>
            {opcoes.etapas.map((x) => (
              <option key={x.codigo} value={x.codigo}>
                {x.codigo} — {x.descricao}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Só etapas 10 a 40 da Venda de Produto. A etapa 50 (faturar) nunca é usada pelo painel.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Condição de pagamento padrão
          <select
            className={campo}
            value={config.formaPagamento}
            onChange={(e) => setConfig({ ...config, formaPagamento: e.target.value })}
          >
            <option value="">(nenhuma — o Comercial escolhe)</option>
            {opcoes.formasPagamento.map((x) => (
              <option key={x.codigo} value={x.codigo}>
                {x.codigo} — {x.descricao}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Categoria de receita
          <select
            className={campo}
            value={config.categoria}
            onChange={(e) => setConfig({ ...config, categoria: e.target.value })}
          >
            <option value="">Escolha…</option>
            {opcoes.categorias.map((x) => (
              <option key={x.codigo} value={x.codigo}>
                {x.codigo} — {x.descricao}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-md bg-surface p-2 text-xs text-muted-foreground">
          <b className="text-foreground">Conta corrente: sem padrão.</b> Quem faz a venda escolhe a
          conta em cada orçamento ({opcoes.contas.length} contas ativas sincronizadas do Omie); ela
          fica congelada com a versão aceita e é a que vai ao Pedido. Sugestão MAG (só dica): vendas
          maiores, CNPJ ou depósito → Bradesco; vendas menores → Stone.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Consumidor final (padrão)
            <select
              className={campo}
              value={config.consumidorFinal}
              onChange={(e) =>
                setConfig({ ...config, consumidorFinal: e.target.value as "S" | "N" })
              }
            >
              <option value="S">Sim</option>
              <option value="N">Não</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Pedido sem estoque suficiente
            <select
              className={campo}
              value={config.semEstoque}
              onChange={(e) =>
                setConfig({ ...config, semEstoque: e.target.value as typeof config.semEstoque })
              }
            >
              <option value="confirmar">Exigir confirmação (encomenda)</option>
              <option value="permitir">Permitir sem perguntar</option>
              <option value="bloquear">Bloquear</option>
            </select>
          </label>
        </div>
        <Button disabled={ocupado} onClick={() => aoSalvar(config)}>
          Salvar configuração
        </Button>
      </div>
    </Card>
  );
}
