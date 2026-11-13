import { AlertCircle, Check, CheckCheck, Clock3, TriangleAlert } from "lucide-react";
import type { Message } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { MessageMedia } from "./MessageMedia";
import { STATUS_LABEL, clockTime, dayLabel, isMediaPlaceholder, parseRichText, tickFor } from "./chatFormat";

/** Etiqueta central do dia ("Hoje", "Ontem", "Segunda-feira", "3 de novembro de 2026"). */
export function DayDivider({ at }: { at: string }) {
  return (
    <div className="wa-day" role="separator" aria-label={dayLabel(at)}>
      <span>{dayLabel(at)}</span>
    </div>
  );
}

/** Tiques do WhatsApp: relógio (na fila), ✓ enviada, ✓✓ entregue, ✓✓ azul lida, alerta em falha. */
export function MessageTicks({ status, className }: { status: string; className?: string }) {
  const kind = tickFor(status);
  if (!kind) return null;
  const label = STATUS_LABEL[status] || status;
  const icon = { className: cn("size-[15px] shrink-0", className), "aria-hidden": true as const };
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      {kind === "clock" ? (
        <Clock3 {...icon} className={cn(icon.className, "size-3")} />
      ) : kind === "single" ? (
        <Check {...icon} />
      ) : kind === "double" ? (
        <CheckCheck {...icon} />
      ) : kind === "read" ? (
        <CheckCheck {...icon} className={cn(icon.className, "wa-tick-read")} />
      ) : kind === "failed" ? (
        <AlertCircle {...icon} className={cn(icon.className, "text-destructive")} />
      ) : (
        <TriangleAlert {...icon} className={cn(icon.className, "wa-tick-uncertain")} />
      )}
    </span>
  );
}

/** Texto com a formatação do WhatsApp, montado só com elementos React (nada de HTML vindo da mensagem). */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseRichText(text).map((piece, index) =>
        piece.kind === "link" ? (
          <a
            key={index}
            href={piece.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="wa-link"
          >
            {piece.text}
          </a>
        ) : piece.kind === "bold" ? (
          <strong key={index}>{piece.text}</strong>
        ) : piece.kind === "italic" ? (
          <em key={index}>{piece.text}</em>
        ) : piece.kind === "strike" ? (
          <s key={index}>{piece.text}</s>
        ) : piece.kind === "mono" ? (
          <code key={index} className="wa-mono">
            {piece.text}
          </code>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Balão de mensagem: verde à direita (vendedora) e branco à esquerda (cliente), com "rabinho" na primeira de
 * uma sequência, horário e tiques dentro do balão.
 */
export function MessageBubble({
  message,
  first,
  contactName,
}: {
  message: Message;
  first: boolean;
  contactName: string;
}) {
  const mine = message.from === "vendedora";
  const hasMedia = Boolean(message.attachments?.length);
  // Com o arquivo à vista, o texto provisório ("[Áudio]") sai; sem o arquivo, ele continua avisando.
  const text = hasMedia && isMediaPlaceholder(message.text) ? "" : message.text;
  const meta = (
    <>
      {message.channel !== "whatsapp" && <span className="capitalize">{message.channel} ·</span>}
      <time dateTime={message.at}>{clockTime(message.at)}</time>
      {mine && <MessageTicks status={message.status} />}
    </>
  );
  return (
    <div className={cn("wa-row", mine ? "wa-row-out" : "wa-row-in", first && "wa-row-first")}>
      <div
        className={cn(
          "wa-bubble",
          mine ? "wa-bubble-out" : "wa-bubble-in",
          first && "wa-tail",
          hasMedia && "wa-bubble-media",
        )}
      >
        <span className="sr-only">{mine ? "Você" : contactName}: </span>
        {hasMedia && <MessageMedia attachments={message.attachments!} />}
        {text ? (
          <p className={cn("wa-text", hasMedia && "mt-1.5")}>
            <RichText text={text} />
            <span className={cn("wa-meta-spacer", mine && "wa-meta-spacer-out")} aria-hidden="true" />
            <span className="wa-meta">{meta}</span>
          </p>
        ) : (
          <span className="wa-meta wa-meta-block">{meta}</span>
        )}
      </div>
    </div>
  );
}

/** A mensagem abre uma sequência (ganha "rabinho") quando muda o remetente ou o dia. */
export function opensGroup(previous: Message | undefined, current: Message, sameDay: boolean) {
  return !previous || previous.from !== current.from || !sameDay;
}
