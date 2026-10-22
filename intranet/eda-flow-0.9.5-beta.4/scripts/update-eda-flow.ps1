param(
    [string]$McpPython,
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DshCommand = (Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),
    [string]$Registry
)
$ErrorActionPreference = 'Stop'
if ($McpPython -and -not (Test-Path -LiteralPath $McpPython -PathType Leaf)) { throw 'McpPython must point to the isolated environment executable.' }
function Get-BundleHash([string]$File) {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($File)
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
}
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPackage = Join-Path $taskRepo 'plugin/dsh-eda-flow-0.9.5-beta.4.tgz'
$taskHashes = Get-Content -LiteralPath (Join-Path $taskRepo 'plugin/SHA256SUMS.txt') -Encoding UTF8
$taskLine = $taskHashes | Where-Object { $_ -match '^([a-f0-9]{64})\s+dsh-eda-flow-0\.9\.5-beta\.4\.tgz$' } | Select-Object -First 1
if (-not $taskLine) { throw 'Package checksum record is missing.' }
$taskExpected = ($taskLine -split '\s+')[0]
if ((Get-BundleHash $taskPackage) -ne $taskExpected) { throw 'Plugin checksum mismatch.' }
$taskProfile = Join-Path $DshHomePath "profiles/$Profile"
$taskManifest = Get-Content -LiteralPath (Join-Path $taskProfile 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $taskManifest.dependencies.'dsh-eda-flow') { throw 'This command updates an existing EDA Flow installation. Choose the profile where circuit design is already installed.' }
$taskInstalled = Join-Path $taskProfile 'node_modules/dsh-eda-flow'
$taskModules = Get-Content -LiteralPath (Join-Path $taskProfile 'node_modules/.modules.yaml') -Raw -Encoding UTF8
if ($taskModules.TrimStart().StartsWith('{')) { $taskStore = ($taskModules | ConvertFrom-Json).storeDir }
else {
    $taskMatch = [regex]::Match($taskModules, '(?m)^storeDir:\s*(.+?)\s*$')
    if ($taskMatch.Success) { $taskStore = $taskMatch.Groups[1].Value.Trim().Trim("'").Trim('"') }
}
if (-not $taskStore) { throw 'Cannot locate the existing pnpm store; no install was attempted.' }
if ([IO.Path]::GetFileName($taskStore) -match '^v\d+$') { $taskStore = Split-Path -Parent $taskStore }
$taskBackup = Join-Path $DshHomePath ('plugin-upgrade-backups/eda-flow-0.9.5-beta.4-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
foreach ($taskName in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
    $taskFile = Join-Path $taskProfile $taskName
    if (Test-Path -LiteralPath $taskFile) { Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskBackup $taskName) }
}
Copy-Item -LiteralPath $taskInstalled -Destination (Join-Path $taskBackup 'plugin') -Recurse
$taskCache = Join-Path $DshHomePath 'plugin-cache'
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
$taskCached = Join-Path $taskCache ('dsh-eda-flow-0.9.5-beta.4-' + $taskExpected.Substring(0,16) + '.tgz')
Copy-Item -LiteralPath $taskPackage -Destination $taskCached -Force
$taskOldHome = $env:DSH_HOME
try {
    $env:DSH_HOME = $DshHomePath
    $taskArgs = @('plugin','--profile',$Profile,'add',$taskCached,'--ignore-scripts','--store-dir',$taskStore)
    if ($Registry) { $taskArgs += @('--registry',$Registry) } else { $taskArgs += '--offline' }
    & $DshCommand @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Upgrade failed. Original profile backup: $taskBackup" }
} finally {
    $env:DSH_HOME = $taskOldHome
    $taskSavedPatch = Join-Path $taskBackup 'cordis.patch.yml'
    if (Test-Path -LiteralPath $taskSavedPatch) { Copy-Item -LiteralPath $taskSavedPatch -Destination (Join-Path $taskProfile 'cordis.patch.yml') -Force }
}
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskInstalled 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($taskVersion -ne '0.9.5-beta.4') { throw "Installed version is $taskVersion, expected 0.9.5-beta.4. Backup: $taskBackup" }
if ($McpPython) {
    $taskPatchFile = Join-Path $taskProfile 'cordis.patch.yml'
    $taskPatch = [IO.File]::ReadAllText($taskPatchFile)
    $taskClean = [regex]::Replace($taskPatch, '(?m)^\s*#.*(?:\r?\n|$)', '').Trim()
    if ($taskClean.StartsWith('[')) {
        $taskEntries = [Collections.Generic.List[object]]::new()
        foreach ($taskEntry in (ConvertFrom-Json -InputObject $taskClean)) { $taskEntries.Add($taskEntry) }
        $taskEntries.Add(@{id='eda-flow';config=@{mcpPython=$McpPython.Replace('\','/')}})
        $taskPatch = ConvertTo-Json -InputObject $taskEntries.ToArray() -Depth 100
    } else {
        if ($taskPatch -match '(?m)^\.\.\.\s*$') { throw 'Closed YAML document: set mcpPython in Harness settings to the isolated interpreter.' }
        $taskValue = $McpPython.Replace('\','/').Replace("'","''")
        $taskPatch = $taskPatch.TrimEnd() + "`n- id: eda-flow`n  config:`n    mcpPython: '$taskValue'`n"
    }
    [IO.File]::WriteAllText($taskPatchFile,$taskPatch,[Text.UTF8Encoding]::new($false))
}
Write-Output "Installed EDA Flow $taskVersion into profile $Profile. Existing project paths, runtime, model and login configuration preserved."
Write-Output "Backup: $taskBackup"
Write-Output 'Reload the circuit-design plugin or restart Harness when convenient. Harness was not stopped.'
& (Join-Path $PSScriptRoot 'check-eda-flow.ps1') -Profile $Profile -DshHomePath $DshHomePath
