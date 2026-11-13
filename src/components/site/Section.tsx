import type { ReactNode } from "react";

export function Section({ children, className = "", tone = "default", id }: { children: ReactNode; className?: string; tone?: "default" | "surface" | "graphite"; id?: string }) {
  const bg = tone === "surface" ? "bg-surface" : tone === "graphite" ? "bg-graphite text-graphite-foreground" : "";
  return (
    <section id={id} className={`${bg} py-12 lg:py-20 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 lg:px-6">{children}</div>
    </section>
  );
}

export function SectionHeader({ eyebrow, title, text, action }: { eyebrow?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-3 lg:mb-10 lg:flex-row lg:items-end lg:justify-between">
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
    <section className="border-b bg-surface">
      <div className={`mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:px-6 lg:py-16 ${image ? "lg:grid-cols-2 lg:items-center" : ""}`}>
        <div>
          {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
          <h1 className="text-4xl font-semibold leading-[1.02] lg:text-6xl">{title}</h1>
          {text && <p className="mt-4 max-w-xl text-muted-foreground lg:text-lg">{text}</p>}
        </div>
        {image && <img src={image} alt="" className="aspect-[16/10] w-full rounded-md object-cover" />}
      </div>
    </section>
  );
}

export function DemoNote({ children = "Conteúdo de demonstração — aguardando dados oficiais." }: { children?: ReactNode }) {
  return <p className="mt-6 text-xs text-muted-foreground">* {children}</p>;
}
