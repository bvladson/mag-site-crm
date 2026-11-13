import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pause, Play, Plug, QrCode, RefreshCw, Smartphone, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { controlWahaSession, retryWahaRecovery } from "@/lib/crm-waha.functions";
import { useCrm } from "./CrmProvider";

/** How long the screen keeps renewing the QR Code after Conectar (WhatsApp gives ~2.5 min). */
const PAIRING_WINDOW_MS = 210_000;
const validQr = (value: unknown): value is string =>
  typeof value === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value);
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível concluir a operação.";
export const stateLabel: Record<string, string> = {
  unconfigured: "Não configurado",
  line_required: "Número não cadastrado",
  owner_required: "Defina a vendedora",
  phone_required: "Defina o número autorizado",
  number_mismatch: "Número não autorizado",
  portfolio_unavailable: "Conexão de outra carteira",
  supervision: "Supervisão",
  PAUSED: "Pausado",
  STOPPED: "Desconectado",
  STARTING: "Iniciando",
  SCAN_QR_CODE: "Aguardando QR Code",
  WORKING: "Conectado",
  FAILED: "QR Code expirado",
  PASSKEY_REQUIRED: "Confirmação de autenticação necessária",
  PASSKEY_CONFIRMATION_REQUIRED: "Aguardando confirmação no aparelho",
  error: "Falha de comunicação",
};
/** States in which the line cannot be operated until an administrator completes the setup. */
const BLOCKED = ["unconfigured", "line_required", "owner_required", "phone_required"];
/** Catch-up after a reconnection, as reported by the CRM (counts only). */
export type WahaRecovery = {
  state: "pending" | "done" | "partial" | "error";
  processed: number;
  newChats: number;
  includesNewChats: boolean;
  nextAt: string | null;
  updatedAt: string;
  errorCode: string | null;
  hasMore: boolean;
  failedCount: number;
} | null;
const clock = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Fortaleza" }).format(
    new Date(value),
  );
function recoveryText(recovery: NonNullable<WahaRecovery>) {
  const found = `${recovery.processed} mensagem(ns) recuperada(s)${recovery.includesNewChats ? `, ${recovery.newChats} conversa(s) nova(s)` : ""}`;
  if (recovery.state === "partial")
    return `Conferência parcial das mensagens da desconexão: ${found}. Ainda há conversas ou páginas para conferir${recovery.failedCount ? ` e ${recovery.failedCount} pendência(s) com falha` : ""}.`;
  if (recovery.state === "error")
    return `A conferência das mensagens da desconexão não foi concluída. Até agora: ${found}. Verifique a conexão e tente continuar.`;
  return recovery.state === "pending"
    ? `Conferência das mensagens recebidas durante a desconexão em andamento${recovery.nextAt ? ` (próxima etapa às ${clock(recovery.nextAt)})` : ""}. Até agora: ${found}.`
    : `Conferência das mensagens recebidas durante a desconexão concluída às ${clock(recovery.updatedAt)}: ${found}.`;
}

/**
 * One WhatsApp line: connect by QR Code (renewed automatically), pause and resume without QR, and
 * unlink the phone. The seller uses it for her own number as often as she needs; administrators use
 * it for any line.
 */
