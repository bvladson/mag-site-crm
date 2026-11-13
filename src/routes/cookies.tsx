import { createFileRoute } from "@tanstack/react-router";
import { PageHero, Section } from "@/components/site/Section";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Política de Cookies — MAG Móveis Corporativos" },
      { name: "description", content: "Política de Cookies da MAG Móveis Corporativos, em conformidade com a LGPD." },
      { property: "og:title", content: "Política de Cookies — MAG" },
      { property: "og:description", content: "Política de Cookies da MAG Móveis Corporativos." },
    ],
    links: [{ rel: "canonical", href: "/cookies" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Institucional" title="Política de Cookies" />
      <Section>
        <p className="max-w-2xl text-muted-foreground">O texto oficial deste documento será publicado pela MAG após revisão jurídica.</p>
      </Section>
    </>
  ),
});
