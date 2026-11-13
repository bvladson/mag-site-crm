import { createFileRoute, Link } from "@tanstack/react-router";
import { environments, categories } from "@/data/catalog";
import { PageHero, Section, SectionHeader } from "@/components/site/Section";

export const Route = createFileRoute("/ambientes/")({
  head: () => ({
    meta: [
      { title: "Ambientes — MAG Móveis Corporativos" },
      { name: "description", content: "Diretoria, operacional, reunião, recepção, call center, home office e educação: soluções por ambiente." },
      { property: "og:title", content: "Ambientes — MAG Móveis Corporativos" },
      { property: "og:description", content: "Encontre soluções para o seu ambiente." },
    ],
    links: [{ rel: "canonical", href: "/ambientes" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Ambientes" title="Encontre soluções para o seu ambiente." text="Escolha o espaço e veja os produtos indicados para ele." />
      <Section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {environments.map((e) => (
            <Link key={e.slug} to="/ambientes/$slug" params={{ slug: e.slug }} className="group relative overflow-hidden rounded-md">
              <img src={e.image} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
              <div className="absolute inset-0 bg-gradient-to-t from-graphite/85 to-transparent" />
              <div className="absolute bottom-0 p-5 text-graphite-foreground">
                <h2 className="text-2xl font-semibold">{e.name}</h2>
                <p className="text-sm text-graphite-foreground/80">{e.tagline}</p>
              </div>
            </Link>
          ))}
        </div>
      </Section>
      <Section tone="surface">
        <SectionHeader title="Ou navegue por categoria" />
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link key={c.slug} to="/categoria/$slug" params={{ slug: c.slug }} className="rounded-full border bg-card px-4 py-2 text-sm font-medium hover:border-brand hover:text-brand">{c.name}</Link>
          ))}
        </div>
      </Section>
    </>
  ),
});
