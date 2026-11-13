import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Pencil, Plus, Power, RefreshCw, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getWahaSettings,
  saveWahaSettings,
  saveWahaLine,
  setWahaLineStatus,
  syncWahaHistory,
  retryWahaEvent,
} from "@/lib/crm-waha.functions";
import { useCrm } from "./CrmProvider";
import { WahaLinePanel, errorMessage, stateLabel } from "./WahaLinePanel";

const empty = {
  revision: 0,
  enabled: false,
  baseUrl: "",
  apiKey: "",
  hmacKey: "",
  allowAdminReplies: false,
  allowFullHistoryImport: false,
  blockedPhones: "",
};
const eventLabel: Record<string, string> = {
  "message.any": "Mensagem",
  "message.ack": "Atualização de entrega",
  "session.status": "Conexão",
};
const eventStateLabel: Record<string, string> = {
  pending: "Aguardando processamento",
  processing: "Em processamento",
  done: "Concluído",
  error: "Falha no processamento",
};
const eventErrorLabel: Record<string, string> = {
  session_mismatch: "O evento pertence a uma linha desativada ou desconhecida.",
  number_mismatch: "O número conectado não corresponde ao número autorizado da linha.",
  media_unavailable: "O conector ainda não disponibilizou o anexo.",
  unsafe_media_url: "O endereço do anexo foi recusado por segurança.",
  body_too_large: "O anexo excede o limite permitido.",
  media_too_large: "O anexo excede o limite permitido.",
  invalid_message_id: "O conector retornou uma mensagem sem identificação válida.",
  processing_failed: "Não foi possível processar o evento. Verifique a conexão e a configuração.",
  waha_http_401: "O conector recusou a credencial configurada.",
  waha_http_403: "O conector recusou o acesso solicitado.",
  waha_http_404: "A sessão ou o anexo não foi encontrado no conector.",
  waha_http_429: "O conector limitou as solicitações. Aguarde antes de tentar novamente.",
};
const eventError = (code: string) =>
  eventErrorLabel[code] ||
  "Falha de comunicação com o conector. Verifique o serviço antes de tentar novamente.";
const eventDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Fortaleza",
      }).format(date)
    : "Data indisponível";
};
const formatPhone = (value: string) => {
  const match = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(value);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value;
};

