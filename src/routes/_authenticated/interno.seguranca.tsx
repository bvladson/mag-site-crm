import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, Copy, Download, CheckCircle2 } from "lucide-react";
import {
  getMySecurity,
  startMyMfa,
  enableMyMfa,
  disableMyMfa,
  renewMyRecovery,
  revokeMySession,
} from "@/lib/mfa.functions";
import { PageTitle, Loading, ErrorState, Card, tableCls } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/interno/seguranca")({
  component: SecurityPage,
});
const field = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
const date = (n: number) =>
  new Date(n).toLocaleString("pt-BR", {
    timeZone: "America/Fortaleza",
    dateStyle: "short",
    timeStyle: "short",
  });
function SecurityPage() {
  const get = useServerFn(getMySecurity),
    start = useServerFn(startMyMfa),
    enable = useServerFn(enableMyMfa),
    disable = useServerFn(disableMyMfa),
    renew = useServerFn(renewMyRecovery),
    revoke = useServerFn(revokeMySession),
    qc = useQueryClient();
  const q = useQuery({ queryKey: ["interno", "security"], queryFn: () => get() });
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof startMyMfa>> | null>(null);
  const [codes, setCodes] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"disable" | "renew" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["interno", "security"] });
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir");
    } finally {
      setBusy(false);
    }
  };
  const begin = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget,
      password = String(new FormData(form).get("password") || "");
    void run(async () => {
      const result = await start({ data: { password } });
      setSetup(result);
      form.reset();
    }, "Leia o QR e confirme o código do aplicativo.");
  };
  const confirm = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") || "");
    void run(async () => {
      const result = await enable({ data: { code } });
      setCodes(result.recoveryCodes);
      setSetup(null);
    }, "Verificação em duas etapas ativada.");
  };
  const sensitive = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      data = { password: String(d.get("password") || ""), code: String(d.get("code") || "") };
    void run(
      async () => {
        if (mode === "disable") {
          await disable({ data });
          setCodes([]);
        } else {
          setCodes((await renew({ data })).recoveryCodes);
        }
        setMode(null);
      },
      mode === "disable"
        ? "Verificação desativada; outras sessões encerradas."
        : "Novos códigos gerados. Os anteriores perderam a validade.",
    );
  };
  const saveCodes = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          `MAG — códigos de recuperação\nCada código funciona uma única vez. Guarde fora do computador de acesso.\n\n${codes.join("\n")}\n`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "mag-codigos-recuperacao.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageTitle title="Segurança" />
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Proteja sua conta com um aplicativo autenticador e acompanhe suas sessões. A ativação é
        individual e mantém o acesso das contas existentes.
      </p>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          {codes.length > 0 && (
            <section
              className="mb-5 rounded-lg border border-primary bg-card p-5"
              aria-label="Códigos de recuperação"
            >
              <h2 className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-5 text-success" /> Guarde seus códigos de recuperação
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Eles são exibidos somente agora. Cada código substitui o autenticador uma única vez.
                A senha da conta continua obrigatória.
              </p>
              <ul className="my-4 grid gap-2 font-mono text-sm sm:grid-cols-2">
                {codes.map((c) => (
                  <li key={c} className="rounded border bg-muted p-2">
                    {c}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(codes.join("\n")).then(
                      () => toast.success("Códigos copiados"),
                      () => toast.error("Não foi possível copiar"),
                    );
                  }}
                >
                  <Copy /> Copiar
                </Button>
                <Button variant="outline" onClick={saveCodes}>
                  <Download /> Baixar
                </Button>
                <Button onClick={() => setCodes([])}>Já guardei os códigos</Button>
              </div>
            </section>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Verificação em duas etapas">
              <div className="mb-4 flex items-center gap-3">
                <ShieldCheck className="size-7 text-primary" />
                <div>
                  <p className="font-semibold">{q.data.enabled ? "Ativa" : "Desligada"}</p>
                  <p className="text-xs text-muted-foreground">
                    {q.data.enabled
                      ? `${q.data.recoveryRemaining} códigos de recuperação disponíveis`
                      : "Google Authenticator, Microsoft Authenticator e aplicativos TOTP compatíveis"}
                  </p>
                </div>
              </div>
              {!q.data.enabled && !setup && (
                <form onSubmit={begin} className="space-y-3">
                  <label className="block text-sm font-medium">
                    Confirme sua senha atual
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={256}
                      className={field}
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    Configurar autenticador
                  </Button>
                </form>
              )}
              {!q.data.enabled && setup && (
                <div className="space-y-4">
                  <p className="text-sm">1. No aplicativo, adicione uma conta e leia este QR.</p>
                  <img
                    src={setup.qr}
                    width={240}
                    height={240}
                    alt="QR de configuração do aplicativo autenticador"
                    className="rounded border bg-white"
                  />
                  <details className="text-sm">
                    <summary className="cursor-pointer">Não consigo ler o QR</summary>
                    <p className="mt-2">
                      Adicione a conta MAG manualmente, com chave baseada em tempo (30 segundos).
                    </p>
                    <code className="mt-2 block break-all rounded border bg-muted p-3 select-all">
                      {setup.secret}
                    </code>
                  </details>
                  <form onSubmit={confirm} className="space-y-3">
                    <label className="block text-sm font-medium">
                      2. Digite os seis números do aplicativo
                      <input
                        name="code"
                        required
                        pattern="[0-9]{6}"
                        maxLength={6}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className={`${field} max-w-48 tracking-widest`}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      A configuração expira em 10 minutos. Nada é ativado antes da confirmação.
                    </p>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={busy}>
                        Confirmar e ativar
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setSetup(null)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                </div>
              )}
              {q.data.enabled && !mode && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setMode("renew")}>
                    Gerar novos códigos
                  </Button>
                  <Button variant="outline" onClick={() => setMode("disable")}>
                    Desativar verificação
                  </Button>
                </div>
              )}
              {q.data.enabled && mode && (
                <form onSubmit={sensitive} className="space-y-3">
                  <p className="text-sm font-medium">
                    {mode === "disable"
                      ? "Desativar a verificação"
                      : "Substituir códigos de recuperação"}
                  </p>
                  <label className="block text-sm">
                    Senha atual
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={256}
                      className={field}
                    />
                  </label>
                  <label className="block text-sm">
                    Código do aplicativo ou de recuperação
                    <input
                      name="code"
                      required
                      maxLength={40}
                      autoComplete="one-time-code"
                      className={field}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={busy}>
                      Confirmar
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() => setMode(null)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              )}
            </Card>
            <Card title="Suas sessões">
              <p className="mb-3 text-sm text-muted-foreground">
                As sessões duram até oito horas. Encerre acessos que não precisa mais.
              </p>
              <div className="space-y-3">
                {q.data.sessions.map((s) => (
                  <div key={s.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <b>{s.current ? "Esta sessão" : "Outro acesso"}</b>
                      {!s.current && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            void run(() => revoke({ data: { id: s.id } }), "Sessão encerrada");
                          }}
                        >
                          Encerrar
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Início: {date(s.createdAt)}
                      <br />
                      Expira: {date(s.expiresAt)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          {q.data.team && (
            <section className="mt-6">
              <h2 className="mb-3 text-lg font-semibold">Situação da equipe</h2>
              <p className="mb-3 text-sm text-muted-foreground">
                O administrador acompanha a ativação; os segredos e códigos individuais não são
                consultáveis.
              </p>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className={tableCls}>
                  <thead>
                    <tr>
                      <th>Conta</th>
                      <th>Perfis</th>
                      <th>Autenticador</th>
                      <th>Acesso mais recente registrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.team.map((u) => (
                      <tr key={u.id}>
                        <td>{u.email}</td>
                        <td>{u.roles.join(", ")}</td>
                        <td>{u.enabled ? "Ativo" : "Não ativado"}</td>
                        <td>{u.lastLogin ? date(u.lastLogin) : "Sem sessão registrada"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
