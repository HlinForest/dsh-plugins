"""Build a self-contained offline demo from the saved, unedited DSH runs."""
from pathlib import Path
from datetime import datetime
import hashlib
import html
import json
import sys

import mistune

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
read_json = lambda name: json.loads((ROOT / name).read_text(encoding="utf-8"))
escape = lambda value: html.escape(str(value), quote=True)
render_markdown = mistune.create_markdown(escape=True, plugins=["table"])
manifest = read_json("experiment.json")
prompt = (ROOT / "prompt.txt").read_text(encoding="utf-8")
requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
metadata = {arm: read_json(f"runs/{arm}.metadata.json") for arm in ["baseline", "plugin"]}
runtime = {arm: read_json(f"runs/{arm}.runtime-evidence.json") for arm in metadata}
reports = {arm: (ROOT / f"{arm}.md").read_text(encoding="utf-8") for arm in metadata}
events = {arm: [json.loads(line) for line in (ROOT / f"runs/{arm}.events.jsonl").read_text(encoding="utf-8").splitlines() if line.startswith("{")] for arm in metadata}
differences = read_json("runs/config-difference.json")
assert [item["id"] for item in differences] == ["megmeet-product-assistant"]
prompt_hash = hashlib.sha256((ROOT / "prompt.txt").read_bytes()).hexdigest()
assert prompt_hash == manifest["promptSHA256"]
assert len({item["sessionId"] for item in metadata.values()}) == 2
for arm, meta in metadata.items():
    assert meta["success"] and meta["exitCode"] == 0 and not meta["errors"]
    assert meta["promptSHA256"] == prompt_hash
    final = next(event["text"] for event in reversed(events[arm]) if event["type"] == "final")
    assert reports[arm] == final + "\n", f"{arm} output was edited"
    assert prompt_hash in runtime[arm]["persistedPromptSHA256"]
    assert runtime[arm]["models"][0]["provider"] == manifest["provider"]
    assert runtime[arm]["models"][0]["model"] == manifest["model"]
assert runtime["baseline"]["persistedPromptSHA256"] == runtime["plugin"]["persistedPromptSHA256"]
assert runtime["plugin"]["catalogMatchesPromptData"] is True
assert runtime["plugin"]["installedPlugin"] == "dsh-megmeet@0.1.0"

evidence = read_json("runs/plugin.session-evidence.json")
results = []
for event in evidence:
    if event["type"] == "tool/result":
        message = event["data"]["message"]
        assert not message["isError"]
        text = "".join(block.get("text", "") for block in message["content"] if block["type"] == "text")
        results.append({"callId": message["toolCallId"], "result": json.loads(text)})
candidates = {item["result"]["candidate"]["productId"]: item["result"]["candidate"] for item in results if "candidate" in item["result"]}
expected = {"DEMO-PS-A": "matches_listed_constraints", "DEMO-PS-B": "incompatible", "DEMO-PS-C": "needs_confirmation", "DEMO-PS-D": "incompatible", "DEMO-PS-E": "incompatible"}
assert {key: value["status"] for key, value in candidates.items()} == expected
assert all(len(candidate["checks"]) == 11 for candidate in candidates.values())
assert next(check for check in candidates["DEMO-PS-C"]["checks"] if check["field"] == "efficiency_pct")["status"] == "unknown"
assert next(check for check in candidates["DEMO-PS-D"]["checks"] if check["field"] == "input_voltage_v")["status"] == "fail"
assert runtime["baseline"]["toolCalls"] == 0 and runtime["plugin"]["toolCalls"] == 8
assert runtime["plugin"]["toolResults"] == 8

def duration(meta):
    return round((datetime.fromisoformat(meta["finishedAt"]) - datetime.fromisoformat(meta["startedAt"])).total_seconds(), 3)

def usage(meta):
    return {key: sum(item.get(key, 0) for item in meta["usage"]) for key in ["inputTokens", "outputTokens", "cacheReadTokens", "totalTokens"]}

