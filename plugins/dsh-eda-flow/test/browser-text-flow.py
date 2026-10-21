"""Browser checks against serve-text-ui.mjs; no model endpoint is configured."""
import json
import sys
import atexit
import socket
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
if len(sys.argv) > 2:
    port = sys.argv[2]
else:
    with socket.socket() as port_socket:
        port_socket.bind(('127.0.0.1', 0))
        port = str(port_socket.getsockname()[1])
    server = subprocess.Popen([r'C:\Program Files\nodejs\node.exe', str(Path(__file__).with_name('serve-text-ui.mjs')),
        str(out / ('fixture-' + uuid.uuid4().hex[:8])), port], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(lambda: server.terminate() if server.poll() is None else None)
base = 'http://127.0.0.1:' + port
for attempt in range(50):
    try:
        with urllib.request.urlopen(base + '/test-control', timeout=1) as response:
            assert not json.load(response)['modelCallsEnabled']
        break
    except OSError:
        time.sleep(.1)
else:
    raise RuntimeError('Local test server did not start')
checks, errors, external = [], [], []

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1,
                                  permissions=['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: external.append(r.url) if not r.url.startswith((base, 'blob:', 'data:')) else None)
    page.goto(base + '/api/eda-flow/page?step=2')
    expect(page.get_by_role('heading', name='资料与提取', exact=True)).to_be_visible()
    expect(page.get_by_label('模型待补问题')).to_be_visible()
    page.screenshot(path=str(out / '02-model-question.png'))
    page.get_by_label('对待补问题的回答').fill('界面检查回答：供电 5 V，允许范围以准确器件规格书为准。')
    page.get_by_role('button', name='保存回答到本步输入', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('回答已保存')
    boot = page.request.get(base + '/api/eda-flow/bootstrap').json()['value']
    pid = boot['projects'][0]['id']

    def project():
        res = page.request.post(base + '/api/eda-flow/action', data={'action': 'open', 'projectId': pid}).json()
        assert res['ok'], res
        return res['value']

    saved = project()
    assert '界面检查回答' in saved['inputs']['stageNotes']['2']
    assert saved['modelRequests'] == 0
    assert saved['mode'] == 'text-mcp' and not saved.get('inputsBundle')
    assert saved['stages'][5]['status'] == 'skipped' and not saved['stages'][5]['confirmed']
    checks.append('公开问答保存到本步输入，不自动请求模型；新项目无旧对象包；PCB skipped')

    page.locator('.step').nth(0).click()
    field = page.get_by_label('完整任务书', exact=False)
    expect(field).to_be_visible()
    initial = field.input_value()
    assert initial == (Path(__file__).parents[1] / 'cases/display-board/default-text.txt').read_text('utf-8')
    assert len(initial) > 40000 and 'TM1616' in initial
    field.fill(initial + '\n\n【界面检查补充】此行验证编辑与失效，不属于冻结演示需求。')
    page.get_by_label('供电要求', exact=True).fill('界面测试供电约束')
    page.get_by_role('button', name='保存', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('本步输入已保存')
    saved = project()
    assert '界面检查补充' in saved['inputs']['requirements']
    assert saved['inputs']['power'] == '界面测试供电约束'
    assert not saved['stages'][0]['confirmed'] and saved['stages'][0]['status'] == 'stale'
    checks.append('完整任务书与供电字段编辑保存；上游修改使人工确认失效')
    page.screenshot(path=str(out / '01-text-editor.png'))

    page.get_by_role('button', name='查看完整文字输入', exact=True).click()
    expect(page.get_by_role('heading', name='完整文字输入', exact=True)).to_be_visible()
    text = page.locator('.text-task-preview').inner_text()
    assert initial in text and '界面测试供电约束' in text and '界面检查回答' in text
    page.get_by_role('button', name='复制完整正文', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('完整文字输入已复制')
    copied = page.evaluate('navigator.clipboard.readText()')
    assert copied.replace('\r\n', '\n') == text.replace('\r\n', '\n')
    with page.expect_download() as download:
        page.get_by_role('button', name='下载文字', exact=True).click()
    download.value.save_as(str(out / 'ui-input-download.txt'))
    assert (out / 'ui-input-download.txt').read_text('utf-8') == text
    page.screenshot(path=str(out / '01-full-input.png'))
    page.get_by_role('button', name='关闭对话框', exact=True).click()
    checks.append('完整文字预览、复制、下载一致，包含额外约束与公开问答')

    page.locator('.step').nth(2).click()
    page.get_by_role('tab', name='规格书', exact=True).click()
    sheet = '界面测试资料 / 版本 1 / 来源：本地测试 / 第 1 页\n此内容仅检查粘贴和保存；不声称器件规格。'
    page.get_by_label('粘贴规格书正文', exact=False).fill(sheet)
    page.get_by_role('button', name='保存', exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('本步输入已保存')
    assert project()['inputs']['datasheetText'] == sheet
    page.screenshot(path=str(out / '03-pasted-datasheet.png'))
    page.reload()
    page.locator('.step').nth(2).click()
    page.get_by_role('tab', name='规格书', exact=True).click()
    expect(page.get_by_label('粘贴规格书正文', exact=False)).to_have_value(sheet)
    checks.append('规格书正文粘贴、保存和刷新后保持')

    page.locator('.step').nth(5).click()
    expect(page.get_by_role('heading', name='PCB 本轮未执行', exact=True)).to_be_visible()
    assert page.get_by_role('button', name='生成 PCB', exact=True).count() == 0
    assert page.get_by_role('button', name='确认并继续', exact=True).count() == 0
    page.screenshot(path=str(out / '06-pcb-skipped.png'))
    page.locator('footer').get_by_role('button', name='进入核验与交付', exact=True).click()
    expect(page.get_by_role('heading', name='核验与交付', exact=True)).to_be_visible()
    expect(page.locator('main')).to_contain_text('Harness 真实模型验收：待验证')
    assert page.get_by_role('button', name='空目录重放', exact=True).count() == 0
    page.screenshot(path=str(out / '07-validation-pending.png'))
    checks.append('PCB无执行/确认按钮；可进入第七步；真实模型验收待验证，无固定重放')

    sizes = []
    for width in [1280, 1000, 390]:
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_timeout(150)
        dimensions = page.evaluate('({width:innerWidth, scroll:document.documentElement.scrollWidth, height:innerHeight, footer:document.querySelector("footer").getBoundingClientRect().toJSON()})')
        assert dimensions['scroll'] <= width + 1, dimensions
        assert dimensions['footer']['bottom'] <= 901, dimensions
        page.screenshot(path=str(out / f'07-width-{width}.png'))
        sizes.append(dimensions)
    checks.append('1280/1000/390 三种宽度无页面水平溢出，底栏在视口内')
    control = page.request.get(base + '/test-control').json()
    assert control['realModelCalls'] == 0 and not control['modelCallsEnabled']
    assert project()['modelRequests'] == 0
    assert not errors and not external, {'errors': errors, 'external': external}
    result = {'status': 'PASS', 'checks': checks, 'browser': browser.version, 'viewportChecks': sizes,
              'pageErrors': errors, 'externalRequests': external, 'realModelCalls': 0,
              'scope': '浏览器页面与真实后台状态；问题为界面夹具。未运行 Harness 真实模型或原生桌面窗口。'}
    (out / 'browser-report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    browser.close()
