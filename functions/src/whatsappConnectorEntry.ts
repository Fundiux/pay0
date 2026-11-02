// Dedicated entry for the five server enrollment functions. No whole-app index,
// legacy connector, session, provider, receipt or automation module is imported.
export {
  createWhatsAppConnectorEnrollment,
  consumeWhatsAppConnectorEnrollment,
  getWhatsAppConnectorBinding,
  revokeWhatsAppConnectorBinding,
  operateWhatsAppConnector,
} from "./modules/documentDelivery/whatsappConnectorCallables";
