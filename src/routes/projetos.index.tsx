import { createFileRoute, Link } from "@tanstack/react-router";
import { cases, images } from "@/data/catalog";
import { EditorialHero, SectionIndex, MAGProcess, FinalCta, TextLink } from "@/components/site/Editorial";


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
  component: Projects,
});
function Projects() {
  return <>
    <EditorialHero label="MAG / PROJETOS CORPORATIVOS" title="Projetos corporativos." text="Do levantamento à montagem. Um olhar para o ambiente inteiro." image={images.envReuniao} />
    <section className="editorial-section"><div className="editorial-container"><SectionIndex index="01" label="Do levantamento à montagem" /><div className="manifesto-grid mt-12"><h2 className="display-title">Um projeto começa<br />antes do primeiro móvel.</h2><div><p className="editorial-copy">Começa com as pessoas, a rotina e o que o espaço precisa resolver.</p><p className="mt-6 text-muted-foreground">A MAG acompanha a escolha do mobiliário, a organização dos ambientes, o fornecimento e a montagem. Da sala de reunião às estações da equipe, cada parte precisa conversar com o conjunto.</p><TextLink to="/contato">Vamos falar sobre seu projeto</TextLink></div></div></div></section>
    <MAGProcess />
    <section className="editorial-section"><div className="editorial-container"><SectionIndex index="03" label={cases.length ? "Projetos & ambientes" : "Possibilidades para o seu espaço"} /><div className="section-heading"><h2 className="display-title">Ambientes pensados<br />como um todo.</h2><TextLink to="/ambientes">Conhecer ambientes</TextLink></div>
    {cases.length > 0 ? <div className="case-editorial-grid">{cases.map(c => <Link key={c.slug} to="/projetos/$slug" params={{slug:c.slug}} className="group"><div className="image-reveal"><img src={c.image} alt={c.type} loading="lazy" /></div><p className="technical-label text-muted-foreground mt-5">{c.type} · {c.city}</p><h3 className="text-4xl mt-3 group-hover:text-brand">{c.company}</h3><p className="mt-3 text-muted-foreground max-w-lg">{c.summary}</p></Link>)}</div> : <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]"><figure className="image-reveal"><img src={images.envOperacional} alt="Estações para ambientes operacionais" loading="lazy" className="aspect-[4/3]" /><figcaption className="technical-label mt-5 text-muted-foreground">OPERAÇÃO / ESPAÇOS DE TRABALHO</figcaption></figure><div className="lg:pt-16"><img src={images.heroOffice} alt="Sala de diretoria" loading="lazy" className="aspect-[4/3] w-full object-cover" /><h3 className="text-3xl mt-6">O próximo projeto pode ser o seu.</h3><p className="mt-4 text-muted-foreground">Conte como sua empresa trabalha e o que deseja mudar. A partir dessa conversa, encontramos as escolhas para o seu ambiente.</p><TextLink to="/contato">Começar uma conversa</TextLink></div></div>}
    </div></section><FinalCta />
  </>;
}
