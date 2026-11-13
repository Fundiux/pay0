export {
  upsertUser,
  createSolicitud,
  cancelSolicitud,
  changeSolicitudStatus,
  initUpload,
  finalizeUpload,
  createAdmin,
  createOperador,
  applyAbono,
  createPago,
  listPagos,
  listSolicitudes,
  changePagoStatus,
  preparePagoFinancialPosting,
  previewPagoFinancialPosting,
  diagnosePagoFinancialContext,
} from "./modules/legacyCore/callables";
export { logAuthEventCallable, logUnauthorizedRouteAttempt, redeemMySecurityUnlockCode } from "./modules/activityLog/callables";
export { loginWithUsername, setMyUsername } from "./modules/users/loginIdentity";
export { updateUserModules } from "./modules/users/modules";
export { updateUserActive } from "./modules/users/active";
export { listUsers } from "./modules/users/list";
export { mergeDuplicateClientCallable, listDuplicateClientGroupsCallable } from "./modules/clients/mergeCallables";
export { saveClientCallable, toggleClientActiveCallable, repairClientNumbersByAdminCallable, listClientsCanonical, getClientCanonical } from "./modules/clients/callables";
export { softDeleteUser, restoreUser, setUserCompanyAccess } from "./modules/users/access";
export { getUserClientAccessConfig, setUserClientAccess } from "./modules/clientDelegations/callables";
export {
  reservePagoApplicationBatch,
  applyPagoToSolicitudesAtomic,
  applyPagoToSolicitud,
  listPagoApplicationsForPayment,
  preparePagoApplicationIqPlan,
  resumePagoApplicationIqPlan,
  executePagoApplicationIqPlan,
  processPagoApplicationIqPlanOnDemandTask,
  processIqPaymentApplicationExecution,
  enqueuePaymentApplicationImmediately,
  diagnosePagoApplicationIqMethods,
} from "./modules/paymentApplications/callables";
export { applyPaymentAutomaticallyOnReconciliation, applyPaymentAutomaticallyOnReceipt, applyPaymentsAutomaticallyOnInvoice, reevaluatePaymentsInReviewDaily } from "./modules/paymentApplications/automaticApplication";
export { notifyUnmatchedPayment, listPagosSinSolicitud, decidePagoSinSolicitud } from "./modules/paymentApplications/unmatchedPaymentReview";

export { addSolicitudNota, addPagoNota } from "./modules/notes/callables";
export { repairUserNumbersByRootCallable } from "./modules/users/repairNumbers";
export { createCompany, toggleCompanyActive, setDispatchCompanies, listCompaniesCanonical, updateCompanyDepositIdentity, setCompanyQuotationLogo } from "./modules/companies/callables";
export { saveDespachoCallable, setUserDespachos, toggleDespachoActive } from "./modules/dispatches/callables";
export { createManualAdjustment } from "./modules/balances/callables";
export { createClientDispersion, createClientDispersionsMassive, grantClientAdvance, listScopedClientDispersions } from "./modules/financing/callables";
export { previewClientDispersionPricing } from "./modules/financing/dispersionFinancialCallables";
export { createOperationType } from "./modules/rates/callables";
export { setDespachoOperationCost } from "./modules/rates/callables";
export { setUserOperationCost } from "./modules/rates/callables";

export { setClientOperationCost } from "./modules/rates/callables";

export { addClientBeneficiaryMethod, createClientBeneficiary, deleteClientBeneficiary, deleteClientBeneficiaryMethod, toggleClientBeneficiaryActive, toggleClientBeneficiaryMethodActive, updateClientBeneficiary, updateClientBeneficiaryMethod, replaceClientBeneficiaryMethod } from "./modules/beneficiaries/callables";
export { requestClientDispersionIncident } from "./modules/financing/callables";
export { resolveClientDispersionIncident } from "./modules/financing/callables";
export { addClientDispersionNota } from "./modules/financing/callables";
export { initSolicitudDocumentUpload, finalizeSolicitudDocumentUpload, deactivateSolicitudDocument, reprocessActiveSolicitudOc } from "./modules/solicitudDocuments/callables";
export { createSolicitudSignatureLink, getSolicitudSignatureRequest, submitSolicitudSignature } from "./modules/signatureLinks/callables";
export { generateSolicitudQuotation, getPublicQuotationVerification } from "./modules/cotizaciones/callables";
export { getPublicConstanciaVerification, generateSolicitudReceiptCertificate } from "./modules/constancias/service";
export { initPagoDocumentUpload, finalizePagoDocumentUpload, updateRejectedPagoAmountForRetry, deactivatePagoDocument } from "./modules/pagoDocuments/callables";
export { initDispersionDocumentUpload, finalizeDispersionDocumentUpload, deactivateDispersionDocument } from "./modules/dispersionDocuments/callables";
export { createDispersionCashSignatureLink, getDispersionCashSignatureRequest, submitDispersionCashSignature } from "./modules/dispersionCashReceipt/callables";
export { importIqDispersionReceipt } from "./modules/dispersionDocuments/iqReceiptImport";
export { processIqDispersionReceipts } from "./modules/dispersionDocuments/iqReceiptAuto";

