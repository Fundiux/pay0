export const DOCUMENT_DELIVERY_MESSAGES = {
  facturaPdfXml: "compartimos folio solicitado",
  dispersionComprobante: "compartimos comprobante",
} as const;

export type DocumentDeliveryMessageKey = keyof typeof DOCUMENT_DELIVERY_MESSAGES;

export function getDocumentDeliveryMessage(key: DocumentDeliveryMessageKey): string {
  return DOCUMENT_DELIVERY_MESSAGES[key];
}