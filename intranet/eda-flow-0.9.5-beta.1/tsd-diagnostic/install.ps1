param(
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh')
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
function Get-ContentHash([string]$Path) {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
}
$taskPlugin = Join-Path $DshHomePath "profiles/$Profile/node_modules/dsh-eda-flow"
$taskPackage = Get-Content -LiteralPath (Join-Path $taskPlugin 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($taskPackage.version -ne '0.9.5-beta.1') { throw 'This diagnostic patch targets EDA Flow 0.9.5-beta.1 only.' }
$taskTarget = Join-Path $taskPlugin 'src/io.js'
$taskSource = Join-Path $PSScriptRoot 'io.js'
$taskBefore = '27edbda3b996cac7df52b961684c35511a64b5bbc925025dd269d140290c9096'
$taskAfter = 'c7130e91e93502810e3e6e61d2d7f4852e20312f3d6c7e60edc058d977109513'
if ((Get-ContentHash $taskSource) -ne $taskAfter) { throw 'Diagnostic patch checksum mismatch.' }
$taskCurrent = Get-ContentHash $taskTarget
if ($taskCurrent -eq $taskAfter) { Write-Output 'Diagnostic patch is already installed.'; exit 0 }
if ($taskCurrent -ne $taskBefore) { throw 'Installed io.js differs from the published package. Nothing was changed.' }
$taskBackup = Join-Path $DshHomePath ('plugin-upgrade-backups/eda-tsd-json-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
Copy-Item -LiteralPath $taskTarget -Destination (Join-Path $taskBackup 'io.js')
Copy-Item -LiteralPath $taskSource -Destination $taskTarget -Force
if ((Get-ContentHash $taskTarget) -ne $taskAfter) { throw "Patch verification failed. Backup: $taskBackup" }
Write-Output 'Installed TSD JSON diagnostic patch. Exit and reopen the entire Harness application, then retry creating the display demo.'
Write-Output 'The next error will identify the affected JSON file and the actual reader executable. No protected project files or model settings were changed.'
Write-Output "Backup: $taskBackup"
