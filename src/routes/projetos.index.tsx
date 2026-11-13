import { createFileRoute, Link } from "@tanstack/react-router";
import { cases, images } from "@/data/catalog";
import { PageHero, Section } from "@/components/site/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/projetos/")({
  head: () => ({
    meta: [
      { title: "Projetos — MAG Móveis Corporativos" },
      { name: "description", content: "Ambientes corporativos planejados, fornecidos e montados pela MAG." },
      { property: "og:title", content: "Projetos — MAG Móveis Corporativos" },
      { property: "og:description", content: "Ambientes que já transformamos." },
    ],
    links: [{ rel: "canonical", href: "/projetos" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Projetos" title="Seu próximo ambiente começa aqui." text="Do levantamento à montagem, converse com a MAG sobre seu projeto corporativo." image={images.envOperacional} />
      <Section>
        {cases.length === 0 && <p className="max-w-2xl text-lg text-muted-foreground">Em breve, os projetos entregues pela MAG estarão aqui. Enquanto isso, conte para a gente o que você precisa.</p>}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <Link key={c.slug} to="/projetos/$slug" params={{ slug: c.slug }} className="group">
              <div className="overflow-hidden rounded-md"><img src={c.image} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.03]" /></div>
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{c.type} · {c.city}</p>
              <h2 className="mt-1 text-xl font-semibold">{c.company}</h2>
              <p className="text-sm text-muted-foreground">{c.summary}</p>
            </Link>
          ))}
        </div>
        <Button asChild size="lg" className="mt-8"><Link to="/contato">Quero falar sobre meu projeto</Link></Button>
      </Section>
    </>
  ),
});
