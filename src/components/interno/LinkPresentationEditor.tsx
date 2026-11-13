import { type LinkPresentation } from "@/lib/links";

const control =
  "mt-1 min-h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 disabled:opacity-60";

type LabelKey = keyof LinkPresentation["labels"];
type LabelField = { key: LabelKey; label: string; description?: boolean };
const groups: { title: string; fields: LabelField[] }[] = [
  {
    title: "Unidades",
    fields: [
      { key: "unitsEyebrow", label: "Texto de apoio das unidades" },
      { key: "unitsTitle", label: "Título da seção de unidades" },
      { key: "unitsText", label: "Descrição da seção de unidades", description: true },
      { key: "allUnitsLabel", label: "Rótulo do filtro de todas as unidades" },
      { key: "visitLabel", label: "Chamada de visita à unidade" },
      { key: "mapsLabel", label: "Rótulo do Google Maps" },
      { key: "wazeLabel", label: "Rótulo do Waze" },
      { key: "teamButtonLabel", label: "Rótulo do botão da equipe" },
      { key: "copyAddressLabel", label: "Rótulo de copiar endereço" },
      { key: "unitWhatsappLabel", label: "Rótulo do WhatsApp da unidade" },
    ],
  },
  {
    title: "Equipe e vendedores",
    fields: [
      { key: "teamEyebrow", label: "Texto de apoio da equipe" },
      { key: "teamTitle", label: "Título da seção de equipe" },
      { key: "teamText", label: "Descrição da seção de equipe", description: true },
      { key: "sellerWhatsappLabel", label: "Rótulo do WhatsApp dos vendedores" },
      { key: "searchPlaceholder", label: "Texto da busca de vendedores" },
      { key: "generalTeamLabel", label: "Nome da equipe sem unidade" },
      { key: "noSellersText", label: "Mensagem de equipe indisponível", description: true },
      { key: "noResultsText", label: "Mensagem de busca sem resultado", description: true },
    ],
  },
  {
    title: "Links e campanhas",
    fields: [
      { key: "linksEyebrow", label: "Texto de apoio dos links" },
      { key: "linksTitle", label: "Título da seção de links" },
      { key: "linksText", label: "Descrição da seção de links", description: true },
      { key: "campaignsLabel", label: "Título das campanhas" },
    ],
  },
  {
    title: "Compartilhamento e rodapé",
    fields: [
      { key: "shareLabel", label: "Rótulo do compartilhamento" },
      { key: "siteLabel", label: "Rótulo do site oficial" },
      { key: "privacyLabel", label: "Rótulo da privacidade" },
    ],
  },
];
type ChoiceKey =
  | "headerLayout"
  | "contentLayout"
  | "contentWidth"
  | "cardStyle"
  | "corners"
  | "backgroundAttachment"
  | "overlayStrength";
const choices: { key: ChoiceKey; label: string; options: [string, string][] }[] = [
  {
    key: "headerLayout",
    label: "Organização do cabeçalho",
    options: [
      ["aligned", "Logo e título alinhados"],
      ["centered", "Logo e título centralizados"],
    ],
  },
  {
    key: "contentLayout",
    label: "Organização de equipe e links",
    options: [
      ["columns", "Lado a lado no computador"],
      ["stacked", "Uma coluna"],
    ],
  },
  {
    key: "contentWidth",
    label: "Largura do conteúdo",
    options: [
      ["wide", "Ampla"],
      ["compact", "Compacta"],
    ],
  },
  {
    key: "cardStyle",
    label: "Superfície dos cartões",
    options: [
      ["glass", "Transparente com desfoque"],
      ["solid", "Sólida"],
    ],
  },
  {
    key: "corners",
    label: "Cantos dos cartões",
    options: [
      ["rounded", "Arredondados"],
      ["soft", "Suaves"],
      ["square", "Retos"],
    ],
  },
  {
    key: "backgroundAttachment",
    label: "Comportamento da imagem de fundo",
    options: [
      ["fixed", "Fixa na tela"],
      ["scroll", "Acompanha a página"],
    ],
  },
  {
    key: "overlayStrength",
    label: "Intensidade da camada sobre o fundo",
    options: [
      ["soft", "Suave"],
      ["balanced", "Equilibrada"],
      ["strong", "Forte"],
    ],
  },
];

