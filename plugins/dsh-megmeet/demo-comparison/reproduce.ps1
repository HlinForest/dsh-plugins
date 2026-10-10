param([string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'))
$ErrorActionPreference = 'Stop'
$env:DSH_HOME = $DshHomePath
$demoDirectory = $PSScriptRoot
$cliPath = Join-Path $demoDirectory '..\.verification\dsh-host\node_modules\@deepseek-ai\dsh\lib\bin.js'
$pluginPath = Join-Path $demoDirectory '..\dsh-megmeet-0.1.0.tgz'
$fallbackDirectory = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback'
if (-not (Test-Path -LiteralPath $cliPath)) { throw 'DSH rc.2 CLI runtime not found. See README.md for runtime setup.' }
if (Test-Path -LiteralPath $fallbackDirectory) { $env:PATH = $fallbackDirectory + ';' + $env:PATH }
$replayDirectory = Join-Path $demoDirectory ('replays\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path (Join-Path $replayDirectory 'runs') -Force | Out-Null
foreach ($name in @('prompt.txt','catalog.demo.json','requirements.txt','experiment.json','shared.patch.yml')) {
    Copy-Item -LiteralPath (Join-Path $demoDirectory $name) -Destination (Join-Path $replayDirectory $name)
}
function Invoke-NodeChecked([string[]]$NodeArguments) {
    & node @NodeArguments
    if ($LASTEXITCODE -ne 0) { throw "Node command failed: $LASTEXITCODE" }
}
Invoke-NodeChecked @($cliPath, '--profile', 'megmeet-ab-base', '--from-default-profile', 'headless', '--dump-config') | Out-Null
Invoke-NodeChecked @($cliPath, '--profile', 'megmeet-ab-plugin', '--from-default-profile', 'headless', '--dump-config') | Out-Null
Invoke-NodeChecked @($cliPath, 'plugin', '--profile', 'megmeet-ab-plugin', 'add', $pluginPath, '--ignore-scripts', '--registry=https://registry.npmjs.org')
foreach ($arm in @('baseline','plugin')) {
    Invoke-NodeChecked @((Join-Path $demoDirectory 'run.mjs'), $arm, $replayDirectory)
    $profileName = if ($arm -eq 'baseline') { 'megmeet-ab-base' } else { 'megmeet-ab-plugin' }
    Invoke-NodeChecked @($cliPath, '--profile', $profileName, '--patch', (Join-Path $demoDirectory 'shared.patch.yml'), '--dump-config') | Set-Content -LiteralPath (Join-Path $replayDirectory "runs\$arm.config.yml") -Encoding utf8
}
Invoke-NodeChecked @((Join-Path $demoDirectory 'collect-evidence.mjs'), $replayDirectory)
Write-Output "Replay outputs and full evidence saved to $replayDirectory"
