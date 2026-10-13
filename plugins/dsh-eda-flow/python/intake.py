"""Read engineer files before the model plans; keep complete pages and source records."""
import sys, json, hashlib, shutil
from pathlib import Path
import native

def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

def main():
    req=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig')); out=Path(req['output'])/'prepared'
    out.mkdir(exist_ok=True); gaps=[]; sources=[]
    write(out/'engineer-inputs.json',req['inputs'])
    if req['stage']==2:
        mapping={}
        for key in ['schematic','pcb','nativeProject']:
            if not req['inputs'].get(key): continue
            src=Path(req['inputs'][key]); data=src.read_bytes()
            sources.append({'kind':key,'sha256':hashlib.sha256(data).hexdigest(),'name':src.name})
            if data.startswith(b'%TSD-Header'):
                gaps.append(src.name+'：TSD 包装文件。请在能打开它的原环境另存为可读 SchDoc/PcbDoc，或导出网表、BOM、逐层图和规格参数。')
                continue
            dest=out/'native'/src.name;dest.parent.mkdir(exist_ok=True);shutil.copyfile(src,dest)
            mapping[key]=dest.relative_to(out).as_posix()
        if 'schematic' in mapping and 'pcb' in mapping:
            try:
                report=native.extract(out,mapping);write(out/'native-extraction.json',report)
                gaps.extend(report.get('issues',[]))
            except Exception as e:gaps.append('原生解析未完成：'+str(e)+'；已保留源文件，请提供原软件导出。')
        elif mapping:gaps.append('已保存原始资料；完整原生提取需要同时提供原理图和 PCB。')
    if req['stage']==3:
        sheets=[]
        for item in req['inputs'].get('datasheets',[]):
            src=Path(item['path']);sha=hashlib.sha256(src.read_bytes()).hexdigest()
            try:
                import pymupdf
                with pymupdf.open(src) as doc:
                    pages=[{'page':i+1,'text':p.get_text()} for i,p in enumerate(doc)]
                entry={**item,'sha256':sha,'pages':pages};sheets.append(entry)
                write(out/'datasheets'/(sha+'.json'),entry)
                if not any(p['text'].strip() for p in pages):gaps.append(src.name+'：扫描 PDF 没有可提取文字，请提供文本版或 OCR 后复核。')
            except Exception as e:gaps.append(src.name+'：PDF 提取失败，'+str(e))
        write(out/'datasheets-index.json',[{k:v for k,v in x.items() if k!='pages'} for x in sheets])
        if not sheets:gaps.append('尚无器件规格书；请从厂家取得准确型号和封装版本的 PDF。')
    write(out/'intake.json',{'stage':req['stage'],'sources':sources,'gaps':gaps})
    print(json.dumps({'event':'prepared','stage':req['stage'],'gaps':len(gaps)}))

if __name__=='__main__':main()
