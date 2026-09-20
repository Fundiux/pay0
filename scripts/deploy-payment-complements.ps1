param([ValidateSet('Backend','Hosting')][string]$Phase='Backend')
$ErrorActionPreference='Stop'
$env:DEBUG=''
$env:FUNCTIONS_DISCOVERY_TIMEOUT='60'
if ($Phase -eq 'Hosting') {
  npx --yes --package=node@22 -- firebase deploy --project pay-0-system --only hosting --non-interactive
} else {
  $repFunctions=@('createPago','enqueueAutomaticPaymentComplement','executeAutomaticPaymentComplement','checkPaymentComplementsDaily','configurePaymentComplementAutomation','setComplementPaymentForm','trackPaymentComplement','refreshComplementOnSolicitud','refreshComplementOnPago','listPaymentComplementFollowup','refreshPaymentComplementFollowup','sendAgent007Message')
  $repOnly=($repFunctions | ForEach-Object {'functions:'+$_}) -join ','
  npx --yes --package=node@22 -- firebase deploy --project pay-0-system --only $repOnly --non-interactive --force
}
if ($LASTEXITCODE -ne 0) { throw 'Complement deployment failed.' }
