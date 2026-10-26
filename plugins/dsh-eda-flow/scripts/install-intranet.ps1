[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SuppliedPackage,
    [Parameter(Mandatory=$true)][string]$DshPath,
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [string]$KicadDirectory,
    [switch]$ReviewOnly,
    [string]$WorkDirectory,
    [string]$JavaPath,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DesktopRuntimeSource,
    [string]$Registry
)

$ErrorActionPreference = 'Stop'

function Get-FileHashHex([string]$File) {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($File)
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
}

function Write-Utf8NoBom([string]$File, [string]$Text) {
    [IO.File]::WriteAllText($File, $Text, [Text.UTF8Encoding]::new($false))
}

function Restore-DshHome([object]$Value) {
    if ($null -eq $Value) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue }
    else { $env:DSH_HOME = [string]$Value }
}

if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$taskPackage = (Resolve-Path -LiteralPath $SuppliedPackage -ErrorAction Stop).Path
$taskDsh = (Resolve-Path -LiteralPath $DshPath -ErrorAction Stop).Path
$taskWorkspace = (Resolve-Path -LiteralPath $WorkspaceRoot -ErrorAction Stop).Path
$taskBin = if ($KicadDirectory) { (Resolve-Path -LiteralPath $KicadDirectory -ErrorAction Stop).Path } else { '' }
if (-not $ReviewOnly -and -not $taskBin) { throw 'Provide KicadDirectory for generation, or use -ReviewOnly to start with viewing and engineer review.' }
if ([IO.Path]::GetExtension($taskPackage) -ine '.tgz') { throw "SuppliedPackage must be a .tgz file: $taskPackage" }
$taskRequiredFiles = @($taskPackage,$taskDsh)
if (-not $ReviewOnly) { $taskRequiredFiles += @((Join-Path $taskBin 'python.exe'),(Join-Path $taskBin 'kicad-cli.exe')) }
foreach ($taskFile in $taskRequiredFiles) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Missing: $taskFile" }
}

