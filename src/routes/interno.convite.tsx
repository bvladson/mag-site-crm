import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getInvitationInfo, acceptPanelInvitation } from "@/lib/invitations.functions";
import { Logo } from "@/components/site/Header";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/interno/convite")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Convite para a equipe — MAG" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: InvitationPage,
});
function InvitationPage() {
  const get = useServerFn(getInvitationInfo),
    accept = useServerFn(acceptPanelInvitation);
  const [token, setToken] = useState(""),
    [loaded, setLoaded] = useState(false),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const fragmentRead = useRef(false);
  useEffect(() => {
    if (fragmentRead.current) return;
    fragmentRead.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(/^[a-f0-9]{64}$/.test(value) ? value : "");
    setLoaded(true);
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
  }, []);
  const q = useQuery({
    queryKey: ["public", "invitation", token.slice(0, 16)],
    queryFn: () => get({ data: { token } }),
    enabled: !!token && !done,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      password = String(d.get("password") || "");
    if (password !== String(d.get("confirm") || "")) {
      toast.error("As senhas não conferem");
      return;
    }
    setBusy(true);
    try {
      await accept({ data: { token, name: String(d.get("name") || ""), password } });
      setDone(true);
      setToken("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível aceitar o convite");
    } finally {
      setBusy(false);
    }
  };
  const field = "mt-1 h-11 w-full rounded-md border bg-card px-3";
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-xl border bg-card p-6">
        <Logo className="h-9" />
        {done ? (
          <>
            <h1 className="mt-5 text-2xl font-semibold">Conta criada</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Seu convite foi utilizado. Entre com o e-mail convidado e a senha que acabou de
              cadastrar.
            </p>
            <Button asChild className="mt-5 w-full">
              <Link to="/interno/login">Ir para o acesso interno</Link>
            </Button>
          </>
        ) : !loaded || (token && q.isLoading) ? (
          <p className="mt-5 text-sm">Conferindo convite...</p>
        ) : !token || q.isError ? (
          <>
            <h1 className="mt-5 text-2xl font-semibold">Convite indisponível</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Este link está incompleto, expirou ou já foi utilizado. Solicite outro convite ao
              administrador.
            </p>
            <Link to="/interno/login" className="mt-4 inline-block text-sm text-primary underline">
              Ir para o acesso interno
            </Link>
          </>
        ) : (
          q.data && (
            <>
              <h1 className="mt-5 text-2xl font-semibold">Faça parte da equipe</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Convite para <b className="text-foreground">{q.data.email}</b>. Perfis:{" "}
                {q.data.roles.join(", ")}.
              </p>
              <form onSubmit={submit} className="mt-5 space-y-3">
                <label className="block text-sm font-medium">
                  Seu nome
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    autoComplete="name"
                    className={field}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Crie uma senha
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={256}
                    autoComplete="new-password"
                    className={field}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Confirme a senha
                  <input
                    name="confirm"
                    type="password"
                    required
                    minLength={12}
                    maxLength={256}
                    autoComplete="new-password"
                    className={field}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  12 a 256 caracteres, com letras maiúsculas, minúsculas e números.
                </p>
                <Button type="submit" disabled={busy} className="w-full">
                  {busy ? "Criando conta..." : "Aceitar convite e criar conta"}
                </Button>
              </form>
            </>
          )
        )}
      </section>
    </main>
  );
}