export function WahaSettings() {
  const { owners, canManage, connection } = useCrm();
  const client = useQueryClient();
  const get = useServerFn(getWahaSettings);
  const save = useServerFn(saveWahaSettings);
  const retry = useServerFn(retryWahaEvent);
  const query = useQuery({
    queryKey: ["interno", "crm-waha", "settings"],
    queryFn: () => get(),
    enabled: canManage,
    refetchInterval: 15_000,
  });
  const [form, setForm] = useState(empty);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [clear, setClear] = useState<("apiKey" | "hmacKey")[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (query.data && !loaded) {
      const data = query.data;
      setForm({
        ...empty,
        revision: data.revision,
        enabled: data.enabled,
        baseUrl: data.baseUrl,
        allowAdminReplies: data.allowAdminReplies,
        allowFullHistoryImport: data.allowFullHistoryImport,
        blockedPhones: data.blockedPhones.join("\n"),
      });
      setLoaded(true);
    }
  }, [query.data, loaded]);
  const change = <K extends keyof typeof empty>(field: K, value: (typeof empty)[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setFailure(null);
  };
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ["interno", "crm-waha"] });
    await client.invalidateQueries({ queryKey: ["interno", "crm"] });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      const message = errorMessage(error);
      setFailure(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  if (!canManage) return null;
  const data = query.data;
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4 md:p-5"
      aria-labelledby="crm-waha-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="crm-waha-heading" className="font-semibold">
            WhatsApp · WAHA
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Core 2026.10.1 · NOWEB · uma linha por vendedora
          </p>
        </div>
        {connection?.provider === "waha" && (
          <span
            role="status"
            className={`rounded-full px-3 py-1 text-xs font-medium ${connection.connected ? "crm-success" : "crm-warning"}`}
          >
            {connection.state === "supervision" && connection.lines
              ? `${connection.lines.filter((line) => line.connected).length} de ${connection.lines.length} linhas conectadas`
              : stateLabel[connection.state] || connection.state}
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Cada vendedora tem a sua linha: o administrador cadastra o número dela aqui e ela mesma
        conecta e desconecta pelo QR Code em “Meu WhatsApp”, no Atendimento. As conversas ficam
        guardadas no CRM. Administradores acompanham todas as linhas.
      </p>
      {query.isLoading && (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando configuração…
        </p>
      )}
      {query.isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          Não foi possível carregar a configuração WAHA.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Tentar novamente
          </button>
        </div>
      )}
      {loaded && data && (
        <>
          <details className="space-y-4 rounded-md border p-3" open={!data.apiKeyConfigured}>
            <summary className="cursor-pointer text-sm font-medium">
              <Settings2 className="mr-1 inline size-4" />
              Conector (comum a todas as linhas)
            </summary>
            <form
              className="space-y-4 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await save({
                    data: {
                      revision: form.revision,
                      enabled: form.enabled,
                      baseUrl: form.baseUrl,
                      apiKey: form.apiKey,
                      hmacKey: form.hmacKey,
                      clearSecrets: clear,
                      allowAdminReplies: form.allowAdminReplies,
                      allowFullHistoryImport: form.allowFullHistoryImport,
                      blockedPhones: form.blockedPhones
                        .split(/[\n,;]+/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  });
                  setForm((current) => ({
                    ...current,
                    revision: result.revision,
                    apiKey: "",
                    hmacKey: "",
                  }));
                  setDirty(false);
                  setClear([]);
                  await invalidate();
                  toast.success("Configuração WAHA salva");
                });
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={busy}
                  onChange={(event) => change("enabled", event.target.checked)}
                />
                Usar WAHA no Atendimento do CRM
              </label>
              <div className="space-y-2 rounded-md border p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.allowAdminReplies}
                    disabled={busy}
                    onChange={(event) => change("allowAdminReplies", event.target.checked)}
                  />
                  <span>
                    <span className="font-medium">
                      Permitir que administradores respondam pela linha da vendedora
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Desligado (padrão): o administrador acompanha as conversas sem responder.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={form.allowFullHistoryImport}
                    disabled={busy}
                    onChange={(event) => change("allowFullHistoryImport", event.target.checked)}
                  />
                  <span>
                    <span className="font-medium">
                      Permitir importação geral do histórico (todas as conversas de uma linha)
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Desligado (padrão): o histórico é buscado por conversa, no botão “Buscar
                      histórico” do Atendimento.
                    </span>
                  </span>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium">
                  Endereço interno do WAHA
                  <Input
                    type="url"
                    value={form.baseUrl}
                    disabled={busy}
                    onChange={(event) => change("baseUrl", event.target.value)}
                    placeholder="http://waha:3000"
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium">
                  Números bloqueados (nunca conectar)
                  <textarea
                    className="min-h-20 w-full rounded-md border bg-card p-2 text-sm"
                    value={form.blockedPhones}
                    disabled={busy}
                    onChange={(event) => change("blockedPhones", event.target.value)}
                    placeholder="Um por linha, com DDI e DDD"
                  />
                  <span className="block text-xs font-normal text-muted-foreground">
                    O WhatsApp oficial da MAG publicado no site já é bloqueado:{" "}
                    {data.protectedPhones.map(formatPhone).join(", ")}.
                  </span>
                </label>
                {(["apiKey", "hmacKey"] as const).map((name) => (
                  <div className="space-y-1.5" key={name}>
                    <label htmlFor={`crm-waha-${name}`} className="text-sm font-medium">
                      {name === "apiKey" ? "Chave de acesso ao WAHA" : "Chave HMAC de recebimento"}
                    </label>
                    <Input
                      id={`crm-waha-${name}`}
                      type="password"
                      autoComplete="new-password"
                      value={form[name]}
                      disabled={busy || clear.includes(name)}
                      onChange={(event) => change(name, event.target.value)}
                      placeholder={
                        (name === "apiKey" ? data.apiKeyConfigured : data.hmacKeyConfigured)
                          ? "Configurada — deixe vazio para manter"
                          : "Ainda não configurada"
                      }
                    />
                    {(name === "apiKey" ? data.apiKeyConfigured : data.hmacKeyConfigured) && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={clear.includes(name)}
                          disabled={busy}
                          onChange={(event) => {
                            setClear((current) =>
                              event.target.checked
                                ? [...current, name]
                                : current.filter((item) => item !== name),
                            );
                            setDirty(true);
                          }}
                        />
                        Remover esta credencial ao salvar
                      </label>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Credenciais salvas permanecem no servidor. Campos vazios mantêm os valores
                  existentes; a chave HMAC é gerada ao salvar uma chave de acesso, se necessário.
                </p>
                <Button type="submit" disabled={!dirty || busy}>
                  <Save className="size-4" />
                  Salvar conector
                </Button>
              </div>
            </form>
          </details>
          {failure && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
            >
              {failure}
            </p>
          )}
          <WahaLines
            data={data}
            owners={owners}
            live={connection?.provider === "waha" ? connection.lines : undefined}
            disabled={dirty}
            onChanged={invalidate}
          />
          <details className="space-y-3 border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Recebimento e eventos
            </summary>
            <div className="flex items-center gap-2 rounded-md border p-3">
              <code className="min-w-0 flex-1 break-all text-xs">{data.webhookUrl}</code>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Copiar endereço de recebimento WAHA"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.webhookUrl);
                    toast.success("Endereço copiado");
                  } catch {
                    toast.error("Não foi possível copiar o endereço.");
                  }
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            {data.events.length > 0 && (
              <ul aria-label="Eventos de recebimento WAHA" className="space-y-2 text-xs">
                {data.events.slice(0, 10).map((event) => (
                  <li key={event.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {eventLabel[event.eventType] || "Evento recebido"} ·{" "}
                        {eventStateLabel[event.state] || "Aguardando atualização"}
                        {event.lineOwner && ` · linha de ${event.lineOwner}`}
                      </span>
                      <time dateTime={event.updatedAt} className="text-muted-foreground">
                        {eventDate(event.updatedAt)}
                      </time>
                    </div>
                    {event.errorCode && (
                      <p className="text-destructive">{eventError(event.errorCode)}</p>
                    )}
                    {(event.state === "pending" || event.state === "error") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || dirty}
                        onClick={() =>
                          void run(async () => {
                            await retry({ data: { id: event.id } });
                            await invalidate();
                            toast.success("Evento agendado para nova tentativa");
                          })
                        }
                      >
                        <RefreshCw className="size-3.5" />
                        Tentar novamente
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </section>
  );
}

type SettingsData = Awaited<ReturnType<typeof getWahaSettings>>;
type LiveLine = NonNullable<NonNullable<ReturnType<typeof useCrm>["connection"]>["lines"]>[number];

/** Lines of the sellers: register the number, operate the connection, disable (offboarding). */
function WahaLines({
  data,
  owners,
  live,
  disabled,
  onChanged,
}: {
  data: SettingsData;
  owners: { id: string; name: string }[];
  live: LiveLine[] | undefined;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const saveLine = useServerFn(saveWahaLine);
  const setStatus = useServerFn(setWahaLineStatus);
  const sync = useServerFn(syncWahaHistory);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; phone: string } | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null);
  const [adding, setAdding] = useState({ userId: "", phone: "" });
  const [message, setMessage] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const states = new Map((live || []).map((line) => [line.lineId, line]));
  const withLine = new Set(data.lines.filter((line) => line.status === "active").map((line) => line.userId));
  const available = owners.filter((owner) => !withLine.has(owner.id));
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Linhas das vendedoras</h3>
      {!data.lines.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma linha cadastrada. Cadastre o número de cada vendedora abaixo.
        </p>
      )}
      <ul className="space-y-2" aria-label="Linhas de WhatsApp">
        {data.lines.map((line) => {
          const state = states.get(line.id);
          const current = line.status === "disabled" ? "disabled" : state?.state || line.lastState || "STOPPED";
          return (
            <li key={line.id} className="space-y-3 rounded-md border p-3" data-crm-waha-line>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{line.ownerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.expectedPhone ? formatPhone(line.expectedPhone) : "Número não informado"}
                    {line.history && ` · ${line.history.processed} mensagem(ns) de histórico importada(s)`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${state?.connected ? "crm-success" : "crm-warning"}`}
                >
                  {current === "disabled" ? "Linha desativada" : stateLabel[current] || current}
                </span>
              </div>
              {!line.ownerActive && line.status === "active" && (
                <p className="crm-warning rounded-md p-2 text-xs">
                  A conta desta vendedora está desativada. Desative a linha para desconectar o
                  WhatsApp; as conversas continuam no CRM.
                </p>
              )}
              {line.protectedNumber && (
                <p className="crm-warning rounded-md p-2 text-xs">
                  Este número está bloqueado (WhatsApp oficial da MAG ou lista de bloqueio) e não
                  pode ser conectado.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {line.status === "active" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || disabled}
                      onClick={() => setOpen(open === line.id ? null : line.id)}
                    >
                      {open === line.id ? "Fechar" : "Conexão e QR Code"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || disabled}
                      onClick={() =>
                        setEditing(
                          editing?.id === line.id ? null : { id: line.id, phone: line.expectedPhone },
                        )
                      }
                    >
                      <Pencil className="size-3.5" />
                      Alterar número
                    </Button>
                    {data.allowFullHistoryImport && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || disabled || !state?.connected}
                        onClick={() =>
                          void run(async () => {
                            const result = await sync({ data: { lineId: line.id } });
                            setMessage(
                              `${line.ownerName}: ${result.processed} mensagem(ns) processada(s).${result.hasMore ? " Há mais histórico; a próxima execução continua do ponto salvo." : " Importação concluída para o conteúdo disponível."}`,
                            );
                          })
                        }
                      >
                        Importar histórico de todas as conversas
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy || disabled}
                      onClick={() => setConfirmDisable(line.id)}
                    >
                      <Power className="size-3.5" />
                      Desativar linha
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || disabled}
                    onClick={() =>
                      void run(async () => {
                        await setStatus({
                          data: { id: line.id, revision: line.revision, status: "active" },
                        });
                        toast.success("Linha reativada");
                      })
                    }
                  >
                    <Power className="size-3.5" />
                    Reativar linha
                  </Button>
                )}
              </div>
              {confirmDisable === line.id && (
                <div role="alertdialog" aria-label="Confirmar desativação" className="space-y-2 rounded-md border p-3 text-sm">
                  <p>
                    Desativar a linha de {line.ownerName}? O WhatsApp é desconectado do CRM e a
                    vendedora não conecta mais por esta linha. Conversas, contatos e oportunidades
                    continuam guardados.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await setStatus({
                            data: { id: line.id, revision: line.revision, status: "disabled" },
                          });
                          setConfirmDisable(null);
                          setOpen(null);
                          toast.success("Linha desativada e WhatsApp desconectado");
                        })
                      }
                    >
                      Desativar agora
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDisable(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
              {editing?.id === line.id && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await saveLine({
                        data: {
                          id: line.id,
                          revision: line.revision,
                          userId: line.userId,
                          expectedPhone: editing.phone,
                        },
                      });
                      setEditing(null);
                      toast.success("Número da linha atualizado");
                    });
                  }}
                >
                  <label className="space-y-1 text-sm font-medium">
                    Número autorizado
                    <Input
                      type="tel"
                      value={editing.phone}
                      maxLength={30}
                      placeholder="DDI + DDD + número"
                      onChange={(event) => setEditing({ id: line.id, phone: event.target.value })}
                    />
                  </label>
                  <Button type="submit" size="sm" disabled={busy}>
                    <Save className="size-3.5" />
                    Salvar número
                  </Button>
                  <p className="w-full text-xs text-muted-foreground">
                    Para trocar um número já usado, desconecte a linha antes. O novo número começa
                    numa sessão nova; as conversas anteriores continuam no CRM.
                  </p>
                </form>
              )}
              {open === line.id && line.status === "active" && (
                <WahaLinePanel
                  lineId={line.id}
                  state={state?.state || line.lastState || undefined}
                  message={state?.message}
                  phoneHint={line.expectedPhone ? `…${line.expectedPhone.slice(-4)}` : null}
                  recovery={state?.recovery ?? null}
                  canConfigure
                />
              )}
            </li>
          );
        })}
      </ul>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <form
        className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await saveLine({ data: { userId: adding.userId, expectedPhone: adding.phone } });
            setAdding({ userId: "", phone: "" });
            toast.success("Linha cadastrada. A vendedora já pode conectar em Meu WhatsApp.");
          });
        }}
      >
        <label className="space-y-1 text-sm font-medium">
          Vendedora
          <select
            className="h-10 w-full rounded-md border bg-card px-3 text-sm"
            value={adding.userId}
            disabled={busy || disabled}
            onChange={(event) => setAdding((current) => ({ ...current, userId: event.target.value }))}
          >
            <option value="">Selecione a vendedora</option>
            {available.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          Número autorizado do WhatsApp
          <Input
            type="tel"
            value={adding.phone}
            disabled={busy || disabled}
            maxLength={30}
            placeholder="DDI + DDD + número"
            onChange={(event) => setAdding((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>
        <Button type="submit" disabled={busy || disabled || !adding.userId}>
          <Plus className="size-4" />
          Cadastrar linha
        </Button>
      </form>
      {disabled && (
        <p className="text-xs text-muted-foreground">
          Salve a configuração do conector antes de operar as linhas.
        </p>
      )}
    </div>
  );
}
