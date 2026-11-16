import { createFileRoute, Link } from "@tanstack/react-router";
import { Section } from "@/components/site/Section";
import { ApplicationForm } from "@/components/site/ApplicationForm";

export const Route = createFileRoute("/carreiras/banco-de-talentos")({
  head: () => ({
    meta: [
      { title: "Banco de talentos — Carreiras MAG" },
      { name: "description", content: "Cadastre seu currículo no banco de talentos da MAG Móveis Corporativos." },
      { property: "og:title", content: "Banco de talentos — Carreiras MAG" },
      { property: "og:description", content: "Deixe seu currículo para futuras oportunidades na MAG." },
      { property: "og:url", content: "/carreiras/banco-de-talentos" },
    ],
    links: [{ rel: "canonical", href: "/carreiras/banco-de-talentos" }],
  }),
  component: () => (
    <Section className="mag-careers-application">
      <nav className="text-xs text-muted-foreground"><Link to="/carreiras">Carreiras</Link> / Banco de talentos</nav>
      <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:gap-20">
        <div>
          <p className="eyebrow">Banco de talentos</p>
          <h1 className="display-title mt-5">Seu próximo capítulo pode ser na MAG.</h1>
          <p className="mt-4 text-muted-foreground lg:text-lg">Não encontrou uma vaga para o seu perfil? Cadastre seu currículo. Quando surgir uma oportunidade na sua área, o DHO entra em contato.</p>
        </div>
        <ApplicationForm />
      </div>
    </Section>
  ),
});
