<#
.SYNOPSIS
    Downloads the shorts-studio binary for Windows from GitHub Releases, checks its SHA-256 and
    installs it.
.EXAMPLE
    irm https://raw.githubusercontent.com/guillempuche/shorts-studio/main/install.ps1 | iex
.NOTES
    $env:SHORTS_VERSION      a release tag to install, e.g. v0.2.0 (default: the latest)
    $env:SHORTS_INSTALL_DIR  where to put the binary (default: %LOCALAPPDATA%\Programs\shorts-studio)
    Adapted from github.com/guillempuche/text-to-speech's installer.
#>
$ErrorActionPreference = "Stop"

$Repo = "guillempuche/shorts-studio"
$Asset = "shorts-studio-windows-x64.exe"
$InstallDir = if ($env:SHORTS_INSTALL_DIR) { $env:SHORTS_INSTALL_DIR } else { "$env:LOCALAPPDATA\Programs\shorts-studio" }

$Version = $env:SHORTS_VERSION
if (-not $Version) {
    $Version = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing).tag_name
}
Write-Host "Installing shorts-studio $Version" -ForegroundColor Green

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
    $Base = "https://github.com/$Repo/releases/download/$Version"
    Invoke-WebRequest -Uri "$Base/$Asset" -OutFile "$Tmp\$Asset" -UseBasicParsing
    Invoke-WebRequest -Uri "$Base/checksums.txt" -OutFile "$Tmp\checksums.txt" -UseBasicParsing

    $Line = Select-String -Path "$Tmp\checksums.txt" -Pattern " $([regex]::Escape($Asset))$"
    if (-not $Line) { throw "checksums.txt has no entry for $Asset." }
    $Expected = ($Line.Line -split ' ')[0].ToLower()
    $Actual = (Get-FileHash -Path "$Tmp\$Asset" -Algorithm SHA256).Hash.ToLower()
    if ($Actual -ne $Expected) { throw "Checksum mismatch for ${Asset}: the download is corrupt or was tampered with." }
    Write-Host "Checksum verified" -ForegroundColor Green

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Move-Item -Force "$Tmp\$Asset" "$InstallDir\shorts-studio.exe"
    Write-Host "Installed $InstallDir\shorts-studio.exe" -ForegroundColor Green

    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
        Write-Host "Added $InstallDir to your PATH; open a new terminal to use it." -ForegroundColor Yellow
    }
    Write-Host "Next: shorts-studio doctor   (it checks ffmpeg, which needs libass for captions, and your API keys)"
} finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
