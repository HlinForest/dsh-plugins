"""The actual host module in an isolated slot fixture, without model or host APIs."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1])
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
    page=browser.new_page(viewport={'width':1000,'height':600})
    page.route('http://workbench.test/',lambda r:r.fulfill(content_type='text/html; charset=utf-8',body='<html lang="zh-CN"><head><meta charset="utf-8"></head><body style="font:14px Segoe UI;background:#f9fafb"><aside style="display:flex;gap:8px;position:absolute;bottom:30px;left:20px"><span id="entry"></span><button id="neighbor">电路设计</button></aside><main style="margin:50px 300px"><h1>聊天输入保持可用</h1><textarea aria-label="聊天输入" style="width:350px;height:180px"></textarea><button id="switch">切换会话</button><output id="session">会话一</output></main><script>document.querySelector("#switch").onclick=()=>document.querySelector("#session").textContent="会话二";</script></body></html>'))
    pending=[];page.route('**/open-window',lambda r:pending.append(r));page.goto('http://workbench.test/');page.add_script_tag(path=str(root/'host-test.js'))
    entry=page.get_by_role('button',name='工程工作台',exact=True);chat=page.get_by_label('聊天输入');chat.fill('保留草稿');before=page.locator('#neighbor').bounding_box()
    assert page.evaluate('window.slots.length')==1 and page.evaluate('window.slots[0].name')=='sidebar.footer.action'
    assert entry.bounding_box()['width']==40 and entry.bounding_box()['height']==40
    assert entry.locator('svg').bounding_box()['width']==20
    entry.focus();expect(page.get_by_role('tooltip')).to_be_visible();entry.press('Enter');expect(entry).to_be_disabled();page.wait_for_timeout(250)
    assert page.locator('#neighbor').bounding_box()==before
    chat.fill('执行中仍可输入');page.locator('#switch').click();expect(page.locator('#session')).to_have_text('会话二')
    pending.pop().fulfill(json={'ok':False,'error':'模拟窗口启动失败，请重试。'});expect(entry).to_be_enabled();entry.hover();expect(page.get_by_role('tooltip')).to_contain_text('模拟窗口启动失败')
    assert page.locator('#neighbor').bounding_box()==before
    entry.click();page.wait_for_timeout(150);pending.pop().fulfill(json={'ok':True,'value':{'mode':'desktop'}});expect(entry).to_be_enabled();expect(chat).to_have_value('执行中仍可输入');assert page.locator('.ew-workbench').count()==0
    page.screenshot(path=str(root/'host-entry-isolation.png'))
    (root/'host-entry-checks.json').write_text(json.dumps({'fixture':'isolated host slots and chat controls','entry40':True,'icon20':True,'neighborStable':True,'keyboardTooltip':True,'failureRetry':True,'noOverlayOrChatBlock':True},indent=2))
    browser.close()
print('Host entry isolation, size, keyboard, failure/retry and chat controls passed.')
