param([Parameter(Mandatory=$true)][string]$PythonExe, [Parameter(Mandatory=$true)][string]$EnvironmentDirectory)
$ErrorActionPreference = 'Stop'
$taskOffline = Join-Path $PSScriptRoot '../offline'
& $PythonExe -c "import sys,struct; assert sys.version_info[:2] == (3,11) and struct.calcsize('P') == 8, 'Offline wheels require Python 3.11 x64'"
if ($LASTEXITCODE -ne 0) { throw 'Python version mismatch.' }
$taskEnv = [IO.Path]::GetFullPath($EnvironmentDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $taskEnv 'pyvenv.cfg'))) {
    if (Test-Path -LiteralPath $taskEnv) { throw 'Choose a new directory for the isolated Python environment.' }
    & $PythonExe -m venv $taskEnv
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create isolated Python environment.' }
}
$taskPython = Join-Path $taskEnv 'Scripts/python.exe'
& $taskPython -c "import sys,struct; assert sys.prefix != sys.base_prefix and sys.version_info[:2] == (3,11) and struct.calcsize('P') == 8"
if ($LASTEXITCODE -ne 0) { throw 'Expected an isolated Python 3.11 x64 environment.' }
& $taskPython -m pip install --no-index --find-links (Join-Path $taskOffline 'wheels') -r (Join-Path $taskOffline 'requirements-lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'Offline Python dependency install failed.' }
& $taskPython -c "import fitz,jsonschema,sexpdata; from ortools.sat.python import cp_model; m=cp_model.CpModel(); x=m.NewIntVar(0,1,'x'); m.Add(x==1); s=cp_model.CpSolver(); assert s.Solve(m)==cp_model.OPTIMAL; print('PDF, schema and layout dependencies ready')"
if ($LASTEXITCODE -ne 0) { throw 'Python dependency smoke check failed.' }

Write-Output "Use -McpPython $taskPython when installing or updating the plugin."
