import { cn } from "@/lib/utils";
import { INBOX_VIEWS, type InboxView } from "./chatFormat";

/** Filtros rápidos da lista de conversas, como as etiquetas do WhatsApp ("Tudo", "Não lidas"...). */
export function InboxFilters({
  value,
  counts,
  onChange,
}: {
  value: InboxView;
  counts: Partial<Record<InboxView, number>>;
  onChange: (view: InboxView) => void;
}) {
  return (
    <div className="wa-filters" role="group" aria-label="Filtrar conversas">
      {INBOX_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={value === view.id}
          title={view.hint}
          onClick={() => onChange(view.id)}
          className={cn("wa-filter", value === view.id && "wa-filter-on")}
        >
          {view.label}
          {counts[view.id] !== undefined && <span className="wa-filter-count">{counts[view.id]}</span>}
        </button>
      ))}
    </div>
  );
}
