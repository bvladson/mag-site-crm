import { createFileRoute } from "@tanstack/react-router";
import { PageHero, Section } from "@/components/site/Section";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — MAG Móveis Corporativos" },
      { name: "description", content: "Termos de Uso da MAG Móveis Corporativos, em conformidade com a LGPD." },
      { property: "og:title", content: "Termos de Uso — MAG" },
      { property: "og:description", content: "Termos de Uso da MAG Móveis Corporativos." },
    ],
    links: [{ rel: "canonical", href: "/termos" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Institucional" title="Termos de Uso" />
      <Section>
        <p className="max-w-2xl text-muted-foreground">O texto oficial deste documento será publicado pela MAG após revisão jurídica.</p>
      </Section>
    </>
  ),
});
