"""Native Windows verification for the test-owned workbench window only."""
import ctypes, json, os, socket, subprocess, sys, time
from ctypes import wintypes
from pathlib import Path
from PIL import Image
import win32gui, win32ui
from playwright.sync_api import sync_playwright, expect

root = Path(sys.argv[1]); runtime = sys.argv[2]
meta = json.loads((root/'server.json').read_text())
main = str(Path(__file__).resolve().parents[2]/'desktop/main.cjs')
profile = root/'native-profile'
with socket.socket() as sock: sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
env=dict(os.environ);env.pop('ELECTRON_RUN_AS_NODE',None)
def launch(request):
    return subprocess.Popen([runtime,main,'--workbench-connection='+meta['connectionFile'], '--workbench-profile='+str(profile), '--workbench-request='+request, '--remote-debugging-port='+str(port)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def wait_state(request):
    for _ in range(100):
        try:
            state=json.loads((profile/'window-state.json').read_text())
            if state.get('request')==request and state.get('ready'): return state
        except (FileNotFoundError,json.JSONDecodeError): pass
        time.sleep(.2)
    raise AssertionError('Native window not ready')
initial='native-first-'+str(time.time_ns());proc=launch(initial);state=wait_state(initial)
user=ctypes.windll.user32
user.SetProcessDPIAware()
user.PrintWindow.argtypes=[wintypes.HWND,wintypes.HDC,wintypes.UINT]
user.IsIconic.argtypes=[wintypes.HWND]
user.IsZoomed.argtypes=[wintypes.HWND]
user.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
user.GetWindowRect.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.RECT)]
user.PostMessageW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM]
user.ShowWindow.argtypes=[wintypes.HWND,ctypes.c_int]
def handles():
    found=[]
    cb=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
    def each(hwnd,_):
        owner=wintypes.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(owner))
        if owner.value==state['pid'] and user.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd): found.append(hwnd)
        return True
    user.EnumWindows(cb(each),0);return found
with sync_playwright() as pw:
    browser=pw.chromium.connect_over_cdp('http://127.0.0.1:'+str(port))
    page=next(p for c in browser.contexts for p in c.pages if '/engineering-workbench/page' in p.url)
    launch('native-focus-'+initial);wait_state('native-focus-'+initial)
    cdp=page.context.new_cdp_session(page);cdp.send('Emulation.setFocusEmulationEnabled',{'enabled':False})
    expect(page.locator('.ew-titlebar')).to_be_visible()
    req=[];page.on('request',lambda r:req.append(r.url))
    field=page.get_by_label('待评审工程',exact=True);field.fill('草稿保留检查.kicad_pcb')
    expect(page.get_by_role('button',name='查看工程进度')).to_contain_text('工程进度')
    metrics=page.evaluate('''()=>({width:innerWidth,height:innerHeight,caption:document.querySelector('.ew-titlebar').getBoundingClientRect().height,captionColor:getComputedStyle(document.querySelector('.ew-titlebar')).backgroundColor,headerColor:getComputedStyle(document.querySelector('.ew-header')).backgroundColor,nodeExposed:typeof require!=='undefined'})''')
    assert metrics['caption']==40 and metrics['captionColor']==metrics['headerColor'] and not metrics['nodeExposed'],metrics
    hwnd=handles()[0];user.SetForegroundWindow(hwnd);time.sleep(.4)
    rect=wintypes.RECT();user.GetWindowRect(hwnd,ctypes.byref(rect))
    dc=win32gui.GetWindowDC(hwnd);src=win32ui.CreateDCFromHandle(dc);dst=src.CreateCompatibleDC();bitmap=win32ui.CreateBitmap();bitmap.CreateCompatibleBitmap(src,rect.right-rect.left,rect.bottom-rect.top);dst.SelectObject(bitmap)
    assert user.PrintWindow(hwnd,dst.GetSafeHdc(),2)
    im=Image.frombuffer('RGB',(rect.right-rect.left,rect.bottom-rect.top),bitmap.GetBitmapBits(True),'raw','BGRX',0,1);im.save(root/'native-window.png')
    win32gui.DeleteObject(bitmap.GetHandle());dst.DeleteDC();src.DeleteDC();win32gui.ReleaseDC(hwnd,dc)
    # Close hides the live renderer; no repeated status requests while hidden.
    user.PostMessageW(hwnd,0x10,0,0);page.wait_for_timeout(1800)
    assert not page.evaluate('window.workbenchDesktop.isVisible()')
    count=len(req);page.wait_for_timeout(3300);assert len(req)==count,(count,len(req))
    launch('native-reopen');again=wait_state('native-reopen')
    assert again['pid']==state['pid']
    expect(field).to_have_value('草稿保留检查.kicad_pcb')
    assert len(handles())==1,handles()
    user.ShowWindow(hwnd,6);page.wait_for_timeout(350)
    launch('native-restore');wait_state('native-restore');assert not user.IsIconic(hwnd)
    user.ShowWindow(hwnd,3);page.wait_for_timeout(350);assert user.IsZoomed(hwnd)
    user.ShowWindow(hwnd,9);page.wait_for_timeout(350);assert not user.IsZoomed(hwnd)
    # Main caption stays available when the drawing overlay opens.
    page.get_by_role('navigation').get_by_role('button',name='原理图评审',exact=True).click()
    section=page.locator('.ew-engineering:visible');section.get_by_role('button',name='读取文件并继续').click()
    viewer=section.locator('.ew-drawing-viewer');expect(viewer).to_be_visible(timeout=60000)
    viewer.get_by_role('button',name='全屏查看').click()
    assert viewer.bounding_box()['y']>=40
    viewer.get_by_role('button',name='退出全屏').click()
    (root/'native-checks.json').write_text(json.dumps({'metrics':metrics,'singleInstance':True,'closePreservesDraft':True,'hiddenStopsPolling':True,'nativeMinimizeRestoreMaximize':True,'fullscreenClearsCaption':True,'pid':state['pid']},ensure_ascii=False,indent=2),encoding='utf-8')
    user.PostMessageW(hwnd,0x10,0,0)
    # Do not close the browser connection: the test later verifies host shutdown.
print('Native window chrome, lifecycle, draft retention and hidden polling passed.')
