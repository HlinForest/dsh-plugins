"""The same connectivity must not pick a different trunk after process restart."""
import copy,json,os,subprocess,sys,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'mcp'))
from constraint_placement import compact

def fixture():
    def port(key,y,side):
        return {'id':key,'x':10 if side=='EAST' else 0,'y':y,
                'layoutOptions':{'elk.port.side':side}}
    return {'children':[
        {'id':'CORE','x':0,'y':0,'width':10,'height':40,
         'ports':[port('CORE.1',10,'EAST'),port('CORE.2',30,'EAST')]},
        {'id':'TAP','x':40,'y':0,'width':10,'height':10,
         'ports':[port('TAP.1',5,'WEST')]},
    ],'edges':[{'id':'first','sources':['CORE.1'],'targets':['TAP.1']},
               {'id':'second','sources':['CORE.2'],'targets':['TAP.1']}]}

def geometry(graph):
    return {n['id']:[n['x'],n['y']] for n in graph['children']}

class ConstraintPlacement(unittest.TestCase):
    def test_restart_hash_order_cannot_choose_different_net_trunk(self):
        code='import sys,json;sys.path.insert(0,sys.argv[1]);from constraint_placement import compact;g=compact(json.loads(sys.stdin.read()));print(json.dumps({n["id"]:[n["x"],n["y"]] for n in g["children"]},sort_keys=True))'
        results=[]
        for seed in ('0','1','2','3','4','5'):
            results.append(subprocess.check_output(
                [sys.executable,'-X','utf8','-c',code,str(ROOT/'mcp')],
                input=json.dumps(fixture()),text=True,encoding='utf-8',
                env={**os.environ,'PYTHONHASHSEED':seed},timeout=15).strip())
        self.assertEqual(len(set(results)),1,results)

    def test_input_arrays_are_not_a_tie_breaking_placement_instruction(self):
        graph=fixture()
        other=copy.deepcopy(graph)
        other['children'].reverse()
        other['edges'].reverse()
        for node in other['children']:node['ports'].reverse()
        self.assertEqual(geometry(compact(graph)),geometry(compact(other)))

if __name__=='__main__':unittest.main()
