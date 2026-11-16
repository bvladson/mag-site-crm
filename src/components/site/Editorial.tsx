import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { images } from "@/data/catalog";
import { siteImageUrl, type SiteSection } from "@/lib/site-content";
import { usePublicSite, useSiteContent } from "./SiteContentProvider";
import "./Editorial.css";

export function SectionIndex({
  index,
  label,
}: {
  index: string;
  label: string;
}) {
  return (
    <p className="section-index">
      <span>{index}</span>
      {label}
    </p>
  );
}

export function EditorialHero({
  label,
  title,
  text,
  image,
}: {
  label: string;
  title: string;
  text?: string;
  image?: string;
}) {
  return (
    <section className="editorial-hero">
      {image && (
        <img
          src={image}
          alt=""
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="film-overlay" />
      <div className="editorial-container relative z-10">
        {label && <p className="technical-label">{label}</p>}
        <h1 className="display-title mt-6 max-w-4xl">{title}</h1>
        {text && (
          <p className="mt-6 max-w-lg text-lg text-graphite-foreground/85">
            {text}
          </p>
        )}
      </div>
    </section>
  );
}

const defaultSteps = [
  { title: "Entender", text: "Ouvir a equipe e conhecer a rotina do espaço." },
  {
    title: "Planejar",
    text: "Relacionar mobiliário, circulação e necessidades.",
  },
  { title: "Separar", text: "Organizar os produtos para cada ambiente." },
  { title: "Entregar", text: "Levar o mobiliário até a sua empresa." },
  { title: "Montar", text: "Cuidar da montagem e dos detalhes." },
  {
    title: "Ambiente pronto",
    text: "O espaço preparado para a rotina de trabalho.",
  },
];

function PublicAction({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      {...(/^https:\/\//.test(href)
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {children}
    </a>
  );
}

export function MAGProcess({
  index = "02",
  section,
}: {
  index?: string;
  section?: SiteSection;
}) {
  const { content, preview } = useSiteContent();
  const editorial = (
    content.home as typeof content.home & {
      editorial?: { processSteps?: typeof defaultSteps };
    }
  ).editorial;
  const steps = editorial?.processSteps ?? defaultSteps;
  const image = siteImageUrl(section?.image, preview) || images.projeto;
  return (
    <section className="mag-process" data-tone={section?.tone ?? "dark"}>
      <div className="editorial-container editorial-section">
        <SectionIndex
          index={index}
          label={section ? section.eyebrow : "O jeito MAG de fazer"}
        />
        <div className="process-heading">
          <h2 className="display-title">
            {section ? section.title : "Do espaço vazio ao ambiente pronto."}
          </h2>
          <div>
            {(section ? section.text : true) && (
              <p className="editorial-support">
                {section
                  ? section.text
                  : "Um ambiente não termina na escolha dos móveis. Atendimento, estoque, entrega e montagem fazem parte do mesmo projeto."}
              </p>
            )}
            {(!section || (section.buttonLabel && section.buttonHref)) && (
              <PublicAction
                href={section?.buttonHref || "/projetos"}
                className="editorial-link mt-6"
              >
                {section ? section.buttonLabel : "Conheça nosso processo"}
                <ArrowUpRight />
              </PublicAction>
            )}
          </div>
        </div>
        <div className="process-image image-reveal mt-12">
          <img
            src={image}
            alt={section?.imageAlt || "Montagem de estações de trabalho"}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <span className="technical-label">MAG / MONTAGEM & OPERAÇÃO</span>
        </div>
        <ol className="process-steps" data-site-list>
          {steps.map(({ title, text }, i) => (
            <li key={`${i}-${title}`}>
              <span className="technical-label">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function FinalCta({ section }: { section?: SiteSection }) {
  const { preview } = useSiteContent();
  const { whatsappUrl, hasWhatsapp } = usePublicSite();
  const image = siteImageUrl(section?.image, preview);
  return (
    <section className="mag-final" data-tone={section?.tone ?? "dark"}>
      {image && (
        <img
          src={image}
          alt={section?.imageAlt || ""}
          loading="lazy"
          className="mag-final-image"
        />
      )}
      {image && <div className="film-overlay" />}
      <div className="editorial-container relative z-10">
        <SectionIndex
          index="MAG"
          label={section ? section.eyebrow : "Vamos conversar"}
        />
        <div className="final-cta-grid">
          <div>
            <h2 className="display-title">
              {section
                ? section.title
                : "Seu próximo ambiente começa com uma conversa."}
            </h2>
            {section?.text && (
              <p className="editorial-support mt-6 max-w-xl">{section.text}</p>
            )}
          </div>
          <div className="final-cta-actions">
            {(!section || (section.buttonLabel && section.buttonHref)) && (
              <PublicAction
                href={section?.buttonHref || "/contato"}
                className="editorial-button"
              >
                {section ? section.buttonLabel : "Quero falar sobre meu espaço"}
                <ArrowUpRight />
              </PublicAction>
            )}
            {section ? (
              <a
                className="editorial-link"
                href={whatsappUrl()}
                target={hasWhatsapp ? "_blank" : undefined}
                rel="noopener noreferrer"
              >
                {hasWhatsapp ? "Falar no WhatsApp" : "Falar com a MAG"}
                <ArrowRight />
              </a>
            ) : (
              <Link to="/orcamento" className="editorial-link">
                Montar uma lista de orçamento
                <ArrowRight />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function TextLink({
  children,
  to,
}: {
  children: ReactNode;
  to:
    | "/projetos"
    | "/sobre"
    | "/empresas"
    | "/produtos"
    | "/ambientes"
    | "/blog"
    | "/carreiras"
    | "/contato"
    | "/redes"
    | "/orcamento";
}) {
  return (
    <Link className="editorial-link" to={to}>
      {children}
      <ArrowUpRight />
    </Link>
  );
}
