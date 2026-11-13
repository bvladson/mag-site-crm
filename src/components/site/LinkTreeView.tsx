import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  FolderOpen,
  Instagram,
  Link2,
  MapPin,
  MessageCircle,
  Music2,
  Navigation,
  Phone,
  Search,
  Share2,
  Store,
  UserRound,
  UsersRound,
  X,
  Youtube,
} from "lucide-react";
import {
  currentLinkMonth,
  defaultLinkPresentation,
  imageUrl,
  isInLinkSchedule,
  itemDestination,
  resolveLinkBackground,
  telephoneLink,
  whatsappLink,
  type LinkPresentation,
  type LinkTreeContent,
  type LinkTreeItem,
} from "@/lib/links";
import { LinkCampaignCarousel } from "./LinkCampaignCarousel";
import "./LinkTreeView.css";

type Labels = LinkPresentation["labels"];
const themes: Record<LinkTreeContent["theme"], CSSProperties> = {
  mag: {
    color: "#242423",
    "--links-card": "#ffffff",
    "--links-line": "#e7e1da",
    "--links-muted": "#65615e",
    "--links-accent": "#981b28",
    "--links-soft": "#f5f1ec",
    "--links-base": "#f6f3ef",
    "--links-whatsapp": "#26733f",
    "--links-surface": "#ffffffd9",
    "--links-shadow": "#3021120b",
  } as CSSProperties,
  light: {
    color: "#242423",
    "--links-card": "#ffffff",
    "--links-line": "#e7e5e1",
    "--links-muted": "#65615e",
    "--links-accent": "#981b28",
    "--links-soft": "#f5f3f0",
    "--links-base": "#ffffff",
    "--links-whatsapp": "#26733f",
    "--links-surface": "#ffffffe6",
    "--links-shadow": "#3021120b",
  } as CSSProperties,
  dark: {
    color: "#faf7f3",
    "--links-card": "#24292e",
    "--links-line": "#4a4e53",
    "--links-muted": "#c9c6c1",
    "--links-accent": "#bd2c3f",
    "--links-soft": "#363b40",
    "--links-base": "#141a20",
    "--links-whatsapp": "#6bdb91",
    "--links-surface": "#24292ed9",
    "--links-shadow": "#00000066",
  } as CSSProperties,
};
const accents = {
  burgundy: { "--links-unit": "#981b28", "--links-unit-soft": "#f8e9eb" },
  ocean: { "--links-unit": "#14627e", "--links-unit-soft": "#e5f2f7" },
  forest: { "--links-unit": "#326148", "--links-unit-soft": "#e8f2e9" },
  amber: { "--links-unit": "#875217", "--links-unit-soft": "#faf0dd" },
} satisfies Record<LinkTreeItem["accent"], Record<string, string>>;
const icons = {
  drive: FolderOpen,
  catalog: BookOpen,
  youtube: Youtube,
  instagram: Instagram,
  tiktok: Music2,
  whatsapp: MessageCircle,
  link: Link2,
};
function itemIcon(item: LinkTreeItem) {
  if (item.icon && item.icon !== "auto") return icons[item.icon];
  if (item.type === "whatsapp") return MessageCircle;
  if (/youtu(?:be\.com|\.be)/i.test(item.url)) return Youtube;
  if (/instagram\.com/i.test(item.url)) return Instagram;
  if (/tiktok\.com/i.test(item.url)) return Music2;
  if (/drive\.google\.com/i.test(item.url))
    return /catalog/i.test(item.title.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
      ? BookOpen
      : FolderOpen;
  return Link2;
}
function Picture({
  image,
  alt,
  preview,
  className,
  eager = false,
  fallback = "person",
}: {
  image: string;
  alt: string;
  preview: boolean;
  className: string;
  eager?: boolean;
  fallback?: "person" | "store";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  if (failed) {
    const Icon = fallback === "store" ? Store : UserRound;
    return (
      <span
        className={`${className} links-picture-fallback`}
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
      >
        <Icon className="size-6" aria-hidden="true" />
      </span>
    );
  }
  return (
    <img
      key={image}
      src={imageUrl(image, preview)}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
function ActionLink({
  href,
  className,
  children,
  label,
  metricId,
}: {
  href: string;
  className: string;
  children: ReactNode;
  label?: string;
  metricId?: string;
}) {
  if (!href) return null;
  const external = /^https:\/\//i.test(href);
  return (
    <a
      href={href}
      data-links-target={metricId}
      data-links-kind="item"
      className={className}
      {...(label ? { "aria-label": label } : {})}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}
function Entry({ item, preview }: { item: LinkTreeItem; preview: boolean }) {
  if (item.type === "heading")
    return <h3 className="links-section-label links-link-heading">{item.title}</h3>;
  const Icon = itemIcon(item);
  return (
    <ActionLink
      metricId={item.id}
      href={itemDestination(item)}
      className={`links-entry ${item.highlight ? "links-entry-highlight" : ""}`}
    >
      {item.image ? (
        <Picture image={item.image} alt="" preview={preview} className="links-entry-image" />
      ) : (
        <span className="links-entry-icon">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      )}
      <span className="links-entry-copy">
        <span className="links-entry-title">{item.title}</span>
        {item.description && <span className="links-entry-description">{item.description}</span>}
      </span>
      <ArrowUpRight className="links-entry-arrow size-5" aria-hidden="true" />
    </ActionLink>
  );
}
function Seller({
  item,
  location,
  preview,
  labels,
}: {
  item: LinkTreeItem;
  location?: LinkTreeItem;
  preview: boolean;
  labels: Labels;
}) {
  return (
    <ActionLink
      metricId={item.id}
      href={itemDestination(item)}
      className="links-seller"
      label={`Conversar com ${item.title}${location ? `, ${location.title}` : ""} pelo WhatsApp`}
    >
      <span
        className="links-avatar-wrap"
        style={accents[location?.accent || "burgundy"] as CSSProperties}
      >
        {item.image ? (
          <Picture
            image={item.image}
            alt={`Foto de ${item.title}`}
            preview={preview}
            className="links-avatar"
          />
        ) : (
          <span className="links-avatar links-picture-fallback">
            <UserRound className="size-7" aria-hidden="true" />
          </span>
        )}
        <span className="links-avatar-contact">
          <MessageCircle className="size-3.5" aria-hidden="true" />
        </span>
      </span>
      <span className="links-seller-copy">
        <span className="links-seller-name">{item.title}</span>
        {item.description && <span className="links-seller-description">{item.description}</span>}
        {location && (
          <span
            className="links-seller-unit"
            style={accents[location.accent || "burgundy"] as CSSProperties}
          >
            <MapPin className="size-3" aria-hidden="true" />
            {location.title}
          </span>
        )}
        <span className="links-seller-cta">{labels.sellerWhatsappLabel}</span>
      </span>
      <ArrowUpRight className="links-entry-arrow size-5" aria-hidden="true" />
    </ActionLink>
  );
}
function Location({
  item,
  preview,
  hasSellers,
  onSellers,
  onCopy,
  labels,
}: {
  item: LinkTreeItem;
  preview: boolean;
  hasSellers: boolean;
  onSellers: () => void;
  onCopy: (value: string) => Promise<void>;
  labels: Labels;
}) {
  const map = itemDestination(item);
  const waze =
    item.wazeUrl ||
    (item.address
      ? `https://www.waze.com/ul?q=${encodeURIComponent(item.address)}&navigate=yes`
      : "");
  const whatsapp = item.phone ? whatsappLink(item.phone, item.message) : "";
  const telephone = item.landline ? telephoneLink(item.landline) : "";
  const localTelephone =
    item.landline.startsWith("55") && item.landline.length >= 12
      ? item.landline.slice(2)
      : item.landline;
  const telephoneLabel =
    localTelephone.length === 10
      ? `(${localTelephone.slice(0, 2)}) ${localTelephone.slice(2, 6)}-${localTelephone.slice(6)}`
      : localTelephone.length === 11
        ? `(${localTelephone.slice(0, 2)}) ${localTelephone.slice(2, 7)}-${localTelephone.slice(7)}`
        : localTelephone;
  return (
    <article className="links-location" style={accents[item.accent || "burgundy"] as CSSProperties}>
      <div className="links-location-photo-wrap">
        {item.image ? (
          <Picture
            image={item.image}
            alt={`Fachada da ${item.title}`}
            preview={preview}
            className="links-location-photo"
            fallback="store"
          />
        ) : (
          <span className="links-location-photo links-location-photo-empty" aria-hidden="true">
            <Store className="size-16" />
          </span>
        )}
        <div className="links-location-photo-shade" aria-hidden="true" />
        <div className="links-location-band" aria-hidden="true" />
        <div className="links-location-caption">
          {labels.visitLabel && <p className="links-location-eyebrow">{labels.visitLabel}</p>}
          <h3>{item.title}</h3>
        </div>
      </div>
      <div className="links-location-body">
        {item.address && (
          <p className="links-location-address">
            <MapPin className="size-4" aria-hidden="true" />
            <span>{item.address}</span>
          </p>
        )}
        {item.description && <p className="links-location-description">{item.description}</p>}
        {item.hours && (
          <p className="links-location-hours">
            <Clock3 className="size-4" aria-hidden="true" />
            <span>{item.hours}</span>
          </p>
        )}
        <div className="links-location-actions">
          {(map || waze) && (
            <div className={`links-map-actions ${map && waze ? "links-map-actions-pair" : ""}`}>
              {map && (
                <ActionLink
                  metricId={item.id}
                  href={map}
                  className="links-map-button"
                  label={`Abrir ${item.title} no Google Maps`}
                >
                  <MapPin className="size-4" aria-hidden="true" />
                  {labels.mapsLabel}
                </ActionLink>
              )}
              {waze && (
                <ActionLink
                  metricId={item.id}
                  href={waze}
                  className="links-map-button"
                  label={`Traçar rota para ${item.title} no Waze`}
                >
                  <Navigation className="size-4" aria-hidden="true" />
                  {labels.wazeLabel}
                </ActionLink>
              )}
            </div>
          )}
          {whatsapp && (
            <ActionLink
              metricId={item.id}
              href={whatsapp}
              className="links-unit-contact"
              label={`WhatsApp da ${item.title}`}
            >
              <MessageCircle className="size-5" aria-hidden="true" />
              {labels.unitWhatsappLabel}
            </ActionLink>
          )}
          {telephone && (
            <ActionLink
              metricId={item.id}
              href={telephone}
              className="links-unit-phone"
              label={`Ligar para ${item.title}: ${telephoneLabel}`}
            >
              <Phone className="size-4" aria-hidden="true" />
              {telephoneLabel}
            </ActionLink>
          )}
        </div>
        {(hasSellers || item.address) && (
          <div className="links-location-secondary">
            {hasSellers && (
              <button type="button" className="links-unit-team" onClick={onSellers}>
                <UsersRound className="size-4" aria-hidden="true" />
                {labels.teamButtonLabel}
                <ArrowDown className="size-3.5" aria-hidden="true" />
              </button>
            )}
            {item.address && (
              <button
                type="button"
                className="links-copy-address"
                onClick={() => void onCopy(item.address)}
                aria-label={`${labels.copyAddressLabel || "Copiar endereço"}: ${item.title}`}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                {labels.copyAddressLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** The new presentation shares the existing publication, private preview and measurement rules. */
export function LinkTreeView({
  content,
  preview = false,
  monthOverride,
  metricsToken,
}: {
  content: LinkTreeContent;
  preview?: boolean;
  monthOverride?: number;
  metricsToken?: string | undefined;
}) {
  const defaults = defaultLinkPresentation();
  const presentation = {
    ...defaults,
    ...content.presentation,
    labels: { ...defaults.labels, ...content.presentation?.labels },
  };
  const labels = {
    ...presentation.labels,
    teamButtonLabel: presentation.labels.teamButtonLabel || defaults.labels.teamButtonLabel,
    shareLabel: presentation.labels.shareLabel || defaults.labels.shareLabel,
    siteLabel: presentation.labels.siteLabel || defaults.labels.siteLabel,
    privacyLabel: presentation.labels.privacyLabel || defaults.labels.privacyLabel,
    mapsLabel: presentation.labels.mapsLabel || defaults.labels.mapsLabel,
    wazeLabel: presentation.labels.wazeLabel || defaults.labels.wazeLabel,
    unitWhatsappLabel: presentation.labels.unitWhatsappLabel || defaults.labels.unitWhatsappLabel,
    sellerWhatsappLabel:
      presentation.labels.sellerWhatsappLabel || defaults.labels.sellerWhatsappLabel,
  };
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState("");
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sellersRef = useRef<HTMLElement>(null);
  const searchId = useId();
  const locationsHeading = useId();
  const sellersHeading = useId();
  const linksHeading = useId();
  const [month, setMonth] = useState(() => currentLinkMonth());
  const [now, setNow] = useState(() => new Date());
  const pageTracked = useRef(false);
  const track = useCallback(
    (
      targetType: "page" | "item" | "campaign",
      targetId: string | null,
      action: "view" | "click",
    ) => {
      if (preview || !metricsToken) return;
      void fetch("/api/links/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: metricsToken, targetType, targetId, action }),
        keepalive: true,
        credentials: "omit",
      }).catch(() => {});
    },
    [preview, metricsToken],
  );
  const bannerView = useCallback((id: string) => track("campaign", id, "view"), [track]);
  useEffect(() => {
    if (!preview && metricsToken && !pageTracked.current) {
      pageTracked.current = true;
      track("page", null, "view");
    }
  }, [track, preview, metricsToken]);
  useEffect(() => {
    const timer = setInterval(() => {
      setMonth(currentLinkMonth());
      setNow(new Date());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const items = content.items
    .filter((item) => isInLinkSchedule(item, now))
    .slice()
    .sort((a, b) => a.position - b.position);
  const locations = items.filter((item) => item.type === "location");
  const locationIds = locations.map((item) => item.id);
  const activeLocation = locationIds.includes(selectedLocation) ? selectedLocation : "all";
  const campaigns = (content.campaigns ?? [])
    .filter(
      (item) =>
        isInLinkSchedule(item, now) &&
        (!item.locationId || locationIds.includes(item.locationId)) &&
        (activeLocation === "all" || !item.locationId || item.locationId === activeLocation),
    )
    .sort((a, b) => a.position - b.position);
  const sellers = items.filter(
    (item) => item.type === "seller" && (!item.locationId || locationIds.includes(item.locationId)),
  );
  const generalSellers = sellers.filter((item) => !item.locationId);
  const normalizedSearch = search
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const matchesSearch = (item: LinkTreeItem) =>
    `${item.title} ${item.description}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .includes(normalizedSearch);
  const visibleLocations = locations.filter(
    (item) => activeLocation === "all" || item.id === activeLocation,
  );
  const selectedSellers = sellers.filter(
    (item) =>
      (activeLocation === "all" || item.locationId === activeLocation) && matchesSearch(item),
  );
  const firstBusiness = items.findIndex(
    (item) => item.type === "location" || item.type === "seller",
  );
  const splitIndex = firstBusiness < 0 ? items.length : firstBusiness;
  const isNavigation = (item: LinkTreeItem) =>
    item.type !== "location" &&
    item.type !== "seller" &&
    (!item.locationId || activeLocation === "all" || item.locationId === activeLocation);
  const primaryLinks = items.slice(0, splitIndex).filter(isNavigation);
  const otherLinks = items.slice(splitIndex).filter(isNavigation);
  const background = content.background;
  const preset = resolveLinkBackground(content, monthOverride ?? month);
  const photoBackground = background.mode === "image" && Boolean(background.image);
  const effectiveTheme = photoBackground
    ? background.overlay === "dark"
      ? "dark"
      : content.theme === "light"
        ? "light"
        : "mag"
    : content.theme;
  const accent =
    presentation.accentColor ||
    String(themes[effectiveTheme]["--links-accent" as keyof CSSProperties]);
  const channels = [1, 3, 5]
    .map((offset) => parseInt(accent.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const accentForeground =
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]! > 0.179
      ? "#191d21"
      : "#ffffff";
  const appearance = {
    ...themes[effectiveTheme],
    "--links-accent": accent,
    "--links-accent-foreground": accentForeground,
  } as CSSProperties;
  const announce = (message: string) => {
    setFeedback(message);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(""), 3000);
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      announce("Endereço copiado. Pronto para compartilhar!");
    } catch {
      announce("Não foi possível copiar. Selecione o endereço para copiá-lo.");
    }
  };
  const share = async () => {
    const url = "https://magmoveiscorporativos.com.br/links/";
    try {
      if (navigator.share) await navigator.share({ title: content.title, url });
      else {
        await navigator.clipboard.writeText(url);
        announce("Link da MAG copiado!");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        announce("Use o endereço desta página para compartilhar.");
    }
  };
  const chooseLocation = (id: string, scrollToSellers = false) => {
    setSelectedLocation(id);
    setSearch("");
    if (scrollToSellers && !preview)
      requestAnimationFrame(() =>
        sellersRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        }),
      );
  };
  const hasTeams = sellers.length > 0;
  const hasOtherLinks = otherLinks.length > 0;
  return (
    <div
      className={`links-page links-theme-${effectiveTheme} links-preset-${preset} ${preview ? "links-preview" : ""}`}
      style={appearance}
      data-links-layout="v2"
      data-header-layout={presentation.headerLayout}
      data-content-layout={presentation.contentLayout}
      data-content-width={presentation.contentWidth}
      data-card-style={presentation.cardStyle}
      data-corners={presentation.corners}
      data-background-attachment={presentation.backgroundAttachment}
      data-overlay-strength={presentation.overlayStrength}
      onClickCapture={(event) => {
        const anchor =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>("a[href]")
            : null;
        if (preview && anchor) {
          event.preventDefault();
          return;
        }
        if (anchor?.dataset["linksTarget"])
          track(
            anchor.dataset["linksKind"] === "campaign" ? "campaign" : "item",
            anchor.dataset["linksTarget"]!,
            "click",
          );
      }}
    >
      <div className="links-background" aria-hidden="true">
        {photoBackground && (
          <img
            key={background.image}
            src={imageUrl(background.image, preview)}
            className="links-background-photo"
            alt=""
            decoding="async"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
        <div
          className={`links-background-wash ${photoBackground ? `links-image-overlay-${background.overlay}` : ""}`}
        />
        {!photoBackground && (
          <>
            <span className="links-orb links-orb-one" />
            <span className="links-orb links-orb-two" />
            <span className="links-background-pattern" />
          </>
        )}
      </div>
      <div className="links-brand-glow" aria-hidden="true" />
      <div className="links-top-band" aria-hidden="true" />
      {content.cover && (
        <Picture image={content.cover} alt="" preview={preview} className="links-cover" eager />
      )}
      <main className="links-main">
        <header className="links-header">
          <a
            href={presentation.siteUrl || "/"}
            aria-label={`Site oficial da ${content.title}`}
            className="links-logo"
          >
            <Picture
              image={content.logo || "/images/mag-logo.png"}
              alt={content.title}
              preview={preview}
              className="links-logo-image"
              eager
              fallback="store"
            />
          </a>
          <div className="links-header-copy">
            {presentation.slogan && (
              <p className="links-section-label links-slogan">{presentation.slogan}</p>
            )}
            <h1>{content.title}</h1>
            {content.subtitle && <p className="links-subtitle">{content.subtitle}</p>}
          </div>
        </header>
        <LinkCampaignCarousel
          campaigns={campaigns}
          preview={preview}
          onView={bannerView}
          label={labels.campaignsLabel}
        />
        {primaryLinks.length > 0 && (
          <nav aria-label="Principais links da MAG" className="links-primary-links">
            {primaryLinks.map((item) => (
              <Entry key={item.id} item={item} preview={preview} />
            ))}
          </nav>
        )}
        {locations.length > 0 && (
          <section className="links-locations" aria-labelledby={locationsHeading}>
            <div className="links-locations-heading">
              <div className="links-section-intro">
                {labels.unitsEyebrow && (
                  <p className="links-section-label">{labels.unitsEyebrow}</p>
                )}
                <h2 id={locationsHeading} className={labels.unitsTitle ? "" : "sr-only"}>
                  {labels.unitsTitle || "Unidades"}
                </h2>
                {labels.unitsText && (
                  <p className="links-section-description">{labels.unitsText}</p>
                )}
              </div>
              {locations.length > 1 && (
                <div className="links-unit-filter" role="group" aria-label="Filtrar por unidade">
                  <button
                    type="button"
                    aria-pressed={activeLocation === "all"}
                    onClick={() => chooseLocation("all")}
                    className="links-unit-chip"
                  >
                    <span className="links-unit-dot links-unit-dot-all" />
                    {labels.allUnitsLabel || "Todas"}
                  </button>
                  {locations.map((location) => (
                    <button
                      type="button"
                      key={location.id}
                      style={accents[location.accent || "burgundy"] as CSSProperties}
                      aria-pressed={activeLocation === location.id}
                      onClick={() => chooseLocation(location.id)}
                      className="links-unit-chip"
                    >
                      <span className="links-unit-dot" />
                      {location.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div
              className={`links-locations-grid ${visibleLocations.length > 1 ? "links-locations-multiple" : ""}`}
            >
              {visibleLocations.map((location) => (
                <Location
                  key={location.id}
                  item={location}
                  preview={preview}
                  labels={labels}
                  hasSellers={sellers.some((seller) => seller.locationId === location.id)}
                  onSellers={() => chooseLocation(location.id, true)}
                  onCopy={copy}
                />
              ))}
            </div>
          </section>
        )}
        {(hasTeams || hasOtherLinks) && (
          <div
            className={`links-content-grid ${hasTeams && hasOtherLinks ? "links-content-grid-paired" : ""}`}
          >
            {hasTeams && (
              <section ref={sellersRef} aria-labelledby={sellersHeading} className="links-teams">
                <div className="links-section-intro">
                  {labels.teamEyebrow && (
                    <p className="links-section-label">{labels.teamEyebrow}</p>
                  )}
                  <h2 id={sellersHeading} className={labels.teamTitle ? "" : "sr-only"}>
                    {labels.teamTitle || "Equipe"}
                  </h2>
                  {labels.teamText && (
                    <p className="links-section-description">{labels.teamText}</p>
                  )}
                </div>
                {sellers.length >= 5 && (
                  <div className="links-seller-search">
                    <Search className="size-4" aria-hidden="true" />
                    <label htmlFor={searchId} className="sr-only">
                      Buscar vendedor pelo nome ou função
                    </label>
                    <input
                      id={searchId}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={labels.searchPlaceholder}
                      type="search"
                      autoComplete="off"
                    />
                    {search && (
                      <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca">
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
                <div className="links-team-groups">
                  {visibleLocations.map((location) => {
                    const team = selectedSellers.filter(
                      (seller) => seller.locationId === location.id,
                    );
                    if (!team.length) return null;
                    return (
                      <div
                        className="links-team-group"
                        key={location.id}
                        style={accents[location.accent || "burgundy"] as CSSProperties}
                      >
                        <h3 className="links-team-title">
                          <UsersRound className="size-4" aria-hidden="true" />
                          {location.title}
                        </h3>
                        <div className="links-sellers-grid">
                          {team.map((item) => (
                            <Seller
                              key={item.id}
                              item={item}
                              location={location}
                              preview={preview}
                              labels={labels}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {activeLocation === "all" && generalSellers.some(matchesSearch) && (
                    <div className="links-team-group">
                      <h3 className="links-team-title">
                        <UsersRound className="size-4" aria-hidden="true" />
                        {labels.generalTeamLabel}
                      </h3>
                      <div className="links-sellers-grid">
                        {generalSellers.filter(matchesSearch).map((item) => (
                          <Seller key={item.id} item={item} preview={preview} labels={labels} />
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedSellers.length === 0 && (
                    <div className="links-empty-team">
                      <UsersRound className="size-6" aria-hidden="true" />
                      <p>{search ? labels.noResultsText : labels.noSellersText}</p>
                      {search && (
                        <button type="button" onClick={() => setSearch("")}>
                          Limpar busca
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}
            {hasOtherLinks && (
              <section className="links-materials" aria-labelledby={linksHeading}>
                <div className="links-section-intro">
                  {labels.linksEyebrow && (
                    <p className="links-section-label">{labels.linksEyebrow}</p>
                  )}
                  <h2 id={linksHeading} className={labels.linksTitle ? "" : "sr-only"}>
                    {labels.linksTitle || "Links"}
                  </h2>
                  {labels.linksText && (
                    <p className="links-section-description">{labels.linksText}</p>
                  )}
                </div>
                <nav aria-label="Mais links da MAG" className="links-other-links">
                  {otherLinks.map((item) => (
                    <Entry key={item.id} item={item} preview={preview} />
                  ))}
                </nav>
              </section>
            )}
          </div>
        )}
        <footer className="links-footer">
          {presentation.showShare && !preview && (
            <button type="button" onClick={() => void share()} className="links-share">
              <Share2 className="size-4" aria-hidden="true" />
              {labels.shareLabel}
            </button>
          )}
          <nav className="links-footer-nav" aria-label="Links institucionais">
            {presentation.siteUrl && (
              <ActionLink href={presentation.siteUrl} className="links-footer-link">
                {labels.siteLabel}
                <ExternalLink className="size-3" aria-hidden="true" />
              </ActionLink>
            )}
            {presentation.privacyUrl && (
              <ActionLink href={presentation.privacyUrl} className="links-footer-link">
                {labels.privacyLabel}
              </ActionLink>
            )}
          </nav>
          <p className="links-copyright">
            © {new Date().getFullYear()} {content.title}
          </p>
        </footer>
      </main>
      <div
        className={`links-feedback ${feedback ? "links-feedback-visible" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback && (
          <>
            <Check className="size-4" aria-hidden="true" />
            <span>{feedback}</span>
          </>
        )}
      </div>
    </div>
  );
}
