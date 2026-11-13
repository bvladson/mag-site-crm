import { createFileRoute, notFound } from "@tanstack/react-router";
import { environments } from "@/data/catalog";
import { PageHero } from "@/components/site/Section";
import { Catalog } from "@/components/site/Catalog";

export const Route = createFileRoute("/ambientes/$slug")({
  loader: ({ params }) => {
    const env = environments.find((e) => e.slug === params.slug);
    if (!env) throw notFound();
    return { env };
  },
  head: ({ loaderData }) => {
    const n = loaderData?.env.name ?? "Ambiente";
    return {
      meta: [
        { title: `${n} — Ambientes MAG` },
        { name: "description", content: loaderData?.env.tagline ?? "Produtos por ambiente." },
        { property: "og:title", content: `${n} — Ambientes MAG` },
        { property: "og:description", content: loaderData?.env.tagline ?? "Produtos por ambiente." },
      ],
    };
  },
  component: EnvPage,
});

function EnvPage() {
  const { env } = Route.useLoaderData();
  return (
    <>
      <PageHero eyebrow="Ambiente" title={env.name} text={env.tagline} image={env.image} />
      <Catalog key={env.slug} initialEnv={env.slug} />
    </>
  );
}
