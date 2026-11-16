import { ArrowDown, ArrowUpRight } from "lucide-react";
import { images } from "@/data/catalog";
import { siteImageUrl } from "@/lib/site-content";
import { useSiteContent } from "./SiteContentProvider";
import "./Editorial.css";

/** O material recebido contém a capa. Vídeo só será ativado com um arquivo real publicado. */
export function MAGHeroFilm() {
  const { content, preview } = useSiteContent();
  const hero = content.home.hero;
  const nextSection = content.home.sections.find((section) => section.enabled);
  return (
    <section
      className={`mag-film mag-film-${hero.layout}`}
      data-align={hero.align}
      data-image-fit={hero.imageFit}
    >
      <picture className="mag-film-picture">
        {hero.mobileImage && (
          <source
            media="(max-width: 767px)"
            srcSet={siteImageUrl(hero.mobileImage, preview)}
          />
        )}
        <img
          src={siteImageUrl(hero.desktopImage, preview) || images.heroOffice}
          alt={hero.imageAlt}
          fetchPriority="high"
          decoding="async"
          className="mag-film-media"
        />
      </picture>
      <div className="film-overlay" />
      <div className="editorial-container mag-film-content">
        {hero.eyebrow && <p className="technical-label">{hero.eyebrow}</p>}
        <h1>{hero.title}</h1>
        {hero.text && <p className="mag-film-copy">{hero.text}</p>}
        <div className="hero-actions">
          {hero.primaryLabel && hero.primaryHref && (
            <a
              className="editorial-button"
              href={hero.primaryHref}
              {...(/^https:\/\//.test(hero.primaryHref)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {hero.primaryLabel}
              <ArrowUpRight />
            </a>
          )}
          {hero.secondaryLabel && hero.secondaryHref && (
            <a
              className="editorial-link"
              href={hero.secondaryHref}
              {...(/^https:\/\//.test(hero.secondaryHref)
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {hero.secondaryLabel}
              <ArrowUpRight />
            </a>
          )}
        </div>
      </div>
      {nextSection && (
        <a
          href={`#home-${nextSection.id}`}
          className="editorial-container mag-film-rail"
          aria-label="Conheça a MAG"
        >
          <span>
            Produtos <b>•</b> Projetos <b>•</b> Pronta entrega <b>•</b> Montagem
          </span>
          <ArrowDown className="size-5" />
        </a>
      )}
    </section>
  );
}
