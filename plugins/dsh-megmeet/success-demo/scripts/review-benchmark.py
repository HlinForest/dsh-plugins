from pathlib import Path
import json,re,unicodedata,urllib.parse
ROOT=Path(__file__).resolve().parents[1];DIR=ROOT/json.loads((ROOT/'records/latest.json').read_text(encoding='utf-8'))['directory']
exp=json.loads((DIR/'experiment.json').read_text(encoding='utf-8'));rows=[]
assert DIR.name=='primary-comparison' and exp.get('provenance',{}).get('aligned')=='records/experiment-2026-10-09T07-13-48-447Z','Review annotations apply only to the archived primary comparison. New runs require a fresh review.'
# These decisions follow review of the saved conclusions against all three gold scenarios.
# Phrase detection below is only a delivery check. It does not prove engineering correctness.
notes={
 ('a-1','initial'):['把 NDR-240-24 的资料缺失写成“不满足”，与同句“待确认”不一致。'],
 ('a-2','changed'):['把安装间距并入放宽后的宽度，给出101.5mm；本体宽度与间距应分别核对。','SDR-480在完整176–264VAC区间的连续能力采用图读外推；共同引擎保持待确认。'],
 ('a-3','changed'):['“降载到≤240W”未应用20%裕量；保留该裕量时应为≤200W。'],
 ('a-3','expanded'):['provider max-tokens：完整选型报告尚未输出。失败保留，不作为正确完成。'],
 ('b-1','expanded'):['称CP20.241-R2是唯一满足的型号，但库中同系列另有3个满足的变体。'],
 ('b-3','initial'):['V1报告提到尚未入库PULS型号可作第二货源；应先扩库再正式校验。'],
 ('c-1','expanded'):['聊天把SDR-480在230VAC的额定能力与全输入区间结论混列。保存的引擎结果对完整输入区间保持待确认。'],
 ('c-3','initial'):['聊天称14项通过；引擎实际解析15项。'],
 ('d-1','initial'):['SDR-240-24的15项均通过，却把“满足已列条件、仍需工程确认”改写成“待确认”。'],
 ('d-1','expanded'):['四个候选均通过，却称满足仍为0。推荐型号正确，状态与引擎不一致。']
}
def present(pattern,text):return bool(re.search(pattern,text,re.I|re.S))
def evidence_links(text):
 refs=re.findall(r'\[[^\]]*\]\(([^\n)]+\.pdf(?:#[^\n)]*)?)\)',text,re.I);values=[]
 for ref in refs:
  ref=urllib.parse.unquote(ref.split('#')[0]);ref=ref.removeprefix('file:///');p=Path(ref)
  if p.is_absolute():values.append({'path':str(p),'exists':p.exists()})
 return values
