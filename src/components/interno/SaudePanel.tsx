import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSystemHealth } from "@/lib/saude.functions";
import { EM_24H, estadoDaLinha } from "@/lib/saude";
import { Card, ErrorState, Loading, PageTitle, Rows, fmtDate } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

type Health = Awaited<ReturnType<typeof getSystemHealth>>;
const ESTADO = {
  ok: { label: "Tudo certo", cls: "bg-success text-primary-foreground" },
  atencao: { label: "Atenção", cls: "bg-amber-500 text-amber-950" },
  critico: { label: "Crítico", cls: "bg-destructive text-primary-foreground" },
} as const;
const quando = (iso: string | null | undefined) => (iso ? fmtDate(iso) : "sem registro");
const maiuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** Saúde do sistema: só administrador, somente leitura; atualiza sozinha a cada minuto. */
export function SaudePanel() {
  const get = useServerFn(getSystemHealth);
  const q = useQuery({ queryKey: ["interno", "saude"], queryFn: () => get(), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const h = q.data;
  const estado = ESTADO[h.estado];
  return (
    <>
      <PageTitle title="Saúde do sistema">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${estado.cls}`}>{estado.label}</span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? "Atualizando…" : "Atualizar"}
          </Button>
        </div>
      </PageTitle>
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Somente leitura: nada aqui reinicia, envia ou altera. Conferido em {fmtDate(h.geradoEm)}. Telefones aparecem só pelo
        final; mensagens e credenciais nunca aparecem.
      </p>
      <Problemas health={h} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <WhatsApp health={h} />
        <Servidor health={h} />
        <Card title="Omie">
          <Rows
            rows={[
              ["Pedidos com erro", String(h.omie.pedidos.comErro)],
              ["Pedidos incertos", String(h.omie.pedidos.incertos)],
              ["Dados do pedido", quando(h.omie.referenciasSincronizadasEm)],
              ["Cadastro completo", `${quando(h.omie.cadastroCompleto.geradoEm)}${h.omie.cadastroCompleto.estado ? ` · ${h.omie.cadastroCompleto.estado}` : ""}`],
              ["Catálogo do site", quando(h.omie.catalogoPublicoEm)],
              [`Consultas com erro ${EM_24H}`, String(h.omie.consultasComErro24h)],
            ]}
          />
        </Card>
        <Card title="Segurança e aplicação">
          <Rows
            rows={[
              [`Logins recusados ${EM_24H}`, `${h.seguranca.loginsRecusados24h} tentativa(s) · ${h.seguranca.contasVisadas24h} conta(s) existente(s) visada(s)`],
              [`Duas etapas inválidas ${EM_24H}`, `${h.seguranca.mfaInvalidos24h} · ${h.seguranca.mfaBloqueios24h} bloqueio(s)`],
              ["Banco de dados", `${h.banco.tamanhoMb} MB (+ ${h.banco.walMb} MB em escrita)`],
              ["Site no ar há", `${h.aplicacao.iniciadaHaMin} min · ${h.aplicacao.memoriaMb} MB de memória`],
            ]}
          />
        </Card>
      </div>
    </>
  );
}

function Problemas({ health }: { health: Health }) {
  if (!health.problemas.length)
    return <div className="rounded-md border border-success bg-success-soft p-4 text-sm text-success">Nenhum problema encontrado.</div>;
  return (
    <ul className="space-y-2" aria-label="Problemas encontrados">
      {health.problemas.map((p, i) => (
        <li
          key={`${p.area}-${i}`}
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border p-3 text-sm ${
            p.nivel === "critico" ? "border-destructive bg-destructive/10" : "border-amber-500 bg-amber-50 text-amber-950"
          }`}
        >
          <span className="text-xs font-semibold uppercase tracking-wider">{p.nivel === "critico" ? "Crítico" : "Atenção"} · {p.area}</span>
          <span className="min-w-0 break-words">{p.texto}</span>
        </li>
      ))}
    </ul>
  );
}

