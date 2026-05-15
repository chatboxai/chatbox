# Chatbox deploy script
# Build dev version and deploy to local install directory F:\Chatbox
# User data is stored in %APPDATA%\xyz.chatboxapp.app, not affected
#
# Usage:
#   .\deploy-to-local.ps1
#   or: pnpm run deploy:local
#
# IMPORTANT: This script copies dist/ ONLY.
# It does NOT overwrite package.json (to preserve the app name
# and user data directory).

param(
    [string]$TargetDir = "F:\Chatbox"
)

$ProjectDir = "D:\ClaudeCode text\chatbox"
$AppDir = "$ProjectDir\release\app"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Chatbox Deploy" -ForegroundColor Cyan
Write-Host "  Target: $TargetDir" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build
Write-Host "[1/2] Building..." -ForegroundColor Yellow
Set-Location $ProjectDir
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "Build OK!" -ForegroundColor Green
Write-Host ""

# Step 2: Copy dist only (DO NOT overwrite package.json)
Write-Host "[2/2] Copying dist to $TargetDir\resources\app..." -ForegroundColor Yellow
if (-not (Test-Path "$TargetDir\resources\app")) {
    Write-Host "ERROR: $TargetDir\resources\app not found!" -ForegroundColor Red
    exit 1
}

if (Test-Path "$TargetDir\resources\app\dist") {
    Remove-Item -Recurse -Force "$TargetDir\resources\app\dist"
}

Copy-Item -Recurse "$AppDir\dist" "$TargetDir\resources\app\dist"
Write-Host "dist copied!" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Restart Chatbox to load the new version." -ForegroundColor Yellow
Write-Host "User data is in %APPDATA%\xyz.chatboxapp.app, safe." -ForegroundColor Yellow
