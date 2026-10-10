param(
    [string]$Profile = 'desktop',
    [string]$ConfigFile = (Join-Path $PSScriptRoot '..\examples\local.config.json'),
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DshCommand = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Invalid profile name.' }
$pluginRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $pluginRoot 'package.json') -Raw | ConvertFrom-Json).version
$packagePath = Join-Path $pluginRoot ('dsh-kicad-workflow-' + $packageVersion + '.tgz')
$ConfigFile = [IO.Path]::GetFullPath($ConfigFile)
$DshHomePath = [IO.Path]::GetFullPath($DshHomePath)
foreach ($target in @($DshCommand, $packagePath, $ConfigFile)) {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing file: $target" }
}
$config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
foreach ($target in @($config.serverEntry,$config.nodeCommand,$config.kicadCli,$config.kicadPython,$config.workspaceRoot)) {
    if (-not [IO.Path]::IsPathRooted($target) -or -not (Test-Path -LiteralPath $target)) { throw "Missing absolute configured path: $target" }
}
$profileDir = Join-Path $DshHomePath ('profiles\' + $Profile)
$backup = Join-Path $pluginRoot ('.verification\install-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($name in @('package.json','cordis.patch.yml','pnpm-lock.yaml')) {
    $source = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $backup $name) }
}
$previousDshHome = $env:DSH_HOME
try {
    $env:DSH_HOME = $DshHomePath
    & $DshCommand plugin --profile $Profile add $packagePath --ignore-scripts --registry=https://registry.npmjs.org
    if ($LASTEXITCODE -ne 0) { throw 'DSH plugin installation failed; original profile files are backed up.' }
    & $config.nodeCommand (Join-Path $PSScriptRoot 'configure-profile.mjs') $profileDir $ConfigFile
    if ($LASTEXITCODE -ne 0) { throw 'Plugin installed but configuration failed; inspect the error and backup.' }
} finally { $env:DSH_HOME = $previousDshHome }
Write-Output "Installed dsh-kicad-workflow $packageVersion into profile: $Profile"
Write-Output "Configuration backup: $backup"
Write-Output 'Reload/reopen the selected Harness profile to activate it. Existing chats are not interrupted by this script.'
