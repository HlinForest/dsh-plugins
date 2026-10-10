param([string]$Mode = 'launch')
$ErrorActionPreference = 'Stop'
$candidates = @('D:\anaconda\pythonw.exe', (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\pythonw.exe'), 'D:\Kicad\bin\pythonw.exe')
$runtime = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $runtime) { throw '未找到本机 Python 运行环境。' }
$scriptFile = Join-Path $PSScriptRoot 'demo_host.py'
Start-Process -FilePath $runtime -ArgumentList @(('"' + $scriptFile + '"'), $Mode) -WindowStyle Hidden