export function WahaLinePanel({
  lineId,
  state,
  message,
  phoneHint,
  recovery = null,
  canConfigure = false,
}: {
  /** Omitted: the signed-in seller's own line. */
  lineId?: string;
  /** Last known state of the line (from the CRM connection). */
  state?: string | undefined;
  message?: string | undefined;
  phoneHint?: string | null;
  recovery?: WahaRecovery | undefined;
  /** Administrators may reapply the receiving configuration. */
  canConfigure?: boolean;
}) {
  const client = useQueryClient();
  const control = useServerFn(controlWahaSession);
  const retryRecovery = useServerFn(retryWahaRecovery);
  const [busy, setBusy] = useState(false);
  const controlling = useRef(false);
  const generation = useRef(0);
  const [recovering, setRecovering] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<Date | null>(null);
  // While set, the screen renews the QR Code by itself until it is read, expires or the window ends.
  const [pairingUntil, setPairingUntil] = useState<number | null>(null);
  const [status, setStatus] = useState<{ state: string; message: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"pause" | "unlink" | null>(null);
  // Resuming a paused line usually needs no QR Code; the QR shows up only if WhatsApp asks for it.
  const [resuming, setResuming] = useState(false);
  type Action = "start" | "restart" | "qr" | "configure" | "status" | "pause" | "logout";
  const request = (action: Action) => ({
    data: lineId ? { action, lineId } : { action },
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["interno", "crm"] });
    await client.invalidateQueries({ queryKey: ["interno", "crm-waha"] });
  };
  // A newer state from the CRM connection replaces what this panel saw last.
  useEffect(() => {
    if (state === "WORKING") {
      setQr(null);
      setPairingUntil(null);
    }
    if (pairingUntil === null) setStatus(null);
  }, [state]);
  useEffect(() => {
    if (pairingUntil === null) return;
    const currentGeneration = generation.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (next: string, text: string) => {
      setQr(null);
      setPairingUntil(null);
      setResuming(false);
      setStatus({ state: next, message: text });
      void refresh();
    };
    const tick = async () => {
      if (stopped || generation.current !== currentGeneration) return;
      if (Date.now() > pairingUntil) {
        stop(
          "FAILED",
          "O tempo para ler o QR Code terminou. Use Conectar para gerar um novo código.",
        );
        return;
      }
      let wait = 2_000;
      try {
        const result = (await control(request("qr"))) as Record<string, unknown>;
        if (stopped || generation.current !== currentGeneration) return;
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
        if (stopped || generation.current !== currentGeneration) return;
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
  const current = status?.state || state || "unconfigured";
  const blocked = BLOCKED.includes(current);
  const connected = current === "WORKING";
  const paused = current === "PAUSED";
  const pairing = ["SCAN_QR_CODE", "STARTING", "FAILED", "number_mismatch"].includes(current);
  const run = async (name: Exclude<Action, "qr">) => {
    if (controlling.current) return;
    controlling.current = true;
    if (["start", "restart", "pause", "logout"].includes(name)) {
      generation.current++;
      setQr(null);
      setPairingUntil(null);
    }
    setBusy(true);
    setFailure(null);
    setConfirm(null);
    try {
      const result = await control(request(name));
      setStatus({ state: result.state, message: result.message });
      if (name === "logout" || name === "pause") {
        setQr(null);
        setPairingUntil(null);
      }
      // After Conectar the QR Code shows up and renews by itself until it is read.
      if ((name === "start" || name === "restart") && result.state !== "WORKING")
        setPairingUntil(Date.now() + PAIRING_WINDOW_MS);
      await refresh();
      if (name !== "status") toast.info(result.message);
    } catch (error) {
      const text = errorMessage(error);
      setFailure(text);
      toast.error(text);
    } finally {
      controlling.current = false;
      setBusy(false);
    }
  };
  // A stopped, paused or never created session starts; an expired QR (FAILED) needs a restart.
  // A paused line comes back without QR; if WhatsApp dropped its login, a new QR Code shows up.
  const connect = () => {
    setResuming(paused);
    void run(["FAILED", "SCAN_QR_CODE", "STARTING"].includes(current) ? "restart" : "start");
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">Número autorizado: </span>
          {phoneHint ? `final ${phoneHint.replace("…", "")}` : "não informado"}
        </p>
        <span
          role="status"
          className={`rounded-full px-3 py-1 text-xs font-medium ${connected ? "crm-success" : "crm-warning"}`}
        >
          {stateLabel[current] || current}
        </span>
      </div>
      {(status?.message || message) && (
        <p className="text-sm text-muted-foreground">{status?.message || message}</p>
      )}
      {failure && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          {failure}
        </p>
      )}
      {recovery && (
        <div className="space-y-2 rounded-md border p-3 text-xs" data-crm-recovery={recovery.state}>
          <p className={recovery.state === "error" ? "text-destructive" : "text-muted-foreground"}>
            {recoveryText(recovery)}
          </p>
          {(recovery.state === "partial" ||
            recovery.state === "error" ||
            recovery.hasMore ||
            recovery.failedCount > 0) && (
            <>
              {!connected && (
                <p className="text-muted-foreground">
                  Retome a conexão para continuar a conferência.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || recovering || !connected}
                onClick={async () => {
                  if (recovering) return;
                  setRecovering(true);
                  setFailure(null);
                  try {
                    await retryRecovery({ data: lineId ? { lineId } : {} });
                    await refresh();
                    toast.success("Conferência agendada para continuar");
                  } catch (error) {
                    setFailure(errorMessage(error));
                  } finally {
                    setRecovering(false);
                  }
                }}
              >
                {recovering ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {recovery.state === "error"
                  ? "Tentar conferência novamente"
                  : "Continuar conferência"}
              </Button>
            </>
          )}
        </div>
      )}
      {(connected || paused) && (
        <p className="text-xs text-muted-foreground">
          Para receber tudo na hora, mantenha o WhatsApp conectado durante o expediente. Pausar e
          desvincular são para situações excepcionais.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!connected && pairingUntil === null && (
          <Button type="button" disabled={busy || blocked} onClick={connect}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {paused ? "Retomar" : "Conectar"}
          </Button>
        )}
        {current === "SCAN_QR_CODE" && pairingUntil === null && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setFailure(null);
              setPairingUntil(Date.now() + PAIRING_WINDOW_MS);
            }}
          >
            <QrCode className="size-4" />
            Mostrar QR Code
          </Button>
        )}
        {connected && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm("pause")}
          >
            <Pause className="size-4" />
            Pausar
          </Button>
        )}
        {(connected || paused) && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm("unlink")}
          >
            <Unlink className="size-4" />
            Desvincular aparelho
          </Button>
        )}
        {pairing && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void run("logout")}
          >
            <X className="size-4" />
            Cancelar conexão
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy || blocked}
          onClick={() => void run("status")}
        >
          <RefreshCw className="size-4" />
          Consultar status
        </Button>
        {canConfigure && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || blocked}
            onClick={() => void run("configure")}
          >
            <Plug className="size-4" />
            Configurar recebimento
          </Button>
        )}
      </div>
      {confirm === "pause" && (
        <div
          role="alertdialog"
          aria-label="Confirmar pausa"
          className="space-y-2 rounded-md border p-3 text-sm"
        >
          <p className="font-medium">Pausar o WhatsApp no CRM?</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>O celular continua vinculado e nada é apagado.</li>
            <li>Enquanto estiver pausado, as mensagens não aparecem no CRM.</li>
            <li>
              Para voltar, use Retomar, sem QR Code. O CRM confere as mensagens do intervalo
              disponibilizadas pelo WhatsApp.
            </li>
          </ul>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void run("pause")}>
              Pausar agora
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {confirm === "unlink" && (
        <div
          role="alertdialog"
          aria-label="Confirmar desvinculação"
          className="space-y-2 rounded-md border p-3 text-sm"
        >
          <p className="font-medium">Desvincular este celular do CRM?</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>O CRM sai da lista de Aparelhos conectados do seu WhatsApp.</li>
            <li>Para voltar, será preciso ler um novo QR Code.</li>
            <li>As conversas já guardadas continuam no CRM.</li>
            <li>
              O que chegar enquanto estiver desvinculado é buscado depois do novo pareamento,
              conforme o histórico que o WhatsApp enviar.
            </li>
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void run("logout")}
            >
              Desvincular agora
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {pairingUntil !== null && !qr && (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {resuming ? "Retomando a conexão…" : "Preparando o QR Code…"}
        </p>
      )}
      {qr && (
        <div className="flex flex-col items-center gap-2 rounded-lg border p-4">
          <img src={qr} width={240} height={240} alt="QR Code da sessão WAHA" />
          <p className="max-w-sm text-center text-xs text-muted-foreground">
            No celular do número autorizado: WhatsApp → Aparelhos conectados → Conectar um aparelho.
            O código é renovado automaticamente enquanto esta tela estiver aberta.
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
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              generation.current++;
              setQr(null);
              setPairingUntil(null);
            }}
          >
            Ocultar QR Code
          </Button>
        </div>
      )}
    </div>
  );
}

/** "Meu WhatsApp" in the Atendimento: the seller connects, pauses and unlinks her own number. */
export function MyWhatsAppButton() {
  const { connection } = useCrm();
  const [open, setOpen] = useState(false);
  if (connection?.provider !== "waha" || !connection.ownLine) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2 w-full"
        onClick={() => setOpen(true)}
      >
        <Smartphone className="size-4" />
        Meu WhatsApp
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mag-crm mag-crm-dialog">
          <DialogHeader>
            <DialogTitle>Meu WhatsApp</DialogTitle>
            <DialogDescription>
              Conecte o seu número ao CRM lendo o QR Code no celular e mantenha conectado durante o
              expediente: as mensagens entram no CRM na hora. Se precisar, pause (volta sem QR Code)
              ou desvincule o aparelho (volta com um novo QR Code). As conversas continuam
              guardadas.
            </DialogDescription>
          </DialogHeader>
          <WahaLinePanel
            state={connection.state}
            message={connection.message}
            phoneHint={connection.phoneHint ?? null}
            recovery={connection.recovery ?? null}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
