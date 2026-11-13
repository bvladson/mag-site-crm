import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { campaignDestination, imageUrl, type LinkCampaign } from "@/lib/links";
import "./LinkCampaignCarousel.css";

export function LinkCampaignCarousel({
  campaigns,
  preview,
  onView,
  label = "Campanhas em destaque",
}: {
  campaigns: LinkCampaign[];
  preview: boolean;
  onView: (id: string) => void;
  label?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const interacting = hovered || focused;
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(true);
  const viewed = useRef(new Set<string>());
  const touch = useRef<number | null>(null);
  const area = useRef<HTMLElement>(null);
  const title = useId();
  const current = Math.min(index, campaigns.length - 1);
  const item = campaigns[current];
  const move = (delta: number) =>
    setIndex((value) => (value + delta + campaigns.length) % campaigns.length);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    const visibility = () => setVisible(!document.hidden);
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (campaigns.length < 2 || paused || interacting || reduced || !visible || preview) return;
    const timer = window.setInterval(
      () => setIndex((value) => (value + 1) % campaigns.length),
      8000,
    );
    return () => window.clearInterval(timer);
  }, [campaigns.length, paused, interacting, reduced, visible, preview]);
  useEffect(() => {
    if (!item || preview || !area.current || viewed.current.has(item.id)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          viewed.current.add(item.id);
          onView(item.id);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(area.current);
    return () => observer.disconnect();
  }, [item?.id, preview, onView]);
  if (!item) return null;
  const destination = campaignDestination(item);
  return (
    <section
      ref={area}
      className="links-campaign-carousel"
      role="region"
      aria-roledescription="carrossel"
      aria-labelledby={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      onTouchStart={(event) => {
        touch.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientX;
        if (
          touch.current !== null &&
          end !== undefined &&
          Math.abs(end - touch.current) > 55 &&
          campaigns.length > 1
        ) {
          move(end < touch.current ? 1 : -1);
          setPaused(true);
        }
        touch.current = null;
      }}
    >
      <div className="links-campaign-frame">
        <div
          key={item.id}
          role="group"
          aria-roledescription="slide"
          aria-label={`${current + 1} de ${campaigns.length}: ${item.title}`}
          className="links-campaign-slide"
        >
          <a
            href={destination}
            data-links-target={item.id}
            data-links-kind="campaign"
            {...(destination.startsWith("https://")
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            className="links-campaign-link"
          >
            {item.desktopImage && (
              <picture className="links-campaign-picture">
                {item.mobileImage && (
                  <source media="(max-width: 600px)" srcSet={imageUrl(item.mobileImage, preview)} />
                )}
                <img
                  src={imageUrl(item.desktopImage, preview)}
                  alt={item.title}
                  width={1200}
                  height={675}
                  decoding="async"
                  className="links-campaign-image"
                />
              </picture>
            )}
            <span className="links-campaign-caption">
              <span className="links-campaign-title">{item.title || item.name}</span>
              {item.description && (
                <span className="links-campaign-description">{item.description}</span>
              )}
              <span className="links-campaign-cta">
                {item.buttonLabel || "Saiba mais"}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </span>
            </span>
          </a>
        </div>
        <div className="links-carousel-toolbar">
          <h2
            id={title}
            className={`links-section-label links-carousel-label ${label ? "" : "sr-only"}`}
          >
            {label || "Campanhas"}
          </h2>
          {campaigns.length > 1 && (
            <div className="links-carousel-controls">
              <button
                type="button"
                className="links-carousel-control"
                aria-label="Banner anterior"
                onClick={() => {
                  move(-1);
                  setPaused(true);
                }}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="links-carousel-control"
                aria-label={
                  paused || reduced
                    ? "Ativar troca automática dos banners"
                    : "Pausar troca automática dos banners"
                }
                onClick={() => {
                  if (reduced) setReduced(false);
                  setPaused(!paused && !reduced);
                }}
              >
                {paused || reduced ? (
                  <Play className="size-4" aria-hidden="true" />
                ) : (
                  <Pause className="size-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="links-carousel-control"
                aria-label="Próximo banner"
                onClick={() => {
                  move(1);
                  setPaused(true);
                }}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
      {campaigns.length > 1 && (
        <div className="links-carousel-dots" aria-label="Navegar entre campanhas">
          {campaigns.map((campaign, position) => (
            <button
              key={campaign.id}
              type="button"
              aria-label={`Mostrar campanha ${position + 1}: ${campaign.title || campaign.name}`}
              aria-pressed={current === position}
              className="links-carousel-dot"
              onClick={() => {
                setIndex(position);
                setPaused(true);
              }}
            >
              <span />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
