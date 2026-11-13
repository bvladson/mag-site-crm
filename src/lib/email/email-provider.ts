/** Contrato de envio — formulários nunca dependem de um provedor específico. */
export type SendEmailInput = {
  to: string | string[]; subject: string; html: string; text: string; replyTo?: string;
  /** Anexos em base64 (ex.: PDF da proposta comercial). */
  attachments?: { filename: string; content: string }[];
};
export type SendEmailResult = { sent: true } | { sent: false; reason: string };
export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
