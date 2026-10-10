param([string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh'))
$ErrorActionPreference = 'Stop'
$demoPath = $PSScriptRoot
$catalogPath = Join-Path $demoPath 'snapshots\catalog.active.json'
$reportPath = Join-Path $demoPath 'desktop-reports'
$pluginPackagePath = Join-Path $demoPath '..\dsh-megmeet-0.2.0.tgz'
$desktopCommandPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
foreach ($target in @($catalogPath,$pluginPackagePath,$desktopCommandPath)) { if (-not (Test-Path -LiteralPath $target)) { throw "Missing file: $target" } }
$env:DSH_HOME = $DshHomePath
$patchPath = Join-Path $DshHomePath 'profiles\desktop\cordis.patch.yml'
$backupPath = $patchPath + '.megmeet-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
if (Test-Path -LiteralPath $patchPath) { Copy-Item -LiteralPath $patchPath -Destination $backupPath }
& $desktopCommandPath plugin --profile desktop add $pluginPackagePath --ignore-scripts --registry=https://registry.npmjs.org
if ($LASTEXITCODE -ne 0) { throw 'Native desktop plugin installation failed.' }
$oldPatch = if (Test-Path -LiteralPath $patchPath) { [IO.File]::ReadAllText($patchPath) } else { '' }
$catalogYamlPath = ([IO.Path]::GetFullPath($catalogPath)).Replace('\','/').Replace("'","''")
$reportYamlPath = ([IO.Path]::GetFullPath($reportPath)).Replace('\','/').Replace("'","''")
$entry = "- id: megmeet-product-assistant`n  config:`n    catalogPath: '$catalogYamlPath'`n    maxCandidates: 10`n    maxInputChars: 60000`n    reportDirectory: '$reportYamlPath'`n"
$ownedEntry = '(?ms)^- id: megmeet-product-assistant\r?\n.*?(?=^\S|\z)'
if ([regex]::IsMatch($oldPatch,$ownedEntry)) { $newPatch = [regex]::Replace($oldPatch,$ownedEntry,[System.Text.RegularExpressions.MatchEvaluator]{ param($match) $entry }) }
else { $newPatch = $oldPatch.TrimEnd() + "`n" + $entry }
[IO.File]::WriteAllText($patchPath,$newPatch,[Text.UTF8Encoding]::new($false))
$installed = [IO.File]::ReadAllText((Join-Path $DshHomePath 'profiles\desktop\node_modules\dsh-megmeet\package.json')) | ConvertFrom-Json
if ($installed.version -ne '0.2.0') { throw 'Unexpected installed plugin version.' }
Write-Output "Desktop installed: $($installed.name)@$($installed.version)"
Write-Output "Catalog: $catalogPath"
Write-Output "Reports: $reportPath"
Write-Output "Configuration backup: $backupPath"