export function LinkPresentationEditor({
  presentation,
  onChange,
  disabled = false,
}: {
  presentation: LinkPresentation;
  onChange: (value: LinkPresentation) => void;
  disabled?: boolean;
}) {
  const patch = (values: Partial<LinkPresentation>) => onChange({ ...presentation, ...values });
  const patchLabel = (key: LabelKey, value: string) =>
    patch({ labels: { ...presentation.labels, [key]: value } });

  return (
    <details className="rounded-xl border bg-card" data-link-presentation-editor open>
      <summary className="cursor-pointer px-5 py-4 text-base font-semibold">
        Layout e textos
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          Organização, cores e chamadas da página
        </span>
      </summary>
      <fieldset disabled={disabled} className="min-w-0 space-y-6 border-t p-5 disabled:opacity-60">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Ajuste o modelo da árvore e confira o resultado na prévia. Salve o rascunho e publique
          para atualizar a página pública. No celular, as colunas se adaptam à largura disponível.
        </p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium sm:col-span-2">
            Slogan da árvore
            <input
              name="links.presentation.slogan"
              value={presentation.slogan}
              onChange={(event) => patch({ slogan: event.target.value })}
              maxLength={120}
              className={control}
              placeholder="Uma frase curta para apresentar a MAG"
            />
          </label>
          {choices.map((choice) => (
            <label key={choice.key} className="min-w-0 text-sm font-medium">
              {choice.label}
              <select
                name={"links.presentation." + choice.key}
                value={presentation[choice.key]}
                onChange={(event) =>
                  patch({ [choice.key]: event.target.value } as Partial<LinkPresentation>)
                }
                className={control}
              >
                {choice.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={presentation.accentColor === null}
              onChange={(event) => patch({ accentColor: event.target.checked ? null : "#981b28" })}
              className="size-4 accent-brand"
            />
            Usar a cor padrão do tema
          </label>
          <label className="block text-sm font-medium">
            Cor de destaque personalizada
            <div className="mt-1 flex items-center gap-3">
              <input
                type="color"
                value={
                  /^#[0-9a-f]{6}$/i.test(presentation.accentColor ?? "")
                    ? presentation.accentColor!
                    : "#981b28"
                }
                disabled={presentation.accentColor === null || disabled}
                onChange={(event) => patch({ accentColor: event.target.value })}
                aria-label="Escolher cor de destaque"
                className="h-10 w-14 shrink-0 rounded-md border bg-card p-1 disabled:opacity-50"
              />
              <input
                name="links.presentation.accentColor"
                aria-label="Cor de destaque personalizada"
                value={presentation.accentColor ?? ""}
                disabled={presentation.accentColor === null || disabled}
                onChange={(event) => patch({ accentColor: event.target.value })}
                maxLength={7}
                placeholder="#981b28"
                className={control + " mt-0"}
                spellCheck={false}
              />
            </div>
          </label>
          <p className="text-xs text-muted-foreground">
            A cor de destaque se aplica às chamadas e aos links destacados. As cores das lojas
            continuam no cadastro de unidades.
          </p>
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium">
            Endereço do site oficial
            <input
              name="links.presentation.siteUrl"
              value={presentation.siteUrl}
              onChange={(event) => patch({ siteUrl: event.target.value })}
              maxLength={1500}
              className={control}
              placeholder="/"
            />
          </label>
          <label className="min-w-0 text-sm font-medium">
            Endereço da privacidade
            <input
              name="links.presentation.privacyUrl"
              value={presentation.privacyUrl}
              onChange={(event) => patch({ privacyUrl: event.target.value })}
              maxLength={1500}
              className={control}
              placeholder="/privacidade"
            />
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
            Use caminhos deste site ou endereços HTTPS. O endereço permanente da árvore e o QR Code
            continuam em /links/.
          </p>
          <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
            <input
              name="links.presentation.showShare"
              type="checkbox"
              checked={presentation.showShare}
              onChange={(event) => patch({ showShare: event.target.checked })}
              className="size-4 accent-brand"
            />
            Mostrar botão de compartilhamento
          </label>
        </div>

        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Personalize os textos das seções e das ações abaixo. Um texto vazio oculta a chamada
            visual correspondente; as ações mantêm suas identificações de acessibilidade.
          </p>
          {groups.map((group) => (
            <details key={group.title} className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                {group.title}
              </summary>
              <div className="grid min-w-0 gap-4 border-t p-4 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <label
                    key={field.key}
                    className={
                      "min-w-0 text-sm font-medium " + (field.description ? "sm:col-span-2" : "")
                    }
                  >
                    {field.label}
                    {field.description ? (
                      <textarea
                        name={"links.presentation.labels." + field.key}
                        value={presentation.labels[field.key]}
                        onChange={(event) => patchLabel(field.key, event.target.value)}
                        maxLength={320}
                        rows={2}
                        className={control + " h-auto py-2"}
                      />
                    ) : (
                      <input
                        name={"links.presentation.labels." + field.key}
                        value={presentation.labels[field.key]}
                        onChange={(event) => patchLabel(field.key, event.target.value)}
                        maxLength={120}
                        className={control}
                      />
                    )}
                  </label>
                ))}
              </div>
            </details>
          ))}
        </div>
      </fieldset>
    </details>
  );
}
