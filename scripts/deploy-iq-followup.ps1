param([ValidateSet('Backend', 'Hosting', 'Indexes')][string]$Phase = 'Backend')
$ErrorActionPreference = 'Stop'
$env:DEBUG = ''
if ($Phase -eq 'Indexes') {
  # Non-interactive default is NO deletion. Never add --force to this phase.
  npx --yes --package=node@22 -- firebase deploy --project pay-0-system --config .firebase.iq-followup-indexes.json --only firestore:indexes --non-interactive
} elseif ($Phase -eq 'Hosting') {
  npx --yes --package=node@22 -- firebase deploy --project pay-0-system --only hosting --non-interactive
} else {
  $iqFollowupTargets = @(
    'createClientBeneficiary','addClientBeneficiaryMethod','toggleClientBeneficiaryActive','toggleClientBeneficiaryMethodActive','updateClientBeneficiary',
    'createClientDispersionIq','processIqDispersionCreate',
    'trackPaymentComplement','refreshComplementOnSolicitud','refreshComplementOnPago','listPaymentComplementFollowup','refreshPaymentComplementFollowup',
    'listAgent007Messages','markAgent007MessagesRead','sendAgent007Message',
    'createClientDispersion','createClientDispersionsMassive','requestClientDispersionIncident','resolveClientDispersionIncident',
    'applyPagoToSolicitud','applyPagoToSolicitudesAtomic'
  )
  $iqFollowupOnly = ($iqFollowupTargets | ForEach-Object { 'functions:' + $_ }) -join ','
  # Explicit function allowlist; --force acknowledges retry policies, not rules.
  npx --yes --package=node@22 -- firebase deploy --project pay-0-system --only $iqFollowupOnly --non-interactive --force
}
if ($LASTEXITCODE -ne 0) { throw "Deploy $Phase failed ($LASTEXITCODE)." }
