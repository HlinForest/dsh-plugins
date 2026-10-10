from pathlib import Path
import json, hashlib, html, re
from datetime import datetime
from urllib.parse import quote, unquote
import mistune

ROOT = Path(__file__).resolve().parent
def read(name): return json.loads((ROOT / name).read_text(encoding='utf-8-sig'))
def esc(value): return html.escape(str(value), quote=True)
manifest=read('experiment.json'); data=read('deterministic-results.json'); tests=read('test-cases.json')['cases']
catalog=read('catalog.real.json'); downloads=read('materials/download-manifest.json')
facts=read('materials/mpt-product-facts.json'); procurement=read('requirements/cases.json')['cases']
stats={}; outputs={}; runtimes={}
prompt_hash=hashlib.sha256((ROOT/'prompt.txt').read_bytes()).hexdigest()
assert prompt_hash==manifest['promptSHA256']
for arm in ['baseline','plugin']:
    meta=read(f'runs/{arm}.metadata.json'); runtime=read(f'runs/{arm}.runtime-evidence.json'); runtimes[arm]=runtime
    events=[json.loads(line) for line in (ROOT/f'runs/{arm}.events.jsonl').read_text(encoding='utf-8').splitlines() if line.startswith('{')]
    text=(ROOT/f'{arm}.md').read_text(encoding='utf-8'); outputs[arm]=text
    assert meta['success'] and meta['exitCode']==0 and not meta['errors']
    assert meta['promptSHA256']==prompt_hash and prompt_hash in runtime['persistedPromptSHA256']
    assert text==next(e['text'] for e in reversed(events) if e['type']=='final')+'\n', 'Original answer was edited'
    assert all(m['provider']==manifest['provider'] and m['model']==manifest['model'] for m in runtime['models'])
    stats[arm]={'seconds':round((datetime.fromisoformat(meta['finishedAt'])-datetime.fromisoformat(meta['startedAt'])).total_seconds(),2),'calls':runtime['toolCalls'],'steps':len(meta['usage']),'tokens':sum(u.get('totalTokens',0) for u in meta['usage'])}
assert runtimes['baseline']['persistedPromptSHA256']==runtimes['plugin']['persistedPromptSHA256']
assert runtimes['plugin']['installedPlugin']=='dsh-megmeet@0.1.3' and runtimes['plugin']['installedCodeMatchesBuild'] and runtimes['plugin']['catalogMatchesPromptData']
assert [d['id'] for d in read('runs/config-difference.json')]==['megmeet-product-assistant']
assert runtimes['baseline']['toolCalls']==0
evidence=read('runs/plugin.session-evidence.json'); full_results=[]
for e in evidence:
    if e['type']=='tool/result':
        message=e['data']['message']; assert not message['isError']
        text=''.join(b.get('text','') for b in message['content'] if b['type']=='text')
        stored_file=None
        try: value=json.loads(text)
        except json.JSONDecodeError:
            # DSH rc.2 spills large tool outputs; recover the original, never parse the truncated preview.
            match=re.search(r'Full formatted result stored at: (.+?)\. Use read',text)
            assert match, 'Missing original spilled output'
            spill=Path(match.group(1))
            assert re.match(r'^D:\\temp\\dsh-spill-[\w-]+\\session-[\w-]+\\[\da-f]+-megmeet_(search_products|generate_solution_report)\.txt$',str(spill)), 'Unexpected spill address'
            destination=ROOT/'runs/tool-spills'/f'{message["toolCallId"]}.json'
            original=destination.read_bytes() if destination.exists() else spill.read_bytes(); value=json.loads(original)
            destination.parent.mkdir(exist_ok=True);destination.write_bytes(original)
            stored_file=destination.relative_to(ROOT).as_posix()
        full_results.append({'callId':message['toolCallId'],'result':value,**({'originalSpillFile':stored_file} if stored_file else {})})