for w in exp['workflows']:
 for s in w['stages']:
  text=(DIR/w['id']/f"{s['id']}.chat.md").read_text(encoding='utf-8');clean=unicodedata.normalize('NFKC',text).replace('**','');flat=re.sub(r'\s+','',clean)
  need=216 if s['id']=='initial' else 360;temp=25 if s['id']=='initial' else 55
  fields={
   'output_voltage':r'24V','output_type':r'VDC|24VDC|输出类型.{0,12}DC',
   'input_voltage':r'176[^0-9]{0,12}264','input_type':r'VAC|输入类型.{0,12}AC',
   'frequency':r'50[^0-9]{0,8}60Hz','mounting':r'导轨|DIN',
   'body_width':r'65mm|65毫米|本体宽度.{0,10}65','dc_ok_relay':r'继电器',
   'continuous_power':rf'{need}W','temperature':rf'{temp}°?C|{temp}℃',
   'orientation':r'垂直','altitude':r'1000m|海拔.{0,12}1000',
   'top_clearance':r'上(?:方)?(?:间距)?[^\n]{0,22}50|50[/、,|]40[/、,|]15',
   'bottom_clearance':r'下(?:方)?(?:间距)?[^\n]{0,22}40|50[/、,|]40[/、,|]15',
   'side_clearance':r'侧(?:面)?(?:间距)?[^\n]{0,22}15|50[/、,|]40[/、,|]15'}
  mentioned={k:present(p,flat) for k,p in fields.items()};mentioned['orientation']=mentioned['orientation'] and present(r'输入端(?:子)?(?:位于|在)?(?:朝)?下|输入端子(?:位于)?底部',flat)
  headings=['结论','需求表','候选表','计算依据','资料来源','待确认事项'];sections={h:present(r'(?:^|\n)#{1,4}\s*[^\n]*'+h,clean) for h in headings}
  links=evidence_links(text);delivery={'localPDF':bool(links) and all(x['exists'] for x in links),'pageNumber':present(r'第\s*\d+\s*页|\bp\.?\s*\d+|PDF.*?页码',clean),'manufacturerVersion':present(r'2025-02-17|Rev\.?\s*1\.[39]',clean)}
  claims=s['success'] and not (w['id']=='d-1' and s['id'] in ['initial','expanded'])
  main=s['success'];cli=sum('lib/cli' in json.dumps(c,ensure_ascii=False) for c in s['toolCalls'])
  rows.append({'workflow':w['id'],'arm':w['arm'],'repeat':w['repeat'],'stage':s['id'],'runSuccess':s['success'],'mainSelectionCorrect':main,'primaryStatusConsistent':claims,'manualConclusionReviewed':True,'reviewer':'Codex','reviewScope':'推荐型号/无合格候选的主结论，与保存的共同引擎及原件依据比较。不是全文无错误评分。','chatRequirementMentions':mentioned,'missingMentionCount':sum(not v for v in mentioned.values()),'chatSixSections':sections,'sixSectionsInChat':all(sections.values()),'evidenceDelivery':delivery,'evidenceDeliveryCount':sum(delivery.values()),'pdfLinks':links,'snapshotMatchesRecordedInput':s['catalogSHA256']==('fb470b5f6a03275395d674e891a1279b8ed3f87bb8b29721717b3a1ea207cf47' if s['id']=='expanded' else '5f98af21efa2edffe1956afd634a9e5544561a2a9435b1a0bdc3aa905db41904'),'genericToolCallsToSharedCLI':cli,'notes':notes.get((w['id'],s['id']),[]),'sourceFile':f"{w['id']}/{s['id']}.chat.md"})
summary={}
for arm in 'abcd':
 rs=[r for r in rows if r['arm']==arm];stages=[s for w in exp['workflows'] if w['arm']==arm for s in w['stages']]
 summary[arm]={'steps':len(rs),'completed':sum(r['runSuccess'] for r in rs),'correctMainSelection':sum(r['mainSelectionCorrect'] for r in rs),'consistentPrimaryStatus':sum(r['primaryStatusConsistent'] for r in rs),'completeSixSectionsInChat':sum(r['sixSectionsInChat'] for r in rs),'all15RequirementsMentioned':sum(r['missingMentionCount']==0 for r in rs),'evidenceDelivery3of3':sum(r['evidenceDeliveryCount']==3 for r in rs),'snapshotsConsistent':sum(r['snapshotMatchesRecordedInput'] for r in rs),'toolCalls':sum(len(s['toolCalls']) for s in stages),'tokens':sum(u.get('totalTokens',0) for s in stages for u in s['usage']),'seconds':round(sum(s['elapsedMs'] for s in stages)/1000,1)}
result={'method':'主选型与主状态由Codex复核。条件覆盖是聊天对15项规范化硬条件的数值提及检测；六部分和证据入口也是交付检测，不是工程正确性的替代。PDF入口、页码、厂家版本构成3项证据交付维度；未对每个生成句子作完整事实评分。原件哈希与输入快照另由复现脚本核对。','summary':summary,'records':rows,'limitations':exp['limitations']+['A3通过通用PowerShell自行发现并调用了共同引擎CLI（3轮合计8次）。名义接入方式不是工具访问隔离；该流程有能力交叉，保留并明确呈现。','所有组都可能补充错误建议。人工复核发现的问题逐条保留，不能把主结论正确读成全文无错。']}
(DIR/'assessment.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps(summary,ensure_ascii=False))
