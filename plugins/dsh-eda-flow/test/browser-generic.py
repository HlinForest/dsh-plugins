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
    page.get_by_label('项目名称',exact=True).fill('从零显示板界面验收')
    page.get_by_role('radio',name='从零设计 · 显示板示例',exact=False).check()
    page.screenshot(path=str(out/'new-project.png'))
    page.get_by_role('button',name='创建项目',exact=True).click()
    expect(page.get_by_role('heading',name='功能需求与约束')).to_be_visible()
    field=page.get_by_label('完整任务书',exact=False)
    expect(field).to_be_editable()
    initial=field.input_value();assert len(initial)<500 and '原图坐标' not in initial
    field.fill(initial+'\n试验补充：允许选择常见器件。')
    page.get_by_role('button',name='保存',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('本步输入已保存')
    page.screenshot(path=str(out/'short-brief.png'))
    boot=page.request.get(base+'/api/eda-flow/bootstrap').json()['value']
    p=next(x for x in boot['projects'] if x['label']=='从零显示板界面验收')
    state=page.request.post(base+'/api/eda-flow/action',data={'action':'open','projectId':p['id']}).json()['value']
    assert state['designMode']=='new-design' and not state.get('inputsBundle') and state['modelRequests']==0
    page.get_by_role('button',name='新建项目',exact=True).first.click()
    page.get_by_label('项目名称',exact=True).fill('保留原图复原界面验收')
    page.get_by_role('radio',name='使用显示板输入',exact=False).check()
    page.get_by_role('button',name='创建项目',exact=True).click()
    expect(page.get_by_role('heading',name='完整纯文字任务书')).to_be_visible()
    assert len(page.get_by_label('完整任务书',exact=False).input_value())>40000
    page.screenshot(path=str(out/'reconstruction-retained.png'))
    page.get_by_role('button',name='新建项目',exact=True).first.click()
    page.get_by_label('项目名称',exact=True).fill('通用固定器件界面验收')
    page.get_by_role('radio',name='固定器件 · 通用设计',exact=False).check()
    parts=[{'ref':'R1','librarySymbol':'Device:R','value':'1k','footprint':'Resistor_SMD:R_0805_2012Metric','mpn':''}]
    page.locator('input[accept=".json,application/json"]').set_input_files({'name':'parts.json','mimeType':'application/json','buffer':json.dumps(parts).encode()})
    expect(page.get_by_text('parts.json · 1 个器件')).to_be_visible()
    page.screenshot(path=str(out/'fixed-import.png'))
    page.get_by_role('button',name='创建项目',exact=True).click()
    expect(page.get_by_role('dialog')).not_to_be_visible()
    boot=page.request.get(base+'/api/eda-flow/bootstrap').json()['value']
    p=next(x for x in boot['projects'] if x['label']=='通用固定器件界面验收')
    state=page.request.post(base+'/api/eda-flow/action',data={'action':'open','projectId':p['id']}).json()['value']
    assert state['layoutEngine']=='native-kicad' and state['fixedParts']==parts
    assert not state.get('fixedLibrary') and state['inputs']['requirements']==''
    assert not errors,errors
    (out/'result.json').write_text(json.dumps({'passed':True,'newDesignChars':len(initial),'legacyRetained':True,'modelCalls':0,'errors':errors}),encoding='utf8')
    browser.close()
print('New-design and reconstruction UI passed; model requests: 0')
