param(
    [string]$Profile = 'desktop',
    [string]$DshHomePath = (Join-Path $env:USERPROFILE '.dsh')
)
$ErrorActionPreference = 'Stop'
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid profile name.' }
$taskProfile = Join-Path $DshHomePath "profiles/$Profile"
$taskManifest = Join-Path $taskProfile 'node_modules/dsh-eda-flow/package.json'
if (-not (Test-Path -LiteralPath $taskManifest)) { throw "EDA Flow is not installed in profile $Profile." }
$taskInstalled = (Get-Content -LiteralPath $taskManifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
$taskReport = [ordered]@{ profile = $Profile; installedVersion = $taskInstalled; runningVersion = $null; activation = 'not-detected' }
$taskPatch = Get-Content -LiteralPath (Join-Path $taskProfile 'cordis.patch.yml') -Raw -Encoding UTF8
# Read only the plugin's two directory scalars, never model/login configuration.
$taskConfig = @{}
if ($taskPatch.TrimStart().StartsWith('[')) {
    $taskEntry = ($taskPatch | ConvertFrom-Json) | Where-Object { $_.id -eq 'eda-flow' } | Select-Object -First 1
    if ($taskEntry) { $taskConfig.workspaceRoot = $taskEntry.config.workspaceRoot; $taskConfig.workDirectory = $taskEntry.config.workDirectory }
} else {
    $taskBlock = [regex]::Match($taskPatch, '(?ms)^-\s+id:\s*[''"]?eda-flow[''"]?\s*\r?\n(?<body>.*?)(?=^-\s|\z)')
    foreach ($taskField in @('workspaceRoot','workDirectory')) {
        $taskMatch = [regex]::Match($taskBlock.Groups['body'].Value, '(?m)^\s+' + $taskField + ':\s*(.*?)\s*$')
        if ($taskMatch.Success) {
            $taskValue = $taskMatch.Groups[1].Value.Trim()
            if ($taskValue.StartsWith('"')) { $taskValue = $taskValue | ConvertFrom-Json }
            elseif ($taskValue.StartsWith("'")) { $taskValue = $taskValue.Trim("'").Replace("''", "'") }
            else { $taskValue = ($taskValue -replace '\s+#.*$', '').Trim() }
            $taskConfig[$taskField] = $taskValue
        }
    }
}
$taskDirectory = $taskConfig.workDirectory
if (-not $taskDirectory -and $taskConfig.workspaceRoot) { $taskDirectory = Join-Path $taskConfig.workspaceRoot 'eda-flow' }
if ($taskDirectory -and [IO.Path]::IsPathRooted($taskDirectory)) {
    $taskSession = Join-Path $taskDirectory 'design-window-session.json'
    if (Test-Path -LiteralPath $taskSession) {
        try {
            $taskWindow = Get-Content -LiteralPath $taskSession -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($taskWindow.port -lt 1 -or $taskWindow.port -gt 65535 -or $taskWindow.key -notmatch '^[a-f0-9]{64}$' -or $taskWindow.cookieName -notmatch '^eda_flow_[a-f0-9]+$') { throw 'Invalid window session metadata.' }
            $taskRequest = [Net.HttpWebRequest]::Create("http://127.0.0.1:$($taskWindow.port)/api/eda-flow/bootstrap")
            $taskRequest.Proxy = $null
            $taskRequest.Timeout = 5000
            $taskRequest.Headers['Cookie'] = "$($taskWindow.cookieName)=$($taskWindow.key)"
            $taskResponse = $null; $taskReader = $null
            try {
                $taskResponse = $taskRequest.GetResponse()
                $taskReader = New-Object IO.StreamReader($taskResponse.GetResponseStream())
                $taskBoot = $taskReader.ReadToEnd() | ConvertFrom-Json
            } finally {
                if ($taskReader) { $taskReader.Dispose() }
                if ($taskResponse) { $taskResponse.Dispose() }
            }
            if (-not $taskBoot.ok -or -not $taskBoot.value.version) { throw 'No backend version returned.' }
            $taskReport.runningVersion = $taskBoot.value.version
            $taskReport.activation = if ($taskReport.runningVersion -eq $taskInstalled) { 'active' } else { 'restart-required' }
        } catch { $taskReport.activation = 'window-not-reachable' }
    }
}
$taskReport | ConvertTo-Json
if ($taskReport.activation -eq 'restart-required') {
    Write-Output 'Files are updated, but the running backend is older. Exit Harness normally when convenient, reopen it, and open Circuit Design from its icon. Closing only the design window may keep the old backend alive.'
} elseif ($taskReport.activation -ne 'active') {
    Write-Output 'The running version could not be verified. Open Circuit Design from Harness, then run this check again. No project or model settings were changed.'
}
