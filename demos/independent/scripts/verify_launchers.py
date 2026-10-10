from pathlib import Path
import json,subprocess,time,re,queue,threading,hashlib
from playwright.sync_api import sync_playwright
import demo_host as host

host.prepare();server=host.start('4793');lines=queue.Queue()
def drain():
    for line in server.stdout:lines.put(line)
threading.Thread(target=drain,daemon=True).start()
def launcher(mode):
    subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(host.ROOT/'scripts/launch.ps1'),'-Mode',mode],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
def wait_same(source,target):
    expected=source.read_bytes();deadline=time.time()+15
    while time.time()<deadline:
        if target.exists() and target.read_bytes()==expected:return
        time.sleep(.1)
    raise AssertionError('Launcher did not restore the expected demo file')
try:
    url=None;deadline=time.time()+90
    while time.time()<deadline:
        line=lines.get(timeout=10);m=re.search(r'http://127\.0\.0\.1:4793/\?token=[^\s\x1b]+',line)
        if m:url=m.group();break
    assert url
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
        page=browser.new_page();page.goto(url,wait_until='domcontentloaded');page.get_by_role('button',name='打开工程工作台',exact=True).wait_for(timeout=60000)
        def call(group,action,args={}):
            value=page.request.post('http://127.0.0.1:4793/api/engineering-workbench/action',data={'group':group,'action':action,'args':args},timeout=120000).json()
            assert value.get('ok'),value;return value['value']
        launcher('after');wait_same(host.ROOT/'02-pcb/after/positions.csv',host.ROOT/'02-pcb/current/positions.csv')
        assert call('pcb','review')['summary']['checked']==2
        call('pcb','setWatch',{'enabled':True,'pollSeconds':1,'popup':False});time.sleep(2.5)
        launcher('before');wait_same(host.ROOT/'02-pcb/before/positions.csv',host.ROOT/'02-pcb/current/positions.csv')
        time.sleep(3.5);watch=call('pcb','watch');assert any(f['status']=='warning' for f in watch['findings'])
        call('pcb','setWatch',{'enabled':False})
        current=host.ROOT/'03-schematic/current/DividerChange.kicad_sch'
        # Check reset's backup behavior using a known teaching-target variant.
        current.write_bytes((host.ROOT/'03-schematic/target/DividerChange.kicad_sch').read_bytes())
        launcher('reset-schematic');wait_same(host.ROOT/'03-schematic/baseline/DividerChange.kicad_sch',current)
        assert any((host.RUNTIME/'reset-backups').glob('*/DividerChange.kicad_sch'))
        task=call('schematic','begin',{'currentPath':'03-schematic/current/DividerChange.kicad_sch','targetPath':'03-schematic/target/DividerChange.kicad_sch'})
        before=call('schematic','compare',{'taskId':task['taskId'],'which':'current'});assert not before['matches']
        candidate=call('schematic','inspect',{'taskId':task['taskId'],'which':'candidate'})
        call('schematic','prepare',{'taskId':task['taskId'],'expectedRevision':candidate['revision']})
        verified=call('schematic','verify',{'taskId':task['taskId']});assert verified['canApply'] and verified['erc']['errors']==0
        browser.close()
    host.save(host.RUNTIME/'host.json',{'pid':server.pid});host.stop();server.wait(timeout=10)
    print('Hidden launchers, watcher transition, reset backup, relative paths, native target and isolated stop verified.')
finally:
    if server.poll() is None:
        server.terminate()
        try:server.wait(timeout=8)
        except Exception:server.kill()