export { telegramWebhook } from "./modules/telegram/webhook";

export { createTelegramLinkToken, getMyTelegramLinkStatus, unlinkMyTelegramAccount, getMyTelegramNotificationPrefs, updateMyTelegramNotificationPrefs, sendMyTelegramTestNotification, createClientTelegramLinkToken, getClientTelegramLinkStatus, unlinkClientTelegramAccount } from "./modules/telegram/callables";

export { telegramDownloadAction } from "./modules/telegram/actionTokens";
export { setMaintenanceMode } from "./modules/system/maintenance";
export { getEarningsByClientReport } from "./modules/reports/callables";
export { getPaymentsFinancialPostingIssuesReport } from "./modules/reports/callables";
export { getOperationalIntelligenceReport } from "./modules/reports/callables";
export { getOperationalMetricsReport } from "./modules/reports/callables";
export {
  getClientCommissionRule,
  saveClientCommissionRule,
  previewPaymentCommissionDistribution,
  processPaymentCommissionDistribution,
  preflightPaymentCommissionDistribution,
  getCommissionDistributionsReport,
} from "./modules/commissionDistributions/callables";
export { onPaymentReadyForCommissionDistribution } from "./modules/commissionDistributions/triggers";
export { getMyCommissionSettings, configureUserCommissionEntitlement, previewMyCommissionDestinations, saveMyCommissionDestinations } from "./modules/commissionDistributions/userDestinations";
export { requestUserCommissionDispersion, previewUserCommissionWithdrawal } from "./modules/commissionDistributions/requests";
export { executeUserCommissionDispersion, cancelUserCommissionDispersion } from "./modules/commissionDistributions/execution";
export { getCommissionAutomationConfig, saveCommissionAutomationConfig, runDailyUserCommissionPreflight, prepareDailyUserCommissions } from "./modules/commissionDistributions/daily";
export { backfillPagoReportDates } from "./modules/reports/pagoReportDateBackfillCallables";
export { getControlCenterOverview, refreshControlCenterOverview } from "./modules/controlCenter/callables";
export { getControlCenterEngineering, importControlCenterEngineeringEvidence, assignControlCenterEngineeringTask } from "./modules/controlCenter/engineeringCallables";
export { listOperationalDocuments } from "./modules/canonicalCenter/documentDossier";
export { trackPaymentComplement, refreshComplementOnSolicitud, refreshComplementOnPago, listPaymentComplementFollowup, refreshPaymentComplementFollowup } from "./modules/paymentApplications/complementFollowup";
export { enqueueAutomaticPaymentComplement, executeAutomaticPaymentComplement, checkPaymentComplementsDaily, configurePaymentComplementAutomation, setComplementPaymentForm } from "./modules/paymentApplications/complementAutomation";
export { getHugoComplementInventoryPage } from "./modules/paymentApplications/complementInventory";
export { runHugoIqRepReadCanary } from "./modules/paymentApplications/complementCanary";
export { runHugoIqRepAttachmentExperiment } from "./modules/paymentApplications/repAttachmentExperiment";
export { runHugoIqRepDepositFieldProbe } from "./modules/paymentApplications/repDepositFieldProbe";
export { runHugoIqRepRequestCanary } from "./modules/paymentApplications/repRequestCanary";
export { runHugoIqRepReadCohort } from "./modules/paymentApplications/repReadCohort";
export { getControlCenterAnalytics, initializeControlCenterAnalytics, getControlCenterEvidence } from "./modules/controlCenter/analyticsCallables";
export { recognizeControlCenterExpense, reverseControlCenterExpense } from "./modules/expenses/callables";
export { queueOperationRecovery, reconcileOperationRecovery } from "./modules/controlCenter/recovery";
export { listOperationRecoveryReviews, acknowledgeOperationRecoveryReview } from "./modules/controlCenter/recoveryReviewCallables";
export { queueControlCenterApplications, queueControlCenterBalances, queueControlCenterMovements, queueControlCenterAdvances, queueControlCenterLearning, queueControlCenterRecovery, queueControlCenterExpenses } from "./modules/controlCenter/automation";
export { queueControlCenterIqInvoice, queueControlCenterIqCreate, queueControlCenterIqStatus, queueControlCenterIqReceipt, queueControlCenterIqDeposit, queueControlCenterWhatsapp, queueControlCenterTelegram } from "./modules/controlCenter/automation";
export {
  queueControlCenterSolicitud,
  queueControlCenterPago,
  queueControlCenterFacturama,
  queueControlCenterMateriality,
  queueControlCenterDispersion,
  queueControlCenterHugo,
  reconcileDirtyControlCenters,
} from "./modules/controlCenter/automation";
export { verifyTelegramMiniAppSession, getMatUserHome, getMatClientHome, getMatSolicitudDocuments } from "./modules/telegramMiniApp/callables";
export { getClientBalanceSummary, getClientStatement, getUserBalanceSummary, getUserStatement, getClientOperationalBalanceSummary, getClientWalletOverview, getUserWalletOverview, getClientWalletAccountsOverview, getClientWalletDetailOverview } from "./modules/ledger/callables";
export { ensureMaterialityClientCompany, linkSolicitudToMaterialityOperation, getMaterialityOperation, getMaterialityClientCompanyOverview, getMaterialityDashboard } from "./modules/materiality/callables";
export { refreshMaterialityFromUpload, refreshMaterialityFromPaymentApplication } from "./modules/materiality/triggers";
export { initEntityDocumentUpload, finalizeEntityDocumentUpload, listEntityDocuments, deactivateEntityDocument, reactivateEntityDocument } from "./modules/entityDocuments/callables";
export { getAuthorizedDocumentDownloadUrl } from "./modules/documents/authorizedDownload";
export { streamPrivateDocument } from "./modules/documents/documentDownloadHttp";
export { getAuthorizedOperationalRecord } from "./modules/documents/operationalReads";
export { listAuthorizedRelatedRecords } from "./modules/documents/relatedReads";
export {
  createIqCredentialProfile,
  updateIqCredentialProfile,
  listIqCredentialProfiles,
  deleteIqCredentialProfile,
  deactivateIqCredentialProfile,
  updateUserIqAccess,
  removeUserIqAccess,
  listUserIqAccess,
  getCurrentUserIqAccess,
  resolveAssignedIqCredentialForModule,
  testIqConnection,
} from "./modules/iq/callables";

