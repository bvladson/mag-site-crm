import type { ReactNode } from "react";
import "./EditorialPages.css";

export function Section({ children, className = "", tone = "default", id }: { children: ReactNode; className?: string; tone?: "default" | "surface" | "graphite"; id?: string }) {
  const bg = tone === "surface" ? "bg-surface" : tone === "graphite" ? "bg-graphite text-graphite-foreground" : "";
  return (
    <section id={id} className={`mag-page-section ${bg} py-16 lg:py-24 ${className}`}>
      <div className="editorial-container">{children}</div>
    </section>
  );
}

export function SectionHeader({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="mag-section-heading mb-8 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="text-3xl font-semibold leading-[1.05] lg:text-[2.6rem]">{title}</h2>
        {text && <p className="mt-3 text-muted-foreground lg:text-lg">{text}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHero({ eyebrow, title, text, image }: { eyebrow?: string; title: string; text?: string; image?: string }) {
  return (
    <section className={image ? "editorial-hero" : "editorial-page-heading"}>
      {image && <><img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" /><div className="film-overlay" /></>}
      <div className="editorial-container relative z-10">
        {eyebrow && <p className="technical-label mb-6">{eyebrow}</p>}
        <h1 className="display-title max-w-4xl">{title}</h1>
        {text && <p className={`mt-6 max-w-xl text-lg ${image ? "text-graphite-foreground/80" : "text-muted-foreground"}`}>{text}</p>}
      </div>
    </section>
  );
}

export function DemoNote({ children = "Conteúdo de demonstração — aguardando dados oficiais." }: { children?: ReactNode }) {
  return <p className="mt-6 text-xs text-muted-foreground">* {children}</p>;
}
