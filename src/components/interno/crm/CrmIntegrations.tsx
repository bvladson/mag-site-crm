import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Plug, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/interno/ui";
import {
  connectCrmEvolution,
  getEvolutionConnection,
  getCrmIntegrationSettings,
  prepareCrmEvolutionWebhook,
  retryCrmIntegrationEvent,
  saveCrmIntegrationSettings,
} from "@/lib/crm-integrations.functions";
import { useCrm } from "./CrmProvider";
import { PageHeader } from "./bits";
import { WahaSettings } from "./WahaSettings";

type Secret =
  | "evolutionApiKey"
  | "evolutionWebhookSecret"
  | "googleWebhookKey"
  | "metaVerifyToken"
  | "metaAppSecret"
  | "metaPageToken";
type Form = {
  revision: number;
  evolutionUrl: string;
  evolutionInstance: string;
  metaPageId: string;
  metaGraphVersion: string;
  defaultOwnerId: string;
  defaultUnitId: string;
} & Record<Secret, string>;
const initial: Form = {
  revision: 0,
  evolutionUrl: "",
  evolutionInstance: "",
  metaPageId: "",
  metaGraphVersion: "v23.0",
  defaultOwnerId: "",
  defaultUnitId: "",
  evolutionApiKey: "",
  evolutionWebhookSecret: "",
  googleWebhookKey: "",
  metaVerifyToken: "",
  metaAppSecret: "",
  metaPageToken: "",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a operação.";
export function CrmIntegrations() {
  const { canManage, owners, units, connection } = useCrm();
  const queryClient = useQueryClient();
  const read = useServerFn(getCrmIntegrationSettings);
  const save = useServerFn(saveCrmIntegrationSettings);
  const test = useServerFn(getEvolutionConnection);
  const prepare = useServerFn(prepareCrmEvolutionWebhook);
  const connect = useServerFn(connectCrmEvolution);
  const retry = useServerFn(retryCrmIntegrationEvent);
  const query = useQuery({
    queryKey: ["interno", "crm-integrations"],
    queryFn: () => read(),
    enabled: canManage,
    refetchInterval: 30_000,
  });
  const [form, setForm] = useState<Form>(initial);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clear, setClear] = useState<Secret[]>([]);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (query.data && !loaded) {
      const data = query.data;
      setForm({
        ...initial,
        revision: data.revision,
        evolutionUrl: data.evolutionUrl,
        evolutionInstance: data.evolutionInstance,
        metaPageId: data.metaPageId,
        metaGraphVersion: data.metaGraphVersion,
        defaultOwnerId: data.defaultOwnerId,
        defaultUnitId: data.defaultUnitId,
      });
      setLoaded(true);
    }
  }, [query.data, loaded]);
  const field = <K extends keyof Form>(name: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [name]: value }));
    setDirty(true);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Endereço copiado");
    } catch {
      toast.error("Não foi possível copiar o endereço.");
    }
  };
  if (!canManage)
    return (
      <div className="p-6">
        <ErrorState
          error={new Error("Somente administradores podem configurar os canais do CRM.")}
        />
      </div>
    );
  if (query.isLoading || (!loaded && !query.isError)) return <Loading />;
  if (query.isError || !query.data) return <ErrorState error={query.error} />;
  const data = query.data;
  const secret = (name: Secret, label: string) => (
    <div className="space-y-1.5" key={name}>
      <label htmlFor={`crm-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`crm-${name}`}
        type="password"
        autoComplete="new-password"
        value={form[name]}
        disabled={busy || clear.includes(name)}
        onChange={(event) => field(name, event.target.value)}
        placeholder={
          data.secrets[name] ? "Configurada — deixe vazio para manter" : "Ainda não configurada"
        }
      />
      {data.secrets[name] && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={clear.includes(name)}
            disabled={busy}
            onChange={(event) => {
              setClear((current) =>
                event.target.checked
                  ? [...current, name]
                  : current.filter((value) => value !== name),
              );
              setDirty(true);
            }}
          />
          Remover esta credencial ao salvar
        </label>
      )}
    </div>
  );
  const callback = (provider: "evolution" | "google" | "meta") => (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
      <code className="min-w-0 flex-1 break-all text-xs">{data.webhookUrls[provider]}</code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Copiar endereço de integração ${provider}`}
        onClick={() => void copy(data.webhookUrls[provider])}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title="Integrações do CRM"
        subtitle="Conecte os canais e acompanhe o recebimento dos contatos."
      />
      <WahaSettings />
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await save({ data: { ...form, clearSecrets: clear } });
            setForm((current) => ({
              ...current,
              revision: result.revision,
              evolutionApiKey: "",
              evolutionWebhookSecret: "",
              googleWebhookKey: "",
              metaVerifyToken: "",
              metaAppSecret: "",
              metaPageToken: "",
            }));
            setClear([]);
            setDirty(false);
            setQr(null);
            setPairingCode(null);
            await queryClient.invalidateQueries({ queryKey: ["interno", "crm-integrations"] });
            await queryClient.invalidateQueries({ queryKey: ["interno", "crm"] });
            toast.success("Integrações salvas");
          });
        }}
      >
        <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold">Destino dos novos contatos</h2>
          <p className="text-sm text-muted-foreground">
            Escolha quem receberá as entradas destes conectores. As regras atuais das solicitações
            do site continuam no painel de atribuição.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Responsável padrão
              <select
                className="h-10 w-full rounded-md border bg-card px-3 text-sm"
                value={form.defaultOwnerId}
                disabled={busy}
                onChange={(event) => field("defaultOwnerId", event.target.value)}
              >
                <option value="">Administrador para triagem</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Unidade
              <select
                className="h-10 w-full rounded-md border bg-card px-3 text-sm"
                value={form.defaultUnitId}
                disabled={busy}
                onChange={(event) => field("defaultUnitId", event.target.value)}
              >
                <option value="">Sem unidade definida</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">WhatsApp · Evolution API</h2>
            <span
              role="status"
              className={`rounded-full px-3 py-1 text-xs font-medium ${connection?.provider !== "waha" && connection?.connected ? "crm-success" : "crm-warning"}`}
            >
              {connection?.provider === "waha"
                ? "WAHA em uso no Atendimento"
                : connection?.connected
                  ? "Conectado"
                  : connection?.configured
                    ? "Aguardando conexão"
                    : "Não configurado"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Informe uma instância existente da Evolution API. Depois de salvar, configure o
            recebimento e conecte o WhatsApp. Nesta entrega, o envio pelo CRM é de texto; outras
            mídias recebidas aparecem como registro para consulta no WhatsApp.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Endereço da Evolution
              <Input
                type="url"
                value={form.evolutionUrl}
                placeholder="https://evolution.suaempresa.com.br"
                disabled={busy}
                onChange={(event) => field("evolutionUrl", event.target.value)}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Nome da instância
              <Input
                value={form.evolutionInstance}
                placeholder="mag-comercial"
                disabled={busy}
                onChange={(event) => field("evolutionInstance", event.target.value)}
              />
            </label>
            {secret("evolutionApiKey", "Chave de acesso à Evolution")}
          </div>
          {callback("evolution")}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty || !data.secrets.evolutionApiKey}
              onClick={() =>
                void run(async () => {
                  const result = await test();
                  await queryClient.invalidateQueries({ queryKey: ["interno", "crm"] });
                  if (result.connected) toast.success(result.message);
                  else toast.info(result.message);
                })
              }
            >
              <RefreshCw className="size-4" />
              Testar conexão
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty || !data.secrets.evolutionApiKey}
              onClick={() =>
                void run(async () => {
                  await prepare();
                  toast.success("Recebimento configurado na Evolution");
                })
              }
            >
              <Plug className="size-4" />
              Configurar recebimento
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty || !data.secrets.evolutionApiKey}
              onClick={() =>
                void run(async () => {
                  const result = await connect();
                  setQr(result.qrCode);
                  setPairingCode(result.pairingCode);
                  if (!result.qrCode && !result.pairingCode)
                    toast.info("Nenhum QR disponível. Confira o estado da instância na Evolution.");
                })
              }
            >
              Conectar WhatsApp
            </Button>
          </div>
          {dirty && (
            <p className="text-xs text-muted-foreground">
              Salve as alterações antes de testar ou conectar.
            </p>
          )}
          {qr && (
            <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
              <img
                src={qr}
                width={240}
                height={240}
                alt="QR Code para conectar a instância do WhatsApp"
              />
              <p className="text-xs text-muted-foreground">
                Leia com o WhatsApp do número comercial. O código expira; solicite outro quando
                necessário.
              </p>
              <Button type="button" variant="ghost" onClick={() => setQr(null)}>
                Ocultar QR Code
              </Button>
            </div>
          )}
          {pairingCode && (
            <p className="rounded-lg border p-4 text-center">
              Código de conexão: <strong>{pairingCode}</strong>
            </p>
          )}
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold">Google Ads · formulários de lead</h2>
          <p className="text-sm text-muted-foreground">
            Configure este endereço e a mesma chave no formulário do Google Ads. Envios de teste são
            reconhecidos e não criam contatos comerciais.
          </p>
          {secret("googleWebhookKey", "Chave de verificação do formulário")}
          {callback("google")}
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold">Meta · formulários de Facebook e Instagram</h2>
          <p className="text-sm text-muted-foreground">
            Configure o aplicativo Meta, autorize o acesso aos leads da Página e assine o evento de
            leads. As permissões são concedidas na conta Meta.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              ID da Página
              <Input
                inputMode="numeric"
                value={form.metaPageId}
                disabled={busy}
                onChange={(event) => field("metaPageId", event.target.value)}
              />
            </label>
            {secret("metaVerifyToken", "Token de verificação do webhook")}
            {secret("metaAppSecret", "Segredo do aplicativo Meta")}
            {secret("metaPageToken", "Token de acesso à Página")}
          </div>
          {callback("meta")}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Configuração avançada
            </summary>
            <label className="mt-3 block max-w-xs space-y-1.5">
              Versão da Graph API
              <Input
                value={form.metaGraphVersion}
                disabled={busy}
                onChange={(event) => field("metaGraphVersion", event.target.value)}
              />
            </label>
          </details>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Credenciais ficam protegidas no servidor. Campos vazios mantêm as credenciais já salvas.
          </p>
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Salvar
            integrações
          </Button>
        </div>
      </form>
      <section className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
        <h2 className="font-semibold">Recebimentos recentes</h2>
        {!data.events.length ? (
          <p className="text-sm text-muted-foreground">
            Os eventos recebidos aparecerão aqui após conectar os canais.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="p-2">Canal</th>
                  <th className="p-2">Situação</th>
                  <th className="p-2">Tentativas</th>
                  <th className="p-2">Recebido</th>
                  <th className="p-2">
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr className="border-b last:border-0" key={event.id}>
                    <td className="p-2 capitalize">{event.provider}</td>
                    <td className="p-2">
                      {{
                        done: "Processado",
                        pending: "Na fila",
                        processing: "Processando",
                        error: "Falha no processamento",
                      }[event.state] || event.state}
                    </td>
                    <td className="p-2">{event.attempts}</td>
                    <td className="whitespace-nowrap p-2">
                      {new Date(event.createdAt).toLocaleString("pt-BR", {
                        timeZone: "America/Fortaleza",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="p-2">
                      {["error", "pending"].includes(event.state) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await retry({ data: { id: event.id } });
                              await queryClient.invalidateQueries({
                                queryKey: ["interno", "crm-integrations"],
                              });
                              toast.success("Evento colocado na fila");
                            })
                          }
                        >
                          Reprocessar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