(ROOT/'runs/tool-results.full.json').write_text(json.dumps(full_results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
assert len(full_results)==runtimes['plugin']['toolCalls']
manifest.update({'status':'completed','stats':stats,'outputFilesUnedited':True,'sameActualModel':True,'samePersistedPrompts':True,'configurationDifference':['megmeet-product-assistant'],'round1Archive':'round1-v0.1.2','assessment':'Both arms must be assessed against the deterministic results. No statistical accuracy improvement is claimed.'})
(ROOT/'experiment.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
verification=read('verification.json'); verification['pairedModelRun']={'pass':True,'samePromptSHA256':prompt_hash,'actualPlugin':runtimes['plugin']['installedPlugin'],'uneditedAnswers':True,'tools':stats['plugin']['calls']};(ROOT/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

class BrowserRenderer(mistune.HTMLRenderer):
    def link(self,text,url,title=None):
        if re.match(r'^[A-Za-z]:[\\/]',url):
            p=Path(unquote(url.split('#')[0])).resolve()
            try: href=quote(p.relative_to(ROOT).as_posix(),safe='/')
            except ValueError: href=p.as_uri()
        elif url.startswith(('https://','http://')): href=url
        else: return text
        return f'<a href="{esc(href)}" target="_blank" rel="noopener noreferrer">{text}</a>'
markdown=mistune.create_markdown(renderer=BrowserRenderer(escape=True),plugins=['table'])
def render(md): return markdown(md)
def counts(result): return {s:sum(c['status']==s for c in result['candidates']) for s in ['matches_listed_constraints','needs_confirmation','incompatible']}
rows=''; detail=''
for i,case in enumerate(data['cases']):
    basic=counts(case['basic']); full=counts(case['full']); t=next(t for t in tests if t['id']==case['id'])
    ids=[c['productId'] for c in case['basic']['candidates'] if c['status']=='matches_listed_constraints']
    screen=', '.join(ids) if ids else '无通过型号'
    rows+=f'<tr><td><button class="case-link" data-case="{i}">{esc(case["title"])}</button><small>{esc(case["id"])}</small></td><td>{esc(screen)}</td><td>{full["needs_confirmation"]} 待确认 / {full["incompatible"]} 不匹配</td><td><a href="reports/{case["id"]}.md" target="_blank">逐项记录</a></td></tr>'
    candidate_rows=''
    for c in case['full']['candidates']:
        failures=[ch['label'] for ch in c['checks'] if ch['status']=='fail']; unknown=[ch['label'] for ch in c['checks'] if ch['status']=='unknown']
        status='待确认' if c['status']=='needs_confirmation' else '不匹配'
        color='pending' if c['status']=='needs_confirmation' else 'fail'
        candidate_rows+=f'<tr><td>{esc(c["productId"])}</td><td><span class="{color}">{status}</span></td><td>{esc("、".join(failures) or "—")}</td><td>{esc("、".join(unknown) or "—")}</td></tr>'
    detail+=f'<section class="case-detail" id="case-{i}" {"hidden" if i else ""}><h3>{esc(case["title"])}</h3><p>{esc(t["scope"])}。<a href="{esc(t["source"]["url"])}" target="_blank" rel="noopener noreferrer">采购原文</a> · <a href="{esc(t["source"]["local_snapshot"])}" download>原文快照</a></p><details><summary>查看整理后的测试输入及未解析条件</summary><pre>{esc(t["fullRequest"])}</pre><p>仍需确认：{esc("；".join(case["full"]["requirements"]["unresolved"]))}</p></details><div class="table-scroll"><table><thead><tr><th>真实型号</th><th>完整条件</th><th>明确不匹配字段</th><th>参数证据缺失</th></tr></thead><tbody>{candidate_rows}</tbody></table></div></section>'
materials=''
for series in facts['products']:
    item=next(i for i in downloads if i['documentPath']==series['manual'])
    materials+=f'<tr><td>{esc(series["series"])} <small>{esc(series["generation"])}代 / {len(series["models"])} 型号</small></td><td><a href="materials/{esc(series["manual"])}#page=1" target="_blank">{esc(item["title"])}</a></td><td>2026-08-12<small>官网列示日期；原文未标修订号</small></td><td><code>{esc(item["sha256"][:12])}</code></td></tr>'
product_rows=''
for series in facts['products']:
    for m in series['models']:
        product_rows+=f'<tr data-product="{esc(m["model"].lower())}"><td><a href="materials/{series["manual"]}#page=1" target="_blank">{esc(m["model"])}</a></td><td>{m["output_voltage_v"]}V</td><td>{m["rated_power_w"]:g}W</td><td>{esc(series["input_voltage"])}</td><td>Typ. {m["efficiency_typical_pct"]:g}%</td></tr>'
source_rows=''
for c in procurement:
    s=c['source']; source_rows+=f'<li><a href="{esc(s["url"])}" target="_blank" rel="noopener noreferrer">{esc(s["publisher"])}：{esc(s["title"])}</a><small>{esc(s["publication_date"])} · {esc(s["source_kind"])} · <a href="{esc(s["local_snapshot"])}" download>原文快照</a></small></li>'
comparison=''.join(f'<article class="answer"><div class="answer-head"><h3>{"无插件" if arm=="baseline" else "已安装插件 v0.1.3"}</h3><small>{stats[arm]["calls"]} 次工具调用 · {stats[arm]["seconds"]} 秒 · {stats[arm]["tokens"]:,} tok</small><a href="{arm}.md" download>下载原始回答</a></div><div class="markdown">{render(outputs[arm])}</div></article>' for arm in ['baseline','plugin'])
SVG='''<svg viewBox="0 0 760 205" role="img" aria-label="输入电压区间比较：客户要求176到264V，部分大功率型号从180V起"><text x="0" y="31">采购要求</text><text x="0" y="80">MPT350 高压档</text><text x="0" y="129">MPT600</text><g transform="translate(172 0)"><rect x="36" y="12" width="528" height="28" fill="#008b8c"/><rect x="60" y="61" width="504" height="28" fill="#627582"/><rect x="60" y="110" width="504" height="28" fill="#627582"/><rect x="36" y="58" width="24" height="85" fill="#c64537" opacity=".3"/><line x1="36" y1="4" x2="36" y2="164" stroke="#c64537" stroke-dasharray="4 4"/><line x1="60" y1="4" x2="60" y2="164" stroke="#627582" stroke-dasharray="4 4"/><text x="21" y="183">176V</text><text x="67" y="183">180V</text><text x="534" y="183">264V</text></g></svg>'''
page=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>真实物料与需求测试 · DSH 麦格米特插件</title><style>
:root{{--ink:#16313d;--muted:#5c6e78;--teal:#008b8c;--line:#dce4e7;--blue:#285ad9}}*{{box-sizing:border-box}}body{{margin:0;background:#f4f7f8;color:var(--ink);font:15px/1.7 'Microsoft YaHei','Segoe UI',sans-serif}}a{{color:var(--blue);text-underline-offset:3px}}button,input{{font:inherit}}button{{cursor:pointer}}header,main{{max-width:1420px;margin:auto;padding:26px 36px}}header{{background:#fff;border-top:5px solid var(--teal)}}h1{{font-size:30px;line-height:1.4;margin:8px 0 12px}}h2{{font-size:23px;margin:0 0 16px}}h3{{font-size:18px}}p{{max-width:88ch}}small{{display:block;color:var(--muted);font-size:12px}}.topline{{display:flex;justify-content:space-between;gap:16px;color:var(--teal);font-weight:600}}.summary{{color:var(--muted);margin-bottom:20px}}nav{{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow:auto}}nav button{{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted);padding:12px 18px;white-space:nowrap}}nav button[aria-selected=true]{{color:var(--teal);border-bottom-color:var(--teal);font-weight:600}}main{{padding-top:28px}}[hidden]{{display:none!important}}.panel{{background:#fff;padding:28px;border:1px solid var(--line)}}.focus{{display:grid;grid-template-columns:1fr 1.4fr;gap:30px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:26px}}.focus p{{color:var(--muted)}}figure{{margin:0}}svg{{display:block;width:100%;height:auto;font-family:'Microsoft YaHei',sans-serif;font-size:13px}}figcaption{{font-size:12px;color:var(--muted)}}table{{border-collapse:collapse;width:100%;text-align:left}}th,td{{border-bottom:1px solid var(--line);padding:11px 12px;vertical-align:top}}th{{color:var(--muted);font-size:12px;background:#f4f7f8;font-weight:600}}.table-scroll{{overflow:auto}}.case-link{{background:none;border:0;padding:0;color:var(--blue);text-align:left}}.case-link:hover{{text-decoration:underline}}.case-detail{{margin-top:28px;border-top:2px solid var(--teal);padding-top:10px}}.pending{{color:#946317}}.fail{{color:#b13930}}.note{{padding:14px 18px;background:#f0f7f7;border-left:3px solid var(--teal);margin:18px 0;color:#395a62}}pre{{white-space:pre-wrap;word-break:break-word;background:#f5f7f8;padding:16px;font-size:13px}}code{{font-family:Consolas,monospace;font-size:12px;overflow-wrap:anywhere}}details{{margin:16px 0}}summary{{cursor:pointer;color:var(--blue)}}.comparison{{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}}.answer{{border:1px solid var(--line);min-width:0}}.answer-head{{padding:18px 22px;border-bottom:1px solid var(--line);background:#f5f8f9}}.answer-head h3{{margin:0}}.answer-head a{{font-size:12px}}.markdown{{padding:20px 22px;font-size:13px;overflow-wrap:anywhere}}.markdown h1{{font-size:20px}}.markdown h2{{font-size:18px;margin-top:26px}}.markdown h3{{font-size:15px}}.markdown table{{font-size:12px;display:block;overflow:auto}}.markdown p{{max-width:unset}}.markdown ul,.markdown ol{{padding-left:22px}}.markdown hr{{border:0;border-top:1px solid var(--line);margin:24px 0}}.source-list{{padding-left:22px}}.source-list li{{margin:16px 0}}.search{{margin:20px 0;display:flex;gap:12px;align-items:center}}input{{padding:9px 12px;border:1px solid var(--line);min-width:280px}}.native{{width:100%;height:auto;display:block;border:1px solid var(--line)}}footer{{padding-top:24px;color:var(--muted);font-size:12px}}@media(max-width:800px){{header,main{{padding:20px 16px}}h1{{font-size:25px}}.panel{{padding:18px}}.focus,.comparison{{grid-template-columns:1fr}}nav button{{padding:10px 12px}}.topline{{flex-wrap:wrap}}th,td{{padding:9px;min-width:95px}}input{{min-width:0;width:100%}}}}
</style></head><body><header><div class="topline"><span>麦格米特工业电源 / DeepSeek Harness</span><a href="../demo-comparison/index.html">查看最初的虚构数据对比</a></div><h1>真实规格书与公开需求测试</h1><p class="summary">8 份官方工业电源原件，28 个真实型号，4 个公开采购出处。已整理 6 条测试输入，并保存同一 Prompt 的两组模型原始回答。资料采集于 2026-10-09。</p><nav role="tablist" aria-label="演示视图"><button role="tab" aria-selected="true" data-tab="results">测试结果</button><button role="tab" aria-selected="false" data-tab="compare">原始输出对照</button><button role="tab" aria-selected="false" data-tab="materials">真实物料与规格书</button><button role="tab" aria-selected="false" data-tab="links">聊天来源链接</button><button role="tab" aria-selected="false" data-tab="method">方法与范围</button></nav></header><main>
<section id="results" class="panel"><div class="focus"><div><h2>功率足够，输入范围仍可能不满足</h2><p>24V、至少 240W、输入 176–264VAC：MPT350 与 MPT600 的高压输入从 180V 起。176V 到 180V 前这一段不能用典型值或额定功率补足。</p><p>这批型号中，本条基础初筛为 <strong>0 个通过</strong>；其他需求仍需核对冗余、报警、保护等完整条款。</p></div><figure>{SVG}<figcaption>图中仅展示高压段。MPT350 另有 90–132V 低压段，不能合并成连续 90–264V。</figcaption></figure></div><h2>6 条来源明确的测试需求</h2><p>点击需求查看 28 个型号的逐项结果。初筛只比较已经列出的基础字段，完整条件会保留尚未解析或缺少证据的要求。</p><div class="table-scroll"><table><thead><tr><th>真实需求出处 / 整理后的子需求</th><th>基础字段通过</th><th>完整条件（28型号）</th><th>保存记录</th></tr></thead><tbody>{rows}</tbody></table></div><div class="note">{esc(read('test-cases.json')['clarification'])}</div>{detail}</section>
<section id="compare" class="panel" hidden><h2>同一 Prompt，原始回答并排查看</h2><p>两组均调用 deepseek-flash / high，使用同样的数据、来源与输入文本。只有右侧安装插件。原始回答未经改写，模型叙述和计数应与“测试结果”中的确定性记录核对。</p><div class="note">不能用这一个样本证明准确率提升。插件提供的是可重跑的条件校验和工具记录；普通模型也可能给出同样正确的结论。首次真实测试发现“双路”判定不足，原始记录另存于 <a href="round1-v0.1.2/plugin.md">v0.1.2 原回答</a>；本轮 v0.1.3 已补充输出路数校验。</div><div class="comparison">{comparison}</div></section>
<section id="materials" class="panel" hidden><h2>8 份官方工业电源原件</h2><p>点击规格书直接打开下载的原版 PDF。原件为扫描文件，选型表已人工核对；文件快照日期和哈希用于确定本次读取的版本。</p><div class="table-scroll"><table><thead><tr><th>系列</th><th>可点击原件</th><th>日期与版本</th><th>SHA-256前12位</th></tr></thead><tbody>{materials}</tbody></table></div><p><a href="materials/download-manifest.json" download>完整下载清单与哈希</a> · <a href="catalog.real.json" download>插件真实产品库 JSON</a> · <a href="https://megmeet.com/service?id=75" target="_blank" rel="noopener noreferrer">麦格米特官网下载中心</a></p><h3>28 个真实型号</h3><div class="search"><label for="product-search">筛选型号</label><input id="product-search" placeholder="例如 MPT150 或 24V"></div><div class="table-scroll"><table><thead><tr><th>真实型号 / 原文行</th><th>输出电压</th><th>额定功率</th><th>原件输入范围</th><th>典型效率（不作保证下限）</th></tr></thead><tbody id="product-rows">{product_rows}</tbody></table></div><h3>附加下载资料</h3><p>医疗电源目录：<a href="materials/megmeet-medical-chinese-v3.0.pdf" target="_blank">中文版 V3.0</a>、<a href="materials/megmeet-medical-english-v2.3.pdf" target="_blank">英文版 V2.3</a>、<a href="materials/megmeet-medical-japanese-v2.1.pdf" target="_blank">日文版 V2.1</a>。它们未混入工业型号测试库。</p><h3>4 个公开需求出处</h3><ul class="source-list">{source_rows}</ul></section>
<section id="links" class="panel" hidden><h2>在聊天里点击版本，直接核对 PDF</h2><p>已在 DSH v0.2.0-rc.2 原生网页聊天中实际点击验证。本地 PDF 在右侧预览，文本资料可打开到指定行；同一聊天组件也用于桌面版。</p><a href="native-chat-real-plugin.png" target="_blank"><img class="native" src="native-chat-real-plugin.png" alt="实际DSH聊天点击本地资料版本后在右侧打开PDF的截图"></a><p><a href="native-chat-link-verification.json">点击验证记录</a> · <a href="native-chat-links.png" target="_blank">文本链接验证截图</a></p><p>报告里的资料版本现在保留原件链接，官网下载入口另列。原文未标修订号时明确记录快照日期和文件哈希，避免把下载日说成规格书修订日。</p></section>
<section id="method" class="panel" hidden><h2>可以复核的演示</h2><ol><li>从麦格米特官网下载中心检索 MPT，下载 8 份当前列示的使用指导书，保留 PDF、官方地址和 SHA-256。</li><li>从官方公开文件收集实际采购条款；其中广州材料是成交结果，2017 年文件日期只精确到月份。原文与整理后的测试输入分开保存。</li><li>逐页核对第1页选型表，提取 28 个型号；MPT35-12V 原文功率为 36W，MPT100-24V 为 108W。不从系列名称估算。</li><li>对 6 条输入各运行基础初筛和完整条件校验，共 336 次型号评估；输入双段、典型效率和输出路数均按原件处理。</li><li>选取三条输入，用相同 Prompt、模型、数据和工作目录进行无插件/有插件对照。模型原始回答、调用记录和运行配置已经保存。</li></ol><div class="note">温度降额、效率保证值、认证证书、保护阈值、输入频率、价格、库存及交期尚未完整建模。完整条件没有通过的型号；“待确认”和“不匹配”都不能用匹配得分替代。</div><p><a href="prompt.txt" download>本轮同一 Prompt</a> · <a href="experiment.json">实验配置与实际用量</a> · <a href="verification.json">校验记录</a> · <a href="runs/tool-results.full.json">完整工具返回</a> · <a href="runs/config-difference.json">两组配置差异</a> · <a href="requirements/requirements-research.md">需求研究记录</a></p><p>Prompt SHA-256：<code>{prompt_hash}</code></p><p>真实目录与插件已配置到本机桌面 profile；如桌面尚未重新加载，关闭并重新打开 DSH 即可加载。安装脚本：<a href="install-desktop.ps1" download>install-desktop.ps1</a>。</p></section>
<footer>DSH v0.2.0-rc.2 / dsh-megmeet v0.1.3。全部建议须经工程复核。此离线页面把原始 Markdown 中的本地路径适配为浏览器链接，原始回答文件保持不变。</footer></main><script>
const tabs=[...document.querySelectorAll('[data-tab]')];tabs.forEach(b=>b.addEventListener('click',()=>{{tabs.forEach(t=>{{const on=t===b;t.setAttribute('aria-selected',String(on));document.getElementById(t.dataset.tab).hidden=!on}});}}));document.querySelectorAll('[data-case]').forEach(b=>b.addEventListener('click',()=>{{document.querySelectorAll('.case-detail').forEach(d=>d.hidden=d.id!=='case-'+b.dataset.case);document.getElementById('case-'+b.dataset.case).scrollIntoView({{behavior:'smooth',block:'start'}})}}));document.getElementById('product-search').addEventListener('input',e=>{{const v=e.target.value.trim().toLowerCase();document.querySelectorAll('[data-product]').forEach(r=>r.hidden=!r.dataset.product.includes(v))}});
</script></body></html>'''
(ROOT/'index.html').write_text(page,encoding='utf-8')
(ROOT/'comparison.md').write_text('# 真实物料：同一 Prompt 对照\n\n原始回答未改写，不能据单次运行声称准确率提升。v0.1.2首次真实测试发现单路/双路校验不足，原始文件保存在round1-v0.1.2。本轮v0.1.3加入输出路数条件，基础与完整需求结果见deterministic-results.json。\n\n'+json.dumps(stats,ensure_ascii=False,indent=2)+'\n\n采购条款、派生条件、典型效率与保证值分开保存。详情见index.html、experiment.json、verification.json。\n',encoding='utf-8')
print(json.dumps({'pageBytes':len(page.encode()),'stats':stats,'sourcePDFs':8,'realModels':28,'samePromptSHA256':prompt_hash}))
