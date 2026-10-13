param([Parameter(Mandatory=$true)][string]$PythonExe)
$ErrorActionPreference = 'Stop'
$taskWheels = Join-Path $PSScriptRoot '../offline/wheels'
if (-not (Test-Path -LiteralPath $taskWheels -PathType Container)) { throw 'Use this script from the full intranet ZIP.' }
& $PythonExe -m pip install --no-index --find-links $taskWheels 'sexpdata==1.0.2' 'PyMuPDF==1.28.2'
if ($LASTEXITCODE -ne 0) { throw 'Offline install failed. The supplied wheels target Windows x64; use the KiCad Python interpreter. See the pip error above.' }