if (-not $WorkDirectory) { $WorkDirectory = Join-Path $taskWorkspace 'eda-flow' }
$taskWork = [IO.Path]::GetFullPath($WorkDirectory)
$taskWorkspacePrefix = $taskWorkspace.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
if ($taskWork -ne $taskWorkspace -and -not $taskWork.StartsWith($taskWorkspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'WorkDirectory must be inside WorkspaceRoot.'
}

$taskPackageHash = Get-FileHashHex $taskPackage
$taskPackageName = [IO.Path]::GetFileNameWithoutExtension($taskPackage)
$taskPackageVersion = if ($taskPackageName -match '^dsh-eda-flow-(.+)$') { $Matches[1] } else { 'supplied-package' }
$taskPackageCache = Join-Path $taskWork 'plugin-cache'
New-Item -ItemType Directory -Force -Path $taskWork,$taskPackageCache | Out-Null
$taskInstallPackage = Join-Path $taskPackageCache ($taskPackageName + '-' + $taskPackageHash.Substring(0,12) + '.tgz')
if (Test-Path -LiteralPath $taskInstallPackage -PathType Leaf) {
    if ((Get-FileHashHex $taskInstallPackage) -ne $taskPackageHash) { throw 'Cached supplied package hash mismatch.' }
} else {
    Copy-Item -LiteralPath $taskPackage -Destination $taskInstallPackage
}

if ($DesktopRuntimeSource) {
    & (Join-Path $PSScriptRoot 'install-desktop-runtime.ps1') -WorkDirectory $taskWork -RuntimeSource $DesktopRuntimeSource
}

$taskProfileDir = Join-Path $DshHomePath "profiles/$Profile"
if (-not (Test-Path -LiteralPath (Join-Path $taskProfileDir 'package.json') -PathType Leaf)) {
    throw "Open or initialize the intended Harness profile first: $Profile. This installer does not copy logins or replace existing profiles."
}

$taskBackup = Join-Path $taskWork ('install-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
foreach ($taskName in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
    $taskFile = Join-Path $taskProfileDir $taskName
    if (Test-Path -LiteralPath $taskFile -PathType Leaf) { Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskBackup $taskName) }
}

$taskPatchFile = Join-Path $taskProfileDir 'cordis.patch.yml'
$taskPatch = if (Test-Path -LiteralPath $taskPatchFile -PathType Leaf) { [IO.File]::ReadAllText($taskPatchFile) } else { '' }
$taskOriginalPatch = $taskPatch
$taskPatchWithoutComments = [regex]::Replace($taskPatch, '(?m)^\s*#.*(?:\r?\n|$)', '').Trim()
$taskPatchIsJson = $taskPatchWithoutComments.StartsWith('[')
$taskJsonPatch = $null
if ($taskPatchIsJson) { $taskJsonPatch = ConvertFrom-Json -InputObject $taskPatchWithoutComments }
elseif ($taskPatch -match '(?m)^\.\.\.\s*$') { throw 'This profile uses a closed YAML document. Merge config manually; original files are unchanged.' }

$taskOldDshHome = $env:DSH_HOME
$taskStoreRoot = Join-Path $DshHomePath 'cache/eda-flow/pnpm-store'
$taskModulesFile = Join-Path $taskProfileDir 'node_modules/.modules.yaml'
if (Test-Path -LiteralPath $taskModulesFile -PathType Leaf) {
    $taskModulesText = [IO.File]::ReadAllText($taskModulesFile)
    $taskRecordedStore = $null
    if ($taskModulesText.TrimStart().StartsWith('{')) { $taskRecordedStore = ($taskModulesText | ConvertFrom-Json).storeDir }
    else {
        $taskStoreMatch = [regex]::Match($taskModulesText, '(?m)^storeDir:\s*(.+?)\s*$')
        if ($taskStoreMatch.Success) { $taskRecordedStore = $taskStoreMatch.Groups[1].Value.Trim().Trim("'").Trim('"') }
    }
    if (-not $taskRecordedStore) { throw 'Cannot identify the existing pnpm store; use a clean Harness profile or preserve the original package-manager configuration.' }
    $taskStoreRoot = if ([IO.Path]::GetFileName($taskRecordedStore) -match '^v\d+$') { Split-Path -Parent $taskRecordedStore } else { $taskRecordedStore }
}

try {
    $env:DSH_HOME = $DshHomePath
    $taskArgs = @('plugin','--profile',$Profile,'add',$taskInstallPackage,'--ignore-scripts')
    if ($Registry) { $taskArgs += @('--registry',$Registry) }
    else { $taskArgs += @('--offline','--store-dir',$taskStoreRoot) }
    & $taskDsh @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Plugin install failed. Backup: $taskBackup. Runtime dependencies are bundled; other existing plugins still require their original cache or an approved intranet registry." }
} finally { Restore-DshHome $taskOldDshHome }

if ($JavaPath) { $JavaPath = (Resolve-Path -LiteralPath $JavaPath -ErrorAction Stop).Path }
$taskConfig = @{
    workspaceRoot=$taskWorkspace.Replace('\','/');workDirectory=$taskWork.Replace('\','/');
    kicadCli=$(if($taskBin){(Join-Path $taskBin 'kicad-cli.exe').Replace('\','/')}else{''});
    kicadPython=$(if($taskBin){(Join-Path $taskBin 'python.exe').Replace('\','/')}else{''});
    reviewOnly=[bool]$ReviewOnly;allowModelCalls=$true
}
if ($JavaPath) { $taskConfig.javaPath = $JavaPath.Replace('\','/') }
$taskEntry = "`n# BEGIN eda-flow-intranet managed config`n- id: eda-flow`n  config:`n"
foreach ($taskKey in @('workspaceRoot','workDirectory','kicadCli','kicadPython','javaPath')) {
    if (-not $taskConfig.ContainsKey($taskKey)) { continue }
    $taskValue = $taskConfig[$taskKey].Replace("'", "''")
    $taskEntry += "    ${taskKey}: '$taskValue'`n"
}
$taskEntry += "    reviewOnly: $($ReviewOnly.IsPresent.ToString().ToLowerInvariant())`n    allowModelCalls: true`n# END eda-flow-intranet managed config`n"
$taskPatch = [regex]::Replace($taskPatch, '(?ms)^# BEGIN eda-flow-intranet managed config\r?\n.*?^# END eda-flow-intranet managed config\r?\n?', '')
if ($taskPatchIsJson) {
    $taskPatchEntries = [Collections.Generic.List[object]]::new()
    foreach ($taskPatchItem in $taskJsonPatch) { $taskPatchEntries.Add($taskPatchItem) }
    $taskPatchEntries.Add(@{id='eda-flow';config=$taskConfig})
    $taskPatchText = ConvertTo-Json -InputObject $taskPatchEntries.ToArray() -Depth 100
} else { $taskPatchText = $taskPatch.TrimEnd() + "`n" + $taskEntry }
Write-Utf8NoBom $taskPatchFile $taskPatchText

$taskValidationLog = Join-Path $taskWork 'profile-validation.private.log'
$taskDesktopDeferred = $false
try {
    $env:DSH_HOME = $DshHomePath
    $ErrorActionPreference = 'Continue'
    & $taskDsh --profile $Profile --dump-config *> $taskValidationLog
    $taskConfigExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $taskValidationText = [IO.File]::ReadAllText($taskValidationLog)
    $taskDesktopDeferred = $Profile -eq 'desktop' -and $taskValidationText -match 'managed exclusively by the Electron application'
    if ($taskConfigExit -ne 0 -and -not $taskDesktopDeferred) {
        Write-Utf8NoBom $taskPatchFile $taskOriginalPatch
        throw "Plugin was installed, but profile configuration failed validation; previous patch restored. See $taskValidationLog locally."
    }
} finally { Restore-DshHome $taskOldDshHome; $ErrorActionPreference = 'Stop' }

Write-Utf8NoBom (Join-Path $taskWork 'installation.json') (@{
    version=$taskPackageVersion;package=$taskPackageName;packageSha256=$taskPackageHash;profile=$Profile;config=$taskConfig;backup=$taskBackup;
    configurationValidation=$(if ($taskDesktopDeferred) {'desktop-host-on-restart'} else {'cli-dump-passed'});installedAt=(Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5)
Write-Output "Installed EDA flow $taskPackageVersion into profile $Profile. Restart Harness."
Write-Output "Backup: $taskBackup"
if ($taskDesktopDeferred) { Write-Output 'Desktop profile composition is checked by Harness on restart; desktop profiles cannot be dumped by its CLI.' }
Write-Output 'The installer preserves your existing model provider and login. Local file access does not imply an offline model.'

# Desktop CLI validation may be deferred successfully; do not leak its expected exit code.
$global:LASTEXITCODE = 0