stats = {arm: {"durationSeconds": duration(meta), "modelSteps": len(meta["usage"]), "toolCalls": len(meta["toolCalls"]), "characters": len(reports[arm].rstrip("\n")), **usage(meta)} for arm, meta in metadata.items()}
verification = {
    "status": "passed", "samePromptSHA256": prompt_hash, "samePersistedUserMessages": True,
    "sameActualModel": True, "uniqueFreshSessions": True, "configurationDifference": ["megmeet-product-assistant"],
    "installedCatalogEqualsSharedCatalog": True, "finalOutputsUnedited": True,
    "pluginCalls": 8, "successfulToolResults": 8, "validatedCandidates": 5, "checksPerCandidate": 11,
    "baselineClassificationReview": "Manual review: all five classifications agree with provided catalog",
    "pluginClassificationReview": "Manual review plus assertions against five complete validation results",
}
manifest.update({"status": "completed", "sessions": {arm: meta["sessionId"] for arm, meta in metadata.items()}, "stats": stats, "conclusion": "Both runs classify all five demo products the same; the plugin adds deterministic checks and durable tool evidence. Token use increased in this pair."})
(ROOT / "experiment.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(ROOT / "verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(ROOT / "runs/tool-results.full.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

comparison = f"""# 同一 prompt：无插件与已安装插件的真实输出对比

两组均真实调用 DeepSeek 模型，原始回答未改写。**本次两组的五个型号分类一致。插件增加了可复核的约束与参数校验记录，累计 token 用量也更高。**

## 共同条件

- DeepSeek Harness 0.2.0-rc.2，官方 headless 运行方式，复用本机登录账号。
- 模型 deepseek-flash，provider deepseek-account，reasoningEffort high，maxTokens 16000。
- 同一份 prompt，内含相同的产品参数、证据引文、来源 ID 与版本；SHA-256：`{prompt_hash}`。
- 新建两条会话，无前序对话。共享 patch 与工作目录相同；配置导出证明唯一差异为 `megmeet-product-assistant`。
- 两组均禁用文件、终端、联网、委派等通用工具。本次测试聚焦提供资料后的产品比对。
- 已安装的插件为 dsh-megmeet@0.1.0；插件目录产品库与 prompt 附带的产品库字节一致。
- 本次全部产品与来源为虚构演示资料（DEMO-1），不代表麦格米特真实产品。

## 实际结果

| 比较项 | 无插件 | 已安装插件 |
| --- | --- | --- |
| DEMO-PS-A | 通过已列条件 | 通过已列条件 |
| DEMO-PS-B | 功率不足，硬性不匹配 | 相同；R4 校验失败 |
| DEMO-PS-C | 效率资料缺失，待确认 | 相同；R5 = unknown |
| DEMO-PS-D | 输入区间不完整覆盖，硬性不匹配 | 相同；R2 校验失败 |
| DEMO-PS-E | 输出电压、RS485、UL 不匹配 | 相同；R3/R8/R10 校验失败 |
| 需求表达 | 9 项需求，协议与认证合并展示 | 11 条约束，CAN/RS485 与 CE/UL 分开校验，保留原文依据 |
| 来源与版本 | 报告列出了各型号来源 ID 和 DEMO-1 | 报告与工具结果均保留来源；校验结果含参数引文 |
| 产品工具调用 | 0 | 8 次，全部成功 |
| 模型步骤 | {stats['baseline']['modelSteps']} | {stats['plugin']['modelSteps']} |
| 本次墙钟时间（含进程启动） | {stats['baseline']['durationSeconds']} 秒 | {stats['plugin']['durationSeconds']} 秒 |
| 输入 token（不含缓存读取） | {stats['baseline']['inputTokens']:,} | {stats['plugin']['inputTokens']:,} |
| 缓存读取 token | {stats['baseline']['cacheReadTokens']:,} | {stats['plugin']['cacheReadTokens']:,} |
| 输出 token | {stats['baseline']['outputTokens']:,} | {stats['plugin']['outputTokens']:,} |
| Provider 报告的累计总 token | {stats['baseline']['totalTokens']:,} | {stats['plugin']['totalTokens']:,} |

有插件组的真实调用顺序：数据集确认 → 需求解析 → 产品检索（包括不匹配产品）→ A/B/C/D/E 各校验一次。最终 Markdown 由模型依据这些结果整理。

## 适合演示的结论

1. 先展示同一 prompt 与相同产品资料，说明两组控制条件。
2. 并排展示原始报告：两组都选对，完整保留这一结果。
3. 打开 C 的效率校验，展示 unknown、缺参数、无来源；打开 D 的电压校验，展示区间相交不等于完整覆盖。
4. 展示每项原文依据、产品参数引文、来源 ID、版本与 8 次实际工具调用。
5. 说明当前价值在于把校验口径与依据沉淀为可核查的业务流程；不能由单次演示推断整体准确率、速度或成本改善。

无插件组也正确识别了缺参数和覆盖关系，并给出了来源信息。有插件组的 token 增加，与工具 schema、返回数据和多步调用有关。两组的缓存状态不同，时间仅为本次观察；没有配置随机种子，未来运行措辞与调用次数可能变化。累计 token 不等于人民币费用。

## 演示文件

- `index.html`：可离线打开的对比页，含完整原始报告、工具证据与共同输入。
- `prompt.txt`：两组共用的 prompt。
- `baseline.md` / `plugin.md`：未改写的两组最终回答。
- `runs/*.events.jsonl`：原始 DSH headless 事件流。DSH 对部分长工具事件有长度截断；最终回答没有截断。
- `runs/tool-results.full.json`：从本次持久化会话提取的 8 份完整工具结果。
- `runs/*.metadata.json` / `*.runtime-evidence.json` / `*.config.yml`：时间、token、实际模型、会话与配置证据。
- `verification.json`：同 prompt、同模型、单一配置差异、原文完整性及关键校验的检查结果。
- `reproduce.ps1`：使用本机现有 DSH 账号重新运行，另存到带时间戳的 replays 目录。

此页记录的是官方 headless 运行结果，并非桌面截图；当前桌面 profile 没有改动。所有结果仍需工程师确认。
"""
(ROOT / "comparison.md").write_text(comparison, encoding="utf-8")

status_name = {"pass": "通过", "fail": "不匹配", "unknown": "待确认"}
candidate_name = {"matches_listed_constraints": "通过已列条件", "incompatible": "硬性不匹配", "needs_confirmation": "待确认"}
check_blocks = []
for product_id, candidate in sorted(candidates.items()):
    rows = []
    for check in candidate["checks"]:
        source = check.get("source") or {}
        actual = check.get("actual", "未提供")
        if isinstance(actual, (dict, list)):
            actual = json.dumps(actual, ensure_ascii=False, separators=(",", ":"))
        rows.append(f"<tr><th scope='row'>{escape(check['constraintId'])} {escape(check['label'])}</th><td>{escape(check['expected'])}</td><td>{escape(actual)}</td><td><span class='status {escape(check['status'])}'>{status_name[check['status']]}</span></td><td>{escape(check['reason'])}</td><td>{escape(source.get('id', '无来源'))}<br>{escape(source.get('version', ''))}<br><code>{escape(check.get('quote', '无参数引文'))}</code></td></tr>")
    check_blocks.append(f"<details class='candidate' {'open' if product_id == 'DEMO-PS-C' else ''}><summary>{escape(product_id)}<span>{candidate_name[candidate['status']]}</span></summary><div class='table-wrap'><table><thead><tr><th>约束</th><th>客户要求</th><th>产品资料</th><th>结果</th><th>判定原因</th><th>来源与逐字引文</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div></details>")

calls = "".join(f"<li><span>{escape(call['name'])}</span>{'<small>' + escape(call['input']['productId']) + '</small>' if 'productId' in call['input'] else ''}</li>" for call in metadata["plugin"]["toolCalls"])
metric_rows = [
    ("五个型号的分类", "1 通过 / 1 待确认 / 3 不匹配", "1 通过 / 1 待确认 / 3 不匹配"),
    ("产品工具调用", "0 次", "8 次，全部成功"),
    ("需求组织", "9 项合并需求", "11 条约束，保留原文依据"),
    ("本次墙钟时间", f"{stats['baseline']['durationSeconds']:.2f} 秒", f"{stats['plugin']['durationSeconds']:.2f} 秒"),
    ("累计总 token", f"{stats['baseline']['totalTokens']:,}", f"{stats['plugin']['totalTokens']:,}"),
    ("其中缓存读取 token", f"{stats['baseline']['cacheReadTokens']:,}", f"{stats['plugin']['cacheReadTokens']:,}"),
]
metric_html = "".join(f"<tr><th>{escape(label)}</th><td>{escape(left)}</td><td>{escape(right)}</td></tr>" for label, left, right in metric_rows)

page = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>麦格米特 DSH 插件：真实输出对比</title>
<style>
:root{--paper:#fafbfe;--ink:#163557;--blue:#315e9b;--green:#006b61;--muted:#566474;--rule:#d3dbe6;--red:#9b343d;--amber:#815709}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Microsoft YaHei UI","Segoe UI",sans-serif;line-height:1.7}a{color:var(--blue)}button{font:inherit;cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #5482ba;outline-offset:3px}header,main,footer{max-width:1540px;margin:auto;padding:24px 36px}header{padding-top:36px;padding-bottom:16px}header .context{margin:0;color:var(--muted);font-size:13px}h1{font-size:clamp(25px,3.4vw,42px);line-height:1.3;margin:12px 0}header .finding{font-size:17px;max-width: seventy;max-width:960px;margin:12px 0;color:var(--ink)}.metadata{color:var(--muted);font-size:13px}.tabs{display:flex;gap:8px;flex-wrap:wrap;padding-top:16px;border-bottom:1px solid var(--rule)}.tabs button{border:0;border-bottom:3px solid transparent;color:var(--muted);background:none;padding:12px 18px}.tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--blue);font-weight:700}.panel[hidden]{display:none}.reports{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.report{min-width:0;background:white;border:1px solid var(--rule);border-radius:6px;overflow:hidden}.report-label{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--rule);background:#edf2f8}.report-label h2{font-size:19px;margin:0}.report-label a{font-size:12px}.report-content{padding:22px;font-size:13px;overflow-wrap:anywhere}.report-content h1{font-size:22px}.report-content h2{font-size:17px;margin-top:26px}.report-content h3{font-size:15px}.report-content p{margin:12px 0}.report-content blockquote{margin:15px 0;padding:10px 14px;border-left:3px solid var(--blue);background:#f3f6fa;color:var(--muted)}.report-content ul,.report-content ol{padding-left:24px}.report-content hr{border:0;border-top:1px solid var(--rule);margin:24px 0}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left}th,td{border:1px solid var(--rule);padding:8px 9px;vertical-align:top}th{background:#eef3f8;font-weight:600}.report-content table{display:block;overflow-x:auto;font-size:12px}.report-content td,.report-content th{min-width:65px}.report-content table thead th{white-space:normal}.table-wrap{overflow-x:auto}code{font-family:Consolas,"Microsoft YaHei UI",monospace;font-size:.93em;background:#eef2f7;border-radius:3px;padding:1px 4px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf2f8;padding:20px;border-radius:5px;font-size:12px;line-height:1.65;max-height:65vh;overflow:auto}.section-title{font-size:23px;margin:0 0 10px}.section-note{max-width:900px;color:var(--muted)}.candidate{border:1px solid var(--rule);background:white;border-radius:5px;margin:14px 0}.candidate summary{padding:14px 18px;cursor:pointer;font-weight:650;display:flex;justify-content:space-between;gap:18px}.candidate summary span{font-weight:400;color:var(--muted)}.candidate .table-wrap{padding:0 18px 18px}.candidate table{min-width:1000px}.candidate td:last-child{max-width:340px}.status{display:inline-block;border-radius:3px;padding:1px 8px;white-space:nowrap}.status.pass{color:var(--green);background:#e5f2ef}.status.fail{color:var(--red);background:#f7e9eb}.status.unknown{color:var(--amber);background:#f9f0dc}.call-list{padding-left:28px;max-width:720px}.call-list li{padding:5px 0}.call-list span{font-size:14px}.call-list small{margin-left:12px;color:var(--muted)}.overview{max-width:1050px}.overview table{margin:20px 0}.prose{max-width:1000px}.prose h2{font-size:21px;margin-top:26px}.notice{border-left:4px solid var(--green);padding:10px 20px;background:#eaf3f1;max-width:1040px;margin-bottom:22px}.file-links{display:flex;gap:16px;flex-wrap:wrap;margin:16px 0}footer{font-size:12px;color:var(--muted);padding-top:8px;padding-bottom:30px}.paired-mode{color:var(--green);font-size:13px;margin:0 0 18px}@media(max-width:980px){.reports{grid-template-columns:1fr}header,main,footer{padding-left:18px;padding-right:18px}.report-content{padding:16px}.tabs button{padding:10px}.candidate summary{font-size:14px}}@media print{.tabs,footer,.report-label a{display:none}.panel[hidden]{display:none}.reports{display:block}.report{page-break-inside:auto;margin-bottom:24px}.report-content table{display:table}header,main{padding:12px}pre{max-height:none}}
</style></head><body>
<header><p class="context">麦格米特产品选型辅助插件 / DSH 真实运行演示</p><h1>同一份需求，两个运行结果</h1>
<p class="finding">五个型号的分类结论一致。已安装插件组增加了可核查的逐项校验记录，本次累计 token 用量更高。</p>
<p class="metadata">DeepSeek Harness 0.2.0-rc.2　模型 deepseek-flash　两条独立会话　2026-10-09</p>
<p class="metadata"><a href="../real-demo/index.html">新增：28个真实型号、8份官方规格书和公开采购需求测试</a></p>
<nav class="tabs" role="tablist" aria-label="对比演示视图">
<button id="tab-output" role="tab" aria-selected="true" aria-controls="output" data-panel="output">原始输出</button>
<button id="tab-evidence" role="tab" aria-selected="false" aria-controls="evidence" data-panel="evidence" tabindex="-1">逐项校验</button>
<button id="tab-input" role="tab" aria-selected="false" aria-controls="input" data-panel="input" tabindex="-1">共同输入</button>
<button id="tab-notes" role="tab" aria-selected="false" aria-controls="notes" data-panel="notes" tabindex="-1">演示说明</button></nav></header>
<main>
<section class="panel" id="output" role="tabpanel" aria-labelledby="tab-output"><p class="paired-mode">两份报告均为真实模型输出，未改写。产品和来源均为虚构演示数据。</p><div class="reports">
<article class="report"><div class="report-label"><h2>无插件</h2><a href="baseline.md" download>保存原始 Markdown</a></div><div class="report-content">{{BASELINE}}</div></article>
<article class="report"><div class="report-label"><h2>已安装插件</h2><a href="plugin.md" download>保存原始 Markdown</a></div><div class="report-content">{{PLUGIN}}</div></article></div></section>
<section class="panel" id="evidence" role="tabpanel" aria-labelledby="tab-evidence" hidden><h2 class="section-title">从工具记录复核每一项结论</h2><p class="section-note">以下直接读取本次持久化会话中的完整工具结果。C 的效率没有资料，D 的输入范围不覆盖客户要求。点击型号可展开全部 11 项校验。</p>{{CHECKS}}
<h2 class="section-title">8 次真实工具调用</h2><ol class="call-list">{{CALLS}}</ol><div class="file-links"><a href="runs/tool-results.full.json" download>完整工具结果 JSON</a><a href="runs/plugin.events.jsonl" download>原始 DSH 事件流</a><a href="verification.json" download>验证记录</a></div></section>
<section class="panel" id="input" role="tabpanel" aria-labelledby="tab-input" hidden><h2 class="section-title">两组读取完全相同的 prompt</h2><p class="section-note">相同需求、同一产品库、同一来源与版本。已安装插件中的产品库也与这份输入一致。</p><p><strong>SHA-256</strong> <code>{{HASH}}</code></p><h3>客户需求</h3><pre>{{REQUIREMENTS}}</pre><details><summary>展开完整 prompt（包含共同产品库）</summary><pre>{{PROMPT}}</pre></details><div class="file-links"><a href="prompt.txt" download>保存 prompt</a><a href="catalog.demo.json" download>保存共同产品库</a><a href="runs/config-difference.json" download>唯一配置差异</a></div></section>
<section class="panel" id="notes" role="tabpanel" aria-labelledby="tab-notes" hidden><h2 class="section-title">演示时强调过程与依据</h2><div class="notice">本次无插件组也判断正确。插件将原文约束、参数比对、缺资料处理和来源保留为可核查的工具记录。</div><div class="overview table-wrap"><table><thead><tr><th>比较项</th><th>无插件</th><th>已安装插件</th></tr></thead><tbody>{{METRICS}}</tbody></table></div><div class="prose"><h3>推荐讲解顺序</h3><ol><li>打开共同输入，展示完全相同的需求和产品资料。</li><li>并排阅读原始输出，保留两组分类一致的实际结果。</li><li>展开 C 的效率 unknown 和 D 的电压 fail，查看来源与逐字引文。</li><li>展示 11 条约束与 8 次真实调用，说明流程可复核。</li><li>说明结果来自一次配对演示，不据此推断整体准确率、速度或费用改善。</li></ol><p>使用官方 headless 运行方式与本机 DSH 登录账号，最终报告由相同模型整理。通用文件、终端、联网和委派工具在两组均禁用；配置导出证明唯一差异是产品插件。没有配置随机种子，两组缓存状态不同；时间包含进程启动。总 token 来自 provider 用量的逐步累加，未换算费用。</p><p>产品型号、参数、认证和来源全部为虚构 DEMO-1 数据。报价、库存、交期、温度降额和认证适用范围未验证，所有结果仍需工程师确认。</p></div><div class="file-links"><a href="comparison.md" download>对比说明</a><a href="experiment.json" download>实验元数据</a><a href="reproduce.ps1" download>复现脚本</a></div></section>
</main><footer>原始输出与证据均保存在同目录。该页可离线展示，无需网络或账号凭据。</footer>
<script>
const tabs=Array.from(document.querySelectorAll('[role=tab]'));
function activate(tab){tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;document.getElementById(t.dataset.panel).hidden=!active;});}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=tabs[(index+1)%tabs.length];if(event.key==='ArrowLeft')next=tabs[(index-1+tabs.length)%tabs.length];if(event.key==='Home')next=tabs[0];if(event.key==='End')next=tabs[tabs.length-1];if(next){event.preventDefault();activate(next);next.focus();}});});
</script></body></html>"""
substitutions = {"BASELINE": render_markdown(reports["baseline"]), "PLUGIN": render_markdown(reports["plugin"]), "CHECKS": "".join(check_blocks), "CALLS": calls, "HASH": prompt_hash, "REQUIREMENTS": escape(requirements), "PROMPT": escape(prompt), "METRICS": metric_html}
for key, value in substitutions.items():
    page = page.replace("{{" + key + "}}", value)
assert "{{" not in page
page = page.replace("max-width: seventy;", "").replace("code{font-family:", "code{overflow-wrap:anywhere;font-family:")
(ROOT / "index.html").write_text(page, encoding="utf-8")
print(json.dumps({"verified": True, "stats": stats, "htmlBytes": len(page.encode("utf-8"))}, ensure_ascii=False))
