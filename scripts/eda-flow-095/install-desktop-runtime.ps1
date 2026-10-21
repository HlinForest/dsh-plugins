param(
    [Parameter(Mandatory=$true)][string]$WorkDirectory,
    [string]$RuntimeSource,
    [switch]$Download
)
$ErrorActionPreference = 'Stop'
$edaWork = [IO.Path]::GetFullPath($WorkDirectory)
$edaTarget = Join-Path $edaWork 'desktop-runtime'
New-Item -ItemType Directory -Force -Path $edaTarget | Out-Null
if ($RuntimeSource) {
    $edaSource = (Resolve-Path -LiteralPath $RuntimeSource).Path
    if ($edaSource.TrimEnd('\','/') -eq $edaTarget.TrimEnd('\','/') -or
        $edaTarget.StartsWith($edaSource.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'RuntimeSource must be separate from the installation target.'
    }
    foreach ($edaRequired in @('electron.exe','LICENSE','LICENSES.chromium.html','resources/default_app.asar')) {
        if (-not (Test-Path -LiteralPath (Join-Path $edaSource $edaRequired) -PathType Leaf)) { throw "Incomplete Electron runtime: $edaRequired" }
    }
    Get-ChildItem -LiteralPath $edaSource -Force | Copy-Item -Destination $edaTarget -Recurse -Force
} elseif ($Download) {
    $edaPackage = Join-Path $edaTarget 'package.json'
    if (-not (Test-Path -LiteralPath $edaPackage)) {
        [IO.File]::WriteAllText($edaPackage,'{"name":"eda-flow-desktop-runtime","private":true}',[Text.UTF8Encoding]::new($false))
    }
    & npm.cmd install --prefix $edaTarget --save-exact electron@44.7.2 --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Electron package installation failed.' }
    & node (Join-Path $edaTarget 'node_modules/electron/install.js')
    if ($LASTEXITCODE -ne 0) { throw 'Electron runtime download failed.' }
} else {
    throw 'Provide -RuntimeSource for an offline runtime or -Download to fetch the official pinned runtime.'
}
Write-Output 'The independent design-window runtime is installed. Harness model settings were not changed.'
