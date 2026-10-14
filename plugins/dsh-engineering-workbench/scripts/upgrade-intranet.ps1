param(
    [Parameter(Mandatory=$true)][string]$PackagePath,
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [string]$RuntimeSource,
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DshCommand = (Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),
    [string]$Registry,
    [string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$taskSource = (Resolve-Path -LiteralPath $PackagePath).Path
$taskWork = (Resolve-Path -LiteralPath $WorkDirectory).Path
$taskProfile = Join-Path $DshHomePath "profiles/$Profile"
$taskManifestPath = Join-Path $taskProfile 'package.json'
$taskManifest = Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
if (-not $taskManifest.dependencies.'dsh-engineering-workbench') { throw 'This is an upgrade command. Install the workbench into the intended profile first.' }
$taskHash = (Get-FileHash -LiteralPath $taskSource -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedSha256 -and $taskHash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Package SHA256 mismatch.' }
$taskBackup = Join-Path $taskWork ('upgrade-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
foreach ($taskName in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
    $taskFile = Join-Path $taskProfile $taskName
    if (Test-Path -LiteralPath $taskFile) { Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskBackup $taskName) }
}
$taskInstalled = Join-Path $taskProfile 'node_modules/dsh-engineering-workbench'
Copy-Item -LiteralPath $taskInstalled -Destination (Join-Path $taskBackup 'plugin') -Recurse
$taskCache = Join-Path $taskWork 'plugin-cache'
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
$taskPackage = Join-Path $taskCache ('dsh-engineering-workbench-0.6.0-' + $taskHash.Substring(0,16) + '.tgz')
Copy-Item -LiteralPath $taskSource -Destination $taskPackage -Force
$taskModules = Get-Content -LiteralPath (Join-Path $taskProfile 'node_modules/.modules.yaml') -Raw
if ($taskModules.TrimStart().StartsWith('{')) { $taskStore = ($taskModules | ConvertFrom-Json).storeDir }
else {
    $taskMatch = [regex]::Match($taskModules, '(?m)^storeDir:\s*(.+?)\s*$')
    if ($taskMatch.Success) { $taskStore = $taskMatch.Groups[1].Value.Trim().Trim("'").Trim('"') }
}
if (-not $taskStore) { throw 'Cannot locate the existing pnpm store; no install was attempted.' }
if ([IO.Path]::GetFileName($taskStore) -match '^v\d+$') { $taskStore = Split-Path -Parent $taskStore }
$taskOldHome = $env:DSH_HOME
try {
    $env:DSH_HOME = $DshHomePath
    $taskArgs = @('plugin','--profile',$Profile,'add',$taskPackage,'--ignore-scripts','--store-dir',$taskStore)
    if ($Registry) { $taskArgs += @('--registry',$Registry) } else { $taskArgs += '--offline' }
    & $DshCommand @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Upgrade failed. Original profile backup: $taskBackup" }
} finally {
    $env:DSH_HOME = $taskOldHome
    # Keep the exact project paths, provider/login configuration and user overrides.
    $taskSavedPatch = Join-Path $taskBackup 'cordis.patch.yml'
    if (Test-Path -LiteralPath $taskSavedPatch) { Copy-Item -LiteralPath $taskSavedPatch -Destination (Join-Path $taskProfile 'cordis.patch.yml') -Force }
}
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskInstalled 'package.json') -Raw | ConvertFrom-Json).version
if ($taskVersion -ne '0.6.0') { throw "Installed version is $taskVersion, expected 0.6.0. Backup: $taskBackup" }
$taskBuild = Get-Content -LiteralPath (Join-Path $taskInstalled 'src/build.json') -Raw | ConvertFrom-Json
if ($RuntimeSource) { & (Join-Path $taskInstalled 'scripts/install-desktop-runtime.ps1') -WorkDirectory $taskWork -RuntimeSource $RuntimeSource }
$taskRecord = @{version=$taskVersion;build=$taskBuild.build;profile=$Profile;packageSha256=$taskHash;backup=$taskBackup;workDirectory=$taskWork;installedAt=(Get-Date).ToString('o');activation='Reload plugin or restart Harness when convenient; this script does not stop it.'}
[IO.File]::WriteAllText((Join-Path $taskWork 'installation.json'),($taskRecord | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
Write-Output "Installed $taskVersion / $($taskBuild.build) into profile $Profile. Existing configuration preserved."
Write-Output "Backup: $taskBackup"
Write-Output 'Harness was not stopped. Reload the plugin or restart Harness when convenient to activate it.'
