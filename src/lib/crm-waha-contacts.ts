/** Safe WhatsApp catalog metadata. Provider credentials, pictures and messages stay on the server. */
export interface WahaCatalogContact {
  chatId: string;
  name: string;
  phone: string | null;
  lastActivityAt: string | null;
  contactId: string | null;
  canImport: boolean;
  unavailableReason: string | null;
  /** Short-lived opaque selection proof. Never display or log it. */
  selectionToken: string | null;
}
export interface WahaContactCatalogPage {
  lineId: string;
  ownerName: string;
  items: WahaCatalogContact[];
  hasMore: boolean;
  nextCursor: string | null;
  scanned: number;
  searchScope: "loaded-window";
  notice: string;
}
export interface WahaContactCatalogInput {
  lineId?: string | undefined;
  search?: string | undefined;
  before?: string | undefined;
  limit?: number | undefined;
}
export interface WahaContactImportInput {
  lineId?: string | undefined;
  chatId: string;
  selectionToken: string;
}
