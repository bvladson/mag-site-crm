import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAdminUnits } from "@/lib/units.functions";
import { newLinkTreeItem, type LinkTreeItem } from "@/lib/links";
import { type Unit } from "@/lib/units";
import { Button } from "@/components/ui/button";

export function officialUnitItem(unit: Unit, previous?: LinkTreeItem): LinkTreeItem {
  const accents = { red: "burgundy", blue: "ocean", green: "forest", amber: "amber" } as const;
  return {
    ...(previous ?? newLinkTreeItem("location")),
    id: unit.id,
    type: "location",
    title: unit.name,
    address: unit.address,
    phone: unit.whatsapp,
    landline: unit.phone,
    hours: unit.hours,
    mapUrl: unit.mapUrl,
    wazeUrl: unit.wazeUrl,
    accent: accents[unit.accent],
  };
}
export function useLinkOfficialUnits() {
  const load = useServerFn(getAdminUnits);
  return useQuery({ queryKey: ["interno", "link-units"], queryFn: () => load(), staleTime: 30_000 });
}
export function LinkOfficialUnits({
  units,
  items,
  onAdd,
  disabled,
}: {
  units: Unit[];
  items: LinkTreeItem[];
  onAdd: (item: LinkTreeItem) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState("");
  return (
    <section id="links-official-units" className="scroll-mt-44 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Unidades oficiais</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Endereço, telefones, horários e cor vêm do cadastro único. A árvore mantém foto, descrição e
        visibilidade próprias.{" "}
        <a href="/interno/unidades" className="text-brand underline">
          Gerenciar unidades
        </a>
        .
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="min-w-[180px] flex-1">
          <span className="sr-only">Unidade para adicionar à árvore</span>
          <select
            className="h-10 w-full rounded-md border bg-card px-3 text-sm"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={disabled}
          >
            <option value="">Escolha uma unidade</option>
            {units
              .filter((unit) => unit.active && !items.some((item) => item.id === unit.id))
              .map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !selected}
          onClick={() => {
            const unit = units.find((entry) => entry.id === selected);
            if (unit) {
              onAdd({ ...officialUnitItem(unit), position: items.length });
              setSelected("");
            }
          }}
        >
          Adicionar unidade
        </Button>
      </div>
    </section>
  );
}
