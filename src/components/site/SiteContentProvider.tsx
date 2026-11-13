import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";
import { site } from "@/config/site";
import {
  defaultSiteContent,
  siteImageUrl,
  siteWhatsappUrl,
  type SiteContent,
} from "@/lib/site-content";
import "./SiteContentProvider.css";

type SiteContext = { content: SiteContent; preview: boolean };
const SiteContentContext = createContext<SiteContext>({
  content: defaultSiteContent(),
  preview: false,
});

export function SiteContentProvider({
  content,
  preview = false,
  children,
}: {
  content: SiteContent;
  preview?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ content, preview }), [content, preview]);
  const hex = content.appearance.brandColor;
  const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const luminance = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const foreground =
    0.2126 * luminance[0]! + 0.7152 * luminance[1]! + 0.0722 * luminance[2]! > 0.179
      ? "#191d21"
      : "#ffffff";
  const style = {
    "--brand": hex,
    "--primary": hex,
    "--ring": hex,
    "--brand-soft": `color-mix(in srgb, ${hex} 8%, white)`,
    "--primary-foreground": foreground,
    "--radius":
      content.appearance.radius === "sharp"
        ? "0rem"
        : content.appearance.radius === "rounded"
          ? "1rem"
          : "0.375rem",
    "--site-width": content.appearance.width === "wide" ? "96rem" : "80rem",
  } as CSSProperties;
  return (
    <SiteContentContext.Provider value={value}>
      <div className="site-public" data-site-spacing={content.appearance.spacing} style={style}>
        {children}
      </div>
    </SiteContentContext.Provider>
  );
}

export function useSiteContent() {
  return useContext(SiteContentContext);
}

/** Public settings are scoped to this render; the server's static defaults stay untouched. */
export function usePublicSite() {
  const { content, preview } = useSiteContent();
  const hasWhatsapp =
    /^55\d{10,11}$/.test(content.general.whatsapp) && !/^550+$/.test(content.general.whatsapp);
  return {
    site: { ...site, ...content.general, logo: siteImageUrl(content.general.logo, preview) },
    hasWhatsapp,
    whatsappUrl: (text?: string) => (hasWhatsapp ? siteWhatsappUrl(content, text) : "/contato"),
  };
}
