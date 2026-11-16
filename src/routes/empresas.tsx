import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { images } from "@/data/catalog";
import { EditorialHero, SectionIndex, MAGProcess, FinalCta, TextLink } from "@/components/site/Editorial";
import { usePublicSite } from "@/components/site/SiteContentProvider";
import { Button } from "@/components/ui/button";

const solutions = [
  ["Uma nova operação", "Projetos completos", "Organizar os ambientes, escolher o mobiliário e acompanhar o fornecimento e a montagem."],
  ["Um espaço que precisa mudar", "Renovação de ambientes", "Rever estações, salas e áreas de convivência para acompanhar a rotina da empresa."],
  ["Uma equipe em movimento", "Compra corporativa", "Cadeiras, mesas e armazenamento para compor as posições de trabalho."],
  ["Espaços de aprendizagem", "Mobiliário escolar", "Escolhas para escolas, universidades e centros de treinamento."],
  ["Dúvidas na escolha", "Atendimento consultivo", "Conversar sobre uso, ambiente e necessidades antes de definir o mobiliário."],
];

export const Route = createFileRoute("/empresas")({
  head: () => ({
    meta: [
      { title: "Soluções para empresas — MAG Móveis Corporativos" },
      {
        name: "description",
        content:
          "Compra corporativa, projetos completos, renovação de ambientes e mobiliário escolar.",
      },
      { property: "og:title", content: "Soluções para empresas — MAG" },
      {
        property: "og:description",
        content: "Da cadeira ao projeto completo, com atendimento consultivo.",
      },
    ],
    links: [{ rel: "canonical", href: "/empresas" }],
  }),
  component: Companies,
});
function Companies() {
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  return <><EditorialHero label="MAG / PARA EMPRESAS" title="Mobiliário para empresas." text="Um novo escritório. Uma equipe crescendo. Um espaço que precisa funcionar melhor." image={images.envOperacional} />
    <section className="editorial-section"><div className="editorial-container"><SectionIndex index="01" label="Necessidades & soluções" /><div className="section-heading"><h2 className="display-title">O ponto de partida<br />é o seu negócio.</h2><p className="text-muted-foreground max-w-sm">Primeiro, entender a demanda. Depois, conectar mobiliário e operação ao que a sua empresa precisa.</p></div><div className="b2b-solutions">{solutions.map(([problem,title,desc],i) => <Link key={title} to="/contato" className="b2b-row"><span className="technical-label">0{i+1}</span><div><p className="text-sm text-muted-foreground mb-3">{problem}</p><h3 className="text-3xl lg:text-4xl">{title}</h3></div><p className="text-muted-foreground max-w-md">{desc}</p><ArrowUpRight className="size-6" /></Link>)}</div></div></section>
    <MAGProcess />
    <section className="editorial-section"><div className="editorial-container"><SectionIndex index="03" label="Briefing corporativo" /><div className="manifesto-grid mt-12"><h2 className="display-title">Conte o que<br />precisa funcionar.</h2><div><p className="editorial-copy">Seu ambiente, sua equipe, sua rotina.</p><p className="mt-6 text-muted-foreground">Compartilhe a necessidade da empresa ou reúna os produtos de interesse em uma lista de orçamento. A equipe MAG segue a conversa com você.</p><div className="flex flex-wrap gap-5"><TextLink to="/contato">Falar sobre meu espaço</TextLink><TextLink to="/produtos">Escolher mobiliário</TextLink></div><Button asChild variant="whatsapp" className="mt-6"><a href={whatsappUrl("Olá! Sou de uma empresa e gostaria de atendimento corporativo.")} target={hasWhatsapp ? "_blank" : undefined} rel="noreferrer">{hasWhatsapp ? "WhatsApp corporativo" : "Atendimento corporativo"}</a></Button></div></div></div></section><FinalCta /></>;
}
