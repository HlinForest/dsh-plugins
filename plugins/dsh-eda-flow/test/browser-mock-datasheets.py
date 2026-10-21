import atexit,json,socket,subprocess,time,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
server=subprocess.Popen(['node',str(Path(__file__).with_name('serve-text-ui.mjs')),str(out/'fixture'),str(port)],stdout=subprocess.DEVNULL)
atexit.register(server.terminate)
base=f'http://127.0.0.1:{port}'
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    for _ in range(60):
        try:page.goto(base+'/api/eda-flow/page');break
        except Exception:time.sleep(.2)
    page.get_by_role('button',name='新建项目',exact=True).first.click()
    page.get_by_label('项目名称',exact=True).fill('模拟规格书显示板界面验收')
    page.get_by_role('radio',name='显示板演示 · 自然语言 + 模拟 PDF 提取',exact=False).check()
    page.screenshot(path=str(out/'new-project.png'))
    page.get_by_role('button',name='创建项目',exact=True).click()
    expect(page.get_by_role('dialog')).not_to_be_visible()
    expect(page.get_by_role('heading',name='功能需求与约束')).to_be_visible()
    field=page.get_by_label('完整任务书',exact=False)
    expect(field).to_be_editable()
    expect(page.get_by_text('显示板演示 · 自然语言 + 模拟 PDF 提取',exact=True)).to_be_visible()
    expect(page.get_by_text('资料提供了什么 · 本步模拟摘录',exact=True)).to_be_visible()
    initial=field.input_value();assert len(initial)<500 and '原图坐标' not in initial
    field.fill(initial+'\n试验补充：允许选择常见器件。')
    page.get_by_role('button',name='保存',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('本步输入已保存')
    page.screenshot(path=str(out/'short-brief.png'))
    boot=page.request.get(base+'/api/eda-flow/bootstrap').json()['value']
    p=next(x for x in boot['projects'] if x['label']=='模拟规格书显示板界面验收')
    state=page.request.post(base+'/api/eda-flow/action',data={'action':'open','projectId':p['id']}).json()['value']
    assert state['designMode']=='datasheet-demo' and len(state['inputs']['evidence'])==7 and not state.get('inputsBundle') and state['modelRequests']==0
    for stage in range(1,8):
        page.goto(base+f'/api/eda-flow/page?step={stage}')
        expect(page.get_by_text('资料提供了什么 · 本步模拟摘录',exact=True)).to_be_visible()
        expect(page.get_by_text('显示板演示 · 自然语言 + 模拟 PDF 提取',exact=True)).to_be_visible()
        page.screenshot(path=str(out/f'step-{stage}.png'))
    page.set_viewport_size({'width':1000,'height':850})
    page.goto(base+'/api/eda-flow/page?step=3')
    expect(page.get_by_text('资料提供了什么 · 本步模拟摘录',exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(out/'narrow-step-3.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    page.get_by_role('button',name='新建项目',exact=True).first.click()
    page.get_by_label('项目名称',exact=True).fill('保留原图复原界面验收')
    page.get_by_role('radio',name='历史显示板 · 原图复原',exact=False).check()
    page.get_by_role('button',name='创建项目',exact=True).click()
    expect(page.get_by_role('heading',name='完整纯文字任务书')).to_be_visible()
    assert len(page.get_by_label('完整任务书',exact=False).input_value())>40000
    page.screenshot(path=str(out/'reconstruction-retained.png'))
    assert not errors,errors
    (out/'result.json').write_text(json.dumps({'passed':True,'mockBriefChars':len(initial),'legacyRetained':True,'modelCalls':0,'errors':errors}),encoding='utf8')
    browser.close()
print('Mock PDF demo and reconstruction UI passed; model requests: 0')
