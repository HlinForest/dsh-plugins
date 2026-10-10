from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
rel=json.loads((ROOT/'records/latest.json').read_text(encoding='utf-8'))['directory'];DIR=ROOT/rel
exp=json.loads((DIR/'experiment.json').read_text(encoding='utf-8'))
qualified={'CP20.241-R1','CP20.241-R2','CP20.241-R2-C1','CP20.242-R2'}
records=[]
for w in exp['workflows']:
 for s in w['stages']:
  file=DIR/w['id']/f"{s['id']}.chat.md";text=file.read_text(encoding='utf-8') if file.exists() else ''
  checks={}
  def add(key,pattern,definition):
   m=re.search(pattern,text,re.I|re.S);checks[key]={'observed':bool(m),'definition':definition,'excerpt':text[max(0,m.start()-50):m.end()+80] if m else ''}
  need=216 if s['id']=='initial' else 360
  add('continuousDemand',rf'{need}\s*W|{need}\s*瓦',f'回答提到本轮{need}W连续需求。需人工确认其语义和计算。')
  add('sixSections',r'待确认事项','回答包含待确认事项标题；完整六部分由人工复核。')
  add('version',r'V[12]|5f98af21|fb470b5f', '回答中提到资料库版本或快照前缀。')
  add('sha256',r'[a-f0-9]{64}', '回答中包含完整SHA256；须人工核对用途与值。')
  add('sourceLinks',r'\]\([^\n]+\.pdf(?:[^\n]*)\)', '回答有PDF Markdown链接。')
  add('width',r'65\s*mm|65\s*毫米', '回答核对65mm本体宽度上限。')
  add('relay',r'继电器|RELAY','回答出现继电器条件。')
  add('installation',r'1000\s*m|1\s*000\s*m', '回答核对1000m海拔。')
  add('peakSeparation',r'3\s*(?:s|秒)', '回答提到3秒峰值。需人工确认未将其作为持续能力。')
  if s['id']=='expanded':add('newCandidate',r'CP20\.241-R2','回答提到加入资料库的新候选CP20.241-R2。')
  if s['id']=='changed':add('noMatch',r'无(?:合格|满足|通过)|没有.*?(?:合格|满足|通过)|未.*?找到.*?(?:合格|满足)|未能.*?找到|全部.*?(?:排除|不满足)','回答表达本库无通过全部条件的候选。')
  records.append({'workflow':w['id'],'arm':w['arm'],'repeat':w['repeat'],'stage':s['id'],'runSuccess':s['success'],'checks':checks,'selectionCorrect':None,'manualReviewRequired':True,'sourceFile':f'{w["id"]}/{s["id"]}.md'})
result={'method':'自动检测仅定位词语和原文片段，不等同准确性判定。selectionCorrect由人工根据实际结论填写。','gold':{'initial':['SDR-240-24'],'changed':[],'expanded':sorted(qualified)},'records':records}
(DIR/'assessment.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'records':len(records),'manualReviewRequired':True}))
