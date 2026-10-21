import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

test('output pull-ups face supply upwards while series resistors remain horizontal, independent of names',()=>{
 const script=`
import sys
from pathlib import Path
sys.path.insert(0,'mcp')
from standard_symbols import generate
from symbol_orientation import defaults
from design_audit import child,children
import native_resources as nr
pins=[{'number':str(i),'name':str(i),'type':'passive'} for i in (1,2)]
native,rules=generate('Test:Resistor',{'pins':pins,'componentKind':'resistor'},Path('D:/Kicad/share/kicad'))
resource={'native':native,'drawingRules':rules,'appearance':{'kind':'resistor'}}
for suffix in ('A','Renamed'):
 out='sensor'+suffix+'.7'
 pull='pull'+suffix;series='series'+suffix
 design={'components':[
  {'ref':'sensor'+suffix,'librarySymbol':'Test:Sensor','pins':[{'number':'7','name':'OUT','type':'output'},{'number':'8','name':'GND','type':'power_in'},{'number':'9','name':'VCC','type':'power_in'}]},
  *[{'ref':r,'librarySymbol':'Test:Resistor','pins':pins} for r in (pull,series)]],
 'nets':[{'name':'rail'+suffix,'nodes':[pull+'.2']},{'name':'signal'+suffix,'nodes':[out,pull+'.1',series+'.1']},{'name':'load'+suffix,'nodes':[series+'.2']}],
 'supplied_nets':['rail'+suffix]}
 sensor,_=generate('Test:Sensor',{'pins':design['components'][0]['pins'],'componentKind':'infrared-receiver','value':'receiver'},Path('D:/Kicad/share/kicad'))
 rotations=defaults(design,{'symbols':{'Test:Resistor':resource,'Test:Sensor':{'native':sensor}}})
 ast=nr.parse(native)
 angles={child(p,'number')[1]:float(child(p,'at')[3]) for u in children(ast,'symbol') for p in children(u,'pin')}
 assert (angles['2']+rotations[pull])%360==270
 assert (angles['1']+rotations[series])%360==0
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});

test('series resistor terminals face the actual driver side, including renamed designs',()=>{
 const script=`
import sys
from pathlib import Path
sys.path.insert(0,'mcp')
from standard_symbols import generate
from symbol_orientation import defaults
from design_audit import child,children
import native_resources as nr
pins=[{'number':str(i),'name':str(i),'type':'passive'} for i in (1,2)]
native,rules=generate('T:R',{'pins':pins,'componentKind':'resistor'},Path('D:/Kicad/share/kicad'))
angles={child(p,'number')[1]:float(child(p,'at')[3]) for u in children(nr.parse(native),'symbol') for p in children(u,'pin')}
for side in (0,180):
 for name in ('hub','renamed_controller'):
  hub=f'(symbol "T:Hub" (symbol "Hub_1_1" (pin output line (at 0 0 {side}) (length 2.54) (name "OUT") (number "1"))))'
  design={'components':[{'ref':name,'librarySymbol':'T:Hub','pins':[{'number':'1','name':'OUT','type':'output'},{'number':'2','name':'GND','type':'power_in'},{'number':'3','name':'VCC','type':'power_in'}]},{'ref':'branch','librarySymbol':'T:R','pins':pins}], 'nets':[{'name':'signal','nodes':[name+'.1','branch.1']},{'name':'load','nodes':['branch.2']}]}
  result=defaults(design,{'symbols':{'T:Hub':{'native':hub},'T:R':{'native':native,'drawingRules':rules,'appearance':{'kind':'resistor'}}}})
  assert (angles['1']+result['branch'])%360==(side+180)%360
print('passed')
`;
 assert.match(execFileSync('D:/anaconda/python.exe',['-c',script],{encoding:'utf8',windowsHide:true}),/passed/);
});
