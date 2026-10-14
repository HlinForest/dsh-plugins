param([string]$ArchivePath)
$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskParts = Join-Path $taskRepo 'output/runtime/electron-44.7.2-win32-x64'
$taskManifest = Get-Content -LiteralPath (Join-Path $taskParts 'manifest.json') -Raw | ConvertFrom-Json
if (-not $ArchivePath) { $ArchivePath = Join-Path $taskRepo ('downloads/' + $taskManifest.archive) }
$taskArchive = [IO.Path]::GetFullPath($ArchivePath)
function Check-Archive([string]$File) {
    return (Test-Path -LiteralPath $File -PathType Leaf) -and
        (Get-Item -LiteralPath $File).Length -eq $taskManifest.size -and
        (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -eq $taskManifest.sha256
}
if (Test-Path -LiteralPath $taskArchive) {
    if (Check-Archive $taskArchive) { Write-Output $taskArchive; return }
    throw 'An existing archive has a different checksum. Choose another ArchivePath; it was not overwritten.'
}
$taskInputs = @()
foreach ($taskPart in $taskManifest.parts) {
    $taskFile = [IO.Path]::GetFullPath((Join-Path $taskParts $taskPart.file))
    if (-not $taskFile.StartsWith($taskParts + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid part path.' }
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Missing part: $($taskPart.file). Pull all repository files first." }
    if ((Get-Item -LiteralPath $taskFile).Length -ne $taskPart.size -or
        (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPart.sha256) { throw "Part checksum mismatch: $($taskPart.file)" }
    $taskInputs += $taskFile
}
$taskParent = Split-Path -Parent $taskArchive
New-Item -ItemType Directory -Force -Path $taskParent | Out-Null
$taskPartial = Join-Path $taskParent ([IO.Path]::GetFileName($taskArchive) + '.' + [guid]::NewGuid().ToString('N') + '.partial')
try {
    $taskOutput = [IO.File]::Open($taskPartial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        foreach ($taskFile in $taskInputs) {
            $taskInput = [IO.File]::OpenRead($taskFile)
            try { $taskInput.CopyTo($taskOutput) } finally { $taskInput.Dispose() }
        }
    } finally { $taskOutput.Dispose() }
    if (-not (Check-Archive $taskPartial)) { throw 'Assembled runtime checksum mismatch.' }
    Move-Item -LiteralPath $taskPartial -Destination $taskArchive
} finally { if (Test-Path -LiteralPath $taskPartial) { Remove-Item -LiteralPath $taskPartial } }
Write-Output $taskArchive
