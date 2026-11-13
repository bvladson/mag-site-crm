import { createFileRoute } from "@tanstack/react-router";
import { PageHero, Section } from "@/components/site/Section";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — MAG Móveis Corporativos" },
      { name: "description", content: "Política de Privacidade da MAG Móveis Corporativos, em conformidade com a LGPD." },
      { property: "og:title", content: "Política de Privacidade — MAG" },
      { property: "og:description", content: "Política de Privacidade da MAG Móveis Corporativos." },
    ],
    links: [{ rel: "canonical", href: "/privacidade" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Institucional" title="Política de Privacidade" />
      <Section>
        <p className="max-w-2xl text-muted-foreground">O texto oficial deste documento será publicado pela MAG após revisão jurídica.</p>
      </Section>
    </>
  ),
});
