param([ValidateSet('Core', 'Links', 'Hosting')][string]$Phase = 'Core')
$ErrorActionPreference = 'Stop'
$env:DEBUG = ''
if ($Phase -eq 'Core') {
  $ccTargets = @(
    'getControlCenterOverview','refreshControlCenterOverview','getControlCenterAnalytics',
    'initializeControlCenterAnalytics','getControlCenterEvidence','recognizeControlCenterExpense',
    'reverseControlCenterExpense','queueOperationRecovery','reconcileOperationRecovery',
    'queueControlCenterSolicitud','queueControlCenterPago','queueControlCenterFacturama',
    'queueControlCenterMateriality','queueControlCenterDispersion','queueControlCenterHugo',
    'queueControlCenterApplications','queueControlCenterBalances','queueControlCenterMovements',
    'queueControlCenterAdvances','queueControlCenterLearning','queueControlCenterRecovery',
    'queueControlCenterExpenses','queueControlCenterIqInvoice','queueControlCenterIqCreate',
    'queueControlCenterIqStatus','queueControlCenterIqReceipt','queueControlCenterIqDeposit',
    'queueControlCenterWhatsapp','queueControlCenterTelegram','reconcileDirtyControlCenters'
  )
} elseif ($Phase -eq 'Links') {
  $ccTargets = @(
    'issueFacturamaProductionInvoice','issueFacturamaSandboxInvoice','linkSolicitudToMaterialityOperation',
    'createSolicitud','finalizeSolicitudDocumentUpload','deactivateSolicitudDocument',
    'reprocessActiveSolicitudOc','generateSolicitudQuotation','submitSolicitudSignature',
    'resolveAgent007Recommendation'
  )
}
if ($Phase -eq 'Hosting') { $ccOnly = 'hosting' }
else { $ccOnly = ($ccTargets | ForEach-Object { 'functions:' + $_ }) -join ',' }
# --force acknowledges retry policies on this explicit allowlist. No rules,
# index deployment, financial mutation or external message is invoked here.
npx --yes --package=node@22 -- firebase deploy --project pay-0-system --only $ccOnly --non-interactive --force
if ($LASTEXITCODE -ne 0) { throw "Deploy $Phase failed ($LASTEXITCODE)." }
