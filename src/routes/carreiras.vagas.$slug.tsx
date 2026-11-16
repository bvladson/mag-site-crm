import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MapPin, Clock, CalendarDays, Info } from "lucide-react";
import { getPublicJob } from "@/lib/careers.functions";
import { employmentType, jobDate, jobFacts, type PublicJob } from "@/config/careers";
import { Section } from "@/components/site/Section";
import { ApplicationForm } from "@/components/site/ApplicationForm";
import { Button } from "@/components/ui/button";
import { jsonLd } from "@/lib/seo";

const BASE = "https://magmoveiscorporativos.com.br";

/** Texto da vaga para busca e JobPosting: resumo, descrição e listas (sem HTML). */
const fullText = (j: PublicJob) => [
  j.summary, j.description,
  j.responsibilities.length ? `Responsabilidades: ${j.responsibilities.join("; ")}.` : null,
  j.requirements.length ? `Requisitos: ${j.requirements.join("; ")}.` : null,
  j.differentials.length ? `Diferenciais: ${j.differentials.join("; ")}.` : null,
].filter(Boolean).join("\n\n");

export const Route = createFileRoute("/carreiras/vagas/$slug")({
  loader: async ({ params }) => {
    // Endereço malformado (maiúscula, acento, ../): 404 aqui, sem chegar à validação do servidor (que daria 500).
    if (!/^[a-z0-9-]{1,80}$/.test(params.slug)) throw notFound();
    const job = await getPublicJob({ data: params.slug });
    if (!job) throw notFound();
    return { job };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Vaga não encontrada — Carreiras MAG" }, { name: "robots", content: "noindex" }] };
    const j = loaderData.job;
    const url = `${BASE}/carreiras/vagas/${j.slug}`;
    const description = j.summary || `${j.title} na MAG Móveis Corporativos.`;
    return {
      meta: [
        { title: `${j.title}${j.open ? "" : " (encerrada)"} — Carreiras MAG` },
        { name: "description", content: description },
        { property: "og:title", content: `${j.title} — Carreiras MAG` },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        // Encerrada: a URL continua (histórico), mas sai dos buscadores e do sitemap.
        ...(j.open ? [] : [{ name: "robots", content: "noindex" }]),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: j.open ? [{ type: "application/ld+json", children: jsonLd({
        "@context": "https://schema.org", "@type": "JobPosting", title: j.title, description: fullText(j) || description, url, directApply: true,
        ...(j.openedAt ? { datePosted: j.openedAt } : {}), ...(j.closesAt ? { validThrough: j.closesAt } : {}),
        ...(employmentType(j.contractType) ? { employmentType: employmentType(j.contractType) } : {}),
        hiringOrganization: { "@type": "Organization", name: "MAG Móveis Corporativos", sameAs: BASE, logo: `${BASE}/images/mag-logo.png` },
        ...(j.workModel === "remoto"
          ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "Brasil" } }
          : { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: j.location || "Fortaleza", addressCountry: "BR" } } }),
      }) }] : [],
    };
  },
  component: JobPage,
});

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <ul className="mt-3 grid gap-2">
        {items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><span aria-hidden className="text-brand">•</span><span>{item}</span></li>)}
      </ul>
    </section>
  );
}

function JobPage() {
  const { job: j } = Route.useLoaderData();
  const facts = jobFacts(j);
  return (
    <Section className="mag-careers-application">
      <nav className="text-xs text-muted-foreground"><Link to="/carreiras">Carreiras</Link> / {j.title}</nav>
      {j.area && <p className="eyebrow mt-5">{j.area}</p>}
      <h1 className="display-title mt-5">{j.title}</h1>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
        {facts && <p className="flex items-center gap-1"><MapPin className="size-4 shrink-0" /> {facts}</p>}
        {j.schedule && <p className="flex items-center gap-1"><Clock className="size-4 shrink-0" /> {j.schedule}</p>}
        {j.open && j.closesAt && <p className="flex items-center gap-1"><CalendarDays className="size-4 shrink-0" /> Inscrições até {jobDate(j.closesAt)}</p>}
      </div>
      {!j.open ? (
        <div className="mt-8 max-w-2xl rounded-md border bg-surface p-6">
          <p className="flex items-center gap-2 text-lg font-semibold"><Info className="size-5 text-brand" /> Esta vaga foi encerrada.</p>
          <p className="mt-1 text-muted-foreground">Ela não recebe mais candidaturas. Veja as vagas abertas ou deixe seu currículo no banco de talentos.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button asChild><Link to="/carreiras" hash="vagas">Ver vagas abertas</Link></Button>
            <Button asChild variant="outline"><Link to="/carreiras/banco-de-talentos">Banco de talentos</Link></Button>
          </div>
        </div>
      ) : (
        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
          <div className="max-w-2xl">
            {j.summary && <p className="text-lg">{j.summary}</p>}
            {j.description && j.description.split(/\n\s*\n/).map((paragraph, index) => <p key={index} className="mt-4 whitespace-pre-line text-muted-foreground">{paragraph}</p>)}
            <List title="Responsabilidades" items={j.responsibilities} />
            <List title="Requisitos" items={j.requirements} />
            <List title="Diferenciais" items={j.differentials} />
          </div>
          <div id="candidatura" className="lg:sticky lg:top-24 lg:self-start"><ApplicationForm job={{ slug: j.slug, title: j.title }} /></div>
        </div>
      )}
    </Section>
  );
}
