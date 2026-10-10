param([switch]$RunModels)
$ErrorActionPreference='Stop'
$projectPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $projectPath
try {
 & npm run success:prepare
 if($LASTEXITCODE -ne 0){throw 'Prepare failed'}
 & npm test
 if($LASTEXITCODE -ne 0){throw 'Tests failed'}
 if($RunModels){
  & node success-demo/scripts/run-benchmark.mjs
  if($LASTEXITCODE -ne 0){throw 'Benchmark failed'}
  & node success-demo/scripts/collect-evidence.mjs
  if($LASTEXITCODE -ne 0){throw 'Evidence verification failed'}
  & python success-demo/scripts/assess.py
 }
 & python success-demo/scripts/build-page.py
 if($LASTEXITCODE -ne 0){throw 'Page generation failed'}
 & python success-demo/scripts/verify-page.py
 if($LASTEXITCODE -ne 0){throw 'Page verification failed'}
} finally { Pop-Location }
