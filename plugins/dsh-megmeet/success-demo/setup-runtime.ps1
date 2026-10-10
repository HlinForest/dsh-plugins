$ErrorActionPreference='Stop'
$projectPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $projectPath
try {
 & npm ci --ignore-scripts
 if($LASTEXITCODE -ne 0){throw 'Project dependency installation failed'}
 & npm install --prefix .verification/dsh-host --ignore-scripts --save-exact '@deepseek-ai/dsh@0.2.0-rc.2'
 if($LASTEXITCODE -ne 0){throw 'DSH runtime installation failed'}
 & python -m pip install -r success-demo/requirements.txt
 if($LASTEXITCODE -ne 0){throw 'Python verification dependencies failed'}
 Write-Output 'Runtime prepared. Use the installed Edge browser. Log in to DSH before running model comparisons.'
} finally { Pop-Location }
