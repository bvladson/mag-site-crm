import { useState, type ComponentType } from "react";
import { Instagram, Youtube, Linkedin, Play, ArrowUpRight } from "lucide-react";
import type { Network, SocialItem, SocialProfile } from "@/config/social";
import { getConsent } from "./CookieConsent";

/**
 * Cards próprios da MAG para conteúdo das redes — nenhum script/widget das plataformas é carregado.
 * Imagens vêm do próprio site (/social-images, copiadas pelo worker). Vídeo do YouTube só carrega o player ao clicar,
 * e só toca aqui dentro se o visitante aceitou cookies de marketing; sem isso, abre no YouTube.
 */
/** Glifo oficial do TikTok (Simple Icons, licença CC0): o lucide não tem ícone do TikTok. */
function TikTokIcon({ className }: { className?: string; "aria-hidden"?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /></svg>;
}
const ICONS: Record<Network, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = { youtube: Youtube, instagram: Instagram, tiktok: TikTokIcon, linkedin: Linkedin };
const LABELS: Record<Network, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn" };
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

export function NetworkIcon({ network, className = "size-4" }: { network: Network; className?: string }) {
  const Icon = ICONS[network];
  return <Icon className={className} aria-hidden />;
}

const duration = (seconds: number | null) => (seconds == null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
const ratio = { "16:9": "aspect-video", "9:16": "aspect-[9/16]", "1:1": "aspect-square" } as const;

function Badge({ network }: { network: Network }) {
  return (
    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-sm bg-card/95 px-1.5 py-0.5 text-[11px] font-semibold text-foreground shadow-sm">
      <NetworkIcon network={network} className="size-3.5" /> {LABELS[network]}
    </span>
  );
}

function Cover({ item }: { item: SocialItem }) {
  return item.image
    ? <img src={item.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
    : <div className="grid h-full w-full place-items-center bg-graphite text-graphite-foreground"><NetworkIcon network={item.network} className="size-10 opacity-80" /></div>;
}

/** YouTube: miniatura até o clique (fachada). Player via youtube-nocookie só com consentimento de marketing. */
function YouTubeCard({ item }: { item: SocialItem }) {
  const [playing, setPlaying] = useState(false);
  const play = () => {
    if (getConsent()?.marketing && item.youtubeId) setPlaying(true);
    else window.open(item.url, "_blank", "noopener,noreferrer");
  };
  return (
    <article>
      <div className="relative aspect-video overflow-hidden rounded-md bg-graphite">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${item.youtubeId}?autoplay=1&rel=0`} title={item.title || "Vídeo da MAG no YouTube"}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full"
          />
        ) : (
          <button type="button" onClick={play} className="group block h-full w-full" aria-label={`Assistir: ${item.title || "vídeo da MAG"}`}>
            <Cover item={item} />
            <span className="absolute inset-0 grid place-items-center"><span className="grid h-11 w-16 place-items-center rounded-lg bg-brand shadow-lg"><Play className="size-5 fill-primary-foreground text-primary-foreground" /></span></span>
            {duration(item.duration) && <span className="absolute bottom-2 right-2 rounded-sm bg-graphite/85 px-1.5 py-0.5 text-xs font-semibold text-graphite-foreground">{duration(item.duration)}</span>}
            <Badge network="youtube" />
          </button>
        )}
      </div>
      <a href={item.url} {...EXTERNAL} className="mt-2 line-clamp-2 block font-semibold hover:text-brand">{item.title || "Assistir no YouTube"}</a>
    </article>
  );
}

export function SocialCard({ item }: { item: SocialItem }) {
  if (item.network === "youtube" && item.youtubeId) return <YouTubeCard item={item} />;
  const video = item.type === "reel" || item.type === "short" || item.type === "video";
  return (
    <a href={item.url} {...EXTERNAL} className="group block" aria-label={`${item.title || "Publicação da MAG"} — abrir no ${LABELS[item.network]}`}>
      <div className={`relative overflow-hidden rounded-md bg-graphite ${ratio[item.aspect]}`}>
        <Cover item={item} />
        {video && <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full bg-card/90"><Play className="size-4 fill-foreground" /></span></span>}
        <Badge network={item.network} />
        {item.title && <p className="absolute inset-x-0 bottom-0 line-clamp-3 bg-gradient-to-t from-graphite/90 to-transparent p-3 pt-8 text-sm font-medium text-graphite-foreground">{item.title}</p>}
      </div>
    </a>
  );
}

/** Grade que respeita o formato: vídeos 16:9 em 3 colunas, verticais em faixa, quadrados em grade. */
export function SocialGrid({ items }: { items: SocialItem[] }) {
  const wide = items.filter((item) => item.aspect === "16:9");
  const tall = items.filter((item) => item.aspect === "9:16");
  const square = items.filter((item) => item.aspect === "1:1");
  return (
    <div className="space-y-6">
      {wide.length > 0 && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{wide.map((item) => <SocialCard key={`${item.network}-${item.id}`} item={item} />)}</div>}
      {tall.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{tall.map((item) => <SocialCard key={`${item.network}-${item.id}`} item={item} />)}</div>}
      {square.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{square.map((item) => <SocialCard key={`${item.network}-${item.id}`} item={item} />)}</div>}
    </div>
  );
}

export function FollowLinks({ profiles, tone = "light" }: { profiles: SocialProfile[]; tone?: "light" | "dark" }) {
  if (!profiles.length) return null;
  const style = tone === "dark"
    ? "border-graphite-foreground/20 text-graphite-foreground hover:border-brand hover:text-brand"
    : "bg-card hover:border-foreground/40";
  return (
    <div className="flex flex-wrap gap-2">
      {profiles.map((profile) => (
        <a key={profile.network} href={profile.url} {...EXTERNAL} className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${style}`}>
          <NetworkIcon network={profile.network} /> {profile.handle || profile.label} <ArrowUpRight className="size-3.5 opacity-60" />
        </a>
      ))}
    </div>
  );
}
