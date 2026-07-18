# Creates a Desktop shortcut to the built Lectorium release executable, so
# you get a one-click launch icon you can pin to Start / the taskbar.
#
# Run after `pnpm tauri build` (which produces target/release/lectorium.exe):
#   powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1
#
# For a fully installed Start Menu entry instead, run the NSIS installer at
# src-tauri/target/release/bundle/nsis/Lectorium_<version>_x64-setup.exe.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repo "src-tauri\target\release\lectorium.exe"

if (-not (Test-Path $exe)) {
    Write-Host "Release executable not found at:`n  $exe" -ForegroundColor Yellow
    Write-Host "Build it first:  pnpm tauri build"
    exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "Lectorium.lnk"

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnkPath)
$sc.TargetPath = $exe
$sc.WorkingDirectory = Split-Path -Parent $exe
$sc.IconLocation = "$exe,0"
$sc.Description = "Lectorium - a quiet room for books"
$sc.Save()

Write-Host "Created shortcut:`n  $lnkPath" -ForegroundColor Green
Write-Host "Double-click it to launch, then right-click, Pin to Start (or Pin to taskbar)."
