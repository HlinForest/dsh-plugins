import json,pathlib,sys
root=pathlib.Path(__file__).parents[1]
sys.path.insert(0,str(root/'mcp'))
from precise_mcp import SCHEMAS,DESCRIPTIONS
(root/'mcp/schema.json').write_text(json.dumps({'tools':[{'name':n,'description':DESCRIPTIONS[n],'inputSchema':s} for n,s in SCHEMAS.items()]},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('MCP schema synchronized:',len(SCHEMAS),'tools')
