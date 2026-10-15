param([Parameter(Mandatory=$true)][string]$PythonExe)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskWheels = Join-Path $taskRoot 'offline/wheels'
$taskHashesPath = Join-Path $taskRoot 'offline/wheels-sha256.json'
if (-not (Test-Path -LiteralPath $taskHashesPath -PathType Leaf)) { throw 'Extract EDA_Flow_Update_0.4.0.zip and run this script there; the source checkout does not contain the wheels directory.' }
$taskPython = & $PythonExe -c "import sys,platform,json; print(json.dumps({'version':list(sys.version_info[:2]),'bits':platform.architecture()[0],'platform':sys.platform,'implementation':sys.implementation.name}))"
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the selected Python interpreter.' }
$taskInfo = $taskPython | ConvertFrom-Json
if ($taskInfo.version[0] -ne 3 -or $taskInfo.version[1] -ne 11 -or $taskInfo.bits -ne '64bit' -or $taskInfo.platform -ne 'win32' -or $taskInfo.implementation -ne 'cpython') { throw 'Bundled wheels require Windows x64 CPython 3.11. Use matching wheels for another interpreter.' }
$taskHashes = Get-Content -LiteralPath $taskHashesPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($taskEntry in $taskHashes.PSObject.Properties) {
    if ($taskEntry.Name -notmatch '^[a-zA-Z0-9_.-]+\.whl$') { throw 'Invalid wheel manifest name.' }
    $taskWheel = Join-Path $taskWheels $taskEntry.Name
    if ((Get-FileHash -LiteralPath $taskWheel -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskEntry.Value) { throw "Wheel checksum mismatch: $($taskEntry.Name)" }
}
& $PythonExe -m pip install --no-index --find-links $taskWheels 'jsonschema==4.26.0'
if ($LASTEXITCODE -ne 0) { throw 'Offline Python dependency installation failed; retain the error above.' }
& $PythonExe -c "import jsonschema; jsonschema.Draft202012Validator.check_schema({'type':'object'}); print('KiCad MCP jsonschema ready')"
if ($LASTEXITCODE -ne 0) { throw 'Installed jsonschema import check failed.' }
