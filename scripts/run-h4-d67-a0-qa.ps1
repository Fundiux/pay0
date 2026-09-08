$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

node "qa\scripts\h4-d67-a0.mjs"