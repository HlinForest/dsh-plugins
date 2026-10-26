import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('ERC parser preserves diagnostics and refuses missing, inconsistent or unknown severities', () => {
  const output = execFileSync('D:/anaconda/python.exe', ['-c', `import sys
sys.path.insert(0,'mcp')
from erc_report import parse_report
text='''ERC report (fixture, Encoding UTF8)
Report includes: Errors, Warnings, Exclusions
***** Sheet /
[pin_not_connected]: Pin not connected
    ; error
    @(10.00 mm, 20.00 mm): Symbol R1 Pin 1
[label_dangling]: Label not connected
    ; warning
    @(10.00 mm, 30.00 mm): Label SIGNAL
 ** ERC messages: 2  Errors 1  Warnings 1
'''
r=parse_report(text);assert r['violation_count']==2
assert r['sheets'][0]['violations'][0]['items'][0]['description'].endswith('Symbol R1 Pin 1')
for bad in [text.replace('Errors 1','Errors 0'),text.split(' ** ERC messages:')[0],text.replace('; error','; unknown')]:
 try:parse_report(bad)
 except ValueError:pass
 else:raise AssertionError('invalid ERC accepted')
print('passed')`], { encoding: 'utf8', windowsHide: true });
  assert.match(output, /passed/);
});
