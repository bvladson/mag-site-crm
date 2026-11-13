import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAdminUnits, saveAdminUnit } from "@/lib/units.functions";
import { UNIT_ACCENTS, unitMapUrl, unitPhoneLabel, type Unit } from "@/lib/units";
import { PageTitle, Loading, ErrorState, Card, tableCls } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/interno/unidades")({ component: UnitsPage });
const field = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
function UnitsPage() {
  const get = useServerFn(getAdminUnits),
    save = useServerFn(saveAdminUnit),
    qc = useQueryClient();
  const q = useQuery({ queryKey: ["interno", "units"], queryFn: () => get() });
  const [editing, setEditing] = useState<Unit | null>(null),
    [saving, setSaving] = useState(false);
  const newUnit = () =>
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      address: "",
      whatsapp: "",
      phone: "",
      hours: "",
      mapUrl: "",
      wazeUrl: "",
      accent: "red",
      active: true,
      revision: 0,
    });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await save({ data: editing });
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["interno", "units"] });
      await qc.invalidateQueries({ queryKey: ["public", "units"] });
      await qc.invalidateQueries({ queryKey: ["interno", "link-units"] });
      qc.removeQueries({ queryKey: ["public", "site-layout"] });
      toast.success("Unidade salva. Os dados oficiais já foram atualizados.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageTitle title="Unidades">
        <Button onClick={newUnit} disabled={!q.data}>
          Nova unidade
        </Button>
      </PageTitle>
      <p className="mb-5 max-w-3xl text-sm text-muted-foreground">
        Cadastro oficial para contato, rodapé, árvore e atribuição de leads. Desativar preserva o
        histórico e retira a unidade das novas escolhas públicas. O emitente fiscal da proposta
        continua na configuração própria.
      </p>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Endereço</th>
                  <th>Contatos</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.name}</b>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Revisão {u.revision}
                      </span>
                    </td>
                    <td className="max-w-72">
                      <a
                        href={unitMapUrl(u)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {u.address}
                      </a>
                      {u.hours && <span className="mt-1 block text-xs">{u.hours}</span>}
                    </td>
                    <td>
                      {u.whatsapp && <div>WhatsApp {unitPhoneLabel(u.whatsapp)}</div>}
                      {u.phone && <div>Telefone {unitPhoneLabel(u.phone)}</div>}
                    </td>
                    <td>{u.active ? "Ativa" : "Inativa"}</td>
                    <td>
                      <Button variant="outline" size="sm" onClick={() => setEditing({ ...u })}>
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Card
            title={
              editing
                ? editing.revision
                  ? "Editar unidade"
                  : "Nova unidade"
                : "Gestão das unidades"
            }
          >
            {editing ? (
              <form onSubmit={submit} className="space-y-3">
                {(
                  [
                    ["name", "Nome", 100],
                    ["address", "Endereço completo", 320],
                    ["whatsapp", "WhatsApp (55 + DDD + número)", 30],
                    ["phone", "Telefone fixo (55 + DDD + número)", 30],
                    ["hours", "Horário confirmado (opcional)", 120],
                    ["mapUrl", "Google Maps (opcional)", 1500],
                    ["wazeUrl", "Waze (opcional)", 1500],
                  ] as const
                ).map(([key, label, max]) => (
                  <label key={key} className="block text-sm font-medium">
                    {label}
                    <input
                      value={editing[key]}
                      maxLength={max}
                      required={key === "name" || key === "address"}
                      className={field}
                      onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <label className="block text-sm font-medium">
                  Cor
                  <select
                    value={editing.accent}
                    className={field}
                    onChange={(e) =>
                      setEditing({ ...editing, accent: e.target.value as Unit["accent"] })
                    }
                  >
                    {UNIT_ACCENTS.map((a, i) => (
                      <option key={a} value={a}>
                        {["Vermelho", "Azul", "Verde", "Âmbar"][i]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.active}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  />{" "}
                  Unidade ativa
                </label>
                <p className="text-xs text-muted-foreground">
                  Nome e endereço são obrigatórios. Deixe contatos e horários não confirmados em
                  branco.
                </p>
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Salvando..." : "Salvar unidade"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Cada alteração registra uma nova revisão e uma ação na auditoria. Unidades não são
                apagadas pelo painel.
              </p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
