import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('process symbols contain Chinese and mixed-language descriptions without source geometry',()=>{
 const script=`
import sys,unicodedata
from pathlib import Path
sys.path.insert(0,'mcp')
from standard_symbols import generate
from native_resources import parse
from design_audit import child,children
for label in ['工艺图形：单面板CQC UL等丝印位置框','工艺图形：二维码条块；6mm*6mm','Assembly verification and optical fiducial marks']:
 native,_=generate('Test:Process',{'pins':[],'componentKind':'process','reference':'MARK','value':'.','materialDescription':label},Path('D:/Kicad/share/kicad'))
 tree=parse(native);unit=children(tree,'symbol')[0]
 box=child(unit,'rectangle');start=child(box,'start');end=child(box,'end')
 width=abs(float(start[1])-float(end[1]));height=abs(float(start[2])-float(end[2]))
 texts=children(unit,'text')
 assert ''.join(t[1] for t in texts)==label
 for text in texts:
  advance=sum(1.27 if unicodedata.east_asian_width(c) in ('W','F') else .9 for c in text[1])
  assert advance<=width-5.08+.001,(text[1],advance,width)
  assert abs(float(child(text,'at')[2]))+1.27<height/2
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});
