import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import { MessageCircle, Phone, Mail, MapPin, CheckCircle2 } from "lucide-react";
import { PageHero, Section } from "@/components/site/Section";
import { Honeypot } from "@/components/site/Honeypot";
import { Button } from "@/components/ui/button";
import { usePublicSite } from "@/components/site/SiteContentProvider";
import { submitContactRequest } from "@/lib/leads.functions";
import { readUtm } from "@/lib/utm";
import { getPublicUnits } from "@/lib/units.functions";
import { unitMapUrl, unitPhoneLabel } from "@/lib/units";

const schema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
  empresa: z.string().trim().max(120).optional(),
  email: z.string().trim().email("E-mail inválido").max(255),
  whatsapp: z.string().trim().min(10, "Informe um WhatsApp válido").max(20),
  assunto: z.string().max(60),
  mensagem: z.string().trim().min(5, "Escreva uma mensagem").max(2000),
});

export const Route = createFileRoute("/contato")({
  loader: () => getPublicUnits(),
  head: () => ({
    meta: [
      { title: "Contato — MAG Móveis Corporativos" },
      {
        name: "description",
        content: "Fale com um consultor MAG pelo WhatsApp, telefone ou formulário.",
      },
      { property: "og:title", content: "Contato — MAG Móveis Corporativos" },
      { property: "og:description", content: "Fale com um consultor MAG." },
    ],
    links: [{ rel: "canonical", href: "/contato" }],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { site, whatsappUrl, hasWhatsapp } = usePublicSite();
  const units = Route.useLoaderData();
  const send = useServerFn(submitContactRequest);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ protocolo: string; text: string } | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = schema.safeParse(
      Object.fromEntries([...fd.entries()].filter(([k, v]) => v !== "" && k !== "website")),
    );
    if (!r.success)
      return setErrors(
        Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
    setErrors({});
    const d = r.data;
    setLoading(true);
    try {
      const res = await send({
        data: { ...d, ...readUtm(), website: String(fd.get("website") ?? "") },
      });
      setDone({
        protocolo: res.protocolo,
        text: `[${d.assunto}] ${d.mensagem}\n\n${d.nome} · ${d.email} · ${d.whatsapp}\nProtocolo: ${res.protocolo}`,
      });
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error && err.message.startsWith("Muitas")
          ? err.message
          : "Não foi possível enviar agora. Tente novamente em instantes.",
      );
    } finally {
      setLoading(false);
    }
  };
  const field =
    "mt-1 h-11 w-full rounded-md border border-input bg-card px-3 outline-none focus:border-foreground/40";
  const err = (k: string) =>
    errors[k] && <span className="text-xs text-destructive">{errors[k]}</span>;
  return (
    <>
      <PageHero
        eyebrow="Contato"
        title="Conte o que sua empresa precisa."
        text="A equipe MAG ajuda você a encontrar a melhor solução."
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold">Vamos conversar?</h2>
            <p className="text-muted-foreground">
              Envie sua mensagem pelo formulário. Nossa equipe vai retornar pelos dados de contato
              que você informar.
            </p>
            {hasWhatsapp && (
              <a
                href={whatsappUrl()}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-4 rounded-md bg-success p-5 text-primary-foreground"
              >
                <MessageCircle className="size-6" />
                <span>
                  <b className="block">WhatsApp</b>
                  <span className="text-sm opacity-90">Atendimento rápido com um consultor</span>
                </span>
              </a>
            )}
            {[
              { icon: Phone, l: site.phone },
              { icon: Mail, l: site.email },
            ]
              .filter(({ l }) => Boolean(l))
              .map(({ icon: Icon, l }) => (
                <div key={l} className="flex items-center gap-4 rounded-md border p-5">
                  <Icon className="size-5 text-brand" />
                  <span className="text-sm">{l}</span>
                </div>
              ))}
            {units.map((unit) => (
              <section
                key={unit.id}
                className="rounded-lg border border-l-4 bg-card p-5"
                style={{
                  borderLeftColor: {
                    red: "#9a3035",
                    blue: "#287198",
                    green: "#287653",
                    amber: "#a36b21",
                  }[unit.accent],
                }}
              >
                <h3 className="flex items-center gap-2 text-xl font-semibold">
                  <MapPin className="size-5" /> Unidade {unit.name}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{unit.address}</p>
                {unit.hours && <p className="mt-1 text-sm">{unit.hours}</p>}
                <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
                  <a
                    href={unitMapUrl(unit)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand underline underline-offset-4"
                  >
                    Como chegar
                  </a>
                  {unit.wazeUrl && (
                    <a
                      href={unit.wazeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand underline underline-offset-4"
                    >
                      Waze
                    </a>
                  )}
                  {unit.phone && (
                    <a href={`tel:+${unit.phone}`} className="flex items-center gap-1 text-brand">
                      <Phone className="size-4" /> {unitPhoneLabel(unit.phone)}
                    </a>
                  )}
                  {unit.whatsapp && (
                    <a
                      href={`https://wa.me/${unit.whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-success"
                    >
                      <MessageCircle className="size-4" /> WhatsApp
                    </a>
                  )}
                </div>
              </section>
            ))}
          </div>
          {done ? (
            <div className="rounded-md border bg-surface p-6 lg:p-8">
              <CheckCircle2 className="size-8 text-success" />
              <h2 className="mt-3 text-3xl font-semibold">Mensagem recebida!</h2>
              <p className="mt-1 text-muted-foreground">
                Protocolo <b className="text-foreground">{done.protocolo}</b>. Nossa equipe
                comercial vai retornar em breve.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                {hasWhatsapp && (
                  <Button asChild variant="whatsapp">
                    <a href={whatsappUrl(done.text)} target="_blank" rel="noreferrer">
                      <MessageCircle /> Continuar pelo WhatsApp
                    </a>
                  </Button>
                )}
                <Button asChild variant="outline">
                  <Link to="/produtos">Ver produtos</Link>
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={submit}
              noValidate
              className="relative space-y-3 rounded-md border bg-surface p-5 lg:p-8"
            >
              <Honeypot />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Nome
                  <input name="nome" className={field} />
                  {err("nome")}
                </label>
                <label className="block text-sm font-medium">
                  Empresa (opcional)
                  <input name="empresa" className={field} />
                </label>
                <label className="block text-sm font-medium">
                  E-mail
                  <input name="email" type="email" className={field} />
                  {err("email")}
                </label>
                <label className="block text-sm font-medium">
                  WhatsApp
                  <input name="whatsapp" inputMode="tel" className={field} />
                  {err("whatsapp")}
                </label>
              </div>
              <label className="block text-sm font-medium">
                Assunto
                <select name="assunto" className={field}>
                  <option>Orçamento</option>
                  <option>Projeto corporativo</option>
                  <option>Pós-venda</option>
                  <option>Outro</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Mensagem
                <textarea
                  name="mensagem"
                  rows={4}
                  className="mt-1 w-full rounded-md border border-input bg-card p-3 outline-none"
                />
                {err("mensagem")}
              </label>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? "Enviando..." : "Enviar mensagem"}
              </Button>
            </form>
          )}
        </div>
      </Section>
    </>
  );
}
