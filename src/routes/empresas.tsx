import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Layers, RefreshCw, GraduationCap, MessagesSquare } from "lucide-react";
import { images } from "@/data/catalog";
import { PageHero, Section } from "@/components/site/Section";
import { Button } from "@/components/ui/button";
import { usePublicSite } from "@/components/site/SiteContentProvider";

const items = [
  {
    icon: Building2,
    t: "Compra corporativa",
    d: "Atendimento para demandas em volume, com consultor dedicado.",
  },
  {
    icon: Layers,
    t: "Projetos completos",
    d: "Do planejamento ao mobiliário, com fornecimento e montagem.",
  },
  {
    icon: RefreshCw,
    t: "Renovação de ambientes",
    d: "Modernização de escritórios existentes, por etapas ou de uma vez.",
  },
  {
    icon: GraduationCap,
    t: "Mobiliário escolar",
    d: "Soluções para escolas, universidades e centros de treinamento.",
  },
  {
    icon: MessagesSquare,
    t: "Atendimento consultivo",
    d: "Ajuda para escolher os produtos adequados à rotina da equipe.",
  },
];

export const Route = createFileRoute("/empresas")({
  head: () => ({
    meta: [
      { title: "Soluções para empresas — MAG Móveis Corporativos" },
      {
        name: "description",
        content:
          "Compra corporativa, projetos completos, renovação de ambientes e mobiliário escolar.",
      },
      { property: "og:title", content: "Soluções para empresas — MAG" },
      {
        property: "og:description",
        content: "Da cadeira ao projeto completo, com atendimento consultivo.",
      },
    ],
    links: [{ rel: "canonical", href: "/empresas" }],
  }),
  component: BusinessPage,
});
function BusinessPage() {
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  return (
    <>
      <PageHero
        eyebrow="Empresas"
        title="Da cadeira ao projeto completo."
        text="A MAG atende empresas de todos os tamanhos com mobiliário, planejamento e montagem."
        image={images.envReuniao}
      />
      <Section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-md border bg-card p-6">
              <Icon className="size-7 text-brand" />
              <h2 className="mt-4 text-2xl font-semibold">{t}</h2>
              <p className="mt-2 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg">
            <Link to="/contato">Falar com um especialista</Link>
          </Button>
          <Button asChild size="lg" variant="whatsapp">
            <a
              href={whatsappUrl("Olá! Sou de uma empresa e gostaria de atendimento corporativo.")}
              target={hasWhatsapp ? "_blank" : undefined}
              rel="noreferrer"
            >
              {hasWhatsapp ? "WhatsApp corporativo" : "Atendimento corporativo"}
            </a>
          </Button>
        </div>
      </Section>
    </>
  );
}