// H4_D87_A57_A73_R1_LEGACY_SOLICITUD_PREVALIDATE_PREPARE_UNEXPORTED
export { createSolicitudIq } from "./modules/iq/solicitudCreationCallables";
export { reconcileSolicitudIq } from "./modules/iq/solicitudReconciliationCallables";
export {
  getIqOperatingCalendar,
  updateIqOperatingCalendar,
  setIqAutomationMasterEnabled,
} from "./modules/iq/operatingCalendarCallables";
export {
  enqueueSolicitudIqCreation,
  processIqCreateOnDemandTask,
  processIqCreateQueue,
} from "./modules/iq/solicitudCreateQueueCallables";
export {
  processSolicitudQuotationOnDemandTask,
  processSolicitudQuotationQueue,
  previewSolicitudesWithoutQuotation,
} from "./modules/cotizaciones/queueCallables";
export {
  syncIqSolicitudStatus,
// IQ2G_H4_D55A_INDEX_EXPORT_DISABLED processIqStatusMonitorQueue
} from "./modules/iq/solicitudStatusMonitorCallables";
export {
  syncIqSolicitudInvoice,
  enqueueExistingIqFolioInvoiceImports,
} from "./modules/iq/solicitudInvoiceImportCallables";
// H4_D67_A1_SOLICITUD_IQ_SCHEDULERS_REMOVED
export {
  debugFindPagoIqDepositCandidates,
  manualLinkPagoIqDeposit,
  manualLinkPagoIqDepositHttp,
  omitPagoIqDepositAutomation,
  omitPagoIqDepositAutomationHttp,
  reconcilePendingPagoIqDepositsNow,
  requestPagoIqSync,
  processIqPagoDepositOnDemandTask,
  // H4_D87_A58_PAGO_MANUAL_ON_DEMAND
  // La accion manual usa Cloud Task; la automatizacion usa schedulers.
} from "./modules/iq/pagoDepositCallables";
export { getIqAutomationDashboard } from "./modules/iq/automationDashboardCallables";
export { getIqDispersionDiagnostic } from "./modules/iq/dispersionDiagnosticCallables";
export { probeIqDispersionModule } from "./modules/iq/dispersionModuleProbeCallables";

