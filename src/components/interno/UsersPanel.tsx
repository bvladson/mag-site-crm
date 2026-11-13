import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listUsers,
  setUserRole,
  createPanelUser,
  resetUserPassword,
  disablePanelUser,
  reactivatePanelUser,
  type Role,
} from "@/lib/admin.functions";
import {
  Loading,
  ErrorState,
  Empty,
  PageTitle,
  Card,
  fmtDate,
  tableCls,
  useMe,
} from "@/components/interno/ui";
import { Button } from "@/components/ui/button";
import { Invitations } from "@/components/interno/Invitations";

const ROLES: { r: Role; label: string }[] = [
  { r: "admin", label: "Admin" },
  { r: "comercial", label: "Comercial" },
  { r: "gerente", label: "Gerente" },
  { r: "dho", label: "DHO" },
];
const PASSWORD_RULE = "12 a 256 caracteres, com letras maiúsculas, minúsculas e números";
const message = (e: unknown) =>
  e instanceof Error
    ? e.message.replace(/^(Forbidden|Unauthorized): /, "")
    : "Não foi possível salvar";

export function UsersPanel({ embedded = false }: { embedded?: boolean }) {
  const fn = useServerFn(listUsers);
  const set = useServerFn(setUserRole);
  const create = useServerFn(createPanelUser);
  const reset = useServerFn(resetUserPassword);
  const disable = useServerFn(disablePanelUser);
  const reactivate = useServerFn(reactivatePanelUser);
  const me = useMe();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const q = useQuery({ queryKey: ["interno", "users"], queryFn: () => fn(), enabled: !!me.data?.roles.includes("admin") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["interno", "users"] });
  const run = async (action: () => Promise<unknown>, ok?: string) => {
    try {
      await action();
      await refresh();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(message(e));
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const roles = ROLES.map((x) => x.r).filter((r) => data.get(`role-${r}`));
    if (!roles.length) {
      toast.error("Marque pelo menos um perfil.");
      return;
    }
    setSaving(true);
    await run(async () => {
      await create({
        data: {
          email: String(data.get("email") ?? "").trim(),
          password: String(data.get("password") ?? ""),
          roles,
        },
      });
      form.reset();
    }, "Usuário criado. Passe a senha provisória por um canal seguro.");
    setSaving(false);
  };
  const field =
    "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";
  if (me.isLoading) return <Loading />;
  if (!me.data?.roles.includes("admin")) return <ErrorState error={new Error("Forbidden")} />;
  return (
    <>
      <PageTitle as={embedded ? "h2" : "h1"} title="Usuários e permissões" />
      {me.data?.roles.includes("admin") && <Invitations />}
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Somente um administrador cria contas. Comercial vê orçamentos e contatos; DHO vê
        candidaturas e banco de talentos. Gerente analisa descontos; os demais acessos dependem dos
        perfis somados. Cada pessoa pode trocar a própria senha em Minha conta.
      </p>
      <div className="mb-6 max-w-2xl">
        <Card title="Novo usuário">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              E-mail
              <input
                required
                name="email"
                type="email"
                autoComplete="off"
                maxLength={255}
                className={field}
              />
            </label>
            <label className="text-sm font-medium">
              Senha provisória
              <input
                required
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                className={field}
              />
            </label>
            <fieldset className="flex flex-wrap gap-4 text-sm sm:col-span-2">
              <legend className="mb-1 font-medium">Perfis</legend>
              {ROLES.map((x) => (
                <label key={x.r} className="flex items-center gap-2">
                  <input type="checkbox" name={`role-${x.r}`} className="size-4" /> {x.label}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted-foreground sm:col-span-2">Senha: {PASSWORD_RULE}.</p>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Criando..." : "Criar usuário"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <Empty>Nenhum usuário.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className={tableCls}>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Criado em</th>
                {ROLES.map((x) => (
                  <th key={x.r}>{x.label}</th>
                ))}
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((u) => {
                const self = u.id === me.data?.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.email}
                      {self && <span className="ml-2 text-xs text-muted-foreground">(você)</span>}
                      {u.disabled && (
                        <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          Inativo
                        </span>
                      )}
                    </td>
                    <td>{fmtDate(u.created_at)}</td>
                    {ROLES.map((x) => (
                      <td key={x.r}>
                        <input
                          type="checkbox"
                          aria-label={`${x.label} para ${u.email}`}
                          checked={u.roles.includes(x.r)}
                          disabled={u.disabled || (self && x.r === "admin")}
                          onChange={(e) =>
                            run(() =>
                              set({ data: { userId: u.id, role: x.r, enabled: e.target.checked } }),
                            )
                          }
                          className="size-4"
                        />
                      </td>
                    ))}
                    <td className="whitespace-nowrap">
                      {!self && !u.disabled && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const password = window.prompt(
                                `Nova senha provisória para ${u.email} (${PASSWORD_RULE}):`,
                              );
                              if (password)
                                void run(
                                  () => reset({ data: { userId: u.id, password } }),
                                  "Senha redefinida. A pessoa precisa entrar de novo.",
                                );
                            }}
                          >
                            Redefinir senha
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Desativar ${u.email}? A pessoa perde o acesso na hora.`,
                                )
                              )
                                void run(
                                  () => disable({ data: { userId: u.id } }),
                                  "Usuário desativado.",
                                );
                            }}
                          >
                            Desativar
                          </Button>
                        </>
                      )}
                      {u.disabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void run(
                              () => reactivate({ data: { userId: u.id } }),
                              "Usuário reativado. Entre novamente para acessar.",
                            )
                          }
                        >
                          Reativar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
