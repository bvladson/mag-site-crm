import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadLinkImage } from "@/lib/links-admin.functions";
import { imageUrl } from "@/lib/links";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Selection = { url: string; image: HTMLImageElement };

export function LinkTreeEditorImage({
  label,
  value,
  onChange,
  onUploading,
  disabled = false,
  ratio = 1,
  removable = true,
  contain = false,
}: {
  label: string;
  value: string | null;
  onChange: (image: string | null) => void;
  onUploading: (delta: number) => void;
  disabled?: boolean;
  ratio?: number;
  removable?: boolean;
  contain?: boolean;
}) {
  const upload = useServerFn(uploadLinkImage);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [busy, setBusy] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (selection) URL.revokeObjectURL(selection.url);
    },
    [selection],
  );
  const paintCanvas = useCallback(
    (target: HTMLCanvasElement): boolean => {
      if (
        !selection ||
        !selection.image.complete ||
        !selection.image.naturalWidth ||
        !selection.image.naturalHeight
      )
        return false;
      const image = selection.image;
      const context = target.getContext("2d");
      if (!context) return false;
      try {
        const containScale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight);
        target.width = contain
          ? Math.max(1, Math.round(image.naturalWidth * containScale))
          : ratio === 1 ? 640 : 1200;
        target.height = contain
          ? Math.max(1, Math.round(image.naturalHeight * containScale))
          : Math.round(target.width / ratio);
        context.clearRect(0, 0, target.width, target.height);
        if (contain) {
          const scale = Math.min(
            target.width / image.naturalWidth,
            target.height / image.naturalHeight,
          );
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context.drawImage(
            image,
            (target.width - width) / 2,
            (target.height - height) / 2,
            width,
            height,
          );
        } else {
          const cropWidth = Math.min(image.naturalWidth, image.naturalHeight * ratio) / zoom;
          const cropHeight = cropWidth / ratio;
          const cropX = ((image.naturalWidth - cropWidth) * x) / 100;
          const cropY = ((image.naturalHeight - cropHeight) * y) / 100;
          context.drawImage(
            image,
            cropX,
            cropY,
            cropWidth,
            cropHeight,
            0,
            0,
            target.width,
            target.height,
          );
        }
        return true;
      } catch {
        return false;
      }
    },
    [selection, zoom, x, y, ratio, contain],
  );

  // Radix mounts portal contents after the selection update. Paint on the actual
  // canvas mount as well as on crop changes; an effect alone may run too early.
  const attachCanvas = useCallback(
    (target: HTMLCanvasElement | null) => {
      canvas.current = target;
      setCanvasReady(target !== null && paintCanvas(target));
    },
    [paintCanvas],
  );

  useEffect(() => {
    setCanvasReady(canvas.current !== null && paintCanvas(canvas.current));
  }, [paintCanvas]);

  const choose = async (file: File | undefined) => {
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
      if (image.naturalWidth > 16000 || image.naturalHeight > 16000) {
        URL.revokeObjectURL(url);
        setError("A imagem é muito grande. Use uma versão de até 16.000 pixels por lado.");
        return;
      }
      setZoom(1);
      setX(50);
      setY(50);
      setCanvasReady(false);
      setSelection({ url, image });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Não foi possível abrir esta imagem.");
    };
    image.src = url;
  };
  const submit = async () => {
    if (!canvasReady || !canvas.current || !paintCanvas(canvas.current)) {
      setCanvasReady(false);
      setError("A imagem ainda não está pronta. Aguarde a prévia antes de enviar.");
      return;
    }
    setBusy(true);
    onUploading(1);
    setError("");
    try {
      const base64 = canvas.current.toDataURL("image/webp", 0.9).split(",")[1];
      if (!base64) throw new Error("Não foi possível preparar a imagem.");
      const result = await upload({ data: { base64 } });
      onChange(result.image);
      setSelection(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível enviar a imagem. Tente novamente.",
      );
    } finally {
      setBusy(false);
      onUploading(-1);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        {value ? (
          <img
            src={imageUrl(value, true)}
            alt={label}
            className={`${contain || ratio !== 1 ? "h-16 w-36" : "size-16"} shrink-0 rounded-md border bg-white ${contain ? "object-contain p-2" : "object-cover"}`}
          />
        ) : (
          <div
            className={`${contain || ratio !== 1 ? "h-16 w-36" : "size-16"} grid shrink-0 place-items-center rounded-md border border-dashed bg-surface text-muted-foreground`}
          >
            <ImagePlus className="size-5" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus /> {value ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {value && removable && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => onChange(null)}
              aria-label={`Remover ${label.toLowerCase()}`}
            >
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Escolher ${label.toLowerCase()}`}
        className="sr-only"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="text-xs text-muted-foreground">
        JPG, PNG ou WebP, até 8 MB.{" "}
        {contain ? "A imagem será preservada por inteiro." : "Ajuste o recorte antes de enviar."}
      </p>
      {error && !selection && (
        <p role="alert" className="text-sm text-destructive">
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
            <DialogTitle>Ajustar {label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              {contain
                ? "Confira a imagem antes de enviar. A proporção original será preservada."
                : "Centralize a imagem e ajuste a aproximação."}{" "}
              A imagem será enviada ao rascunho.
            </DialogDescription>
          </DialogHeader>
          <canvas
            ref={attachCanvas}
            className="mx-auto max-h-[300px] w-full rounded-lg bg-white object-contain"
            aria-label={contain ? "Prévia da imagem completa" : "Prévia do recorte da imagem"}
          />
          {!contain && (
            <div className="grid gap-3">
              <label className="text-sm font-medium">
                Aproximação
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  disabled={busy}
                  onChange={(event) => {
                    setCanvasReady(false);
                    setZoom(Number(event.target.value));
                  }}
                  className="mt-2 w-full accent-brand"
                />
              </label>
              <label className="text-sm font-medium">
                Posição horizontal
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={x}
                  disabled={busy}
                  onChange={(event) => {
                    setCanvasReady(false);
                    setX(Number(event.target.value));
                  }}
                  className="mt-2 w-full accent-brand"
                />
              </label>
              <label className="text-sm font-medium">
                Posição vertical
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={y}
                  disabled={busy}
                  onChange={(event) => {
                    setCanvasReady(false);
                    setY(Number(event.target.value));
                  }}
                  className="mt-2 w-full accent-brand"
                />
              </label>
            </div>
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
            <Button type="button" disabled={busy || !canvasReady} onClick={() => void submit()}>
              {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
              {busy ? "Enviando..." : "Usar imagem"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
