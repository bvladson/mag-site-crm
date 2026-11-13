import { createFileRoute, Link } from "@tanstack/react-router";
import { HeartHandshake, Compass, Wrench, TrendingUp } from "lucide-react";
import { PageHero, Section, SectionHeader } from "@/components/site/Section";
import { Button } from "@/components/ui/button";

const values = ["Confortável + Ergonômico", "Durável + Funcional", "Estiloso + Organizado", "Produtivo + Adaptável", "Inovador + Acessível"];
const pillars = [
  { icon: HeartHandshake, t: "Acolher", d: "Ouvir com atenção quem chega até a MAG." },
  { icon: Compass, t: "Orientar", d: "Ajudar a escolher o que faz sentido para cada espaço." },
  { icon: Wrench, t: "Resolver", d: "Entregar, montar e acompanhar até o fim." },
  { icon: TrendingUp, t: "Evoluir", d: "Aprender todos os dias, como time e como empresa." },
];

export const Route = createFileRoute("/sobre")({
  head: () => ({
    meta: [
      { title: "Sobre a MAG — Móveis Corporativos" },
      { name: "description", content: "A MAG acredita que o espaço onde você trabalha tem o poder de transformar o seu dia a dia." },
      { property: "og:title", content: "Sobre a MAG Móveis Corporativos" },
      { property: "og:description", content: "Espaços, pessoas, produtividade e histórias." },
    ],
    links: [{ rel: "canonical", href: "/sobre" }],
  }),
  component: () => (
    <>
      <PageHero eyebrow="Sobre a MAG" title="Espaços, pessoas, produtividade e histórias." text="A MAG acredita que o ambiente de trabalho deve ser mais do que funcional: deve refletir bem-estar, produtividade e estilo." />
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHeader eyebrow="Posicionamento" title="Mais do que um móvel: um aliado do seu desempenho." />
            <p className="text-muted-foreground lg:text-lg">
              Criamos soluções que atendem às necessidades funcionais e tornam o ambiente mais confortável e produtivo para todos — no escritório ou em casa. Da cadeira de alta performance às estações de trabalho, cada item é pensado para durar e funcionar bem.
            </p>
          </div>
          <ul className="grid content-start gap-2">
            {values.map((v) => (
              <li key={v} className="flex items-center gap-3 rounded-md border p-4 font-display text-xl font-semibold"><span className="h-5 w-1 bg-brand" />{v}</li>
            ))}
          </ul>
        </div>
      </Section>
      <Section tone="surface">
        <SectionHeader eyebrow="Cultura" title="Pessoas fazem a MAG acontecer." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-md border bg-card p-6"><Icon className="size-6 text-brand" /><h3 className="mt-4 text-2xl font-semibold">{t}</h3><p className="mt-1 text-sm text-muted-foreground">{d}</p></div>
          ))}
        </div>
        <Button asChild size="lg" className="mt-8"><Link to="/carreiras">Trabalhe com a gente</Link></Button>
      </Section>
    </>
  ),
});
