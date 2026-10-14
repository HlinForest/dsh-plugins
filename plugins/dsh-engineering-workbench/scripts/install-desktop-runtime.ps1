param(
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [string]$RuntimeSource,
    [switch]$Download
)
$ErrorActionPreference = 'Stop'
$workbenchWork = [IO.Path]::GetFullPath($WorkDirectory)
$workbenchTarget = Join-Path $workbenchWork 'desktop-runtime'
New-Item -ItemType Directory -Force -Path $workbenchTarget | Out-Null
if ($RuntimeSource) {
    $workbenchSource = (Resolve-Path -LiteralPath $RuntimeSource).Path
    if ($workbenchSource.TrimEnd('\','/') -eq $workbenchTarget.TrimEnd('\','/') -or
        $workbenchTarget.StartsWith($workbenchSource.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'RuntimeSource must be separate from the installation target.'
    }
    foreach ($workbenchRequired in @('electron.exe','LICENSE','LICENSES.chromium.html','resources/default_app.asar')) {
        if (-not (Test-Path -LiteralPath (Join-Path $workbenchSource $workbenchRequired) -PathType Leaf)) { throw "Incomplete Electron runtime: $workbenchRequired" }
    }
    Get-ChildItem -LiteralPath $workbenchSource -Force | Copy-Item -Destination $workbenchTarget -Recurse -Force
} elseif ($Download) {
    $workbenchPackage = Join-Path $workbenchTarget 'package.json'
    if (-not (Test-Path -LiteralPath $workbenchPackage)) {
        [IO.File]::WriteAllText($workbenchPackage,'{"name":"workbench-flow-desktop-runtime","private":true}',[Text.UTF8Encoding]::new($false))
    }
    & npm.cmd install --prefix $workbenchTarget --save-exact electron@44.7.2 --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Electron package installation failed.' }
    & node (Join-Path $workbenchTarget 'node_modules/electron/install.js')
    if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed.' }
} else {
    throw 'Provide -RuntimeSource for an offline runtime or -Download to fetch the official pinned runtime.'
}
Write-Output 'The independent workbench window runtime is installed. Harness model settings were not changed.'
