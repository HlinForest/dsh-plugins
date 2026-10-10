from pathlib import Path
import re,json,sys
root=Path(__file__).resolve().parents[1];directory=root/json.loads((root/'records/latest.json').read_text(encoding='utf-8'))['directory']
experiment=json.loads((directory/'experiment.json').read_text(encoding='utf-8'))
for w in experiment['workflows']:
 if len(sys.argv)>1 and w['arm']!=sys.argv[1]:continue
 for s in w['stages']:
  messages=json.loads((directory/w['id']/f"{s['id']}.assistant-messages.json").read_text(encoding='utf-8'))
  report=max(messages,key=lambda m:len(m) if ('结论' in m and ('需求' in m or '候选' in m)) else 0,default='')
  print('\n###',w['id'],s['id'],'COMPLETE',s['success'])
  conclusion=re.search(r'(?:#{1,3}\s*(?:\d[.、 ]*)?\s*结论)([\s\S]*?)(?=\n#{1,3}\s|\Z)',report)
  print((conclusion.group() if conclusion else report)[:2200])
  req=re.search(r'#{1,3}\s*(?:\d[.、 ]*)?\s*需求表[\s\S]*?(?=\n#{1,3}\s|\Z)',report)
  print('REQUIREMENTS:',req.group()[:1800] if req else 'No named requirements section')
  sources=re.search(r'#{1,3}\s*(?:\d[.、 ]*)?\s*资料来源[\s\S]*?(?=\n#{1,3}\s|\Z)',report)
  print('SOURCES:',sources.group()[:950] if sources else 'No named source section')
