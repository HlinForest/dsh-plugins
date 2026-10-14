param([string]$Browser,[string]$Url,[string]$ProfileDirectory)
$ErrorActionPreference = 'Stop'
# A separate desktop renderer gives the title bar the same dimensions and color as Harness.
$edaWorkDirectory = Split-Path -Parent $ProfileDirectory
$edaRuntimeCandidates = @(
    (Join-Path $edaWorkDirectory 'desktop-runtime/electron.exe'),
    (Join-Path $edaWorkDirectory 'desktop-runtime/node_modules/electron/dist/electron.exe')
)
$edaDesktopRuntime = $edaRuntimeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($edaDesktopRuntime) {
    $edaDesktopMain = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../desktop/main.cjs'))
    $edaDesktopProfile = $ProfileDirectory + '-desktop'
    $edaConnection = Join-Path $edaWorkDirectory 'design-window-session.json'
    $edaOldRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        # This is the interactive design window explicitly requested by the user.
        $edaStarted = Start-Process -FilePath $edaDesktopRuntime -WindowStyle Normal -PassThru -ArgumentList @(
            ('"' + $edaDesktopMain + '"'),
            ('"--eda-connection=' + $edaConnection + '"'),
            ('"--eda-profile=' + $edaDesktopProfile + '"')
        )
    } finally { $env:ELECTRON_RUN_AS_NODE = $edaOldRunAsNode }
    $edaStateFile = Join-Path $edaDesktopProfile 'window-state.json'
    for ($edaWait = 0; $edaWait -lt 100; $edaWait++) {
        Start-Sleep -Milliseconds 200
        if (Test-Path -LiteralPath $edaStateFile) {
            try {
                $edaReady = Get-Content -LiteralPath $edaStateFile -Raw | ConvertFrom-Json
                $edaRunning = Get-Process -Id $edaReady.pid -ErrorAction SilentlyContinue
                if ($edaReady.ready -and $edaRunning -and $edaRunning.Path -eq $edaDesktopRuntime) { return }
            } catch { }
        }
        if ($edaStarted.HasExited -and $edaStarted.ExitCode -ne 0) { throw 'The design window could not start. See design-window-desktop/window-error.log.' }
    }
    throw 'The design window did not become ready within 20 seconds.'
}
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class EdaWindow {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder t,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint processId);
 [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h,int attribute,ref uint value,int size);
}
'@
# Match this app's dedicated browser profile, independently of its project title.
function Find-EdaWindow {
$script:edaProcessIds = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($ProfileDirectory,[StringComparison]::OrdinalIgnoreCase) -ge 0
} | ForEach-Object { [uint32]$_.ProcessId })
$script:edaHandle = [IntPtr]::Zero
[EdaWindow]::EnumWindows({ param($h,$l)
    $title = New-Object Text.StringBuilder 512
    [void][EdaWindow]::GetWindowText($h,$title,512)
    [uint32]$edaOwner = 0
    [void][EdaWindow]::GetWindowThreadProcessId($h,[ref]$edaOwner)
    if ([EdaWindow]::IsWindowVisible($h) -and $script:edaProcessIds -contains $edaOwner -and $title.Length -gt 0 -and -not $title.ToString().StartsWith('DevTools')) { $script:edaHandle = $h; return $false }
    return $true
},[IntPtr]::Zero) | Out-Null
}
function Set-EdaWindowAppearance {
    # Windows 11 supports an unobtrusive border; earlier Windows keeps its default.
    [uint32]$edaBorderColor = 0x00e9e5e2
    [void][EdaWindow]::DwmSetWindowAttribute($script:edaHandle,34,[ref]$edaBorderColor,4)
}
Find-EdaWindow
if ($script:edaHandle -ne [IntPtr]::Zero) {
    Set-EdaWindowAppearance
    [void][EdaWindow]::ShowWindow($script:edaHandle,9)
    [void][EdaWindow]::SetForegroundWindow($script:edaHandle)
} else {
    # This is the interactive design window explicitly opened by the engineer.
    Start-Process -FilePath $Browser -ArgumentList @("--app=$Url",'--window-size=1280,850','--no-first-run',('"--user-data-dir=' + $ProfileDirectory + '"'))
    for ($edaAttempt = 0; $edaAttempt -lt 20; $edaAttempt++) {
        Start-Sleep -Milliseconds 100
        Find-EdaWindow
        if ($script:edaHandle -ne [IntPtr]::Zero) { Set-EdaWindowAppearance; break }
    }
}
