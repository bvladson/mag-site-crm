import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, ContactRound, Loader2, RefreshCw, Search, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getWahaContactCatalog, importWahaContact } from "@/lib/crm-waha.functions";
import { useCrm } from "./CrmProvider";
import { Avatar } from "./bits";
import { fullDate } from "./format";

type Destination = "clients" | "inbox";
const failureMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Não foi possível trazer este contato. Tente novamente.";

export function WahaContactsButton({
  destination = "clients",
  className,
}: {
  destination?: Destination;
  className?: string | undefined;
}) {
  const { connection } = useCrm();
  const [open, setOpen] = useState(false);
  if (connection?.provider !== "waha") return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className}
        onClick={() => setOpen(true)}
      >
        <ContactRound />
        Contatos do WhatsApp
      </Button>
      {open && <WahaContactsDialog destination={destination} onClose={() => setOpen(false)} />}
    </>
  );
}

function WahaContactsDialog({
  destination,
  onClose,
}: {
  destination: Destination;
  onClose: () => void;
}) {
  const { connection, owners, viewerId, refresh, canManage } = useCrm();
  const navigate = useNavigate();
  const readCatalog = useServerFn(getWahaContactCatalog);
  const bringContact = useServerFn(importWahaContact);
  const [chosenLine, setChosenLine] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const lines = connection?.lines?.length
    ? connection.lines.map((item) => ({
        id: item.lineId,
        ownerName: item.ownerName,
        connected: item.connected,
        phoneHint: item.phoneHint,
      }))
    : connection?.lineId
      ? [
          {
            id: connection.lineId,
            ownerName:
              owners.find((owner) => owner.id === connection.responsibleId)?.name ||
              "Linha configurada",
            connected: connection.connected,
            phoneHint: connection.phoneHint,
          },
        ]
      : [];
  const selectedLine = lines.find(
    (item) => item.id === (chosenLine || (lines.length === 1 ? lines[0]?.id : "")),
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const pages = useInfiniteQuery({
    queryKey: ["interno", "crm", "whatsapp-catalog", viewerId, selectedLine?.id, search],
    queryFn: ({ pageParam }) =>
      readCatalog({
        data: {
          lineId: selectedLine!.id,
          search,
          limit: 50,
          ...(pageParam ? { before: pageParam } : {}),
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    enabled: Boolean(selectedLine?.connected),
    staleTime: 20_000,
    retry: 1,
  });
  const items = [
    ...new Map(
      (pages.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.chatId, item]),
    ).values(),
  ];
  const firstPage = pages.data?.pages[0];
  const selectContact = async (contactId: string) => {
    onClose();
    if (destination === "inbox")
      await navigate({ to: "/interno/crm/atendimento", search: { c: contactId } });
    else await navigate({ to: "/interno/crm/clientes", search: { id: contactId } });
  };
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !importing) onClose();
      }}
    >
      <DialogContent
        className="mag-crm mag-crm-dialog max-h-[90dvh] max-w-2xl overflow-y-auto"
        aria-busy={Boolean(importing)}
      >
        <DialogHeader>
          <DialogTitle>Contatos do WhatsApp</DialogTitle>
          <DialogDescription>
            Escolha uma conversa disponível no WhatsApp conectado para trazer o contato ao CRM.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Trazemos apenas o cadastro escolhido. Para consultar mensagens antigas, abra a conversa e
          use “Buscar histórico”. Nenhuma oportunidade é criada automaticamente.
        </p>
        {lines.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="crm-waha-catalog-line">WhatsApp da vendedora</Label>
            <select
              id="crm-waha-catalog-line"
              value={chosenLine}
              disabled={Boolean(importing)}
              onChange={(event) => {
                setChosenLine(event.target.value);
                setQuery("");
                setSearch("");
                setFailure(null);
              }}
              className="h-10 w-full rounded-md border bg-card px-2 text-sm"
            >
              <option value="">Escolha uma linha</option>
              {lines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.ownerName}
                  {line.phoneHint ? ` · ${line.phoneHint}` : ""}
                  {line.connected ? "" : " · desconectada"}
                </option>
              ))}
            </select>
          </div>
        ) : selectedLine ? (
          <p className="text-xs text-muted-foreground">
            {selectedLine.ownerName}
            {selectedLine.phoneHint ? ` · ${selectedLine.phoneHint}` : ""}
          </p>
        ) : null}
        {!selectedLine ? (
          <p className="rounded-md border p-4 text-sm text-muted-foreground">
            {lines.length > 1
              ? "Escolha a linha para consultar seus contatos."
              : "Nenhuma linha de WhatsApp está disponível para sua conta."}
          </p>
        ) : !selectedLine.connected ? (
          <div className="space-y-3 rounded-md border p-4 text-sm">
            <p className="flex items-start gap-2 text-muted-foreground">
              <WifiOff className="mt-0.5 size-4 shrink-0" />
              Conecte este WhatsApp para consultar as conversas disponíveis. Os contatos já salvos
              no CRM continuam acessíveis.
            </p>
            {canManage ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/interno/crm/integracoes" onClick={onClose}>
                  Abrir integrações
                </Link>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Use “Meu WhatsApp” no Atendimento para conectar sua linha.
              </p>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>
              <RefreshCw />
              Consultar conexão
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Buscar contatos disponíveis no WhatsApp"
                placeholder="Nome ou telefone no WhatsApp"
                maxLength={200}
                value={query}
                disabled={Boolean(importing)}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={Boolean(importing) || pages.isFetching}
                onClick={() => {
                  setFailure(null);
                  void pages.refetch();
                }}
              >
                <RefreshCw />
                Atualizar lista
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {firstPage?.notice ||
                "A lista depende das conversas disponibilizadas pelo WhatsApp. Use Carregar mais para continuar; contatos antigos podem não estar disponíveis."}
            </p>
            {failure && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 p-3 text-sm text-destructive"
              >
                {failure}
              </p>
            )}
            {pages.isLoading ? (
              <p
                role="status"
                className="flex items-center gap-2 p-5 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 animate-spin" />
                Consultando contatos…
              </p>
            ) : pages.isError && !pages.data ? (
              <div role="alert" className="space-y-3 rounded-md border p-4 text-sm">
                <p>Não foi possível consultar as conversas deste WhatsApp.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void pages.refetch()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <>
                <ul
                  className="divide-y rounded-md border"
                  aria-label="Conversas disponíveis no WhatsApp"
                >
                  {items.map((item) => (
                    <li key={item.chatId} className="flex flex-wrap items-center gap-3 p-3">
                      <Avatar name={item.name} />
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.phone || "Telefone ainda não identificado"}
                        </p>
                        {item.lastActivityAt && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Última conversa: {fullDate(item.lastActivityAt)}
                          </p>
                        )}
                        {item.contactId && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Check className="size-3" />
                            Já está no CRM
                          </p>
                        )}
                        {!item.contactId && !item.canImport && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.unavailableReason ||
                              "Revise a identificação antes de trazer este contato."}
                          </p>
                        )}
                      </div>
                      {item.contactId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(importing)}
                          onClick={() => void selectContact(item.contactId!)}
                        >
                          {destination === "inbox" ? "Abrir conversa" : "Abrir ficha"}
                          <ArrowRight />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(importing) || !item.canImport || !item.selectionToken}
                          onClick={async () => {
                            if (!selectedLine || !item.selectionToken || importing) return;
                            setImporting(item.chatId);
                            setFailure(null);
                            try {
                              const result = await bringContact({
                                data: {
                                  lineId: selectedLine.id,
                                  chatId: item.chatId,
                                  selectionToken: item.selectionToken,
                                },
                              });
                              await refresh();
                              toast.success(
                                result.created
                                  ? "Contato trazido para o CRM"
                                  : "Este contato já estava no CRM",
                              );
                              await selectContact(result.contactId);
                            } catch (error) {
                              setFailure(failureMessage(error));
                            } finally {
                              setImporting(null);
                            }
                          }}
                        >
                          {importing === item.chatId && <Loader2 className="size-3 animate-spin" />}
                          Trazer para CRM
                        </Button>
                      )}
                    </li>
                  ))}
                  {!items.length && (
                    <li className="p-5 text-center text-sm text-muted-foreground">
                      {pages.hasNextPage
                        ? "Nenhum contato encontrado nesta parte da lista. Continue a busca nas próximas conversas."
                        : search
                          ? "Nenhum contato encontrado nas conversas consultadas."
                          : "Nenhuma conversa individual foi disponibilizada até aqui."}
                    </li>
                  )}
                </ul>
                {pages.isFetchNextPageError && (
                  <p role="alert" className="text-sm text-destructive">
                    Não foi possível continuar a lista. Tente carregar novamente.
                  </p>
                )}
                {pages.isRefetchError && (
                  <p role="alert" className="text-sm text-destructive">
                    Não foi possível atualizar a lista. Os contatos exibidos são da consulta
                    anterior; use Atualizar lista para tentar novamente.
                  </p>
                )}
                {pages.hasNextPage && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pages.isFetchingNextPage || Boolean(importing)}
                    onClick={() => void pages.fetchNextPage()}
                  >
                    {pages.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
                    {search ? "Continuar busca no WhatsApp" : "Carregar mais contatos"}
                  </Button>
                )}
              </>
            )}
          </>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" disabled={Boolean(importing)} onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
