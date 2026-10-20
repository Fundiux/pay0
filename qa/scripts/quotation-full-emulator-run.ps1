$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$config = Join-Path ([IO.Path]::GetTempPath()) ('pay0-quotation-' + [guid]::NewGuid().ToString('N') + '.json')
$oldConfig = $env:XDG_CONFIG_HOME; $oldProject = $env:GCLOUD_PROJECT; $oldFirebase = $env:FIREBASE_PROJECT
$oldChrome = $env:PAY0_CHROMIUM_PATH; $oldMode = $env:SMOKE_SIGNATURE_MODE
$env:XDG_CONFIG_HOME = $config + '-cli'; $env:GCLOUD_PROJECT = 'demo-pay0-quotation'; $env:FIREBASE_PROJECT = 'demo-pay0-quotation'
$env:PAY0_CHROMIUM_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'; $env:SMOKE_SIGNATURE_MODE = 'core'
$settings = @{ firestore=@{rules=(Join-Path $root 'firestore.rules'); indexes=(Join-Path $root 'firestore.indexes.json')}; storage=@{rules=(Join-Path $root 'storage.rules')}; emulators=@{ firestore=@{host='127.0.0.1';port=18087}; storage=@{host='127.0.0.1';port=19197}; ui=@{enabled=$false}; hub=@{host='127.0.0.1';port=14407}; logging=@{host='127.0.0.1';port=14507}; singleProjectMode=$true } }
[IO.File]::WriteAllText($config, ($settings | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Push-Location $root
try { & firebase.cmd emulators:exec --project demo-pay0-quotation --config $config --only firestore,storage 'node qa/scripts/materiality-oc-automatic-smoke.mjs'; if($LASTEXITCODE -ne 0){throw "Quotation smoke failed: $LASTEXITCODE"} } finally { Pop-Location; $env:XDG_CONFIG_HOME=$oldConfig; $env:GCLOUD_PROJECT=$oldProject; $env:FIREBASE_PROJECT=$oldFirebase; $env:PAY0_CHROMIUM_PATH=$oldChrome; $env:SMOKE_SIGNATURE_MODE=$oldMode; Remove-Item -LiteralPath $config -Force -ErrorAction SilentlyContinue }
