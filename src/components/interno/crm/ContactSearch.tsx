import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type SearchMode = "contacts" | "all";
type SearchMatch = {
  kind: "name" | "phone" | "email" | "company" | "conversation" | "opportunity" | "other";
  snippet?: string;
};
const labels: Record<SearchMatch["kind"], string> = {
  name: "Nome",
  phone: "Telefone",
  email: "E-mail",
  company: "Empresa",
  conversation: "Conversa salva",
  opportunity: "Interesse ou anotação",
  other: "Cadastro",
};

export function ContactSearch({
  label,
  value,
  onChange,
  mode,
  onModeChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Nome, telefone, empresa ou interesse"
          maxLength={200}
          className="pl-9"
        />
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={mode === "all"}
          onChange={(event) => onModeChange(event.target.checked ? "all" : "contacts")}
          className="mt-0.5 rounded border-input accent-primary"
        />
        Buscar também nas conversas salvas
      </label>
      {mode === "all" && (
        <p className="text-[11px] text-muted-foreground">
          Inclui mensagens já guardadas no CRM. Conversas disponíveis só no celular precisam ser
          consultadas com “Buscar histórico”, depois de trazer o contato e abrir sua conversa.
        </p>
      )}
    </div>
  );
}

export function ContactSearchPreparing({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p role="status">
        Preparando busca nas conversas. Alguns resultados podem ainda não aparecer.
      </p>
      <Button type="button" variant="ghost" size="sm" disabled={refreshing} onClick={onRefresh}>
        Atualizar busca
      </Button>
    </div>
  );
}

export function ContactMatchHint({ match }: { match?: SearchMatch | undefined }) {
  if (!match) return null;
  return (
    <p
      className="mt-1 line-clamp-2 text-xs text-muted-foreground"
      data-crm-search-match={match.kind}
    >
      <span className="font-medium">{labels[match.kind]}</span>
      {match.snippet && <> · {match.snippet}</>}
    </p>
  );
}
