import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { cases } from "@/data/catalog";
import { Section, DemoNote } from "@/components/site/Section";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/projetos/$slug")({
  loader: ({ params }) => {
    const c = cases.find((x) => x.slug === params.slug);
    if (!c) throw notFound();
    return { c };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.c.type ?? "Projeto"} — Projetos MAG` },
      { name: "description", content: loaderData?.c.summary ?? "Projeto MAG." },
      { property: "og:title", content: `${loaderData?.c.type ?? "Projeto"} — Projetos MAG` },
      { property: "og:description", content: loaderData?.c.summary ?? "Projeto MAG." },
    ],
  }),
  component: CasePage,
});

function CasePage() {
  const { c } = Route.useLoaderData();
  return (
    <Section>
      <nav className="text-xs text-muted-foreground"><Link to="/projetos">Projetos</Link> / {c.type}</nav>
      <h1 className="mt-3 text-4xl font-semibold lg:text-6xl">{c.type}</h1>
      <p className="mt-2 text-muted-foreground">{c.company} · {c.city}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <figure><img src={c.before} alt="Projeto" className="aspect-[4/3] w-full rounded-md object-cover" /><figcaption className="mt-2 text-sm text-muted-foreground">Projeto</figcaption></figure>
        <figure><img src={c.image} alt="Resultado" className="aspect-[4/3] w-full rounded-md object-cover" /><figcaption className="mt-2 text-sm text-muted-foreground">Resultado</figcaption></figure>
      </div>
      <p className="mt-8 max-w-2xl text-lg">{c.summary}</p>
      <DemoNote />
      <Button asChild size="lg" className="mt-8"><Link to="/contato">Quero um projeto assim</Link></Button>
    </Section>
  );
}
