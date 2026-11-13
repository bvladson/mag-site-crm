import { createFileRoute, Link } from "@tanstack/react-router";
import { posts } from "@/data/catalog";
import { PageHero, Section } from "@/components/site/Section";
import { PostCard } from "@/components/site/PostCard";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "Blog — MAG Móveis Corporativos" },
      { name: "description", content: "Ergonomia, NR-17, planejamento de escritório e mobiliário corporativo." },
      { property: "og:title", content: "Blog MAG — Conteúdo para espaços que funcionam" },
      { property: "og:description", content: "Conteúdo para espaços que precisam funcionar melhor." },
    ],
    links: [{ rel: "canonical", href: "/blog" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Conteúdo" title="Conteúdo para espaços que precisam funcionar melhor." />
      <Section>
        {posts.length === 0 && <div className="max-w-2xl rounded-md border bg-surface p-6">
          <h2 className="text-2xl font-semibold">Vamos ajudar a planejar seu espaço.</h2>
          <p className="mt-2 text-muted-foreground">Enquanto preparamos novos conteúdos, fale com a equipe MAG para escolher o mobiliário adequado à sua empresa.</p>
          <Link to="/contato" className="mt-4 inline-block font-semibold text-brand hover:underline">Falar com um consultor</Link>
        </div>}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => <PostCard key={p.slug} post={p} className="" />)}
        </div>
      </Section>
    </>
  ),
});
