param([string]$Destination)
$ErrorActionPreference = 'Stop'
if (-not $Destination) { $Destination = Join-Path $PSScriptRoot 'prepared' }
$taskDestination = [IO.Path]::GetFullPath($Destination)
$taskManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'parts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Get-PayloadHash([string]$Path) {
    $taskHash = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($taskHash.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHash.Dispose() }
}
if (Test-Path -LiteralPath $taskDestination) { throw 'Destination already exists. Choose a new directory with -Destination.' }
foreach ($taskPart in $taskManifest.parts) {
    if ($taskPart.name -notmatch '^payload\.zip\.part[0-9]{3}$') { throw 'Invalid part name.' }
    $taskFile = Join-Path $PSScriptRoot $taskPart.name
    if ((Get-Item -LiteralPath $taskFile).Length -ne $taskPart.bytes -or (Get-PayloadHash $taskFile) -ne $taskPart.sha256) { throw "Part missing or corrupt: $($taskPart.name)" }
}
New-Item -ItemType Directory -Path $taskDestination | Out-Null
$taskZip = Join-Path $taskDestination $taskManifest.archive
$taskOutput = [IO.File]::Create($taskZip)
try {
    foreach ($taskPart in $taskManifest.parts) {
        $taskInput = [IO.File]::OpenRead((Join-Path $PSScriptRoot $taskPart.name))
        try { $taskInput.CopyTo($taskOutput) } finally { $taskInput.Dispose() }
    }
} finally { $taskOutput.Dispose() }
if ((Get-Item -LiteralPath $taskZip).Length -ne $taskManifest.bytes -or (Get-PayloadHash $taskZip) -ne $taskManifest.sha256) { throw 'Reassembled archive checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskInstall = Join-Path $taskDestination 'install'
[IO.Compression.ZipFile]::ExtractToDirectory($taskZip,$taskInstall)
Write-Output "Verified and extracted: $taskInstall"
Write-Output "Follow $taskInstall/README.md to install or update."
