import React,{useState} from 'react';
import {Btn,Table,Notice} from './ui.jsx';
export function Environment({onCheck,download}){
 const [result,R]=useState(null),[busy,B]=useState(false),[error,E]=useState('');
 const check=async()=>{B(true);E('');try{R(await onCheck())}catch(e){E(e.message)}finally{B(false)}};
 return <section aria-label="环境与安装"><h2>环境与安装</h2><p className="page-help">检查本机工具和配置，不发送模型请求。已有图纸的浏览、文字评审与评审记录导出可以先用；重新生成需要本机 CAD 工具。</p>
 <div className="buttons"><Btn primary disabled={busy} onClick={check}>{busy?'正在检查本机环境…':'检查本机环境'}</Btn>{result&&<Btn onClick={()=>download('EDA-环境检查.json',JSON.stringify(result,null,2))}>下载检查报告</Btn>}</div>
 {error&&<Notice tone="error">{error}</Notice>}{result&&<><p>{result.reviewOnly?'当前为仅查看与评审模式。':`原理图生成条件：${result.schematicReady?'已具备':'尚不完整'}；PCB生成条件：${result.pcbReady?'已具备':'尚不完整'}。`} 模型连通性需实际请求验证。</p><Table label="本机依赖检查" pageSize={12} columns={[{key:'name',title:'依赖'},{key:'passed',title:'结果',render:r=>r.passed?'可用':'待处理'},{key:'detail',title:'本机情况'},{key:'remedy',title:'处理方法'}]} rows={result.checks}/></>}
 <h3>工程师电脑需要什么</h3><ol><li>DeepSeek Harness 和本插件；生成时使用 Harness 中已配置的模型服务。</li><li>KiCad 10 稳定版完整安装，包含配套 Python、符号库和封装库。无需先手工打开 KiCad 编辑器。</li><li>交付包的 Python 离线依赖；安装到插件配置的 Python 中。</li><li>PCB 自动布线需要 Java 21 或以上。完整交付包附 Java 21，Freerouting 已随插件提供。</li></ol>
 <h3>还没有 KiCad</h3><p>从 <a href="https://www.kicad.org/download/windows/" target="_blank" rel="noreferrer">KiCad 官方下载页</a>获取 Windows x64 的10系列稳定版完整安装器，保留符号和封装库。内网可由联网电脑下载后转入安装；然后运行交付包的安装脚本，配置 KiCad 目录、补齐离线依赖，再检查本机环境。</p><p>暂时不能安装时，可用安装脚本的 ReviewOnly 选项先启用查看和评审模式。补齐后重新配置并关闭该选项，继续生成。当前没有远程 CAD 服务器代执行功能；仅安装 AD 不能替代 KiCad。</p><p>本机已安装但显示缺少时，先检查插件配置路径，不必重复安装。3D模型只影响3D外观预览，不是本轮二维布局和DRC的必要条件。</p></section>;
}
