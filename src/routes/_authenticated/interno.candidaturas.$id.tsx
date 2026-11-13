import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { getApplication, updateApplication, getResumeUrl, APP_STATUS } from "@/lib/admin.functions";
import {
  Loading,
  ErrorState,
  Card,
  Rows,
  StatusEditor,
  StatusBadge,
  RetentionDate,
  fmtDate,
} from "@/components/interno/ui";
import { Button } from "@/components/ui/button";
import { InterviewPanel } from "@/components/interno/InterviewPanel";

export const Route = createFileRoute("/_authenticated/interno/candidaturas/$id")({
  component: AppDetail,
});

function AppDetail() {
  const { id } = Route.useParams();
  const fn = useServerFn(getApplication);
  const save = useServerFn(updateApplication);
  const resume = useServerFn(getResumeUrl);
  const qc = useQueryClient();
  const [opening, setOpening] = useState(false);
  const q = useQuery({ queryKey: ["interno", "app", id], queryFn: () => fn({ data: { id } }) });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const r = q.data;
  const open = async () => {
    setOpening(true);
    try {
      const { url } = await resume({ data: { id } });
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error("Não foi possível abrir o currículo");
    } finally {
      setOpening(false);
    }
  };
  return (
    <>
      <Link to="/interno/candidaturas" className="text-sm text-muted-foreground">
        ← Candidaturas
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-semibold">{r["nome"]}</h1>
        <StatusBadge s={r["status"]} />
      </div>
      <p className="text-sm text-muted-foreground">
        Protocolo <span className="font-mono">{r["protocolo"]}</span> ·{" "}
        {r["job_title"] ?? "Banco de talentos"} · {fmtDate(r["created_at"])}
      </p>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card title="Candidato">
            <Rows
              rows={[
                ["Nome", r["nome"]],
                [
                  "E-mail",
                  r["email"] && (
                    <a className="underline" href={`mailto:${r["email"]}`}>
                      {r["email"]}
                    </a>
                  ),
                ],
                ["WhatsApp", r["whatsapp"]],
                ["Cidade", r["cidade"]],
                [
                  "LinkedIn",
                  r["linkedin"] && /^https?:\/\//.test(r["linkedin"]) ? (
                    <a
                      className="underline"
                      href={r["linkedin"]}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {r["linkedin"]}
                    </a>
                  ) : (
                    r["linkedin"]
                  ),
                ],
                ["Área", r["area_interesse"]],
                [
                  "Vaga",
                  r["job_slug"] ? (
                    <a
                      className="underline"
                      href={`/carreiras/vagas/${r["job_slug"]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r["job_title"]}
                    </a>
                  ) : (
                    "Banco de talentos"
                  ),
                ],
                [
                  "Banco de talentos",
                  r["job_slug"]
                    ? r["talent_bank"]
                      ? "Aceitou ficar também no banco de talentos"
                      : "Não pediu"
                    : "Cadastro direto no banco",
                ],
                ["Data", fmtDate(r["created_at"])],
                [
                  "LGPD",
                  r["lgpd_consent"] ? `Consentimento em ${fmtDate(r["lgpd_consent_at"])}` : "Não",
                ],
              ]}
            />
          </Card>
          <Card title="Finalidade e retenção (LGPD)">
            <Rows
              rows={[
                ["Finalidade", r["retention"]?.purpose_label],
                ["Banco de talentos", r["retention"]?.talent_bank ? "Sim" : "Não"],
                ["Recebida em", fmtDate(r["created_at"])],
                ["Expiração prevista", <RetentionDate iso={r["retention"]?.expires_at} />],
                [
                  "Prazo aplicado",
                  r["retention"]?.months
                    ? `${r["retention"].months} meses a partir da candidatura`
                    : "Política de retenção ainda não definida pela MAG",
                ],
              ]}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Nada é apagado automaticamente: a data só indica o que a MAG deve revisar.
            </p>
          </Card>
          <Card title="Mensagem">
            <p className="whitespace-pre-wrap text-sm">{r["mensagem"] || "-"}</p>
          </Card>
          <Card title="Currículo">
            {r["resume_path"] ? (
              <Button onClick={open} disabled={opening}>
                <FileText /> {opening ? "Preparando..." : "Baixar currículo (PDF)"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Sem currículo anexado.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              O download confere sua sessão a cada acesso e só funciona para Admin e DHO.
            </p>
          </Card>
        </div>
        <StatusEditor
          status={r["status"]}
          notes={r["internal_notes"]}
          options={APP_STATUS}
          onSave={async (status, internal_notes) => {
            await save({ data: { id, status, internal_notes } });
            await qc.invalidateQueries({ queryKey: ["interno"] });
          }}
        />
      </div>
      <section className="mt-7">
        <InterviewPanel applicationId={id} />
      </section>
    </>
  );
}
