import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Mic, Paperclip, Send, Smile, Square, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { mediaSize } from "./MessageMedia";
import { QUICK_REPLIES, matchQuickReplies, type QuickReply } from "./quickReplies";
import { recordingSupported, startVoiceRecording, type VoiceRecording } from "./audioWav";

/** Emojis mais usados no atendimento comercial (sem biblioteca externa). */
const EMOJIS = [
  "😊", "🙂", "😀", "😁", "😉", "😍", "🤩", "😅", "🤔", "👀",
  "👍", "👏", "🙏", "🤝", "💪", "👋", "✅", "✔️", "❌", "⚠️",
  "🎉", "❤️", "🔥", "⭐", "💼", "🏢", "🪑", "🛋️", "🗄️", "🖥️",
  "📦", "🚚", "📐", "📏", "📸", "📄", "📎", "📅", "⏰", "💰",
];

/** Arquivo escolhido (ou áudio gravado) antes do envio, com prévia. */
export function ComposerFilePreview({
  file,
  imagePreview,
  prepared,
  disabled,
  onRemove,
}: {
  file: File;
  imagePreview: string | null;
  prepared: boolean;
  disabled: boolean;
  onRemove: () => void;
}) {
  const audio = file.type.startsWith("audio/");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!audio) return;
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, audio]);
  return (
    <div className="wa-file mb-2 flex items-center gap-2 p-2">
      {imagePreview ? (
        <img src={imagePreview} alt="Prévia do arquivo selecionado" className="size-12 rounded object-cover" />
      ) : audio ? (
        <Mic className="size-6 shrink-0 text-[var(--wa-green-dark)]" />
      ) : (
        <FileText className="size-6 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1 text-xs">
        {audio && audioUrl ? (
          <audio controls src={audioUrl} className="h-9 w-full max-w-xs" aria-label="Ouvir o áudio antes de enviar" />
        ) : (
          <p className="break-all font-medium">{file.name}</p>
        )}
        <p className="mt-0.5 text-muted-foreground">
          {mediaSize(file.size)}
          {prepared ? " · Preparado" : " · Será enviado ao confirmar"}
          {audio && " · Envie o texto em uma mensagem separada"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={audio ? "Descartar o áudio" : "Remover arquivo selecionado"}
        disabled={disabled}
        onClick={onRemove}
      >
        {audio ? <Trash2 className="size-4" /> : <X className="size-4" />}
      </Button>
    </div>
  );
}

const formatSeconds = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;

/**
 * Campo de mensagem com cara de WhatsApp: emoji, respostas prontas ("/" ou raio), anexo, campo arredondado e o botão
 * que vira microfone quando o campo está vazio. Enter envia; Shift+Enter quebra a linha (no celular, Enter quebra).
 * O envio em si continua no formulário do Atendimento (mesmas regras de anexo, repetição segura e erros).
 */
export function ComposerBar({
  text,
  onTextChange,
  disabled,
  sending,
  canSubmit,
  mediaEnabled,
  canSendMedia,
  hasFile,
  placeholder,
  onPickFile,
  onRecorded,
  onError,
}: {
  text: string;
  onTextChange: (value: string) => void;
  disabled: boolean;
  sending: boolean;
  canSubmit: boolean;
  mediaEnabled: boolean;
  canSendMedia: boolean;
  hasFile: boolean;
  placeholder: string;
  onPickFile: () => void;
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [canRecord, setCanRecord] = useState(false);
  const [recording, setRecording] = useState<{ handle: VoiceRecording; startedAt: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => setCanRecord(recordingSupported()), []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed((Date.now() - recording.startedAt) / 1000), 250);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => () => recording?.handle.cancel(), [recording]);
  // O campo cresce com o texto (até ~6 linhas), como no WhatsApp.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);
  const shortcuts = matchQuickReplies(text);
  const insert = (value: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    onTextChange(text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + value.length, start + value.length);
    });
  };
  const applyReply = (reply: QuickReply) => {
    onTextChange(reply.text);
    setRepliesOpen(false);
    requestAnimationFrame(() => {
      const element = input.current;
      element?.focus();
      element?.setSelectionRange(reply.text.length, reply.text.length);
    });
  };
  const startRecording = async () => {
    try {
      const handle = await startVoiceRecording(() => stopRef.current());
      setElapsed(0);
      setRecording({ handle, startedAt: Date.now() });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível gravar o áudio.");
    }
  };
  const finishRecording = async () => {
    if (!recording || finishing) return;
    setFinishing(true);
    try {
      const file = await recording.handle.stop();
      if (file) onRecorded(file);
      else onError("Nenhum som foi captado. Confira o microfone e grave de novo.");
    } finally {
      setRecording(null);
      setFinishing(false);
    }
  };
  stopRef.current = () => void finishRecording();
  const showMic = canRecord && mediaEnabled && canSendMedia && !text.trim() && !hasFile;

  if (recording)
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Gravando áudio">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-11 shrink-0 rounded-full text-muted-foreground"
          aria-label="Cancelar a gravação"
          onClick={() => {
            recording.handle.cancel();
            setRecording(null);
          }}
        >
          <Trash2 className="size-5" />
        </Button>
        <div className="wa-input flex h-11 min-w-0 flex-1 items-center gap-2 px-4 text-sm" aria-live="polite">
          <span className="wa-rec-dot" aria-hidden="true" />
          <span className="tabular-nums font-medium">{formatSeconds(elapsed)}</span>
          <span className="min-w-0 truncate text-muted-foreground">
            Gravando…<span className="hidden lg:inline"> pare para ouvir antes de enviar</span>
          </span>
        </div>
        <Button
          type="button"
          size="icon"
          className="wa-send size-11 shrink-0"
          aria-label="Parar a gravação"
          disabled={finishing}
          onClick={() => void finishRecording()}
        >
          {finishing ? <Loader2 className="size-5 animate-spin" /> : <Square className="size-4 fill-current" />}
        </Button>
      </div>
    );

  return (
    <div className="relative">
      {shortcuts.length > 0 && !disabled && (
        <ul className="wa-shortcuts absolute bottom-full left-0 right-0 mb-2 overflow-hidden" role="listbox" aria-label="Respostas prontas">
          {shortcuts.map((reply) => (
            <li key={reply.id}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => applyReply(reply)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <code className="rounded bg-muted px-1.5 text-xs">{reply.shortcut}</code>
                <span className="truncate">{reply.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5">
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 shrink-0 rounded-full text-muted-foreground"
              aria-label="Inserir emoji"
              disabled={disabled}
            >
              <Smile className="size-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="mag-crm w-72 p-2">
            <div className="grid grid-cols-8 gap-0.5" role="group" aria-label="Emojis">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="grid size-8 place-items-center rounded-md text-lg hover:bg-accent"
                  aria-label={`Inserir ${emoji}`}
                  onClick={() => insert(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Popover open={repliesOpen} onOpenChange={setRepliesOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-11 shrink-0 rounded-full text-muted-foreground"
              aria-label="Respostas prontas"
              title="Respostas prontas (ou digite / no campo)"
              disabled={disabled}
            >
              <Zap className="size-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" className="mag-crm w-[min(92vw,26rem)] p-0">
            <p className="border-b px-3 py-2 text-sm font-semibold">
              Respostas prontas <span className="font-normal text-muted-foreground">· digite / no campo</span>
            </p>
            <ul className="max-h-80 overflow-y-auto py-1">
              {QUICK_REPLIES.map((reply) => (
                <li key={reply.id}>
                  <button
                    type="button"
                    onClick={() => applyReply(reply)}
                    className="w-full px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      {reply.title}
                      <code className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{reply.shortcut}</code>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{reply.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        {mediaEnabled && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 shrink-0 rounded-full text-muted-foreground"
            aria-label="Anexar imagem, áudio ou documento"
            title="Anexar imagem, áudio ou documento (um arquivo por envio, até 7 MB)"
            disabled={!canSendMedia || disabled}
            onClick={onPickFile}
          >
            <Paperclip className="size-5" />
          </Button>
        )}
        <textarea
          ref={input}
          aria-label="Mensagem ao cliente"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            if (window.matchMedia?.("(pointer: coarse)").matches) return;
            event.preventDefault();
            if (shortcuts.length === 1 && text.trim() === shortcuts[0]!.shortcut) {
              applyReply(shortcuts[0]!);
              return;
            }
            if (canSubmit) event.currentTarget.form?.requestSubmit();
          }}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={4000}
          rows={1}
          className="wa-input max-h-40 min-h-11 min-w-0 flex-1 resize-none px-4 py-2.5 text-[15px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        {showMic ? (
          <Button
            type="button"
            size="icon"
            className="wa-send size-11 shrink-0"
            aria-label="Gravar áudio"
            title="Gravar áudio"
            disabled={disabled}
            onClick={() => void startRecording()}
          >
            <Mic className="size-5" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className={cn("wa-send size-11 shrink-0", !canSubmit && "opacity-60")}
            disabled={!canSubmit}
            aria-label="Enviar mensagem"
          >
            {sending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </Button>
        )}
      </div>
    </div>
  );
}
