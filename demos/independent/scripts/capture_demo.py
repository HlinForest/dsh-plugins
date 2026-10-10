"""Exercise each independent demo in native DSH and capture real UI results."""
from pathlib import Path
import json,re,time,queue,threading,hashlib,sys
from playwright.sync_api import sync_playwright
import demo_host as host

ROOT=host.ROOT;OUT=ROOT/'screenshots';OUT.mkdir(exist_ok=True)
host.prepare();host.switch_pcb('before');host.reset_schematic()
server=host.start('4792');lines=queue.Queue()
def drain():
    for line in server.stdout:lines.put(line)
threading.Thread(target=drain,daemon=True).start()
data={};errors=[]
try:
    deadline=time.time()+90;url=None
    while time.time()<deadline:
        line=lines.get(timeout=10);match=re.search(r'http://127\.0\.0\.1:4792/\?token=[^\s\x1b]+',line)
        if match:url=match.group();break
    assert url,'Native DSH did not start'
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
        context=browser.new_context(viewport={'width':1440,'height':1000});page=context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(url,wait_until='domcontentloaded');page.get_by_role('button',name='打开工程工作台',exact=True).wait_for(timeout=60000)
        try:page.get_by_role('button',name='继续',exact=True).click(timeout=2000)
        except Exception:pass
        page.get_by_role('button',name='打开工程工作台',exact=True).click()
        panel=page.get_by_role('dialog',name='工程工作台');module=panel.locator('.ew-business:visible')
        page.get_by_label('工程任务悬浮面板',exact=True).get_by_role('button',name='收起',exact=True).click()
        def idle(timeout=120):
            deadline=time.time()+timeout
            while time.time()<deadline:
                assert not errors,errors
                alerts=module.locator('[role=alert]')
                if alerts.count():raise AssertionError(alerts.first.inner_text())
                if not module.locator('p.ew-note[role=status]').count():return
                page.wait_for_timeout(100)
            raise TimeoutError('Business operation timed out')
        def click(name):
            module.get_by_role('button',name=name,exact=True).click();page.wait_for_timeout(150);idle()
        def shot(name,locator=None):
            target=locator or panel
            target.screenshot(path=str(OUT/(name+'.png')))
        def call(group,action,args={}):
            r=page.request.post('http://127.0.0.1:4792/api/engineering-workbench/action',data={'group':group,'action':action,'args':args},timeout=120000).json()
            assert r.get('ok'),r
            return r['value']
        idle();shot('00-workbench')
        # Demo 1 does not require either KiCad fixture.
        module.get_by_label('客户需求',exact=True).fill((ROOT/'01-selection/A_初始需求.txt').read_text(encoding='utf-8'))
        module.get_by_role('checkbox',name='同时列出不满足项，便于解释排除原因',exact=True).uncheck()
        click('解析需求');shot('01-requirements',module.locator('.ew-request-grid'))
        click('检索并校验候选')
        section=module.locator('section').filter(has=page.get_by_role('heading',name='候选比较',exact=True))
        shot('02-initial-candidates',section.locator('.ew-table-wrap').first)
        data['selectionA']=call('selection','search',{'text':(ROOT/'01-selection/A_初始需求.txt').read_text(encoding='utf-8'),'includeIncompatible':False,'limit':10})
        module.get_by_label('客户需求',exact=True).fill((ROOT/'01-selection/B_负载和温度提高.txt').read_text(encoding='utf-8'));click('检索并校验候选')
        data['selectionB']=call('selection','search',{'text':(ROOT/'01-selection/B_负载和温度提高.txt').read_text(encoding='utf-8'),'includeIncompatible':False,'limit':10})
        assert len(data['selectionB']['candidates'])==4
        assert all(c['productId'].startswith('CP20.') and c['status']=='matches_listed_constraints' for c in data['selectionB']['candidates'])
        shot('03-revised-candidates',section.locator('.ew-table-wrap').first)
        shot('04-power-comparison',module.locator('.ew-chart'))
        module.get_by_role('button',name='CP20.241-R2',exact=True).click()
        shot('05-evidence',module.locator('.ew-details'))
        module.get_by_role('checkbox',name='纳入方案 CP20.241-R2',exact=True).check()
        module.get_by_label('报告标题',exact=True).fill('控制柜电源需求变更演示')
        click('导出 HTML / Markdown / JSON')
        report_href=module.get_by_role('link',name='打开 HTML 报告',exact=True).get_attribute('href')
        report_page=context.new_page();report_page.goto('http://127.0.0.1:4792'+report_href)
        report_page.screenshot(path=str(OUT/'06-exported-report.png'));report_page.close()
        module.get_by_label('客户需求',exact=True).fill((ROOT/'01-selection/C_缺少安装条件.txt').read_text(encoding='utf-8'));click('检索并校验候选')
        data['selectionC']=call('selection','search',{'text':(ROOT/'01-selection/C_缺少安装条件.txt').read_text(encoding='utf-8'),'includeIncompatible':False,'limit':10})
        assert all(c['status']=='needs_confirmation' for c in data['selectionC']['candidates'])
        shot('07-missing-information',section.locator('.ew-table-wrap').first)
        print('Demo 1 verified: real demands, changed candidates, evidence, export and unknown conditions.',flush=True)
        # Demo 2 reads its own four-component KiCad project.
        panel.get_by_role('button',name='PCB 评审',exact=True).click();idle();click('从已保存 KiCad 工程更新')
        data['pcbBefore']=call('pcb','review');assert data['pcbBefore']['summary']['warning']==1
        shot('08-pcb-findings-before',module.locator('.ew-findings-list'))
        module.get_by_label('精确位号',exact=True).fill('J2');click('查询器件网络')
        shot('09-pcb-location',module.locator('.ew-inspection-grid'))
        module.get_by_role('button',name='PCB 原图',exact=True).click();page.wait_for_timeout(500)
        shot('10-pcb-board',module.locator('.ew-board-canvas'))
        module.get_by_role('button',name='器件检查清单',exact=True).click()
        module.get_by_label('器件型号或用途',exact=True).fill('输入滤波电容');module.get_by_label('器件类别',exact=True).select_option('capacitor');click('查询检查清单')
        shot('11-component-guide',module.locator('section.ew-paper'))
        module.get_by_role('button',name='变更监听',exact=True).click();page.wait_for_timeout(400)
        module.get_by_label('检查间隔（秒）',exact=True).fill('2');click('开启 / 更新监听');page.wait_for_timeout(4300)
        shot('12-watcher',module.locator('section.ew-paper'))
        host.switch_pcb('after');page.wait_for_timeout(4500)
        module.get_by_role('button',name='工程与网络',exact=True).click();click('从已保存 KiCad 工程更新')
        data['pcbAfter']=call('pcb','review');assert data['pcbAfter']['summary']['warning']==0 and data['pcbAfter']['summary']['checked']==2
        shot('13-pcb-findings-after',module.locator('.ew-findings-list'));click('导出评审报告')
        data['pcbReportExport']=call('pcb','export',{'expectedRevision':data['pcbAfter']['revision']})
        module.get_by_role('button',name='变更监听',exact=True).click();click('停止监听');host.switch_pcb('before')
        print('Demo 2 verified: DNP finding, pin nets, native PCB, guide, watching and corrected project.',flush=True)
        # Demo 3 uses a separate resistor divider. Apply/rollback affects only this copy.
        panel.get_by_role('button',name='原理图同步',exact=True).click();idle()
        current=ROOT/'03-schematic/current/DividerChange.kicad_sch';original=current.read_bytes()
        module.get_by_label('当前原理图',exact=True).fill(str(current))
        module.get_by_label('目标要求原文',exact=True).fill((ROOT/'03-schematic/修改要求.txt').read_text(encoding='utf-8'))
        shot('14-create-schematic-task',module.locator('section.ew-paper').first)
        click('创建并读取目标');assert module.locator('fieldset.ew-target-row').count()==2
        shot('15-target-items',module.locator('fieldset.ew-target-row').first)
        click('保存并确认目标条目')
        module.get_by_role('button',name='差异比较',exact=True).click();click('比较修改前');shot('16-differences-before',module.locator('.ew-comparison'))
        module.get_by_role('button',name='候选修改',exact=True).click();click('修改候选副本')
        assert current.read_bytes()==original
        module.get_by_role('button',name='验证与写回',exact=True).click();click('验证候选并生成对比')
        module.get_by_label('对比聚焦器件',exact=True).select_option('R1')
        shot('17-schematic-before-after',module.locator('.ew-diff-grid'))
        task_id=module.get_by_label('已有原理图任务',exact=True).input_value()
        record=page.request.get('http://127.0.0.1:4792/api/engineering-workbench/task?id='+task_id).json()['value']
        data['schematicVerification']=record['verification'];assert record['verification']['canApply']
        shot('18-verification',module.locator('.ew-diff-summary'))
        click('核对并准备写回');shot('19-write-confirmation',module.locator('.ew-confirmation'))
        module.get_by_label('我已保存并关闭该 KiCad 工程，并确认以上文件和修改',exact=True).check();click('确认写回')
        assert current.read_bytes()!=original;shot('20-applied',module.locator('section.ew-paper').last)
        click('核对并准备回退');module.get_by_label('我已保存并关闭该 KiCad 工程，并确认以上文件和修改',exact=True).check();click('确认回退')
        assert current.read_bytes()==original;shot('21-rolled-back',module.locator('section.ew-paper').last)
        data['rollbackExact']=True;data['originalHash']=hashlib.sha256(original).hexdigest()
        panel.get_by_role('button',name='执行记录',exact=True).click();shot('22-execution-log')
        assert not errors,errors;data['browserErrors']=errors
        (host.RUNTIME/'demo-verification.json').write_bytes(json.dumps(data,ensure_ascii=False,indent=2).encode('utf-8'))
        print('Demo 3 verified: two real modifications, ERC, confirmed apply and byte-exact rollback.',flush=True)
        browser.close()
except Exception:
    try:page.screenshot(path=str(host.RUNTIME/'demo-error.png'));(host.RUNTIME/'demo-error.txt').write_bytes(page.locator('body').inner_text().encode('utf-8'))
    except Exception:pass
    raise
finally:
    server.terminate()
    try:server.wait(timeout=8)
    except Exception:server.kill()