// IQ2G_H4_D57B_EXPORT_OMIT_IQ_AUTOMATION_JOB
export { omitIqAutomationJob } from "./modules/iq/automationControlCallables";
export { precheckSimilarPay0Operation, confirmSimilarPay0OperationAsNew } from "./modules/iq/pay0SimilarOperationPrecheckCallables";
export { prepareDocumentDeliveryJob } from "./modules/documentDelivery/callables";

export {
  getWhatsAppQrDashboard,
  saveWhatsAppDeliveryRoute,
} from "./modules/documentDelivery/whatsappQrCallables";

export { releaseWhatsAppJobDeliveries, retryWhatsAppJobErrors, resolveWhatsAppUncertainDelivery } from "./modules/documentDelivery/whatsappReleaseCallables";
export { getWhatsAppAgentObservers, saveWhatsAppAgentObservers } from "./modules/documentDelivery/whatsappObserverCallables";
export { getWhatsAppAutomationConfig, setWhatsAppAutomationEnabled } from "./modules/documentDelivery/whatsappAutomationCallables";
export { processWhatsAppInvoiceAutomation } from "./modules/documentDelivery/whatsappAutomationTrigger";
export { releaseForwardOnlyDispersionReservationOnTerminal } from "./modules/dispatchBalances/forwardOnlyTriggers";
export {
  createClientDispersionIq,
  processIqDispersionCreate,
  resolveCommissionInstrumentIq,
} from "./modules/iq/dispersionCreationCallables";


// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL
export { processIqReconciliationQueue } from "./modules/iq/solicitudReconciliationCallables";
export {
  discoverIqWorkCandidates,
  processIqInvoiceImportQueue,
} from "./modules/iq/solicitudInvoiceImportCallables";
export { processIqStatusMonitorQueue } from "./modules/iq/solicitudStatusMonitorCallables";
export { checkIqCancellationReceiptsDaily } from "./modules/iq/cancellationReceiptImport";
export { syncIqBeneficiaryCatalog } from "./modules/beneficiaries/iqCatalogSync";
export { linkBeneficiaryMethodToIq } from "./modules/beneficiaries/iqLinkTrigger";
export { sendNewDispersionToIq } from "./modules/iq/dispersionCreateTrigger";
export { getClientWhatsAppGroups, assignWhatsAppGroupToClients } from "./modules/documentDelivery/clientWhatsappGroups";
export { redriveIqBeneficiaryLinks } from "./modules/beneficiaries/iqLinkRedrive";
export {
  processIqPagoDepositCreateQueue,
  dispatchQueuedPagoIqCreation,
  processIqPagoDepositAutomaticTask,
  processIqPagoDepositReconciliationQueue,
} from "./modules/iq/pagoDepositCallables";
// H4_D82_A3_A6_A3C_AUTOMATION_CONTROL_END


export { syncIqClientCallable } from "./modules/clients/iqLinkCallable";

