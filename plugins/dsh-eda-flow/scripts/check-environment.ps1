param(
    [Parameter(Mandatory=$true)][string]$WorkspaceRoot,
    [Parameter(Mandatory=$true)][string]$KicadDirectory,
    [switch]$SchematicOnly,
    [string]$OutputFile = (Join-Path $PSScriptRoot 'environment-check.json')
)
$ErrorActionPreference = 'Stop'
$taskChecks = [Collections.Generic.List[object]]::new()
function Check-Tool([string]$Name, [string]$Exe, [string[]]$Arguments, [bool]$Required=$true) {
    if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) {
        $taskChecks.Add(@{name=$Name;passed=$false;required=$Required;detail="Missing: $Exe"}); return
    }
    $taskPreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $taskOutput = (& $Exe @Arguments 2>&1 | Out-String).Trim()
        $taskExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $taskPreviousPreference }
    $taskChecks.Add(@{name=$Name;passed=($taskExitCode -eq 0);required=$Required;detail=$taskOutput})
}
$taskWorkspace = [IO.Path]::GetFullPath($WorkspaceRoot)
if (-not (Test-Path -LiteralPath $taskWorkspace -PathType Container)) { throw "Workspace does not exist: $taskWorkspace" }
$taskProbe = Join-Path $taskWorkspace ('.engineering-probe-' + [guid]::NewGuid().ToString() + '.txt')
try {
    [IO.File]::WriteAllText($taskProbe, 'local file access')
    if ([IO.File]::ReadAllText($taskProbe) -ne 'local file access') { throw 'Read/write mismatch' }
    $taskChecks.Add(@{name='local-files';passed=$true;required=$true;detail=$taskWorkspace})
} finally { if (Test-Path -LiteralPath $taskProbe) { Remove-Item -LiteralPath $taskProbe } }
Check-Tool 'KiCad CLI' (Join-Path $KicadDirectory 'kicad-cli.exe') @('--version')
Check-Tool 'KiCad Python / verifier' (Join-Path $KicadDirectory 'python.exe') @('-c','import sys,pcbnew,wx,sexpdata;print(sys.version);print(pcbnew.GetBuildVersion())')
# Generic schematic layout requires the constraint solver.  SchematicOnly is
# retained as a scope label and must not make this dependency optional.
Check-Tool 'Constraint placement solver' (Join-Path $KicadDirectory 'python.exe') @('-c',"from ortools.sat.python import cp_model;print('OR-Tools ready')") $true
Check-Tool 'Local PDF reader' (Join-Path $KicadDirectory 'python.exe') @('-c','import pymupdf;print(pymupdf.VersionBind)')
$taskScope = if ($SchematicOnly) { 'schematic' } else { 'schematic-and-pcb' }
$taskResult = @{checkedAt=(Get-Date).ToString('o');scope=$taskScope;schematicLayoutSolverRequired=$true;schematicOnlyMeaning='Scope label only; this script does not waive any generic schematic dependency, including OR-Tools.';checks=@($taskChecks.ToArray());passed=(@($taskChecks | Where-Object { $_.required -and -not $_.passed }).Count -eq 0);modelConnection='Use the approved provider configured inside Harness; not tested by this script.'}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile), ($taskResult | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
$taskChecks | ForEach-Object { Write-Output ("{0}: {1}" -f $_.name, $(if ($_.passed) {'PASS'} elseif (-not $_.required) {'MISSING (optional for schematic)'} else {'MISSING'})) }
Write-Output "Report: $OutputFile"
if (-not $taskResult.passed) { exit 1 }
