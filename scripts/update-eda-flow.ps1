param(
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DshCommand = (Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),
    [string]$Registry,
    [string]$PackageVersion = '0.4.0',
    [switch]$DisableModelCalls
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
if ($PackageVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version.' }
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPackageName = "dsh-eda-flow-$PackageVersion.tgz"
$taskPackage = Join-Path $taskRepo "dist/$taskPackageName"
$taskHashes = Get-Content -LiteralPath (Join-Path $taskRepo 'dist/SHA256SUMS.txt') -Encoding UTF8
$taskChecksumPattern = '^([a-f0-9]{64})\s+' + [regex]::Escape($taskPackageName) + '$'
$taskLine = $taskHashes | Where-Object { $_ -match $taskChecksumPattern } | Select-Object -First 1
if (-not $taskLine) { throw 'Package checksum record is missing.' }
$taskExpected = ($taskLine -split '\s+')[0]
if ((Get-FileHash -LiteralPath $taskPackage -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected) { throw 'Plugin checksum mismatch.' }
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
$taskPatchPath = Join-Path $taskProfile 'cordis.patch.yml'
$taskOriginalPatch = [IO.File]::ReadAllText($taskPatchPath)
$taskTargetPatch = $taskOriginalPatch
if ($DisableModelCalls) {
    # Change only this plugin's scalar; retain other plugin/provider/login text exactly.
    $taskMatches = [regex]::Matches($taskOriginalPatch, '(?ms)^-\s+id:\s*[''"]?eda-flow[''"]?\s*\r?\n(?<body>.*?)(?=^-\s|\z)')
    if ($taskMatches.Count -ne 1) { throw 'Expected one YAML eda-flow entry. No installation attempted; configure the model-call guard explicitly for this profile format.' }
    $taskMatch = $taskMatches[0]
    $taskBlock = $taskMatch.Value
    $taskFlags = [regex]::Matches($taskBlock, '(?m)^(?<prefix>\s+allowModelCalls:\s*)(?:true|false)(?<suffix>[^\r\n]*)(?<cr>\r?)$')
    if ($taskFlags.Count -ne 1) { throw 'Expected one existing model-call flag. No installation attempted.' }
    $taskDisabledBlock = [regex]::Replace($taskBlock, '(?m)^(?<prefix>\s+allowModelCalls:\s*)(?:true|false)(?<suffix>[^\r\n]*)(?<cr>\r?)$', '${prefix}false${suffix}${cr}')
    $taskTargetPatch = $taskOriginalPatch.Substring(0,$taskMatch.Index) + $taskDisabledBlock + $taskOriginalPatch.Substring($taskMatch.Index + $taskMatch.Length)
}
$taskBackup = Join-Path $DshHomePath ("plugin-upgrade-backups/eda-flow-$PackageVersion-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
foreach ($taskName in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
    $taskFile = Join-Path $taskProfile $taskName
    if (Test-Path -LiteralPath $taskFile) { Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskBackup $taskName) }
}
Copy-Item -LiteralPath $taskInstalled -Destination (Join-Path $taskBackup 'plugin') -Recurse
$taskCache = Join-Path $DshHomePath 'plugin-cache'
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
$taskCached = Join-Path $taskCache ("dsh-eda-flow-$PackageVersion-" + $taskExpected.Substring(0,16) + '.tgz')
Copy-Item -LiteralPath $taskPackage -Destination $taskCached -Force
# Disable generation before plugin-manager activity can reload the backend.
if ($DisableModelCalls) { [IO.File]::WriteAllText($taskPatchPath, $taskTargetPatch, [Text.UTF8Encoding]::new($false)) }
$taskOldHome = $env:DSH_HOME
try {
    $env:DSH_HOME = $DshHomePath
    $taskArgs = @('plugin','--profile',$Profile,'add',$taskCached,'--ignore-scripts','--store-dir',$taskStore)
    if ($Registry) { $taskArgs += @('--registry',$Registry) } else { $taskArgs += '--offline' }
    & $DshCommand @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Upgrade failed. Original profile backup: $taskBackup" }
} finally {
    $env:DSH_HOME = $taskOldHome
    [IO.File]::WriteAllText($taskPatchPath, $taskTargetPatch, [Text.UTF8Encoding]::new($false))
}
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskInstalled 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($taskVersion -ne $PackageVersion) { throw "Installed version is $taskVersion, expected $PackageVersion. Backup: $taskBackup" }
if ([IO.File]::ReadAllText($taskPatchPath) -cne $taskTargetPatch) { throw 'Configuration changed unexpectedly during installation.' }
if ($DisableModelCalls) { Write-Output 'EDA model calls are disabled. Provider and login configuration are preserved.' }
Write-Output "Installed EDA Flow $taskVersion into profile $Profile. Existing project paths, runtime, model and login configuration preserved."
Write-Output "Backup: $taskBackup"
Write-Output 'Reload the circuit-design plugin or restart Harness when convenient. Harness was not stopped.'
& (Join-Path $PSScriptRoot 'check-eda-flow.ps1') -Profile $Profile -DshHomePath $DshHomePath
