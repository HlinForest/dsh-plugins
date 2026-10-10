import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { createNotifier } from '../src/watcher.js';

if (process.platform !== 'win32') throw new Error('此验证需要本机 Windows 交互桌面');
const logs = [];
const notify = createNotifier({ popup: true, log: message => logs.push(message) });
try {
  await notify({ project: '插件弹窗验证', findings: [{ refs: ['U1'], net: 'ADC_IN', title: '回传电容测试：待确认' }] });
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'PCB 评审提醒')
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$window = $null
$names = @()
while ([DateTime]::UtcNow -lt $deadline) {
  $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
  if ($window) {
    $texts = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $names = @($texts | ForEach-Object { $_.Current.Name })
    if (($names -join ' ').Contains('回传电容测试')) { break }
  }
  Start-Sleep -Milliseconds 200
}
if (-not $window) { throw '未找到弹窗' }
$title = $window.Current.Name
[Console]::OutputEncoding = [Text.Encoding]::UTF8
@{ title = $title; texts = $names } | ConvertTo-Json -Compress
`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 20000 });
  const result = JSON.parse(stdout.trim());
  if (!result.texts.some(t => t.includes('回传电容测试'))) throw new Error('弹窗中文内容不符合预期');
  await mkdir('verification', { recursive: true });
  await writeFile('verification/popup.json', JSON.stringify({ testedAt: new Date().toISOString(), passed: true, ...result }, null, 2));
  console.log('Windows 弹窗已显示，中文内容核对通过，已自动关闭。');
} catch (error) {
  console.error(error.stderr || error.message);
  console.error(logs.join('\n'));
  process.exitCode = 1;
} finally { notify.dispose(); }
