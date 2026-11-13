import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { getSocialPage } from "@/lib/social.functions";
import { PageHero, Section } from "@/components/site/Section";
import { NetworkIcon, SocialGrid } from "@/components/site/Social";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/redes")({
  loader: () => getSocialPage(),
  head: () => ({
    meta: [
      { title: "MAG nas redes — Acompanhe a MAG Móveis Corporativos" },
      { name: "description", content: "Vídeos, projetos, bastidores e novidades da MAG Móveis Corporativos nas redes sociais." },
      { property: "og:title", content: "MAG nas redes" },
      { property: "og:description", content: "Acompanhe a MAG Móveis Corporativos nas redes sociais." },
      { property: "og:url", content: "https://magmoveiscorporativos.com.br/redes" },
    ],
    links: [{ rel: "canonical", href: "https://magmoveiscorporativos.com.br/redes" }],
  }),
  component: RedesPage,
});

function RedesPage() {
  const networks = Route.useLoaderData();
  // Rede com conteúdo ganha seção própria; as que só têm o perfil oficial (sem publicações no site) ficam juntas,
  // como cartões de perfil — nada de seção vazia nem de rede desligada.
  const withItems = networks.filter((network) => network.items.length > 0);
  const profilesOnly = networks.filter((network) => network.items.length === 0 && network.url);
  return (
    <>
      <PageHero eyebrow="Redes sociais" title="Acompanhe a MAG." text="Produtos, projetos entregues, bastidores e novidades. O conteúdo abre na rede original." />
      {networks.length === 0 && (
        <Section><p className="text-muted-foreground">Os perfis oficiais da MAG aparecem aqui em breve.</p></Section>
      )}
      {profilesOnly.length > 0 && (
        <Section>
          <h2 className="text-3xl font-semibold">Perfis oficiais da MAG</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {profilesOnly.map((network) => (
              <a key={network.network} href={network.url} target="_blank" rel="noopener noreferrer" aria-label={`MAG no ${network.label} (abre em nova aba)`}
                className="group flex items-center gap-3 rounded-md border bg-card p-4 transition hover:border-brand">
                <span className="grid size-11 shrink-0 place-items-center rounded-md bg-graphite text-graphite-foreground"><NetworkIcon network={network.network} className="size-5" /></span>
                <span className="min-w-0">
                  <span className="block font-semibold">{network.label}</span>
                  {network.handle && <span className="block truncate text-sm text-muted-foreground">{network.handle}</span>}
                </span>
                <ArrowUpRight className="ml-auto size-4 shrink-0 opacity-60 group-hover:text-brand" />
              </a>
            ))}
          </div>
        </Section>
      )}
      {withItems.map((network, index) => (
        <Section key={network.network} tone={(index + (profilesOnly.length ? 1 : 0)) % 2 ? "surface" : "default"}>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-md bg-graphite text-graphite-foreground"><NetworkIcon network={network.network} className="size-5" /></span>
              <div>
                <h2 className="text-3xl font-semibold">{network.label}</h2>
                {network.handle && <p className="text-sm text-muted-foreground">{network.handle}</p>}
              </div>
            </div>
            {network.url && (
              <Button asChild variant="outline"><a href={network.url} target="_blank" rel="noopener noreferrer">Seguir no {network.label} <ArrowUpRight /></a></Button>
            )}
          </div>
          <SocialGrid items={network.items} />
        </Section>
      ))}
    </>
  );
}
