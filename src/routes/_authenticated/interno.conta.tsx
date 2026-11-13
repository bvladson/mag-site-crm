import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { updateMyPassword } from "@/lib/auth.functions";
import { lerPerfilComercial, salvarPerfilComercial } from "@/lib/propostas.functions";
import { PageTitle, Card, useMe } from "@/components/interno/ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/interno/conta")({ component: AccountPage });

function AccountPage() {
  const me = useMe();
  const change = useServerFn(updateMyPassword);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirm") ?? "")) {
      toast.error("A confirmação não confere com a nova senha.");
      return;
    }
    setSaving(true);
    try {
      await change({ data: { currentPassword: String(data.get("current") ?? ""), password } });
      toast.success("Senha alterada. Entre novamente com a nova senha.");
      qc.clear();
      await navigate({ to: "/interno/login" });
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message.replace(/^(Forbidden|Unauthorized): /, "")
          : "Não foi possível alterar a senha",
      );
    } finally {
      setSaving(false);
    }
  };
  const field =
    "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";
  return (
    <>
      <PageTitle title="Minha conta" />
      <div className="max-w-xl space-y-5">
        <Card title="Segurança da conta">
          <p className="mb-3 text-sm text-muted-foreground">
            Configure o aplicativo autenticador, guarde seus códigos de recuperação e gerencie suas
            sessões.
          </p>
          <Button asChild variant="outline">
            <Link to="/interno/seguranca">Abrir segurança</Link>
          </Button>
        </Card>
        {me.data?.roles.some((r) => r === "admin" || r === "comercial") && <PerfilComercial />}
        <Card title="Trocar senha">
          <p className="mb-3 text-sm text-muted-foreground">{me.data?.email}</p>
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-medium">
              Senha atual
              <input
                required
                name="current"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                className={field}
              />
            </label>
            <label className="block text-sm font-medium">
              Nova senha
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
            <label className="block text-sm font-medium">
              Confirmar nova senha
              <input
                required
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                className={field}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              12 a 256 caracteres, com letras maiúsculas, minúsculas e números.
            </p>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Trocar senha"}
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

type Perfil = Awaited<ReturnType<typeof lerPerfilComercial>>["perfil"];
const campoPerfil =
  "mt-1 h-10 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";

/**
 * Perfil comercial da proposta: o PDF de um orçamento usa SEMPRE o perfil do dono do orçamento (nunca de quem clica em
 * Gerar). Telefone, WhatsApp e e-mail só aparecem para o cliente quando marcados para exibir.
 */
function PerfilComercial() {
  const lerFn = useServerFn(lerPerfilComercial);
  const q = useQuery({ queryKey: ["interno", "perfil-comercial"], queryFn: () => lerFn() });
  if (!q.data)
    return (
      <Card title="Perfil comercial (proposta)">
        <p className="text-sm text-muted-foreground">
          {q.isError ? "Não foi possível carregar o perfil." : "Carregando..."}
        </p>
      </Card>
    );
  return <FormularioPerfil key={JSON.stringify(q.data.perfil)} inicial={q.data.perfil} />;
}

function FormularioPerfil({ inicial }: { inicial: Perfil }) {
  const salvarFn = useServerFn(salvarPerfilComercial);
  const qc = useQueryClient();
  const [p, setP] = useState({
    nome: inicial.nome,
    cargo: inicial.cargo,
    telefone: inicial.telefone,
    whatsapp: inicial.whatsapp,
    email: inicial.email,
    assinatura: inicial.assinatura,
    exibirTelefone: inicial.exibirTelefone,
    exibirWhatsapp: inicial.exibirWhatsapp,
    exibirEmail: inicial.exibirEmail,
  });
  const [saving, setSaving] = useState(false);
  const texto = (
    chave: "nome" | "cargo" | "telefone" | "whatsapp" | "email",
    rotulo: string,
    max: number,
    extra: Record<string, string> = {},
  ) => (
    <label className="block text-sm font-medium">
      {rotulo}
      <input
        value={p[chave]}
        maxLength={max}
        onChange={(e) => setP({ ...p, [chave]: e.target.value })}
        className={campoPerfil}
        {...extra}
      />
    </label>
  );
  const exibir = (chave: "exibirTelefone" | "exibirWhatsapp" | "exibirEmail", rotulo: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-brand"
        checked={p[chave]}
        onChange={(e) => setP({ ...p, [chave]: e.target.checked })}
      />{" "}
      {rotulo}
    </label>
  );
  const contatos = [
    p.exibirEmail && p.email,
    p.exibirWhatsapp && p.whatsapp && `WhatsApp ${p.whatsapp}`,
    p.exibirTelefone && p.telefone && `Tel. ${p.telefone}`,
  ].filter(Boolean);
  const salvar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await salvarFn({ data: p });
      toast.success("Perfil comercial salvo (vale para as próximas versões das suas propostas)");
      await qc.invalidateQueries({ queryKey: ["interno", "perfil-comercial"] });
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message.replace(/^(Forbidden|Unauthorized): /, "")
          : "Não foi possível salvar",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Perfil comercial (proposta)">
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {texto("nome", "Nome na proposta", 80)}
          {texto("cargo", "Cargo/função", 60, { placeholder: "Consultor(a) comercial" })}
          {texto("telefone", "Telefone", 20, { inputMode: "tel", placeholder: "(85) 3122-0506" })}
          {texto("whatsapp", "WhatsApp", 20, { inputMode: "tel", placeholder: "(85) 99999-9999" })}
        </div>
        {texto("email", "E-mail", 120, { type: "email" })}
        <label className="block text-sm font-medium">
          Assinatura (opcional, até 3 linhas)
          <textarea
            value={p.assinatura}
            maxLength={200}
            rows={2}
            onChange={(e) => setP({ ...p, assinatura: e.target.value })}
            className={`${campoPerfil} h-16 py-2`}
          />
        </label>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {exibir("exibirTelefone", "Exibir telefone")}
          {exibir("exibirWhatsapp", "Exibir WhatsApp")}
          {exibir("exibirEmail", "Exibir e-mail")}
        </div>
        <div
          className="rounded-md border bg-surface p-3 text-sm"
          aria-label="Como aparece na proposta"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Como aparece na proposta
          </p>
          <p className="mt-1 font-semibold">{p.nome || "—"}</p>
          <p>{p.cargo || "Consultor(a) comercial"}</p>
          <p className="text-muted-foreground">
            {[
              ...contatos,
              ...(p.exibirEmail && p.email ? [] : ["E-mail não informado na proposta."]),
            ].join(" · ")}
          </p>
          {p.assinatura && (
            <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{p.assinatura}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Nenhum contato aparece por padrão (nem o e-mail de login): só os preenchidos aqui e
          marcados para exibir. Contatos não marcados nunca aparecem para o cliente nem para outras
          pessoas do painel. As propostas já geradas não mudam.
        </p>
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar perfil comercial"}
        </Button>
      </form>
    </Card>
  );
}
