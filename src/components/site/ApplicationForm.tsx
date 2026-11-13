import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { submitJobApplication } from "@/lib/leads.functions";
import { careerAreas } from "@/config/careers";
import { usePublicSite } from "@/components/site/SiteContentProvider";
import { Button } from "@/components/ui/button";
import { Honeypot } from "./Honeypot";

const LINKEDIN = /^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/\S{1,280}$/i;

const schema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
  email: z.string().trim().email("E-mail inválido").max(255),
  whatsapp: z.string().trim().min(10, "Informe um WhatsApp ou telefone com DDD").max(20),
  cidade: z.string().trim().min(2, "Informe sua cidade").max(80),
  linkedin: z
    .string()
    .trim()
    .max(300)
    .regex(LINKEDIN, "Use o link do perfil: https://linkedin.com/in/...")
    .optional(),
  area_interesse: z.string().max(80).optional(),
  mensagem: z.string().trim().max(2000).optional(),
});

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(f);
  });

/** Mensagens do servidor que podem ser mostradas como estão (as demais viram um aviso genérico). */
const FRIENDLY = /Muitas|PDF|MB|vaga|LinkedIn|conteúdo ativo|Verificação/;

/** Candidatura a uma vaga (job) ou cadastro no banco de talentos (sem job). O título da vaga vem do servidor. */
export function ApplicationForm({ job }: { job?: { slug: string; title: string } }) {
  const { site } = usePublicSite();
  const send = useServerFn(submitJobApplication);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(
      [...fd.entries()].filter(
        ([k, v]) => !["curriculo", "lgpd", "banco", "website"].includes(k) && v !== "",
      ),
    );
    const parsed = schema.safeParse(raw);
    const errs: Record<string, string> = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    const file = fd.get("curriculo") as File | null;
    const hasFile = file && file.size > 0;
    if (!hasFile) errs["curriculo"] = "Anexe seu currículo em PDF";
    else if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))
      errs["curriculo"] = "Envie um arquivo PDF";
    else if (file.size > 5 * 1024 * 1024) errs["curriculo"] = "Máximo de 5 MB";
    if (!fd.get("lgpd")) errs["lgpd"] = "É necessário autorizar o uso dos dados para enviar";
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;
    setLoading(true);
    try {
      const r = await send({
        data: {
          ...parsed.data,
          job_slug: job?.slug,
          talent_bank: job ? Boolean(fd.get("banco")) : undefined,
          lgpd_consent: true,
          website: String(fd.get("website") ?? ""),
          resume: { name: file!.name, base64: await toBase64(file!) },
        },
      });
      setDone(r.protocolo);
    } catch (err) {
      const expected = err instanceof Error && FRIENDLY.test(err.message); // recusa prevista (PDF, prazo, limite): só o aviso
      if (!expected) console.error(err);
      toast.error(
        expected
          ? (err as Error).message
          : "Não foi possível enviar agora. Tente novamente em instantes.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-md border bg-surface p-6">
        <CheckCircle2 className="size-8 text-success" />
        <h3 className="mt-3 text-2xl font-semibold">
          {job ? "Candidatura recebida!" : "Cadastro recebido!"}
        </h3>
        <p className="mt-1 text-muted-foreground">
          Protocolo <b className="text-foreground">{done}</b>. O time de pessoas (DHO) da MAG vai
          analisar seu perfil e entrar em contato se houver aderência.
        </p>
      </div>
    );
  }

  const field =
    "mt-1 h-11 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";
  const err = (k: string) =>
    errors[k] && <span className="text-xs text-destructive">{errors[k]}</span>;
  return (
    <form
      onSubmit={submit}
      noValidate
      className="relative space-y-3 rounded-md border bg-surface p-5 lg:p-6"
    >
      <Honeypot />
      <h3 className="text-2xl font-semibold">
        {job ? `Candidatar-se: ${job.title}` : "Cadastro no banco de talentos"}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Nome completo
          <input name="nome" autoComplete="name" className={field} />
          {err("nome")}
        </label>
        <label className="block text-sm font-medium">
          E-mail
          <input name="email" type="email" autoComplete="email" className={field} />
          {err("email")}
        </label>
        <label className="block text-sm font-medium">
          WhatsApp ou telefone
          <input name="whatsapp" inputMode="tel" autoComplete="tel" className={field} />
          {err("whatsapp")}
        </label>
        <label className="block text-sm font-medium">
          Cidade / UF
          <input name="cidade" autoComplete="address-level2" className={field} />
          {err("cidade")}
        </label>
        <label className="block text-sm font-medium">
          LinkedIn (opcional)
          <input name="linkedin" placeholder="https://linkedin.com/in/..." className={field} />
          {err("linkedin")}
        </label>
        {!job && (
          <label className="block text-sm font-medium">
            Área de interesse (opcional)
            <select name="area_interesse" className={field} defaultValue="">
              <option value="">Selecione</option>
              {[...careerAreas, "Outra"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="block text-sm font-medium">
        Apresentação (opcional)
        <textarea name="mensagem" rows={4} maxLength={2000} className={`${field} h-auto py-2`} />
      </label>
      <label className="block text-sm font-medium">
        Currículo (PDF, até 5 MB)
        <input
          name="curriculo"
          type="file"
          accept="application/pdf,.pdf"
          className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-graphite file:px-4 file:py-2 file:text-graphite-foreground"
        />
        {err("curriculo")}
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input name="lgpd" type="checkbox" className="mt-1" />
        <span>
          {job ? (
            <>
              <b>Candidatura a esta vaga:</b> autorizo a MAG Móveis Corporativos a usar meus dados e
              meu currículo para avaliar minha candidatura nesta vaga ({job.title}), conforme a
              LGPD.
            </>
          ) : (
            <>
              <b>Banco de talentos:</b> autorizo a MAG Móveis Corporativos a manter meus dados e meu
              currículo no banco de talentos e a me contatar sobre vagas compatíveis, conforme a
              LGPD.
            </>
          )}
        </span>
      </label>
      {err("lgpd")}
      {job && (
        <label className="flex items-start gap-2 text-sm">
          <input name="banco" type="checkbox" className="mt-1" />
          <span>
            <b>Banco de talentos (opcional):</b> também quero que meu currículo fique no banco de
            talentos da MAG para vagas futuras. Se eu não marcar, meus dados serão usados só nesta
            vaga.
          </span>
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        Seus dados e seu currículo não ficam públicos: só o time de pessoas (DHO) e a administração
        da MAG têm acesso, para recrutamento. Para pedir acesso, correção ou exclusão — ou para sair
        do banco de talentos —, escreva para{" "}
        <a className="underline" href={`mailto:${site.email}`}>
          {site.email}
        </a>
        . Veja também a{" "}
        <Link to="/privacidade" className="underline">
          Política de Privacidade
        </Link>
        .
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading ? "Enviando..." : job ? "Enviar candidatura" : "Cadastrar no banco de talentos"}
      </Button>
    </form>
  );
}
