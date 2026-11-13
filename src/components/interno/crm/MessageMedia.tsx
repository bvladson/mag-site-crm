import { FileText, Download } from "lucide-react";
import type { Message } from "@/lib/crm";

export function mediaSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** URLs are authenticated MAG routes; connector URLs and credentials never enter this component. */
export function MessageMedia({
  attachments,
}: {
  attachments: NonNullable<Message["attachments"]>;
}) {
  return (
    <div className="space-y-2">
      {attachments.map((attachment) => {
        if (!/^\/api\/interno\/crm\/anexos\/[0-9a-f-]{36}$/.test(attachment.downloadUrl))
          return null;
        return (
          <div
            key={attachment.id}
            className="min-w-0 space-y-1.5"
            data-crm-attachment={attachment.id}
          >
            {attachment.kind === "image" && (
              <a
                href={attachment.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
              >
                <img
                  src={attachment.downloadUrl}
                  alt={attachment.name}
                  loading="lazy"
                  className="max-h-64 w-auto max-w-full rounded-lg object-contain"
                />
              </a>
            )}
            {attachment.kind === "audio" && (
              <audio
                aria-label={`Áudio: ${attachment.name}`}
                controls
                preload="none"
                src={attachment.downloadUrl}
                className="max-w-full"
              />
            )}
            <a
              href={attachment.downloadUrl}
              download={attachment.name}
              className="flex min-w-0 items-center gap-2 rounded-md border bg-card/50 p-2 text-xs hover:bg-accent"
            >
              {attachment.kind === "document" ? (
                <FileText className="size-5 shrink-0" />
              ) : (
                <Download className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 break-all">
                {attachment.name}
                <span className="mt-0.5 block text-muted-foreground">
                  {mediaSize(attachment.size)}
                </span>
              </span>
              {attachment.kind === "document" && <Download className="size-3.5 shrink-0" />}
            </a>
          </div>
        );
      })}
    </div>
  );
}
