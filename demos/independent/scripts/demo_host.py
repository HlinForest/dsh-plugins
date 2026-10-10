"""Local DSH demo profile. Uses no copied model credentials or account state."""
from pathlib import Path
import os,sys,subprocess,json,hashlib,shutil,re,time,webbrowser,ctypes

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
RUNTIME=ROOT/'.runtime'
PROFILE='engineering-independent-demo'
APP=Path(os.environ['LOCALAPPDATA'])/'Programs/DeepSeek Harness'
ENV=dict(os.environ,ELECTRON_RUN_AS_NODE='1',DSH_TELEMETRY_DISABLED='1')
CLI=[str(APP/'DeepSeek Harness.exe'),'--expose-internals',str(APP/'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')]
PACKAGES=['dsh-megmeet-0.2.0.tgz','dsh-pcb-review-0.1.1.tgz','dsh-schematic-sync-0.1.0.tgz','dsh-engineering-workbench-0.2.0.tgz']

def save(file,data):
    file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes((json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
def run(args):
    result=subprocess.run(CLI+args,env=ENV,capture_output=True,encoding='utf-8',errors='replace',creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:raise RuntimeError(result.stderr[-3000:] or result.stdout[-3000:])
    return result
def material_root():
    packaged=ROOT/'01-selection/catalog'
    return packaged if packaged.exists() else REPO/'plugins/dsh-megmeet/success-demo'
def switch_pcb(state):
    if state not in ['before','after']:raise ValueError('Unknown demo state')
    source=ROOT/'02-pcb'/state;dest=ROOT/'02-pcb/current';dest.mkdir(parents=True,exist_ok=True)
    for file in source.iterdir():
        if file.suffix not in ['.kicad_sch','.kicad_pro','.kicad_pcb','.json','.xml','.csv']:continue
        shutil.copy2(file,dest/file.name)
def reset_schematic():
    dest=ROOT/'03-schematic/current';dest.mkdir(parents=True,exist_ok=True)
    for p in (ROOT/'03-schematic/baseline').iterdir():
        previous=dest/p.name
        if previous.exists() and previous.read_bytes()!=p.read_bytes():
            backup=RUNTIME/'reset-backups'/str(time.time_ns());backup.mkdir(parents=True,exist_ok=True);shutil.copy2(previous,backup/p.name)
        shutil.copy2(p,previous)
def prepare():
    if not (APP/'DeepSeek Harness.exe').exists():raise RuntimeError('未找到本机 DeepSeek Harness。')
    RUNTIME.mkdir(exist_ok=True)
    profile=Path.home()/'.dsh/profiles'/PROFILE
    if not profile.exists():run(['--profile',PROFILE,'--from-default-profile','web','--dump-config'])
    dist=ROOT/'packages' if (ROOT/'packages').exists() else REPO/'dist'
    hashes={name:hashlib.sha256((dist/name).read_bytes()).hexdigest() for name in PACKAGES}
    stamp=RUNTIME/'installed.json'
    if not stamp.exists() or json.loads(stamp.read_text(encoding='utf-8'))!=hashes:
        run(['plugin','--profile',PROFILE,'add',*[str(dist/name) for name in PACKAGES],'--ignore-scripts','--registry=https://registry.npmjs.org','--reporter=append-only']);save(stamp,hashes)
    if not (ROOT/'02-pcb/current/project.json').exists():switch_pcb('before')
    if not (ROOT/'03-schematic/current/DividerChange.kicad_sch').exists():reset_schematic()
    kicad=Path('D:/Kicad/bin/kicad-cli.exe')
    if not kicad.exists():
        candidates=sorted(Path('C:/Program Files/KiCad').glob('*/bin/kicad-cli.exe'),reverse=True)
        if not candidates:raise RuntimeError('未找到 KiCad CLI，请在 scripts/demo_host.py 指定本机路径。')
        kicad=candidates[0]
    python=Path(sys.executable).with_name('python.exe')
    config=[{'id':'megmeet-product-assistant','config':{'catalogPath':str(material_root()/'snapshots/catalog.v2.json'),'maxCandidates':10,'maxInputChars':60000,'reportDirectory':str(RUNTIME/'selection-reports')}},
            {'id':'pcb-review-assistant','config':{'projectFile':str(ROOT/'02-pcb/current/project.json'),'reportDirectory':str(RUNTIME/'pcb-reports'),'watch':False,'popup':False,'pollSeconds':2}},
            {'id':'schematic-sync','config':{'workspaceRoot':str(ROOT),'workDirectory':str(RUNTIME/'tasks'),'kicadCli':str(kicad),'python':str(python),'allowApply':True}},
            {'id':'engineering-workbench','config':{'catalogPath':str(material_root()/'snapshots/catalog.v2.json'),'projectFile':str(ROOT/'02-pcb/current/project.json'),'currentSchematic':str(ROOT/'02-pcb/current/FilterReview.kicad_sch'),'pcbPath':str(ROOT/'02-pcb/current/FilterReview.kicad_pcb'),'workspaceRoot':str(ROOT),'workDirectory':str(RUNTIME/'workbench'),'syncWorkDirectory':str(RUNTIME/'tasks'),'kicadCli':str(kicad)}}]
    save(profile/'cordis.patch.yml',config)
    return config
def start(port='4791'):
    return subprocess.Popen(CLI+['--profile',PROFILE,'--no-open','--port',str(port)],env=ENV,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,encoding='utf-8',errors='replace',creationflags=subprocess.CREATE_NO_WINDOW)
def stop():
    state=RUNTIME/'host.json'
    if not state.exists():return
    pid=int(json.loads(state.read_text(encoding='utf-8'))['pid'])
    command=f"$p = Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}'; if ($p -and $p.Name -eq 'DeepSeek Harness.exe' -and $p.CommandLine -like '*--profile engineering-independent-demo*') {{ Stop-Process -Id {pid} }}"
    subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    state.unlink(missing_ok=True)
def launch():
    try:
        prepare();server=start()
        for line in server.stdout:
            match=re.search(r'http://127\.0\.0\.1:\d+/\?token=[^\s\x1b]+',line)
            if match:webbrowser.open(match.group());break
        else:raise RuntimeError('演示工作台未启动，请确认端口 4791 未被占用。')
        # Continue draining output without persisting authentication URLs.
        save(RUNTIME/'host.json',{'pid':server.pid})
        for line in server.stdout:pass
    except Exception as e:
        error=re.sub(r'([?&]token=)[^\s&]+',r'\1[已隐藏]',str(e))
        ctypes.windll.user32.MessageBoxW(0,error,'DSH 演示启动提示',0x10)

if __name__=='__main__':
    mode=sys.argv[1] if len(sys.argv)>1 else 'launch'
    if mode in ['before','after']:switch_pcb(mode)
    elif mode=='reset-schematic':reset_schematic()
    elif mode=='prepare':prepare();print('Independent demo profile ready.')
    elif mode=='stop':stop()
    else:launch()
