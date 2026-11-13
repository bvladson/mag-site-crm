import { Copy, ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";
import { LinkTreeEditorImage } from "./LinkTreeEditorImage";
import { Button } from "@/components/ui/button";
import {
  campaignDestination,
  linkScheduleState,
  newLinkCampaign,
  type LinkCampaign,
  type LinkTreeContent,
} from "@/lib/links";

const input = "mt-1 h-10 w-full rounded-md border bg-card px-3 text-sm";
export function LinkCampaignEditor({
  content,
  onChange,
  onUploading,
  disabled,
}: {
  content: LinkTreeContent;
  onChange: (campaigns: LinkCampaign[]) => void;
  onUploading: (delta: number) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const campaigns = content.campaigns ?? [];
  const locations = content.items.filter((item) => item.type === "location");
  const patch = (id: string, data: Partial<LinkCampaign>) =>
    onChange(campaigns.map((item) => (item.id === id ? { ...item, ...data } : item)));
  const move = (index: number, delta: number) => {
    const next = [...campaigns];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    onChange(next.map((item, position) => ({ ...item, position })));
  };
  return (
    <section aria-label="Banners de campanha" className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Banners de campanha</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Até três artes clicáveis. As mudanças entram no ar ao publicar esta árvore.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || campaigns.length >= 3}
          onClick={() => {
            const campaign = { ...newLinkCampaign(), position: campaigns.length };
            onChange([...campaigns, campaign]);
            setSelected(campaign.id);
          }}
        >
          <ImagePlus /> Adicionar banner
        </Button>
      </div>
      {!campaigns.length && (
        <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
          Nenhuma campanha cadastrada. Crie uma arte para destacar ofertas, catálogo ou atendimento.
        </p>
      )}
      <div className="space-y-3">
        {campaigns.map((item, index) => (
          <article key={item.id} className="rounded-lg border">
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                onClick={() => setSelected(selected === item.id ? null : item.id)}
                className="min-w-0 flex-1 text-left"
                aria-expanded={selected === item.id}
              >
                <span className="block truncate text-sm font-semibold">
                  {item.name || "Campanha sem nome"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {linkScheduleState(item)} · {item.channel || "Sem canal"} ·{" "}
                  {item.locationId
                    ? locations.find((location) => location.id === item.locationId)?.title ||
                      "Unidade removida"
                    : "Todas as unidades"}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Subir ${item.name}`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Descer ${item.name}`}
                disabled={disabled || index === campaigns.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
            </div>
            {selected === item.id && (
              <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Nome interno
                  <input
                    value={item.name}
                    maxLength={120}
                    onChange={(event) => patch(item.id, { name: event.target.value })}
                    className={input}
                  />
                </label>
                <label className="text-sm font-medium">
                  Identificador do link
                  <input
                    value={item.slug}
                    maxLength={80}
                    onChange={(event) =>
                      patch(item.id, {
                        slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                      })
                    }
                    className={input}
                  />
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Ex.: ofertas-outubro. Preservado nas métricas e no destino.
                  </span>
                </label>
                <label className="text-sm font-medium">
                  Canal
                  <select
                    value={item.channel}
                    onChange={(event) => patch(item.id, { channel: event.target.value })}
                    className={input}
                  >
                    {Array.from(
                      new Set([
                        item.channel,
                        "Site",
                        "Instagram",
                        "Facebook",
                        "Google",
                        "QR code",
                        "WhatsApp",
                      ]),
                    )
                      .filter(Boolean)
                      .map((channel) => (
                        <option key={channel}>{channel}</option>
                      ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Unidade
                  <select
                    value={item.locationId ?? ""}
                    onChange={(event) => patch(item.id, { locationId: event.target.value || null })}
                    className={input}
                  >
                    <option value="">Todas as unidades</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.title}
                        {!location.active ? " (oculta)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Título público
                  <input
                    value={item.title}
                    maxLength={120}
                    onChange={(event) => patch(item.id, { title: event.target.value })}
                    className={input}
                  />
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  Descrição
                  <textarea
                    value={item.description}
                    maxLength={320}
                    rows={2}
                    onChange={(event) => patch(item.id, { description: event.target.value })}
                    className="mt-1 w-full rounded-md border bg-card p-3 text-sm"
                  />
                </label>
                <div>
                  <LinkTreeEditorImage
                    label="Arte para computador (16:9)"
                    value={item.desktopImage}
                    onChange={(desktopImage) => patch(item.id, { desktopImage })}
                    onUploading={onUploading}
                    disabled={disabled}
                    ratio={16 / 9}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Obrigatória para ativar. Será usada no celular se não houver outra arte.
                  </p>
                </div>
                <LinkTreeEditorImage
                  label="Arte para celular (4:3, opcional)"
                  value={item.mobileImage}
                  onChange={(mobileImage) => patch(item.id, { mobileImage })}
                  onUploading={onUploading}
                  disabled={disabled}
                  ratio={4 / 3}
                />
                <label className="text-sm font-medium">
                  Destino
                  <select
                    value={item.destinationType}
                    onChange={(event) =>
                      patch(item.id, {
                        destinationType: event.target.value as LinkCampaign["destinationType"],
                      })
                    }
                    className={input}
                  >
                    <option value="catalog">Catálogo</option>
                    <option value="link">Link personalizado / PDF</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Texto do botão
                  <input
                    value={item.buttonLabel}
                    maxLength={60}
                    onChange={(event) => patch(item.id, { buttonLabel: event.target.value })}
                    className={input}
                  />
                </label>
                {item.destinationType === "whatsapp" ? (
                  <>
                    <label className="text-sm font-medium sm:col-span-2">
                      WhatsApp com DDI e DDD
                      <input
                        type="tel"
                        value={item.phone}
                        maxLength={30}
                        onChange={(event) => patch(item.id, { phone: event.target.value })}
                        className={input}
                        placeholder="5585998610074"
                      />
                    </label>
                    <label className="text-sm font-medium sm:col-span-2">
                      Mensagem inicial
                      <textarea
                        value={item.message}
                        maxLength={600}
                        onChange={(event) => patch(item.id, { message: event.target.value })}
                        className="mt-1 w-full rounded-md border bg-card p-3 text-sm"
                      />
                    </label>
                  </>
                ) : (
                  <label className="text-sm font-medium sm:col-span-2">
                    Link de destino
                    <input
                      value={item.url}
                      maxLength={1500}
                      onChange={(event) => patch(item.id, { url: event.target.value })}
                      className={input}
                      placeholder={
                        item.destinationType === "catalog"
                          ? "/produtos (padrão)"
                          : "https://... ou /produtos"
                      }
                    />
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      HTTPS ou caminho do site. Um catálogo promocional pode ser um endereço ou PDF
                      já publicado.
                    </span>
                  </label>
                )}
                <label className="text-sm font-medium">
                  Começa em
                  <input
                    type="datetime-local"
                    value={item.startsAt}
                    onChange={(event) => patch(item.id, { startsAt: event.target.value })}
                    className={input}
                  />
                </label>
                <label className="text-sm font-medium">
                  Termina em
                  <input
                    type="datetime-local"
                    value={item.endsAt}
                    onChange={(event) => patch(item.id, { endsAt: event.target.value })}
                    className={input}
                  />
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Horários de Fortaleza. Em branco: sem limite. Uma campanha ativa fora da vigência
                  não aparece nem libera suas imagens ao público.
                </p>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={item.active}
                    onChange={(event) => patch(item.id, { active: event.target.checked })}
                  />
                  Ativar campanha
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || campaigns.length >= 3}
                    onClick={() => {
                      const copy = {
                        ...item,
                        id: crypto.randomUUID(),
                        slug: `${item.slug.slice(0, 60)}-${crypto.randomUUID().slice(0, 8)}`,
                        name: `${item.name.slice(0, 112)} (cópia)`,
                        active: false,
                        position: campaigns.length,
                      };
                      onChange([...campaigns, copy]);
                      setSelected(copy.id);
                    }}
                  >
                    <Copy /> Duplicar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remover este banner do rascunho? A página só muda após publicar.",
                        )
                      )
                        onChange(campaigns.filter((entry) => entry.id !== item.id));
                    }}
                  >
                    <Trash2 /> Remover
                  </Button>
                </div>
                {campaignDestination(item) && (
                  <a
                    className="break-all text-xs text-brand underline sm:col-span-2"
                    href={campaignDestination(item)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Conferir destino
                  </a>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
