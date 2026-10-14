param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)][string]$KicadDirectory,
    [string]$WorkDirectory,
    [string]$DesktopRuntimeSource,
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DshCommand = (Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),
    [string]$Registry
)
$ErrorActionPreference = 'Stop'
function Get-BundleHash([string]$File) {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($File)
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
}
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$taskBundle = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPackage = Join-Path $taskBundle 'plugin/dsh-eda-flow-0.3.2.tgz'
$taskWorkspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
if (-not $WorkDirectory) { $WorkDirectory = Join-Path $taskWorkspace 'eda-flow' }
$taskWork = [IO.Path]::GetFullPath($WorkDirectory)
if ($taskWork -ne $taskWorkspace -and -not $taskWork.StartsWith($taskWorkspace.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'WorkDirectory must be inside WorkspaceRoot.' }
$taskBin = (Resolve-Path -LiteralPath $KicadDirectory).Path
foreach ($taskFile in @($taskPackage,$DshCommand,(Join-Path $taskBin 'python.exe'),(Join-Path $taskBin 'kicad-cli.exe'))) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Missing: $taskFile" }
}
# Verify the distributed payload before asking the plugin manager to load it.
$taskManifest = Get-Content -LiteralPath (Join-Path $taskBundle 'FILES.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($taskItem in $taskManifest.files) {
    $taskFile = [IO.Path]::GetFullPath((Join-Path $taskBundle $taskItem.path))
    if (-not $taskFile.StartsWith($taskBundle + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid bundle path.' }
    if ((Get-BundleHash $taskFile) -ne $taskItem.sha256) { throw "Bundle hash mismatch: $($taskItem.path)" }
}
New-Item -ItemType Directory -Force -Path $taskWork | Out-Null
$taskPackageHash = Get-BundleHash $taskPackage
$taskPackageCache = Join-Path $taskWork 'plugin-cache'
New-Item -ItemType Directory -Force -Path $taskPackageCache | Out-Null
$taskInstallPackage = Join-Path $taskPackageCache ('dsh-eda-flow-0.3.2-' + $taskPackageHash.Substring(0,12) + '.tgz')
if (-not (Test-Path -LiteralPath $taskInstallPackage)) { Copy-Item -LiteralPath $taskPackage -Destination $taskInstallPackage }
if ((Get-BundleHash $taskInstallPackage) -ne $taskPackageHash) { throw 'Cached plugin hash mismatch.' }
if (-not $DesktopRuntimeSource -and (Test-Path -LiteralPath (Join-Path $taskBundle 'offline/desktop-runtime') -PathType Container)) {
    $DesktopRuntimeSource = Join-Path $taskBundle 'offline/desktop-runtime'
}
$taskProfileDir = Join-Path $DshHomePath "profiles/$Profile"
if (-not (Test-Path -LiteralPath (Join-Path $taskProfileDir 'package.json'))) {
    throw "Open or initialize the intended Harness profile first: $Profile. This installer does not copy logins or replace existing profiles."
}
$taskBackup = Join-Path $taskWork ('install-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $taskBackup | Out-Null
foreach ($taskName in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')) {
    $taskFile = Join-Path $taskProfileDir $taskName
    if (Test-Path -LiteralPath $taskFile) { Copy-Item -LiteralPath $taskFile -Destination (Join-Path $taskBackup $taskName) }
}
$taskPatchFile = Join-Path $taskProfileDir 'cordis.patch.yml'
$taskPatch = if (Test-Path -LiteralPath $taskPatchFile) { [IO.File]::ReadAllText($taskPatchFile) } else { '' }
$taskOriginalPatch = $taskPatch
$taskPatchWithoutComments = [regex]::Replace($taskPatch, '(?m)^\s*#.*(?:\r?\n|$)', '').Trim()
$taskPatchIsJson = $taskPatchWithoutComments.StartsWith('[')
if ($taskPatchIsJson) { $taskJsonPatch = ConvertFrom-Json -InputObject $taskPatchWithoutComments }
elseif ($taskPatch -match '(?m)^\.\.\.\s*$') { throw 'This profile uses a closed YAML document. Merge config manually using docs/intranet.md; original files are unchanged.' }
$taskOldDshHome = $env:DSH_HOME
$taskStoreRoot = Join-Path $DshHomePath 'cache/eda-flow/pnpm-store'
$taskModulesFile = Join-Path $taskProfileDir 'node_modules/.modules.yaml'
if (Test-Path -LiteralPath $taskModulesFile) {
    $taskModulesText = [IO.File]::ReadAllText($taskModulesFile)
    if ($taskModulesText.TrimStart().StartsWith('{')) { $taskRecordedStore = ($taskModulesText | ConvertFrom-Json).storeDir }
    else {
        $taskStoreMatch = [regex]::Match($taskModulesText, '(?m)^storeDir:\s*(.+?)\s*$')
        if ($taskStoreMatch.Success) { $taskRecordedStore = $taskStoreMatch.Groups[1].Value.Trim().Trim("'").Trim('"') }
    }
    if (-not $taskRecordedStore) { throw 'Cannot identify the existing pnpm store; use a clean Harness profile or preserve the original package-manager configuration.' }
    $taskStoreRoot = if ([IO.Path]::GetFileName($taskRecordedStore) -match '^v\d+$') { Split-Path -Parent $taskRecordedStore } else { $taskRecordedStore }
}
if ($DesktopRuntimeSource) {
    & (Join-Path $PSScriptRoot 'install-desktop-runtime.ps1') -WorkDirectory $taskWork -RuntimeSource $DesktopRuntimeSource
}
try {
    $env:DSH_HOME = $DshHomePath
    $taskArgs = @('plugin','--profile',$Profile,'add',$taskInstallPackage,'--ignore-scripts')
    if ($Registry) { $taskArgs += @('--registry',$Registry) }
    else { $taskArgs += @('--offline','--store-dir',$taskStoreRoot) }
    & $DshCommand @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Plugin install failed. Backup: $taskBackup. Runtime dependencies are bundled; other existing plugins still require their original cache or an approved intranet registry." }
} finally { $env:DSH_HOME = $taskOldDshHome }
# A trailing id-targeted patch changes only this plugin's settings.
$taskConfig = @{
    workspaceRoot=$taskWorkspace.Replace('\','/');workDirectory=$taskWork.Replace('\','/');
    kicadCli=(Join-Path $taskBin 'kicad-cli.exe').Replace('\','/');
    kicadPython=(Join-Path $taskBin 'python.exe').Replace('\','/');
    allowModelCalls=$true
}
$taskEntry = "`n# BEGIN eda-flow-intranet managed config`n- id: eda-flow`n  config:`n"
foreach ($taskKey in @('workspaceRoot','workDirectory','kicadCli','kicadPython')) {
    $taskValue = $taskConfig[$taskKey].Replace("'","''")
    $taskEntry += "    ${taskKey}: '$taskValue'`n"
}
$taskEntry += "    allowModelCalls: true`n# END eda-flow-intranet managed config`n"
$taskPatch = [regex]::Replace($taskPatch, '(?ms)^# BEGIN eda-flow-intranet managed config\r?\n.*?^# END eda-flow-intranet managed config\r?\n?', '')
if ($taskPatchIsJson) {
    $taskPatchEntries = [Collections.Generic.List[object]]::new()
    foreach ($taskPatchItem in $taskJsonPatch) { $taskPatchEntries.Add($taskPatchItem) }
    $taskPatchEntries.Add(@{id='eda-flow';config=$taskConfig})
    $taskPatchText = ConvertTo-Json -InputObject $taskPatchEntries.ToArray() -Depth 100
} else { $taskPatchText = $taskPatch.TrimEnd() + "`n" + $taskEntry }
[IO.File]::WriteAllText($taskPatchFile, $taskPatchText, [Text.UTF8Encoding]::new($false))
try {
    $env:DSH_HOME = $DshHomePath
    $ErrorActionPreference = 'Continue'
    & $DshCommand --profile $Profile --dump-config *> (Join-Path $taskWork 'profile-validation.private.log')
    $taskConfigExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $taskValidationLog = [IO.File]::ReadAllText((Join-Path $taskWork 'profile-validation.private.log'))
    $taskDesktopDeferred = $Profile -eq 'desktop' -and $taskValidationLog -match 'managed exclusively by the Electron application'
    if ($taskConfigExit -ne 0 -and -not $taskDesktopDeferred) {
        [IO.File]::WriteAllText($taskPatchFile, $taskOriginalPatch, [Text.UTF8Encoding]::new($false))
        throw "Plugin was installed, but profile configuration failed validation; previous patch restored. See $taskWork/profile-validation.private.log locally."
    }
} finally { $env:DSH_HOME = $taskOldDshHome; $ErrorActionPreference = 'Stop' }
[IO.File]::WriteAllText((Join-Path $taskWork 'installation.json'), (@{version='0.3.2';profile=$Profile;config=$taskConfig;backup=$taskBackup;configurationValidation=$(if ($taskDesktopDeferred) {'desktop-host-on-restart'} else {'cli-dump-passed'});installedAt=(Get-Date).ToString('o')} | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output "Installed EDA flow 0.3.2 into profile $Profile. Restart Harness."
Write-Output "Backup: $taskBackup"
if ($taskDesktopDeferred) { Write-Output 'Desktop profile composition is checked by Harness on restart; desktop profiles cannot be dumped by its CLI.' }
Write-Output 'The installer preserves your existing model provider and login. Local file access does not imply an offline model.'

# Desktop CLI validation is deferred successfully; do not leak its expected exit code.
$global:LASTEXITCODE = 0
