import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAuditLog } from "@/lib/administration.functions";
import { PageTitle, Loading, ErrorState, Empty, tableCls, fmtDate } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";
export function AuditPanel({ embedded = false }: { embedded?: boolean }) {
  const get = useServerFn(getAuditLog),
    [filter, setFilter] = useState<{ page: number; action: string; from?: string; to?: string }>({
      page: 1,
      action: "",
    });
  const q = useQuery({
    queryKey: ["interno", "audit", filter],
    queryFn: () => get({ data: filter }),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      from = String(d.get("from") || ""),
      to = String(d.get("to") || "");
    setFilter({
      page: 1,
      action: String(d.get("action") || ""),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  };
  return (
    <>
      <PageTitle as={embedded ? "h2" : "h1"} title="Auditoria" />
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Histórico real de ações. Detalhes exibem apenas contagens e indicadores técnicos permitidos;
        documentos, currículos, mensagens e credenciais não aparecem aqui.
      </p>
      <form
        onSubmit={submit}
        className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      >
        <label className="text-sm">
          Ação (prefixo)
          <input
            name="action"
            placeholder="quote:, mfa:, links:, unit:"
            maxLength={80}
            pattern="[a-zA-Z0-9_:.-]*"
            className="mt-1 block h-10 rounded-md border bg-card px-3"
          />
        </label>
        <label className="text-sm">
          De
          <input
            name="from"
            type="date"
            className="mt-1 block h-10 rounded-md border bg-card px-3"
          />
        </label>
        <label className="text-sm">
          Até
          <input name="to" type="date" className="mt-1 block h-10 rounded-md border bg-card px-3" />
        </label>
        <Button type="submit">Filtrar</Button>
      </form>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data?.rows.length ? (
        <Empty>Nenhum evento no período.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className={tableCls}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Ação</th>
                <th>Autor</th>
                <th>Registro (ID)</th>
                <th>Detalhes técnicos</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td>
                    <span className="block text-sm">{r.actorLabel}</span>
                    {r.actorId && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {r.actorId}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs">{r.targetId || "—"}</td>
                  <td className="max-w-64 break-words text-xs">
                    {Object.entries(r.details)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
          <span>
            {q.data.total} eventos · página {q.data.page} de {q.data.pages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={filter.page <= 1}
              onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={filter.page >= q.data.pages}
              onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
