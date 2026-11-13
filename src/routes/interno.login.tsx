import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { login } from "@/lib/auth.functions";
import { Logo } from "@/components/site/Header";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/interno/login")({
  head: () => ({
    meta: [{ title: "Acesso interno — MAG" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const authenticate = useServerFn(login);
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const result = await authenticate({
        data: {
          email: String(data.get("email") || "").trim(),
          password: String(data.get("password") || ""),
          ...(challenge ? { code: String(data.get("code") || "") } : {}),
        },
      });
      if (!result.ok) {
        setChallenge(true);
        return;
      }
      qc.clear();
      await navigate({ to: "/interno" });
    } catch (error) {
      toast.error(
        error instanceof Error && /Muitas tentativas|Código inválido/.test(error.message)
          ? error.message
          : "E-mail, senha ou código incorretos.",
      );
    } finally {
      setLoading(false);
    }
  };
  const field =
    "mt-1 h-11 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";
  return (
    <div className="grid min-h-[80vh] place-items-center px-4 py-12">
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border bg-card p-6">
        <Logo className="h-9" />
        <h1 className="mt-5 text-3xl font-semibold">Acesso interno</h1>
        <p className="mt-1 text-sm text-muted-foreground">Área restrita à equipe MAG.</p>
        <label className="mt-5 block text-sm font-medium">
          E-mail
          <input
            required
            name="email"
            type="email"
            autoComplete="username"
            maxLength={255}
            className={field}
            onChange={() => setChallenge(false)}
          />
        </label>
        <label className="mt-3 block text-sm font-medium">
          Senha
          <input
            required
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            className={field}
            onChange={() => setChallenge(false)}
          />
        </label>
        {challenge && (
          <div className="mt-4 rounded-md border bg-surface p-3">
            <label className="block text-sm font-medium">
              {recovery ? "Código de recuperação" : "Código do aplicativo autenticador"}
              <input
                key={String(recovery)}
                required
                name="code"
                inputMode={recovery ? "text" : "numeric"}
                autoComplete="one-time-code"
                maxLength={recovery ? 40 : 6}
                pattern={recovery ? undefined : "[0-9]{6}"}
                className={field}
                autoFocus
              />
            </label>
            <button
              type="button"
              onClick={() => setRecovery(!recovery)}
              className="mt-2 text-xs font-medium text-brand underline"
            >
              {recovery ? "Usar aplicativo autenticador" : "Usar um código de recuperação"}
            </button>
          </div>
        )}
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={loading}>
          {loading ? "Aguarde..." : challenge ? "Verificar e entrar" : "Entrar"}
        </Button>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Para obter acesso, procure o administrador da equipe.
        </p>
      </form>
    </div>
  );
}
