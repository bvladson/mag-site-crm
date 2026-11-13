import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadSiteImage } from "@/lib/site-content-admin.functions";
import { siteImageUrl } from "@/lib/site-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SiteContentImage({
  label,
  value,
  onChange,
  onUploading,
  disabled = false,
  resetValue = null,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  onUploading: (delta: number) => void;
  disabled?: boolean;
  resetValue?: string | null;
  hint?: string;
}) {
  const upload = useServerFn(uploadSiteImage);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [selection, setSelection] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (selection) URL.revokeObjectURL(selection.url);
    },
    [selection],
  );
  const paint = useCallback(
    (target: HTMLCanvasElement | null) => {
      canvas.current = target;
      if (!target || !selection) {
        setReady(false);
        return;
      }
      const source = selection.image;
      const context = target.getContext("2d");
      if (!context || !source.naturalWidth || !source.naturalHeight) {
        setReady(false);
        return;
      }
      const scale = Math.min(1, 2400 / source.naturalWidth, 2400 / source.naturalHeight);
      target.width = Math.max(1, Math.round(source.naturalWidth * scale));
      target.height = Math.max(1, Math.round(source.naturalHeight * scale));
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(source, 0, 0, target.width, target.height);
      setReady(true);
    },
    [selection],
  );
  const choose = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Escolha uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Escolha uma imagem de até 8 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth > 16000 ||
        image.naturalHeight > 16000 ||
        image.naturalWidth * image.naturalHeight > 36_000_000
      ) {
        URL.revokeObjectURL(url);
        setError(
          "Use uma imagem de até 36 milhões de pixels, com no máximo 16.000 pixels por lado.",
        );
        return;
      }
      setReady(false);
      setSelection({ url, image });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Não foi possível abrir esta imagem.");
    };
    image.src = url;
  };
  const submit = async () => {
    if (!ready || !canvas.current || busy || disabled) return;
    setBusy(true);
    onUploading(1);
    setError("");
    try {
      let base64 = "";
      for (const quality of [0.88, 0.78, 0.68]) {
        base64 = canvas.current.toDataURL("image/webp", quality).split(",")[1] ?? "";
        if (base64 && base64.length * 0.75 <= 2 * 1024 * 1024) break;
      }
      if (!base64 || base64.length * 0.75 > 2 * 1024 * 1024)
        throw new Error(
          "A imagem continua muito pesada. Envie uma versão menor para manter o site rápido.",
        );
      const result = await upload({ data: { base64 } });
      onChange(result.image);
      setSelection(null);
    } catch (cause) {
      setError(
        cause instanceof Error && !cause.message.startsWith("{")
          ? cause.message
          : "Não foi possível enviar a imagem. Tente novamente.",
      );
    } finally {
      setBusy(false);
      onUploading(-1);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        {value ? (
          <img
            src={siteImageUrl(value, true)}
            alt={label}
            className="h-20 w-36 rounded-lg border bg-white object-contain p-2"
          />
        ) : (
          <span className="grid h-20 w-36 place-items-center rounded-lg border border-dashed bg-surface text-muted-foreground">
            <ImagePlus className="size-6" aria-hidden="true" />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus />
            {value ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {value !== resetValue && value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => {
                setError("");
                onChange(resetValue);
              }}
            >
              <Trash2 />
              {resetValue ? "Restaurar padrão" : "Remover"}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`Escolher ${label.toLowerCase()}`}
        disabled={disabled || busy}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {hint || "JPG, PNG ou WebP, até 8 MB. A proporção original será preservada."}
      </p>
      {error && !selection && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSelection(null);
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conferir {label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              A imagem inteira será enviada ao rascunho. Confira a arte antes de continuar.
            </DialogDescription>
          </DialogHeader>
          <canvas
            ref={paint}
            className="mx-auto max-h-[340px] w-full rounded-lg bg-white object-contain"
            aria-label="Prévia da imagem completa"
          />
          {selection && (
            <p className="text-xs text-muted-foreground">
              Original: {selection.image.naturalWidth} × {selection.image.naturalHeight} pixels.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setSelection(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy || !ready || disabled}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
              {busy ? "Enviando…" : "Usar imagem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
