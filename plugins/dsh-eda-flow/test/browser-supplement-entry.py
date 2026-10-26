"""Exercise supplement navigation through the real client and a no-model service."""
import atexit
import json
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
fixture = out / ('fixture-' + uuid.uuid4().hex[:8])
server = subprocess.Popen([r'C:\Program Files\nodejs\node.exe', str(Path(__file__).with_name('serve-text-ui.mjs')),
    str(fixture), str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
atexit.register(lambda: server.terminate() if server.poll() is None else None)
base = f'http://127.0.0.1:{port}'
for _ in range(80):
    try:
        with urllib.request.urlopen(base + '/test-control', timeout=1) as response:
            assert not json.load(response)['modelCallsEnabled']
        break
    except OSError:
        time.sleep(.1)
else:
    raise RuntimeError('No-model fixture failed to start')

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 850})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/api/eda-flow/page?step=2')
    expect(page.get_by_label('模型待补问题')).to_be_visible()
    page.get_by_label('本步待确认项').get_by_role('button', name='补充文字要求', exact=True).click()
    page.screenshot(path=str(out / 'supplement-entry.png'))
    expect(page.get_by_label('本步补充与调整', exact=True)).to_be_focused(timeout=2000)
    page.get_by_label('本步补充与调整', exact=True).fill('入口检查：补充 5 V 供电要求。')
    page.get_by_role('button', name='补充规格书正文', exact=True).first.click()
    expect(page.get_by_label('粘贴规格书正文', exact=False)).to_be_focused()
    page.get_by_label('粘贴规格书正文', exact=False).fill('入口检查资料 / 来源测试 / 第 1 页：输入 5 V。')
    page.get_by_role('button', name='保存并返回第二步', exact=True).click()
    expect(page.get_by_role('heading', name='资料与提取', exact=True)).to_be_visible()
    expect(page.get_by_role('status')).to_contain_text('已保存')
    page.get_by_role('button', name='查看完整文字输入', exact=True).click()
    expect(page.locator('.text-task-preview')).to_contain_text('入口检查资料')
    expect(page.locator('.text-task-preview')).to_contain_text('补充 5 V 供电要求')
    page.get_by_role('button', name='返回第二步', exact=True).click()
    expect(page.get_by_role('heading', name='完整文字输入', exact=True)).to_have_count(0)
    expect(page.get_by_role('heading', name='资料与提取', exact=True)).to_be_visible()
    boot = page.request.get(base + '/api/eda-flow/bootstrap').json()['value']
    saved = page.request.post(base + '/api/eda-flow/action', data={'action': 'open', 'projectId': boot['projects'][0]['id']}).json()['value']
    assert saved['modelRequests'] == 0
    assert '入口检查资料' in saved['inputs']['datasheetText']
    assert '补充 5 V' in saved['inputs']['stageNotes']['2']
    # Inject a failed-response fixture only in this test's isolated project.
    project_path = fixture / 'projects' / saved['id'] / 'project.json'
    raw_project = json.loads(project_path.read_text('utf-8'))
    bad_reply = '原始回复测试：\n{"action":\n<script>throw new Error("must remain text")</script>'
    raw_project['stages'][2].update({'status': 'failed', 'errorInfo': {'code': 'format', 'message': '回复格式修正失败', 'details': {'rawResponse': bad_reply, 'formatRetries': 2}}})
    project_path.write_text(json.dumps(raw_project, ensure_ascii=False), 'utf-8')
    page.locator('.step').nth(2).click()
    page.get_by_role('button', name='查看模型原始回复', exact=True).click()
    expect(page.locator('.text-task-preview')).to_have_text(bad_reply)
    with page.expect_download() as download:
        page.get_by_role('button', name='下载原始回复', exact=True).click()
    download.value.save_as(str(out / 'model-reply.txt'))
    assert (out / 'model-reply.txt').read_text('utf-8') == bad_reply
    page.screenshot(path=str(out / 'model-reply-visible.png'))
    page.get_by_role('button', name='返回当前步骤', exact=True).click()
    assert not errors, errors
    report = {'status': 'PASS', 'modelRequests': 0, 'checks': ['supplement link focuses the actual field', 'datasheet navigation saves existing draft', 'save and return to step 2', 'full text modal has an explicit return action', 'failed model reply can be viewed and downloaded as escaped text']}
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(report, ensure_ascii=False))
    page.screenshot(path=str(out / 'supplement-return.png'))
    browser.close()