export { parseClientCsfCallable, finalizeClientCsfIntakeCallable } from "./modules/clients/csfCallables";
export { parsePagoReceiptPdf, correctPagoReceiptSemanticField } from "./modules/pagos/receiptPdfCallables";
export {
  listCorporateResources, getCorporateResource, prepareCorporateResourceMigration,
  importCorporateResource, cloneCorporateTemplateBase, reviseCorporateTemplate, reviewCorporateResourceVersion, activateCorporateResourceVersion,
  restoreCorporateResourceVersion, retireCorporateResourceVersion, getCorporateResourceDownloadUrl,
  initCorporateResourceUpload, finalizeCorporateResourceUpload,
} from "./modules/canonicalCenter/service";
export { getFacturamaSandboxStatus, getFacturamaProductionStatus, saveFacturamaDraft, listFacturamaInvoices, importCompanyInvoiceCatalog, initGlobalSatCatalogUpload, finalizeGlobalSatCatalogImport } from "./modules/facturama/callables";
export { revalidateFacturamaFiscalDrafts } from "./modules/facturama/revalidationCallables";
export { saveFacturamaIssuerConfig, issueFacturamaSandboxInvoice, issueFacturamaProductionInvoice, reconcileFacturamaIssuedMetadata, cancelFacturamaProductionInvoice, refreshFacturamaProductionCancellationStatus, checkFacturamaCancellations, getFacturamaProductionCsdStatus, registerFacturamaProductionCsd } from "./modules/facturama/sandboxCallables";
export { getInvoicePaymentControl } from "./modules/facturama/invoicePaymentControl";
export { recordAgent007Observation, listAgent007Observations, listAgent007Recommendations, reconcileAgent007RecommendationsNow, resolveAgent007Recommendation, listAgent007Messages, markAgent007MessagesRead, sendAgent007Message, getHugoDashboard, listAgent007Traces, getAgent007Trace, listAgent007MemoryDiagnostics, createAgent007MemoryCandidate, reviewAgent007MemoryCandidate, linkAgent007VerifiedExperience, createAgent007LearningExperience, createAgent007LearningDraft, linkAgent007LearningOutcome, correctAgent007LearningExperience, listAgent007LearningDiagnostics, listAgent007LearningLineage, assignAgent007LearningSplit, supersedeAgent007LearningExperience, saveAgent007HumanReview, listAgent007HumanReviews, reviewAgent007LearningRule } from "./modules/agent007/callables";
export { createHugoRealtimeSession } from "./modules/agent007/realtimeVoice";
export { sendHugoTeamTurn, listHugoTeamTurns, delegateHugoTeamVoiceTurn } from "./modules/agent007/teamCallables";
export { authorizeHugoVoiceGatewaySession, delegateHugoVoiceTurn } from "./modules/agent007/voiceDelegation";
export { saveHugoVoiceHistory, getHugoVoiceSession, listHugoVoiceActivity } from "./modules/agent007/voiceHistory";
export { reconcileHugoOnSolicitudChange, reconcileHugoOnPagoChange } from "./modules/agent007/reconciliationMaintenance";
export { manageP4HistoricalIqImport } from "./modules/iqHistoricalImport/service";
export { purgeExpiredHugoTraces } from "./modules/agent007/traceStore";
export { getAgentOperations, setAgentKillSwitch, reviewAgentProposal, resolveAgentIncident, createAgentBlueprintDraft } from "./modules/agentOperations/callables";
export { sendAgentDailyStatusAlert } from "./modules/agentOperations/dailyAlert";
export { reviewAgentAutomationRule, processAgentAutomationRules } from "./modules/agentAutomation/callables";
export { getBusinessIndicators } from "./modules/businessIndicators/callables";
export { applyWarmCapacityWindow } from "./modules/warmCapacity/callables";
export { getPendingOperationsSummary } from "./modules/agentOperations/pendingItems";
export { detectMissingSolicitudQuotations } from "./modules/cotizaciones/missingQuoteDetector";
export { listAssetOverview, createAssetPosition, updateAssetPositionDetails, recordAssetMovement, closeAssetPosition, accrueAssetLoanInterest, previewAssetPaymentAllocation, linkPay0PaymentToAsset, createAssetDocumentDraft, initAssetDocumentUpload, finalizeAssetDocumentUpload, seedUproAssetPortfolio } from "./modules/assets/callables";

export { getMyRestrictionStatus } from "./modules/users/restrictionsCallables";
export { listClientDispersionNotes } from "./modules/financing/noteReads";
export { listPagoNotes } from "./modules/notes/pagoReads";
export { listSolicitudNotes } from "./modules/notes/solicitudReads";

export { createWhatsAppConnectorEnrollment, consumeWhatsAppConnectorEnrollment, getWhatsAppConnectorBinding, revokeWhatsAppConnectorBinding, operateWhatsAppConnector } from "./modules/documentDelivery/whatsappConnectorCallables";
export { listWhatsAppAgentConnectors } from "./modules/documentDelivery/whatsappConnectorCallables";
export { getWhatsAppAgentActivity, purgeExpiredWhatsAppInboundMessages } from "./modules/documentDelivery/whatsappAgentActivity";
export { listWhatsAppAgentChats } from "./modules/documentDelivery/whatsappAgentChats";
export { getUserOperatorNumbers, saveUserOperatorNumbers } from "./modules/operatorNumbers/callables";
