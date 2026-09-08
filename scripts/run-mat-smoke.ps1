param(
  [switch]$Headed
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$packagePath = Join-Path $root "package.json"
$packageRaw = Get-Content -LiteralPath $packagePath -Raw
$package = $packageRaw | ConvertFrom-Json

$hasPlaywright = $false
if ($package.devDependencies -and $package.devDependencies.PSObject.Properties.Name -contains "@playwright/test") {
  $hasPlaywright = $true
}
if ($package.dependencies -and $package.dependencies.PSObject.Properties.Name -contains "@playwright/test") {
  $hasPlaywright = $true
}

if (-not $hasPlaywright) {
  Write-Host "Instalando @playwright/test..."
  & npm.cmd install -D @playwright/test
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo instalar @playwright/test."
  }
}

$playwrightCmd = Join-Path $root "node_modules\.bin\playwright.cmd"

if (!(Test-Path -LiteralPath $playwrightCmd)) {
  throw "No existe Playwright local: $playwrightCmd"
}

Write-Host "Validando Chromium de Playwright..."
& $playwrightCmd install chromium
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo validar Chromium para Playwright."
}

$baseUrl = "http://localhost:3000"
$env:MAT_BASE_URL = $baseUrl

$startedDev = $false
$dev = $null

function Test-LocalServer {
  try {
    $res = Invoke-WebRequest -Uri "$baseUrl/mat/usuarios" -UseBasicParsing -TimeoutSec 3
    return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500)
  } catch {
    return $false
  }
}

if (Test-LocalServer) {
  Write-Host "Servidor local ya activo. Reusando $baseUrl."
} else {
  Write-Host "Iniciando servidor local..."
  $dev = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" -PassThru -WindowStyle Hidden
  $startedDev = $true

  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if (Test-LocalServer) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "El servidor local no respondio en $baseUrl."
  }
}

try {
  Write-Host "Servidor listo. Ejecutando pruebas MAT..."

  if ($Headed) {
    & $playwrightCmd test --config=playwright.mat.config.ts --headed
  } else {
    & $playwrightCmd test --config=playwright.mat.config.ts
  }

  if ($LASTEXITCODE -ne 0) {
    throw "MAT smoke fallo."
  }

  Write-Host "MAT smoke OK."
}
finally {
  if ($startedDev -and $dev -and !$dev.HasExited) {
    taskkill /PID $dev.Id /T /F | Out-Null
  }
}