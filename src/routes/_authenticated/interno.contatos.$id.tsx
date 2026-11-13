import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getContact, updateContact, CONTACT_STATUS } from "@/lib/admin.functions";
import { Loading, ErrorState, Card, Rows, StatusEditor, StatusBadge, fmtDate } from "@/components/interno/ui";

export const Route = createFileRoute("/_authenticated/interno/contatos/$id")({ component: ContactDetail });

function ContactDetail() {
  const { id } = Route.useParams();
  const fn = useServerFn(getContact);
  const save = useServerFn(updateContact);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["interno", "contact", id], queryFn: () => fn({ data: { id } }) });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const r = q.data;
  const utm = (r["utm"] ?? {}) as Record<string, string>;
  return (
    <>
      <Link to="/interno/contatos" className="text-sm text-muted-foreground">← Contatos</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">Contato <span className="font-mono">{r["protocolo"]}</span></h1>
        <StatusBadge s={r["status"]} />
      </div>
      <p className="text-sm text-muted-foreground">Recebido em {fmtDate(r["created_at"])}</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card title="Contato"><Rows rows={[["Nome", r["nome"]], ["Empresa", r["empresa"]], ["WhatsApp", r["whatsapp"]], ["E-mail", r["email"] && <a className="underline" href={`mailto:${r["email"]}`}>{r["email"]}</a>], ["Assunto", r["assunto"]]]} /></Card>
          <Card title="Mensagem"><p className="whitespace-pre-wrap text-sm">{r["mensagem"]}</p></Card>
          <Card title="Origem"><Rows rows={[["URL", r["origem"]], ["UTM Source", utm["utm_source"]], ["UTM Medium", utm["utm_medium"]], ["UTM Campaign", utm["utm_campaign"]]]} /></Card>
        </div>
        <StatusEditor status={r["status"]} notes={r["internal_notes"]} options={CONTACT_STATUS} onSave={async (status, internal_notes) => {
          await save({ data: { id, status, internal_notes } });
          await qc.invalidateQueries({ queryKey: ["interno"] });
        }} />
      </div>
    </>
  );
}
