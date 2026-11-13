import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import {
  createPanelInvitation,
  getPanelInvitations,
  revokePanelInvitation,
} from "@/lib/invitations.functions";
import { Card, ErrorState, fmtDate, tableCls } from "./ui";
import { Button } from "@/components/ui/button";
import { PANEL_ROLES } from "@/lib/roles";
export function Invitations() {
  const get = useServerFn(getPanelInvitations),
    create = useServerFn(createPanelInvitation),
    revoke = useServerFn(revokePanelInvitation),
    qc = useQueryClient();
  const q = useQuery({ queryKey: ["interno", "invitations"], queryFn: () => get() });
  const [link, setLink] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["interno", "invitations"] });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form);
    const roles = PANEL_ROLES.filter((r) => d.has(`invite-${r}`));
    if (!roles.length) {
      toast.error("Selecione ao menos um perfil");
      return;
    }
    setBusy(true);
    try {
      const result = await create({ data: { email: String(d.get("email") || ""), roles } });
      setLink(result.url);
      form.reset();
      await refresh();
      if (result.emailSent) toast.success("Convite enviado por e-mail. O link também está disponível para copiar.");
      else toast.success(result.emailConfigured ? "Convite criado. O e-mail não foi enviado; copie e entregue o link." : "Convite criado. O serviço de e-mail ainda não está configurado; copie e entregue o link.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="my-6 space-y-4">
      <Card title="Convidar uma pessoa">
        <p className="mb-3 text-sm text-muted-foreground">
          A pessoa recebe um link de uso único, válido por 72 horas, e define a própria senha.
          Compartilhe o link por um canal de confiança; o sistema não envia e-mail automaticamente.
        </p>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
          <label className="min-w-56 flex-1 text-sm font-medium">
            E-mail
            <input
              name="email"
              type="email"
              required
              maxLength={255}
              className="mt-1 h-10 w-full rounded-md border bg-card px-3"
            />
          </label>
          <fieldset className="flex gap-3 text-sm">
            <legend className="mb-2 text-sm font-medium">Perfis</legend>
            {(
              [
                ["admin", "Administrador"],
                ["comercial", "Comercial"],
                ["gerente", "Gerente"],
                ["dho", "DHO"],
              ] as const
            ).map(([r, label]) => (
              <label key={r} className="flex items-center gap-1.5">
                <input name={`invite-${r}`} type="checkbox" />
                {label}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={busy}>
            Gerar convite
          </Button>
        </form>
        {link && (
          <div className="mt-4 rounded-md border bg-surface p-4">
            <p className="mb-2 text-sm font-medium">
              Copie agora. O link não poderá ser consultado novamente.
            </p>
            <input
              aria-label="Link do convite criado"
              readOnly
              value={link}
              className="h-10 w-full rounded-md border bg-card px-3 text-xs"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(
                    () => toast.success("Link copiado"),
                    () => toast.error("Selecione o link e copie manualmente"),
                  );
                }}
              >
                <Copy /> Copiar link
              </Button>
              <Button type="button" variant="ghost" onClick={() => setLink("")}>
                Já compartilhei
              </Button>
            </div>
          </div>
        )}
      </Card>
      {q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        !!q.data?.length && (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th>Convite</th>
                  <th>Perfis</th>
                  <th>Expiração</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.roles.join(", ")}</td>
                    <td>{fmtDate(new Date(i.expiresAt).toISOString())}</td>
                    <td>{i.state}</td>
                    <td>
                      {i.state === "pendente" && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setBusy(true);
                            void revoke({ data: { id: i.id } })
                              .then(async () => {
                                setLink("");
                                await refresh();
                                toast.success("Convite revogado");
                              })
                              .catch((e) =>
                                toast.error(
                                  e instanceof Error ? e.message : "Não foi possível revogar",
                                ),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          Revogar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}
