import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listContacts, CONTACT_STATUS } from "@/lib/admin.functions";
import { Loading, ErrorState, Empty, PageTitle, StatusBadge, StatusFilter, fmtDate, tableCls } from "@/components/interno/ui";

export const Route = createFileRoute("/_authenticated/interno/contatos/")({ component: ContactsList });

function ContactsList() {
  const fn = useServerFn(listContacts);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const query = useQuery({ queryKey: ["interno", "contacts", status, term], queryFn: () => fn({ data: { status: status || undefined, q: term || undefined } }) });
  return (
    <>
      <PageTitle title="Contatos">
        <form onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, empresa, protocolo, e-mail" className="h-10 w-full rounded-md border bg-card px-3 text-sm sm:w-80" />
        </form>
      </PageTitle>
      <StatusFilter value={status} options={CONTACT_STATUS} onChange={setStatus} />
      <div className="mt-4">
        {query.isLoading ? <Loading /> : query.isError ? <ErrorState error={query.error} /> : !query.data?.length ? (
          <Empty>{status || term ? "Nenhum contato para este filtro." : "Nenhum contato recebido ainda."}</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className={tableCls}>
              <thead><tr><th>Protocolo</th><th>Data</th><th>Nome</th><th>Assunto</th><th>WhatsApp</th><th>E-mail</th><th>Status</th></tr></thead>
              <tbody>
                {query.data.map((r) => (
                  <tr key={r.id}>
                    <td><Link to="/interno/contatos/$id" params={{ id: r.id }} className="font-mono font-semibold text-brand">{r.protocolo}</Link></td>
                    <td className="whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td>{r.nome}</td><td>{r.assunto}</td><td>{r.whatsapp}</td><td>{r.email}</td>
                    <td><StatusBadge s={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
