# Download and verify the newest successful Love Book restore point from the production server.

[CmdletBinding()]
param(
    [string]$SshAlias = "ts3_qrqto",
    [string]$RemoteRoot = "/home/ts3/backups/love_book",
    [string]$LocalRoot = "C:\Backups\love_book",
    [ValidateRange(1, 100)]
    [int]$Keep = 4,
    [ValidateRange(1, 365)]
    [int]$MaximumAgeDays = 8
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-NativeChecked {
    param(
        [Parameter(Mandatory)]
        [string]$Command,
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
$resolvedRoot = (Resolve-Path -LiteralPath $LocalRoot).Path
$currentIdentity = (& whoami).Trim()
Invoke-NativeChecked -Command "icacls.exe" -Arguments @(
    $resolvedRoot,
    "/inheritance:r",
    "/grant:r",
    "${currentIdentity}:(OI)(CI)F"
)

$remoteQuery = "find '$RemoteRoot' -mindepth 2 -maxdepth 2 -type f -name SUCCESS -printf '%T@|%h\n' | sort -nr | head -n 1"
$latest = (& ssh $SshAlias $remoteQuery)
if ($LASTEXITCODE -ne 0) {
    throw "Could not query backups from $SshAlias"
}
$latest = ($latest | Select-Object -First 1).Trim()
if (-not $latest -or -not $latest.Contains("|")) {
    throw "No successful restore point exists under $RemoteRoot"
}

$remoteDirectory = $latest.Split("|", 2)[1]
$restorePoint = Split-Path -Leaf $remoteDirectory
if ($restorePoint -notmatch "^(?<stamp>\d{8}T\d{6}Z)_(weekly|pre-release|emergency)$") {
    throw "Unexpected restore-point name: $restorePoint"
}

$createdAt = [DateTime]::ParseExact(
    $Matches.stamp,
    "yyyyMMdd'T'HHmmss'Z'",
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
)
$age = [DateTime]::UtcNow - $createdAt
if ($age.TotalDays -gt $MaximumAgeDays) {
    throw "Newest successful backup is $([Math]::Floor($age.TotalDays)) days old; maximum allowed is $MaximumAgeDays"
}

$finalDirectory = Join-Path $resolvedRoot $restorePoint
$partialDirectory = "${finalDirectory}.partial"
if (Test-Path -LiteralPath $partialDirectory) {
    Remove-Item -LiteralPath $partialDirectory -Recurse -Force
}

if (-not (Test-Path -LiteralPath $finalDirectory)) {
    Invoke-NativeChecked -Command "scp" -Arguments @(
        "-r",
        "${SshAlias}:${remoteDirectory}",
        $partialDirectory
    )
    Rename-Item -LiteralPath $partialDirectory -NewName $restorePoint
}

$manifestPath = Join-Path $finalDirectory "manifest.sha256"
$successPath = Join-Path $finalDirectory "SUCCESS"
if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $successPath)) {
    throw "Downloaded restore point is incomplete: $finalDirectory"
}

foreach ($line in Get-Content -LiteralPath $manifestPath) {
    if ($line -notmatch "^(?<hash>[0-9a-fA-F]{64})\s{2}(?<file>.+)$") {
        throw "Invalid manifest line: $line"
    }
    $artifactPath = Join-Path $finalDirectory $Matches.file
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        throw "Manifest artifact is missing: $($Matches.file)"
    }
    $actualHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash
    if ($actualHash -ne $Matches.hash) {
        throw "SHA-256 mismatch for $($Matches.file)"
    }
}

$successfulDirectories = Get-ChildItem -LiteralPath $resolvedRoot -Directory |
    Where-Object {
        $_.Name -match "^\d{8}T\d{6}Z_(weekly|pre-release|emergency)$" -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "SUCCESS"))
    } |
    Sort-Object Name -Descending

$successfulDirectories |
    Select-Object -Skip $Keep |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

Write-Host "Backup verified: $finalDirectory"
