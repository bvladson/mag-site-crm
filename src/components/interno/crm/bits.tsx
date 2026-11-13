import type { ReactNode } from "react";
import {
  AlertCircle,
  CalendarClock,
  Clock,
  Globe,
  Megaphone,
  MessageCircle,
  Users,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, type Origin, type ProposalStatus, type Stage } from "@/lib/crm";
import { dueState, initials, relative } from "./format";
export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5",
        className,
      )}
    >
      {children}
    </span>
  );
}
const originIcons: Record<Origin, LucideIcon> = {
  "Anúncio Meta": Megaphone,
  "Anúncio Google": Megaphone,
  Site: Globe,
  Indicação: Users,
  WhatsApp: MessageCircle,
  Desconhecida: HelpCircle,
};
export function OriginBadge({ origin }: { origin: Origin }) {
  const Icon = originIcons[origin] ?? Globe;
  return (
    <Pill className={origin === "Desconhecida" ? "bg-muted text-muted-foreground" : "crm-info"}>
      <Icon className="size-3" />
      {origin}
    </Pill>
  );
}
const stageClass: Record<Stage, string> = {
  novo: "crm-info",
  conversando: "crm-warning",
  orcamento: "crm-brand",
  fechado: "crm-success",
  perdido: "bg-muted text-muted-foreground",
};
export function StageBadge({ stage }: { stage: Stage }) {
  return <Pill className={stageClass[stage]}>{STAGE_LABEL[stage]}</Pill>;
}
const proposalClass: Record<ProposalStatus, string> = {
  Rascunho: "bg-muted text-muted-foreground",
  Enviada: "crm-info",
  Aceita: "crm-success",
  Recusada: "crm-brand",
  Cancelada: "bg-muted text-muted-foreground",
};
export function ProposalBadge({ status }: { status: ProposalStatus }) {
  return <Pill className={proposalClass[status]}>{status}</Pill>;
}
export function NextActionLine({
  label,
  due,
  compact,
}: {
  label: string;
  due: string;
  compact?: boolean;
}) {
  const state = dueState(due);
  if (!label) return <span className="text-sm text-muted-foreground">Defina a próxima ação</span>;
  const Icon = state === "atrasado" ? AlertCircle : CalendarClock;
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 text-sm",
        state === "atrasado" ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className={cn("leading-snug", compact && "line-clamp-2")}>
        <strong className="font-medium">
          {state === "atrasado" ? "Atrasado · " : state === "hoje" ? "Hoje · " : ""}
        </strong>
        {label}
        {due && <span className="opacity-80"> · {relative(due)}</span>}
      </span>
    </div>
  );
}
export function LastSeen({ at }: { at: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="size-3" />
      {relative(at)}
    </span>
  );
}
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
export function AwaitingDot() {
  return (
    <Pill className="bg-primary text-primary-foreground">
      <span className="size-1.5 rounded-full bg-primary-foreground" />
      Aguardando resposta
    </Pill>
  );
}
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center">
      <Icon className="size-8 text-muted-foreground/70" />
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
