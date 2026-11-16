import { createFileRoute } from "@tanstack/react-router";
import { images } from "@/data/catalog";
import { EditorialHero, SectionIndex, FinalCta, TextLink } from "@/components/site/Editorial";
import { usePublicSite } from "@/components/site/SiteContentProvider";

const pillars = [
  ["Acolher", "Ouvir com atenção quem chega até a MAG."],
  ["Orientar", "Ajudar a escolher o que faz sentido para cada espaço."],
  ["Resolver", "Entregar, montar e acompanhar até o fim."],
  ["Evoluir", "Aprender todos os dias, como time e como empresa."],
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
  component: About,
});
function About() {
  const { site } = usePublicSite();
  return <><EditorialHero label="MAG / QUEM SOMOS" title={site.name} text="Espaços que trabalham. Pessoas que fazem acontecer." image={images.team} />
    <section className="editorial-section"><div className="editorial-container"><SectionIndex index="01" label="Nossa perspectiva" /><div className="manifesto-grid mt-12"><h2 className="display-title">O espaço faz parte<br />do dia de alguém.</h2><div><p className="editorial-copy">Por isso, escolher mobiliário é também olhar para as pessoas.</p><p className="mt-6 text-muted-foreground">A MAG acredita que o ambiente de trabalho deve refletir conforto, funcionalidade e organização. Da cadeira às estações de trabalho, do atendimento à montagem, nossa história se constrói nessa relação com cada espaço.</p><TextLink to="/projetos">Conhecer nosso jeito de trabalhar</TextLink></div></div></div></section>
    <section className="editorial-section bg-surface"><div className="editorial-container"><SectionIndex index="02" label="Cultura MAG" /><div className="section-heading"><h2 className="display-title">Uma postura.<br />Em cada etapa.</h2><p className="max-w-sm text-muted-foreground">O que orienta nossa relação com clientes, ambientes e com o próprio time.</p></div><div className="culture-grid">{pillars.map(([t,d],i) => <article key={t}><span className="technical-label text-muted-foreground">0{i+1}</span><h3 className="mt-8 text-5xl lg:text-6xl">{t}</h3><p className="mt-5 text-muted-foreground max-w-xs">{d}</p></article>)}</div></div></section>
    <section className="editorial-section"><div className="editorial-container"><SectionIndex index="03" label="Equipe & operação" /><div className="people-editorial mt-12"><div className="image-reveal"><img src={images.projeto} alt="Montagem de mobiliário corporativo" loading="lazy" /></div><div className="people-copy"><h2 className="display-title">Por trás de cada entrega,<br />existe um time.</h2><p className="mt-8 text-muted-foreground">Quem atende, quem organiza e quem monta. Pessoas conectando a escolha do mobiliário ao ambiente pronto.</p><TextLink to="/carreiras">Trabalhe com a gente</TextLink></div></div></div></section><FinalCta /></>;
}