function WhatsApp({ health }: { health: Health }) {
  const w = health.whatsapp;
  const ativas = w ? w.linhas.filter((l) => l.ativa) : [];
  const desativadas = w ? w.linhas.length - ativas.length : 0;
  return (
    <Card title="WhatsApp">
      {!w ? (
        <p className="text-sm text-muted-foreground">Nenhuma linha de WhatsApp cadastrada.</p>
      ) : (
        <>
          {!ativas.length && <p className="mb-2 text-sm text-muted-foreground">Nenhuma linha ativa.</p>}
          <ul className="mb-1 divide-y text-sm">
            {ativas.map((l, i) => (
              <li key={`${i}-${l.vendedora}-${l.final}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="min-w-0 break-words">
                  {l.vendedora} <span className="text-muted-foreground">· final {l.final || "?"}</span>
                </span>
                <span className={l.estado === "WORKING" && !l.erro ? "text-success" : "font-semibold"}>
                  {l.estado === "WORKING" && !l.erro ? "Conectada" : maiuscula(estadoDaLinha(l.estado, l.erro))}
                </span>
              </li>
            ))}
          </ul>
          {desativadas > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">{desativadas} linha(s) desativada(s) não aparecem aqui.</p>
          )}
          <Rows
            rows={[
              ["Envios em andamento", String(w.fila.enviando)],
              ["Envios incertos", String(w.fila.incertos)],
              [`Envios com erro ${EM_24H}`, String(w.fila.comErro24h)],
              ["Recebimentos na fila", `${w.eventos.pendentes}${w.eventos.maisAntigoPendenteMin ? ` · mais antigo há ${w.eventos.maisAntigoPendenteMin} min` : ""}`],
              ["Recebimentos com erro", String(w.eventos.comErro)],
              ["Última mensagem recebida", quando(w.ultimaMensagemRecebida)],
            ]}
          />
        </>
      )}
    </Card>
  );
}

function Servidor({ health }: { health: Health }) {
  const s = health.servidor;
  if (!s)
    return (
      <Card title="Servidor e backups">
        <p className="text-sm text-muted-foreground">Sem dados do servidor: o verificador (saude-host, a cada 5 min) ainda não gravou o arquivo.</p>
      </Card>
    );
  return (
    <Card title="Servidor e backups">
      <Rows
        rows={[
          ["Conferido em", quando(s.geradoEm)],
          ["Disco", s.disco ? `${s.disco.usoPct}% usado · ${s.disco.livreGb} GB livres` : "sem dado"],
          ["Memória", s.memoria ? `${s.memoria.usoPct}% usada · ${s.memoria.disponivelMb} MB livres` : "sem dado"],
          ["Carga", s.carga ? `${s.carga.join(" / ")} (${s.cpus ?? "?"} CPUs)` : "sem dado"],
          ...(s.backups ?? []).map((b): [string, string] => [
            `Backup ${b.projeto}`,
            `${quando(b.ultimo)} · ${b.falhaPendente ? "falha pendente" : b.ok ? "ok" : (b.resultado ?? "sem resultado")}`,
          ]),
          [
            "Vigia do WhatsApp",
            s.vigiaWhatsapp
              ? `${s.vigiaWhatsapp.ok === false ? "em falha" : s.vigiaWhatsapp.ok ? "ok" : "sem estado"} · ${quando(s.vigiaWhatsapp.conferido)}${s.vigiaWhatsapp.manutencao ? " · em manutenção" : ""}`
              : "não instalado",
          ],
        ]}
      />
      <ul className="mt-3 flex flex-wrap gap-2 text-xs">
        {(s.containers ?? []).map((c) => (
          <li
            key={c.nome}
            className={`rounded-full border px-2.5 py-1 ${c.estado === "running" && c.saude !== "unhealthy" ? "" : "border-destructive font-semibold"}`}
          >
            {c.nome}: {c.estado === "running" ? (c.saude ?? "no ar") : c.estado}
          </li>
        ))}
      </ul>
    </Card>
  );
}
