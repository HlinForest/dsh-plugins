param(
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$DshCommand = (Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),
    [string]$Registry
)
$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPackage = Join-Path $taskRepo 'dist/dsh-engineering-workbench-0.6.0.tgz'
$taskHashes = Get-Content -LiteralPath (Join-Path $taskRepo 'output/packages/Engineering_Workbench_0.6.0.sha256.txt')
$taskLine = $taskHashes | Where-Object { $_ -match '^([a-f0-9]{64})\s+dsh-engineering-workbench-0\.6\.0\.tgz$' } | Select-Object -First 1
if (-not $taskLine) { throw 'Package checksum record is missing.' }
$taskExpected = ($taskLine -split '\s+')[0]
if ((Get-FileHash -LiteralPath $taskPackage -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected) { throw 'Plugin checksum mismatch.' }
$taskWork = (Resolve-Path -LiteralPath $WorkDirectory).Path
$taskRuntime = Join-Path $taskWork 'desktop-runtime'
function Test-Runtime([string]$Directory) {
    foreach ($taskRequired in @('electron.exe','LICENSE','LICENSES.chromium.html','resources/default_app.asar')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Directory $taskRequired) -PathType Leaf)) { return $false }
    }
    return $true
}
$taskRuntimeReady = (Test-Runtime $taskRuntime) -or (Test-Runtime (Join-Path $taskRuntime 'node_modules/electron/dist'))
$taskArgs = @{ PackagePath=$taskPackage; WorkDirectory=$taskWork; Profile=$Profile; DshHomePath=$DshHomePath; DshCommand=$DshCommand; ExpectedSha256=$taskExpected }
if ($Registry) { $taskArgs.Registry = $Registry }
if (-not $taskRuntimeReady) {
    $taskArchive = & (Join-Path $PSScriptRoot 'assemble-workbench-runtime.ps1')
    $taskExtract = Join-Path $taskRepo 'downloads/workbench-runtime'
    Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskExtract -Force
    $taskArgs.RuntimeSource = Join-Path $taskExtract 'electron'
}
& (Join-Path $taskRepo 'plugins/dsh-engineering-workbench/scripts/upgrade-intranet.ps1') @taskArgs
