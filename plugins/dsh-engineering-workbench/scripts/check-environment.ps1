param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)][string]$KicadDirectory,
    [string]$OutputFile = (Join-Path $PSScriptRoot 'environment-check.json')
)
$ErrorActionPreference = 'Stop'
$taskChecks = [Collections.Generic.List[object]]::new()
function Check-Tool([string]$Name, [string]$Exe, [string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) {
        $taskChecks.Add(@{name=$Name;passed=$false;detail="Missing: $Exe"}); return
    }
    $taskOutput = (& $Exe @Arguments 2>&1 | Out-String).Trim()
    $taskChecks.Add(@{name=$Name;passed=($LASTEXITCODE -eq 0);detail=$taskOutput})
}
$taskWorkspace = [IO.Path]::GetFullPath($WorkspaceRoot)
if (-not (Test-Path -LiteralPath $taskWorkspace -PathType Container)) { throw "Workspace does not exist: $taskWorkspace" }
$taskProbe = Join-Path $taskWorkspace ('.engineering-probe-' + [guid]::NewGuid().ToString() + '.txt')
try {
    [IO.File]::WriteAllText($taskProbe, 'local file access')
    if ([IO.File]::ReadAllText($taskProbe) -ne 'local file access') { throw 'Read/write mismatch' }
    $taskChecks.Add(@{name='local-files';passed=$true;detail=$taskWorkspace})
} finally { if (Test-Path -LiteralPath $taskProbe) { Remove-Item -LiteralPath $taskProbe } }
Check-Tool 'KiCad CLI' (Join-Path $KicadDirectory 'kicad-cli.exe') @('--version')
Check-Tool 'KiCad Python / verifier' (Join-Path $KicadDirectory 'python.exe') @('-c','import sys,pcbnew,wx,sexpdata;print(sys.version);print(pcbnew.GetBuildVersion())')
Check-Tool 'Local PDF reader' (Join-Path $KicadDirectory 'python.exe') @('-c','import pymupdf;print(pymupdf.VersionBind)')
$taskResult = @{checkedAt=(Get-Date).ToString('o');checks=@($taskChecks.ToArray());passed=(@($taskChecks | Where-Object { -not $_.passed }).Count -eq 0);modelConnection='Use the approved provider configured inside Harness; not tested by this script.'}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile), ($taskResult | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
$taskChecks | ForEach-Object { Write-Output ("{0}: {1}" -f $_.name, $(if ($_.passed) {'PASS'} else {'MISSING'})) }
Write-Output "Report: $OutputFile"
if (-not $taskResult.passed) { exit 1 }
