"""Developer-side evidence packaging. No CAD or original page/netlist is shipped here."""
import json,pathlib,sys
root=pathlib.Path(__file__).parents[1]
source=pathlib.Path(sys.argv[1])
data=json.loads(source.read_text(encoding='utf8'))
assert data['sourceTextSha256']=='51142a27dccc870189fbe4e23fecab45441bddd64762aa9a2395e1ab60b37e35'
rules=[]
def rule(kind,name,nodes,**extra):rules.append(dict(kind=kind,name=name,nodes=nodes,**extra))
for ns in [['DISP.3','U1.4'],['DISP.2','U1.14','D1.2'],['DISP.1','D1.1'],['DISP.4','U1.3'],['DISP.5','U1.2'],['DISP.6','U1.1']]:
    rule('connected','Functional connection '+' / '.join(ns),ns)
for ref,ends in [('R1',['DISP.3','D1.3']),('R3',['DISP.3','DISP.1'])]+[(r,['DISP.3','DISP.2']) for r in ['C1','C4','C8']]+[(r,['D1.3','DISP.2']) for r in ['C2','C3']]+[(r,[f'DISP.{n}','DISP.2']) for r,n in [('C5',4),('C6',5),('C7',6)]]:
    rule('bridge',ref+' required functional role',ends,ref=ref)
limiters=['R2','R4','R5','R6','R7','R8','R9'];isolated=['DISP.3','DISP.2','DISP.4','DISP.5','DISP.6','D1.3','DISP.1']
for up,dp,name in [(5,8,'C'),(6,9,'E'),(7,7,'G'),(8,10,'D'),(9,6,'F'),(10,5,'A'),(11,4,'B')]:
    ns=[f'U1.{up}',f'*.{dp}'];rule('one-series','Segment '+name+' through one fixed 47R',ns,refs=limiters);isolated.extend(ns)
for up,dp in [(16,1),(15,3),(13,2)]:
    rule('connected','Grid U1.'+str(up)+' to display.'+str(dp),[f'U1.{up}',f'*.{dp}']);isolated.append(f'U1.{up}')
rule('isolated','Separate control, segment, grid and supply networks',isolated)
data['functionalPolicy']={'zeroOhm':[f'RJ{i}' for i in range(1,9)],'nc':['U1.12'],'checks':rules}
for c in data['objects']:
    # Retain source locators and numerical evidence, omit duplicated prose.
    for g in c['symbolConstraints']['graphics']:g.pop('sourceText',None)
(root/'libraries').mkdir(exist_ok=True)
(root/'libraries/display-board-fixed.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
brief='''使用固定原器件库重新设计显示板。保留全部29个电气器件、12个工艺对象的原符号形状、引脚局部几何、物料参数、原封装标识和字段可见性。自行布局和连线，调整字段位置避免重叠；不提供原图整页坐标或完整网表。显示管保持原自定义图形，不能按三路位选猜画成三位数字。
主板5V供电，DIN/CLK/STB控制TM1616，IRM-3638M3-X接收红外并通过RCV返回主板。DISP 1=RCV、2=SGND、3=+5V、4=STB、5=CLK、6=DIN。SEG1—7对应原显示段C/E/G/D/F/A/B，经七个原47R电阻；GRID1/2/3对应显示器脚1/3/2，GRID4脚12明确NC。R1是红外电源220R串联滤波，R3是RCV的22K上拉；C2/C3接R1后的红外电源去耦；C1/C4/C8为主5V去耦；C5/C6/C7分别为STB/CLK/DIN对地滤波。八个零欧跨线电阻均保留并用于有效连接路径，位置自行安排。
主要信号要有可读的实际导线；跨模块可使用同名标签。保留固定引脚的离网格位置，按实际native_at连线，不为消除警告改变原器件。可以加非物料ERC供电声明。采购号无证据留空；本轮不做PCB。交付前检查实际网表功能、BOM、封装标识、符号和引脚几何、PDF文字重叠。'''
(root/'libraries/display-board-brief.txt').write_text(brief,encoding='utf8')
print(json.dumps({'objects':len(data['objects']),'chars':len(brief),'graphics':sum(len(c['symbolConstraints']['graphics']) for c in data['objects'])}))
