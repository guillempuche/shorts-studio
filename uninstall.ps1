<#
.SYNOPSIS
    Removes the shorts-studio binary that install.ps1 put in place. Your posts, settings and spend
    ledger are left where they are (`shorts-studio config show` prints the folders).
.EXAMPLE
    irm https://raw.githubusercontent.com/guillempuche/shorts-studio/main/uninstall.ps1 | iex
#>
$ErrorActionPreference = "Stop"

$InstallDir = if ($env:SHORTS_INSTALL_DIR) { $env:SHORTS_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\shorts-studio" }
$Target = "$InstallDir\shorts-studio.exe"
if (Test-Path $Target) {
    Remove-Item -Force $Target
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    [Environment]::SetEnvironmentVariable("Path", (($UserPath -split ';') | Where-Object { $_ -and $_ -ne $InstallDir }) -join ';', "User")
    Write-Host "Removed $Target. Your posts and settings were left in place."
} else {
    Write-Host "No shorts-studio at $Target (set SHORTS_INSTALL_DIR if you installed it elsewhere)."
}
