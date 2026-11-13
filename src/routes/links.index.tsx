import { createFileRoute, notFound } from "@tanstack/react-router";
import { getPublicLinkTree } from "@/lib/links.functions";
import { LinkTreeView } from "@/components/site/LinkTreeView";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/links/")({
  loader: async () => {
    const publication = await getPublicLinkTree();
    if (!publication) throw notFound();
    return publication;
  },
  staleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.content.title === "MAG Móveis Corporativos"
            ? "MAG Móveis Corporativos | Contatos e links"
            : `${loaderData?.content.title || "Contatos e links"} — MAG Móveis Corporativos`,
      },
      {
        name: "description",
        content:
          loaderData?.content.subtitle ||
          "Fale com a MAG, encontre nossa loja e conheça nossos produtos.",
      },
      { property: "og:title", content: loaderData?.content.title || "MAG Móveis Corporativos" },
      {
        property: "og:description",
        content:
          loaderData?.content.subtitle ||
          "Todos os contatos e links oficiais da MAG em um só lugar.",
      },
      { property: "og:url", content: "https://magmoveiscorporativos.com.br/links/" },
      { property: "og:image", content: "https://magmoveiscorporativos.com.br/images/mag-logo.png" },
      { name: "twitter:title", content: loaderData?.content.title || "MAG Móveis Corporativos" },
    ],
    links: [{ rel: "canonical", href: "https://magmoveiscorporativos.com.br/links/" }],
  }),
  component: PublishedLinks,
});

function PublishedLinks() {
  const initial = Route.useLoaderData();
  const [publication, setPublication] = useState(initial);
  const read = useServerFn(getPublicLinkTree);
  useEffect(() => {
    setPublication(initial);
  }, [initial]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void read()
        .then((value) => {
          if (value) setPublication(value);
        })
        .catch(() => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [read]);
  return <LinkTreeView content={publication.content} metricsToken={publication.metricsToken} />;
}
