"""Build the Chinese, screenshot-led handbook from verified independent demos."""
from pathlib import Path
import json,html
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor,white
from reportlab.lib.pagesizes import A4,landscape
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader

ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[1]
OUT=REPO/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
PDF=OUT/'DSH三个插件独立演示手册.pdf'
proof=json.loads((ROOT/'.runtime/demo-verification.json').read_text(encoding='utf-8'))
assert proof['rollbackExact'] and not proof['browserErrors']
assert proof['schematicVerification']['erc']['errors']==0 and proof['schematicVerification']['erc']['warnings']==0
pdfmetrics.registerFont(TTFont('YaHei','C:/Windows/Fonts/msyh.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('YaHeiBold','C:/Windows/Fonts/msyhbd.ttc',subfontIndex=0))
pdfmetrics.registerFontFamily('YaHei',normal='YaHei',bold='YaHeiBold',italic='YaHei',boldItalic='YaHeiBold')
W,H=landscape(A4);M=42;CW=W-2*M
INK=HexColor('#203745');MUTED=HexColor('#597180');TEAL=HexColor('#257D8D');PAPER=HexColor('#EDF2F5');LINE=HexColor('#D6E1E6')
c=canvas.Canvas(str(PDF),pagesize=(W,H));c.setTitle('DSH 三个插件独立演示手册');c.setAuthor('DSH Engineering Workbench');c.setSubject('独立选型演示 PCB评审演示 原理图修改演示')
styles={
 'body':ParagraphStyle('body',fontName='YaHei',fontSize=11,leading=17,textColor=INK,wordWrap='CJK'),
 'small':ParagraphStyle('small',fontName='YaHei',fontSize=9.5,leading=14,textColor=MUTED,wordWrap='CJK'),
 'step':ParagraphStyle('step',fontName='YaHei',fontSize=11.3,leading=18,textColor=INK,wordWrap='CJK'),
 'quote':ParagraphStyle('quote',fontName='YaHei',fontSize=11,leading=17,textColor=TEAL,wordWrap='CJK'),
}
def para(text,x,y,width,style='body'):
    p=Paragraph(text,styles[style]);_,height=p.wrap(width,1000);p.drawOn(c,x,y-height);return y-height
def start(number,section,title,subtitle='',bookmark=None):
    c.setFillColor(white);c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(TEAL);c.setFont('YaHeiBold',10);c.drawString(M,H-35,section)
    c.setFillColor(INK);c.setFont('YaHeiBold',23);c.drawString(M,H-73,title)
    if subtitle:para(subtitle,M,H-88,CW,'small')
    c.setStrokeColor(LINE);c.line(M,34,W-M,34)
    c.setFillColor(MUTED);c.setFont('YaHei',8.5);c.drawString(M,20,'DSH 工程工作台 0.2.0  |  独立演示  |  2026年10月10日实测')
    c.drawRightString(W-M,20,f'{number:02d} / 15')
    if bookmark:c.bookmarkPage(bookmark);c.addOutlineEntry(title,bookmark,level=0,closed=False)
def steps(items,x,y,width):
    for number,title,body in items:
        c.setFillColor(TEAL);c.roundRect(x,y-21,25,23,4,fill=1,stroke=0);c.setFillColor(white);c.setFont('YaHeiBold',10);c.drawCentredString(x+12.5,y-14,str(number))
        y=para('<b>'+title+'</b><br/>'+body,x+36,y,width-36,'step')-16
    return y
def note(text,x,y,width):
    p=Paragraph('<b>讲解参考</b>　'+text,styles['quote']);_,height=p.wrap(width-24,300)
    c.setFillColor(PAPER);c.roundRect(x,y-height-22,width,height+18,5,fill=1,stroke=0);p.drawOn(c,x+12,y-height-11)
def pic(name,x,y,width,height,caption):
    file=ROOT/'screenshots'/name
    image=ImageReader(str(file));iw,ih=image.getSize();scale=min(width/iw,height/ih);dw,dh=iw*scale,ih*scale
    c.setFillColor(PAPER);c.roundRect(x,y-height,width,height,5,fill=1,stroke=0)
    c.drawImage(image,x+(width-dw)/2,y-(height-dh)/2-dh,width=dw,height=dh,mask='auto')
    para(caption,x,y-height-8,width,'small')
def finish():c.showPage()

# 1. Select any independent demonstration.
start(1,'演示入口','DSH 三个插件独立演示','每个案例都有自己的输入、预期结果和复位方法。可任选一个直接开始，无须先运行另外两个。', 'contents')
para('这份手册用于现场操作与讲解。截图来自本机 DSH 原生工作台的实际运行；材料包已准备好需求文本、两套四器件 KiCad 小工程和修正版。',M,H-133,CW)
y=H-193
for code,title,desc,duration,target in [
 ('01','产品选型','改变客户负载与温度，查看候选、功率及资料依据如何变化。','约 5 分钟 · 第 3 页','selection'),
 ('02','PCB 评审','定位电容装配问题，载入预制修正版，再评审并展示变化。','约 5 分钟 · 第 6 页','pcb'),
 ('03','原理图同步','输入两处改值要求，比较候选，验证后写回，再完整回退。','约 7 分钟 · 第 10 页','schematic')]:
    c.setFillColor(PAPER);c.roundRect(M,y-82,CW,74,6,fill=1,stroke=0)
    c.setFillColor(TEAL);c.setFont('YaHeiBold',24);c.drawString(M+17,y-48,code)
    para('<b>'+title+'</b>　'+duration,M+72,y-19,CW-90)
    para(desc,M+72,y-43,CW-90,'small');c.linkRect('',target,(M,y-82,W-M,y-8),relative=0,thickness=0)
    y-=88
para('建议先按第 2 页启动专用演示窗口。现场每个案例只讲一件事：需求能复核、问题能定位、修改能验证和回退。',M,94,CW,'small');finish()

# 2. One local launch, no changes to the daily desktop profile.
start(2,'准备一次即可','打开专用演示工作台','使用独立演示配置；现有桌面 DSH 和正式工程不需要切换。','prepare')
steps([
 (1,'先找到材料目录','本机：<b>D:\\VisualBoard\\dsh-plugins\\demos\\independent</b>。下载材料包后，请先完整解压到路径较短的本地目录。'),
 (2,'打开演示窗口','双击 <b>打开演示工作台.cmd</b>。浏览器打开 DSH 后，若显示预览版说明，点击“继续”。'),
 (3,'进入工作台','点击侧栏“工程工作台”。需要更多空间时，收起右下角“工程进度”面板。浏览器缩放保持 100%。'),
 (4,'结束演示','先关浏览器页，再双击 <b>关闭演示服务.cmd</b>。该入口只停止专用演示服务。')],M,H-132,310)
pic('00-workbench.png',M+330,H-136,CW-330,310,'三项入口在顶部：产品方案、PCB 评审、原理图同步。')
para('本机已准备完成。其他机器需有兼容的 DSH 与 KiCad；首次安装演示插件可能需要联网。所有案例的业务操作都由本机插件执行。',M,83,CW,'small');finish()

# 3-5 selection, standalone.
start(3,'演示一  产品选型  1 / 3','载入真实格式的客户需求','入口：产品方案。材料：01-selection 文件夹。无需打开 KiCad。','selection')
steps([
 (1,'载入第一份需求','点击“载入 TXT / Markdown”，选择 <b>A_初始需求.txt</b>。也可打开文件，复制全文到“客户需求”。'),
 (2,'只展示可继续考虑的候选','产品类别保持“全部类别”，候选上限设为 <b>10</b>。取消勾选“同时列出不满足项，便于解释排除原因”。'),
 (3,'点击解析需求','核对右侧已提取条件及逐字原文依据。初始负载 <b>180 W</b>、裕量 <b>20%</b>、环境 <b>25℃</b>，连续能力要求为 <b>216 W</b>。')],M,H-133,310)
pic('01-requirements.png',M+330,H-135,CW-330,310,'需求还明确列出 24 V、输入范围、宽度、安装姿态、海拔和间距。')
note('“我们先让系统把客户的话拆成可核对的条件，需求里没写的条件不会自动补上。”',M,98,CW);finish()

start(4,'演示一  产品选型  2 / 3','改变需求 观察候选收敛','保持同一个资料库，改变客户输入。可以现场打开两份 TXT 对照。')
y=steps([
 (4,'先检索初始需求','点击“检索并校验候选”。可看到 CP10.241、SDR-240-24 等初始候选；功率图中可核对 240 W 与 216 W 的关系。'),
 (5,'载入第二份需求并重新检索','载入 <b>B_负载和温度提高.txt</b>：负载变为 <b>300 W</b>、温度变为 <b>55℃</b>。再次检索；本次要求变为 <b>360 W</b>，符合已列条件的候选剩下以下 4 个。')],M,H-130,CW)
pic('03-revised-candidates.png',M,y-4,CW,138,'实测保留 CP20.241-R1、CP20.241-R2、CP20.241-R2-C1、CP20.242-R2；此工况下已核验连续能力均为 480 W。')
note('“客户把需求改高以后，候选会重新计算。能交付的方案必须同时解释为什么满足，以及哪些条件是依据。”',M,106,CW)
para('可选：重新勾选“同时列出不满足项”再检索，查看原 240 W 级产品因连续能力不足而被排除的原因。',M,53,CW,'small');finish()

start(5,'演示一  产品选型  3 / 3','展示证据并导出方案','主线到导出即可结束。缺少信息的例子可作为 30 秒加演。')
steps([
 (6,'查看逐项证据','点击型号 <b>CP20.241-R2</b>，查看要求、资料值、原文摘录和结果。展开“资料来源与原件”，打开厂家原件。'),
 (7,'输出一份可交接报告','勾选“纳入方案 CP20.241-R2”，输入报告标题，再点击“导出 HTML / Markdown / JSON”。打开 HTML 报告，展示结果及筛选框。'),
 (8,'加演或复位','加演：载入 <b>C_缺少安装条件.txt</b> 并检索，应出现“资料待确认”，已核验连续能力为“—”。复位：重新载入 A 文件即可。')],M,H-134,310)
pic('06-exported-report.png',M+330,H-135,CW-330,310,'导出时重新校验，报告保留客户原文、资料版本、候选与待确认项。')
note('“资料不足会留成待确认项，不能凭空变成满足。报告可交给下一位工程师继续复核。”',M,98,CW);finish()

# 6-9 PCB, standalone, intentionally unrouted fixture.
start(6,'演示二  PCB 评审  1 / 4','载入四器件小板','入口：PCB 评审。材料：02-pcb 文件夹。无需先完成产品选型。','pcb')
steps([
 (1,'恢复修正前样例','在资源管理器双击 <b>02-pcb\\载入修正前样例.cmd</b>。等 2 秒，回到工作台“PCB 评审”。'),
 (2,'更新并读取工程','在“工程与网络”点击“从已保存 KiCad 工程更新”。应显示 <b>4 个器件、3 个网络</b>。'),
 (3,'先让老板看清这块板','切换“PCB 原图”。J1 是输入、R1 是串联电阻、C1 是滤波电容、J2 是输出。这里只展示放置好的封装，板子尚未布线。')],M,H-134,310)
pic('10-pcb-board.png',M+330,H-138,CW-330,280,'本例为教学工程。评审检查声明的网络、装配状态与参考点距离。')
note('“用很小的一块板看清楚：系统读取了哪几个器件、哪几条网络，以及具体检查什么。”',M,98,CW);finish()

start(7,'演示二  PCB 评审  2 / 4','从问题定位到真实引脚网络','修正前预期：需处理 1 项，待确认 0 项；邻近检查暂不适用。')
y=steps([
 (4,'找到电容装配问题','向下找到“未发现项目要求的已装输入电容”。依据中应写出 <b>C1 = 100nF，DNP，不计作已装</b>。图上有电容符号，不代表当前版本装了它。'),
 (5,'定位器件并查连接','点击问题中的 <b>C1</b> 定位点；再在“精确位号”输入 <b>J2</b>，点击“查询器件网络”。J2.1 位于 /SIGNAL，与 R1.2、C1.1 相连；J2.2 位于 /GND。')],M,H-130,CW)
pic('08-pcb-findings-before.png',M,y-2,CW,170,'因为 C1 标为不装，不能计入已装滤波电容；涉及它的邻近检查也不会冒充有效布局结论。')
note('“它把问题落到 J2.1、C1 和具体网络上，工程师知道该检查哪里，也能看见判断依据。”',M,98,CW);finish()

start(8,'演示二  PCB 评审  3 / 4','载入修正版 再看检查结果','这里加载的是事先准备好的修正版，工作台负责重新读取和复核。')
y=steps([
 (6,'加载预制修正版','双击 <b>02-pcb\\载入已准备的修正版.cmd</b>。它把 C1 改为装配，并把 C1 移到距 J2 参考点 <b>2 mm</b> 处。'),
 (7,'更新后展示问题消失','回到“工程与网络”，再次点击“从已保存 KiCad 工程更新”。预期变为 <b>需处理 0 项、局部检查符合 2 项</b>。点击“导出评审报告”保存本次结果。')],M,H-131,CW)
pic('13-pcb-findings-after.png',M,y-2,CW,180,'两项通过：输入电容装配与直接连接；C1 到 J2 的参考点距离 2 mm，不超过演示规则 3 mm。')
note('“改完以后再跑同一套检查，结果能对照。通过的是这两项明确规则，不等于整板 DRC 或制造验证通过。”',M,98,CW);finish()

start(9,'演示二  PCB 评审  4 / 4','补充展示清单与变更监听','按现场时间选演；核心主线在第 8 页已经完成。')
steps([
 (8,'查器件检查清单','打开“器件检查清单”，输入 <b>输入滤波电容</b>，类别选“电容”，点击查询。用一句话说明：这是检查建议清单，实际检测结果在工程评审页。'),
 (9,'观察快照变化','切到“变更监听”，间隔设为 <b>2 秒</b>，点击“开启 / 更新监听”。等状态为“正在监听”，再载入修正前样例，约等 4 至 8 秒，查看新增问题。'),
 (10,'结束与复位','点击“停止监听”。再次双击“载入修正前样例.cmd”，回“工程与网络”更新。下一次演示从第 6 页开始。')],M,H-134,310)
pic('12-watcher.png',M+330,H-136,CW-330,300,'监听读取导出快照；EDA 中未保存、未导出的编辑不会自动进入检查。')
note('“问题不仅能手动检查，导出的设计一变化，也能在工作台里看到新的检查结果。”',M,98,CW);finish()

# 10-14 schematic, separate input project.
start(10,'演示三  原理图同步  1 / 5','创建一个独立改值任务','入口：原理图同步。材料：03-schematic 文件夹。无需完成选型或 PCB 演示。','schematic')
y=steps([
 (1,'准备初始小工程','确认 KiCad 未打开该小工程，双击 <b>03-schematic\\恢复初始小工程.cmd</b>。初始 R1、R2 均为 <b>10k</b>。'),
 (2,'指定图纸与修改要求','切到“原理图同步”，展开“创建新任务”。当前原理图填写 <b>03-schematic/current/DividerChange.kicad_sch</b>；目标类型选“直接输入文字要求”。输入：<b>R1 改为 20k；R2 改为 15k</b>。')],M,H-131,CW)
pic('14-create-schematic-task.png',M,y-2,CW,192,'当前原理图务必指向 03-schematic/current 中的 DividerChange。不要沿用 PCB 案例的默认文件路径。')
note('“这次只改两处明确的电阻值。先建立独立任务，后面每一步都能核对。”',M,98,CW);finish()

start(11,'演示三  原理图同步  2 / 5','确认两项目标 再比较修改前','目标条目必须保留原文依据。现场可让观众逐条核对。')
y=steps([
 (3,'创建并保存目标条目','点击“创建并读取目标”。应生成两个条目：R1 = 20k、R2 = 15k；检查对应原文，确认“该条目清晰且已核对”已勾选，再点“保存并确认目标条目”。'),
 (4,'比较修改前图纸','打开“差异比较”，点击“比较修改前”。应看到 <b>2 项有差异</b>：两只电阻目前仍为 10k。此时原图和候选都还没有改值。')],M,H-131,CW)
pic('16-differences-before.png',M,y-2,CW,190,'比较对象是明确声明的两个目标条目；这一步让“要改什么、现在是什么”可直接核对。')
note('“先看到差异，再修改。目标是两条有原文依据的要求，结果不会只剩一句模糊的‘已完成’。”',M,98,CW);finish()

start(12,'演示三  原理图同步  3 / 5','修改候选 验证后看前后图','本例实测结果：目标差异 0 项，ERC 0 个错误、0 个警告。')
y=steps([
 (5,'只修改候选副本','进入“候选修改”，保持默认修改方式，点击“修改候选副本”。提示应为候选已修改，原文件尚未写回。'),
 (6,'验证并聚焦 R1','进入“验证与写回”，点击“验证候选并生成对比”。在“对比聚焦器件”选择 <b>R1</b>：左边 R1/R2 为 10k/10k，右边变为 20k/15k。候选 PDF 和验证记录也可打开。')],M,H-131,CW)
pic('17-schematic-before-after.png',M,y-2,CW,188,'这是 KiCad 实际导出的前后原理图。该截图中，两个电阻值均可直接看出变化。')
note('“现在修改发生在候选里；目标和 ERC 都验证过以后，我们才决定是否写回。”',M,98,CW);finish()

start(13,'演示三  原理图同步  4 / 5','核对路径 再确认写回','演示只写回材料包里的 current 小工程。截图中的随机任务号每次都会变化。')
y=steps([
 (7,'打开本次写回确认','确认显示“目标差异 0 项”且 ERC 没有错误，点击“核对并准备写回”。核对路径确实以 <b>03-schematic/current/DividerChange.kicad_sch</b> 结尾。'),
 (8,'明确确认后写回','确认该小工程已保存且关闭，勾选确认框，再点击“确认写回”。应出现“已写回”、当前工程路径和原始备份位置。确认超过两分钟时，重新核对即可。')],M,H-131,CW)
pic('19-write-confirmation.png',M,y-2,CW,165,'必须先勾选确认框。写回前会备份；候选或原图变化时，旧验证不能继续用于写回。')
note('“最后一步会明确告诉我改的是哪个文件。写回不是悄悄发生的，而且保留了原始备份。”',M,98,CW);finish()

start(14,'演示三  原理图同步  5 / 5','回退并恢复下次演示状态','回退是本例最适合收尾的一步。实测回退文件与起始文件逐字节一致。')
y=steps([
 (9,'演示一键恢复原版本','在“已写回”区域点击“核对并准备回退”，核对路径，勾选确认框，再点击“确认回退”。应显示“已回退”，R1、R2 恢复为 10k。'),
 (10,'结束与重演','切到“执行记录”，展示真实步骤与耗时。重演时展开“创建新任务”重新开始；也可先关闭该小工程，再双击“恢复初始小工程.cmd”。已有任务不要反复写回。')],M,H-131,CW)
pic('21-rolled-back.png',M,y-2,CW,162,'如果写回后有人又人工修改了原图，回退会拒绝覆盖。此时先保存现场版本，再决定如何恢复。')
note('“修改前后能看见，写回前能核对，写回后还能回到原点。工程师可以验证每一步。”',M,98,CW);finish()

# 15. Fast recovery / optional native target.
start(15,'排练与现场速查','遇到这些情况 这样继续','这张表用于现场恢复。先保证主线完成，再增加支线。','troubleshooting')
rows=[
 ('选型没有出现预期的 4 个候选','确认已载入 B 文件全文，资料库为 V2-2026-10-09，类别为全部，取消显示不满足项，再检索。'),
 ('小板看起来仍是上一次结果','先载入对应样例，再点“从已保存 KiCad 工程更新”。只切换图片标签不会重新读工程。'),
 ('写回按钮不可用','先保存目标条目，再修改候选并验证；检查目标差异和 ERC 错误。请使用专用演示窗口。'),
 ('输入或操作与文档不一致','重新载入对应输入文件或恢复小工程，然后创建新任务。不要改已有任务的原始文件。'),
 ('准备加演原生目标图','创建新任务，当前图仍选 current；目标类型改为“目标 KiCad 原理图”，目标选 03-schematic/target/DividerChange.kicad_sch。随后直接比较、修改候选和验证，无需手录条目。'),
 ('演示结束后需要收尾','停止监听；完成原理图回退；关闭浏览器；双击“关闭演示服务.cmd”。原有桌面 DSH 不受该入口影响。'),
]
y=H-131
for i,(problem,solution) in enumerate(rows):
    c.setFillColor(PAPER if i%2==0 else white);c.rect(M,y-56,CW,56,fill=1,stroke=0)
    para('<b>'+html.escape(problem)+'</b>',M+12,y-9,220)
    para(html.escape(solution),M+247,y-9,CW-262,'small');y-=56
para('材料与边界：选型使用已有公开厂家资料快照；两个电路是专门创建的教学样例。PCB 尚未布线，不作为生产设计。判断只覆盖插件声明的条件与规则，原理图的两条改值要求也不等于整张图纸的独立设计审查。',M,83,CW,'small');finish()
c.save()
print(PDF)
