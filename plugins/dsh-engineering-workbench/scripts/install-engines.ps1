param([Parameter(Mandatory=$true)][string]$ToolsDirectory)
$ErrorActionPreference = 'Stop'
$taskToolsPath = [IO.Path]::GetFullPath($ToolsDirectory)
New-Item -ItemType Directory -Force -Path $taskToolsPath | Out-Null
$taskPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../src/engineering/pins.json') -Raw | ConvertFrom-Json
foreach ($taskToolName in @('kicad-happy','altium-monkey')) {
    $taskTool = $taskPins.$taskToolName
    $taskCheckout = Join-Path $taskToolsPath $taskToolName
    if (-not (Test-Path -LiteralPath $taskCheckout)) {
        & git clone $taskTool.url $taskCheckout
        if ($LASTEXITCODE -ne 0) { throw "Cannot clone $taskToolName" }
    }
    $taskDirty = & git -C $taskCheckout status --porcelain --untracked-files=no
    if ($taskDirty) { throw "$taskCheckout has local changes; refusing to replace them." }
    & git -C $taskCheckout checkout --detach $taskTool.commit
    if ($LASTEXITCODE -ne 0) { throw "Cannot check out pinned $taskToolName" }
}
& py -3.11 -m pip install --user uv==0.13.0
if ($LASTEXITCODE -ne 0) { throw 'uv installation failed' }
& py -3.11 -m uv python install $taskPins.python
& py -3.11 -m uv venv --python $taskPins.python (Join-Path $taskToolsPath '.venv') --allow-existing
if ($LASTEXITCODE -ne 0) { throw 'Python environment setup failed' }
$taskPython = Join-Path $taskToolsPath '.venv/Scripts/python.exe'
& py -3.11 -m uv pip install --python $taskPython (Join-Path $taskToolsPath 'altium-monkey') ('pymupdf==' + $taskPins.pymupdf) --constraint (Join-Path $PSScriptRoot 'engines.constraints.txt')
if ($LASTEXITCODE -ne 0) { throw 'Engine installation failed' }
Write-Output "engineeringPython: $taskPython"
Write-Output ('happyRoot: ' + (Join-Path $taskToolsPath 'kicad-happy'))
Write-Output 'altium-monkey carries AGPL-3.0-or-later; preserve its LICENSE and source attribution.'
