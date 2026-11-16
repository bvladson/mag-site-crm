import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin, ArrowRight, Briefcase, HeartHandshake, Compass, Wrench, TrendingUp } from "lucide-react";
import { listOpenJobs } from "@/lib/careers.functions";
import { images } from "@/data/catalog";
import { careerAreas, careerPillars, jobFacts } from "@/config/careers";
import { PageHero, Section, SectionHeader } from "@/components/site/Section";
import { Button } from "@/components/ui/button";

const pillarIcons = { Acolher: HeartHandshake, Orientar: Compass, Resolver: Wrench, Evoluir: TrendingUp } as const;

export const Route = createFileRoute("/carreiras/")({
  loader: () => listOpenJobs(),
  head: () => ({
    meta: [
      { title: "Carreiras — Trabalhe na MAG Móveis Corporativos" },
      { name: "description", content: "Cultura, áreas em que a MAG contrata, vagas abertas e banco de talentos." },
      { property: "og:title", content: "Carreiras na MAG" },
      { property: "og:description", content: "Venha fazer a MAG acontecer com a gente." },
      { property: "og:url", content: "/carreiras" },
    ],
    links: [{ rel: "canonical", href: "/carreiras" }],
  }),
  component: CareersPage,
});

function CareersPage() {
  const jobs = Route.useLoaderData();
  return (
    <>
      <PageHero eyebrow="Carreiras · DHO" title="Venha fazer a MAG acontecer." text="Um time que acolhe, orienta, resolve e evolui. Conheça nosso jeito de trabalhar, as vagas abertas e o banco de talentos." image={images.team} />
      <Section>
        <SectionHeader eyebrow="Cultura MAG" title="Por que trabalhar na MAG" text="Atendimento, entrega, montagem e pós-venda: em cada etapa existe alguém do nosso time cuidando da experiência de quem confia na MAG. É assim que trabalhamos:" />
        <div className="mag-career-pillars grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {careerPillars.map(({ t, d }) => {
            const Icon = pillarIcons[t];
            return <div key={t} className="border-t py-8"><Icon className="size-6 text-brand" /><h3 className="mt-6 text-4xl font-medium">{t}</h3><p className="mt-1 text-sm text-muted-foreground">{d}</p></div>;
          })}
        </div>
      </Section>
      <Section tone="surface">
        <SectionHeader eyebrow="Onde contratamos" title="Áreas da MAG" text="Quando surge uma vaga, ela aparece logo abaixo. Para as demais áreas, deixe seu currículo no banco de talentos." />
        <ul className="flex flex-wrap gap-2">
          {careerAreas.map((area) => <li key={area} className="mr-4 border-b px-0 py-3 text-sm font-medium">{area}</li>)}
        </ul>
      </Section>
      <Section>
        <div id="vagas" className="scroll-mt-24" />
        <SectionHeader eyebrow="Oportunidades" title="Vagas abertas" />
        {jobs.length === 0 ? (
          <div className="rounded-md border bg-card p-6">
            <p className="font-semibold">Nenhuma vaga aberta no momento.</p>
            <p className="mt-1 text-muted-foreground">Cadastre-se no banco de talentos: quando surgir uma oportunidade na sua área, o DHO entra em contato.</p>
          </div>
        ) : (
          <ul className="mag-career-jobs divide-y border-y bg-card">
            {jobs.map((j) => (
              <li key={j.slug}>
                <Link to="/carreiras/vagas/$slug" params={{ slug: j.slug }} className="flex items-center justify-between gap-5 py-7 hover:bg-surface">
                  <div className="min-w-0">
                    {j.area && <p className="text-xs font-semibold uppercase tracking-wider text-brand">{j.area}</p>}
                    <h3 className="mt-1 text-xl font-semibold">{j.title}</h3>
                    {jobFacts(j) && <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5 shrink-0" /> {jobFacts(j)}</p>}
                    {j.summary && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{j.summary}</p>}
                  </div>
                  <ArrowRight className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section tone="surface">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-4">
            <Briefcase className="size-8 shrink-0 text-brand" />
            <div>
              <h2 className="text-3xl font-semibold">Banco de talentos</h2>
              <p className="mt-1 text-muted-foreground">Não encontrou sua vaga? Deixe seu currículo para futuras oportunidades.</p>
            </div>
          </div>
          <Button asChild size="lg"><Link to="/carreiras/banco-de-talentos">Cadastrar no banco de talentos</Link></Button>
        </div>
      </Section>
    </>
  );
}
