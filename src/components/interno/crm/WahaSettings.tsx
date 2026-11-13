import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, QrCode, RefreshCw, Save, Plug, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getWahaSettings,
  saveWahaSettings,
  controlWahaSession,
  syncWahaHistory,
  retryWahaEvent,
} from "@/lib/crm-waha.functions";
import { useCrm } from "./CrmProvider";

const empty = {
  revision: 0,
  enabled: false,
  baseUrl: "",
  session: "mag-teste",
  ownerId: "",
  expectedPhone: "",
  apiKey: "",
  hmacKey: "",
  allowAdminReplies: false,
  allowFullHistoryImport: false,
};
/** How long the screen keeps renewing the QR Code after Iniciar/Reconectar (WhatsApp gives ~2.5 min). */
const PAIRING_WINDOW_MS = 210_000;
const validQr = (value: unknown): value is string =>
  typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a operação.";
const stateLabel: Record<string, string> = {
  unconfigured: "Não configurado",
  owner_required: "Defina a vendedora",
  phone_required: "Defina o número autorizado",
  number_mismatch: "Número não autorizado",
  portfolio_unavailable: "Conexão de outra carteira",
  STOPPED: "Sessão parada",
  STARTING: "Iniciando",
  SCAN_QR_CODE: "Aguardando QR Code",
  WORKING: "Conectado",
  FAILED: "Falha na sessão",
  PASSKEY_REQUIRED: "Confirmação de autenticação necessária",
  PASSKEY_CONFIRMATION_REQUIRED: "Aguardando confirmação no aparelho",
  error: "Falha de comunicação",
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
  session_mismatch: "O evento pertence a uma sessão diferente da configurada.",
  number_mismatch: "O número conectado não corresponde ao número autorizado.",
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

export function WahaSettings() {
  const { owners, canManage, connection } = useCrm();
  const client = useQueryClient();
  const get = useServerFn(getWahaSettings);
  const save = useServerFn(saveWahaSettings);
  const control = useServerFn(controlWahaSession);
  const sync = useServerFn(syncWahaHistory);
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
  const [qr, setQr] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<Date | null>(null);
  // While set, the screen renews the QR Code by itself until it is read, expires or the window ends.
  const [pairingUntil, setPairingUntil] = useState<number | null>(null);
  const [status, setStatus] = useState<{ state: string; message: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  useEffect(() => {
    if (query.data && !loaded) {
      const data = query.data;
      setForm({
        ...empty,
        revision: data.revision,
        enabled: data.enabled,
        baseUrl: data.baseUrl,
        session: data.session,
        ownerId: data.ownerId,
        expectedPhone: data.expectedPhone,
        allowAdminReplies: data.allowAdminReplies,
        allowFullHistoryImport: data.allowFullHistoryImport,
      });
      setLoaded(true);
    }
  }, [query.data, loaded]);
  useEffect(() => {
    if (connection?.provider === "waha" && connection.connected) {
      setQr(null);
      setPairingUntil(null);
    }
  }, [connection?.provider, connection?.connected]);
  useEffect(() => {
    if (pairingUntil === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (state: string, message: string) => {
      setQr(null);
      setPairingUntil(null);
      setStatus({ state, message });
      void client.invalidateQueries({ queryKey: ["interno", "crm"] });
    };
    const tick = async () => {
      if (stopped) return;
      if (Date.now() > pairingUntil) {
        stop(
          "FAILED",
          "O tempo para ler o QR Code terminou. Use Reconectar para gerar um novo código.",
        );
        return;
      }
      let wait = 2_000;
      try {
        const result = (await control({ data: { action: "qr" } })) as Record<string, any>;
        if (stopped) return;
        if (validQr(result["qrCode"])) {
          setQr(result["qrCode"]);
          setQrAt(new Date());
          setStatus({ state: "SCAN_QR_CODE", message: String(result["message"] || "") });
          wait = Math.max(5_000, Number(result["refreshAfterMs"]) || 10_000);
        } else if (result["connected"] === true || result["state"] === "WORKING") {
          stop("WORKING", String(result["message"] || "WhatsApp conectado."));
          toast.success("WhatsApp conectado.");
          return;
        } else if (
          result["requiresRestart"] ||
          result["requiresStart"] ||
          ["FAILED", "STOPPED", "error", "number_mismatch"].includes(String(result["state"]))
        ) {
          stop(String(result["state"]), String(result["message"] || ""));
          return;
        } else {
          setStatus({ state: String(result["state"]), message: String(result["message"] || "") });
          wait = Math.max(1_000, Number(result["retryAfterMs"]) || 2_000);
        }
      } catch (error) {
        if (stopped) return;
        setFailure(errorMessage(error));
        setQr(null);
        setPairingUntil(null);
        return;
      }
      timer = setTimeout(() => void tick(), wait);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [pairingUntil]);
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
  const canOperate = Boolean(
    data?.enabled &&
    data.apiKeyConfigured &&
    data.hmacKeyConfigured &&
    form.baseUrl &&
    form.session &&
    form.ownerId &&
    form.expectedPhone &&
    !dirty &&
    !busy,
  );
  const currentState =
    (connection?.provider === "waha" ? connection.state : status?.state) || "unconfigured";
  const action = (name: "start" | "restart" | "qr" | "configure" | "status") =>
    run(async () => {
      const result = await control({ data: { action: name } });
      setStatus({ state: result.state, message: result.message });
      if ("qrCode" in result)
        setQr(
          typeof result.qrCode === "string" &&
            /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.qrCode)
            ? result.qrCode
            : null,
        );
      else if (result.state === "WORKING") setQr(null);
      // After Iniciar/Reconectar the QR Code shows up and renews by itself until it is read.
      if ((name === "start" || name === "restart") && result.state !== "WORKING")
        setPairingUntil(Date.now() + PAIRING_WINDOW_MS);
      await invalidate();
      if (name !== "qr") toast.info(result.message);
    });
  const showQr = () => {
    setFailure(null);
    setPairingUntil(Date.now() + PAIRING_WINDOW_MS);
  };
  const hideQr = () => {
    setQr(null);
    setPairingUntil(null);
  };
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
          <p className="mt-1 text-xs text-muted-foreground">Core 2026.10.1 · NOWEB · uma sessão</p>
        </div>
        <span
          role="status"
          className={`rounded-full px-3 py-1 text-xs font-medium ${currentState === "WORKING" ? "crm-success" : "crm-warning"}`}
        >
          {stateLabel[currentState] || currentState}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Configure a sessão que será usada neste Atendimento. A vendedora pode ser definida depois;
        junto com o número autorizado, é obrigatória para conectar o WhatsApp.
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
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await save({ data: { ...form, clearSecrets: clear } });
                setForm((current) => ({
                  ...current,
                  revision: result.revision,
                  apiKey: "",
                  hmacKey: "",
                }));
                setDirty(false);
                setClear([]);
                setQr(null);
                setStatus(null);
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
                    Permitir que administradores respondam pelo número da vendedora
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
                    Permitir importação geral do histórico (todas as conversas do número)
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
                Nome da sessão
                <Input
                  value={form.session}
                  disabled={busy}
                  onChange={(event) => change("session", event.target.value)}
                  maxLength={54}
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Vendedora responsável
                <select
                  className="h-10 w-full rounded-md border bg-card px-3 text-sm"
                  value={form.ownerId}
                  disabled={busy}
                  onChange={(event) => change("ownerId", event.target.value)}
                >
                  <option value="">Selecione a vendedora</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Número autorizado do WhatsApp
                <Input
                  type="tel"
                  value={form.expectedPhone}
                  disabled={busy}
                  onChange={(event) => change("expectedPhone", event.target.value)}
                  placeholder="DDI + DDD + número"
                  maxLength={30}
                />
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
                Salvar WAHA
              </Button>
            </div>
          </form>
          {failure && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
            >
              {failure}
            </p>
          )}
          {status?.message && (
            <p role="status" className="text-sm text-muted-foreground">
              {status.message}
            </p>
          )}
          {(!form.ownerId || !form.expectedPhone) && (
            <p className="crm-warning rounded-md p-3 text-sm">
              Antes de iniciar, selecione uma vendedora ativa e informe o número autorizado.
            </p>
          )}
          {dirty && (
            <p className="text-xs text-muted-foreground">
              Salve as alterações antes de operar a sessão.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canOperate}
              onClick={() => void action("start")}
            >
              <Play className="size-4" />
              Iniciar sessão
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canOperate || pairingUntil !== null}
              onClick={showQr}
            >
              <QrCode className="size-4" />
              Visualizar QR Code
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty || !data.apiKeyConfigured}
              onClick={() => void action("status")}
            >
              <RefreshCw className="size-4" />
              Consultar status
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canOperate}
              onClick={() => void action("restart")}
            >
              <RefreshCw className="size-4" />
              Reconectar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canOperate}
              onClick={() => void action("configure")}
            >
              <Plug className="size-4" />
              Configurar recebimento
            </Button>
          </div>
          {pairingUntil !== null && !qr && (
            <p
              role="status"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              Preparando o QR Code…
            </p>
          )}
          {qr && (
            <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
              <img src={qr} width={240} height={240} alt="QR Code da sessão WAHA" />
              <p className="max-w-sm text-center text-xs text-muted-foreground">
                No celular do número autorizado: WhatsApp → Aparelhos conectados → Conectar um
                aparelho. O código é renovado automaticamente enquanto esta tela estiver aberta.
              </p>
              {qrAt && (
                <p className="text-[11px] text-muted-foreground" data-crm-qr-updated>
                  Atualizado às{" "}
                  {new Intl.DateTimeFormat("pt-BR", {
                    timeStyle: "medium",
                    timeZone: "America/Fortaleza",
                  }).format(qrAt)}
                </p>
              )}
              <Button type="button" variant="ghost" onClick={hideQr}>
                Ocultar QR Code
              </Button>
            </div>
          )}
          <details className="space-y-3 border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Recebimento e sincronização
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
            <p className="text-xs text-muted-foreground">
              A sincronização consulta as mensagens disponibilizadas pelo conector. Ela preserva as
              datas e não transforma mensagens antigas em novas pendências.
              {!data.allowFullHistoryImport &&
                " A importação geral está desativada: busque o histórico de cada conversa no Atendimento."}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={!canOperate || currentState !== "WORKING" || !data.allowFullHistoryImport}
              onClick={() =>
                void run(async () => {
                  const result = await sync({ data: {} });
                  setSyncResult(
                    `${result.processed} mensagem(ns) processada(s).${result.hasMore ? " Há mais histórico disponível; a próxima execução continuará do ponto salvo." : " Sincronização concluída para o conteúdo disponibilizado."}`,
                  );
                  await invalidate();
                })
              }
            >
              Importar histórico de todas as conversas
            </Button>
            {syncResult && (
              <p role="status" className="text-sm text-muted-foreground">
                {syncResult}
              </p>
            )}
            {data.events.length > 0 && (
              <ul aria-label="Eventos de recebimento WAHA" className="space-y-2 text-xs">
                {data.events.slice(0, 10).map((event) => (
                  <li key={event.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {eventLabel[event.eventType] || "Evento recebido"} ·{" "}
                        {eventStateLabel[event.state] || "Aguardando atualização"}
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
