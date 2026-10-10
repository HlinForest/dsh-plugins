import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import yaml from '../../node_modules/js-yaml/index.js';
import {Context} from '@deepseek-ai/cordis';
import {ToolRuntime} from '@deepseek-ai/dsh-tools';
import {SystemPrompt} from '@deepseek-ai/dsh-system-prompt';
const root=path.resolve('success-demo'),project=path.dirname(root);
const installed=path.join(process.env.USERPROFILE,'.dsh/profiles/desktop/node_modules/dsh-megmeet');
const manifest=JSON.parse(await fs.readFile(path.join(installed,'package.json'),'utf8'));
if(manifest.version!=='0.2.0'||manifest.peerDependencies['@deepseek-ai/dsh-tools']!=='0.2.0-rc.2')throw Error('Installed version mismatch');
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const f of ['index','domain','power','service','reporting','cli'])if(hash(await fs.readFile(path.join(installed,`lib/${f}.js`)))!==hash(await fs.readFile(path.join(project,`lib/${f}.js`))))throw Error('Installed code differs: '+f);
const jsType=new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>({expression:value})});
// The desktop profile is owned by Electron. Inspect its saved override without trying to boot it from headless CLI.
const output=await fs.readFile(path.join(process.env.USERPROFILE,'.dsh/profiles/desktop/cordis.patch.yml'),'utf8');
const config=yaml.load(output,{schema:yaml.DEFAULT_SCHEMA.extend([jsType])});
const entry=config.find(r=>r.id==='megmeet-product-assistant');if(!entry?.config.catalogPath?.endsWith('/snapshots/catalog.active.json')||!entry.config.reportDirectory?.endsWith('/desktop-reports'))throw Error('Desktop catalog/report configuration mismatch');
// Bare Node does not install Electron's peer-package resolver. Test the byte-identical code in the rc.2 registry here.
const plugin=await import(pathToFileURL(path.join(project,'lib/index.js')).href),ctx=new Context();
let schemas;
try{await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime);await ctx.plugin(plugin,entry.config);schemas=ctx.tools.schemas();if(schemas.length!==6)throw Error('Expected six installed tools');const info=await ctx.tools.execute({name:'megmeet_get_catalog_info',arguments:{},callId:'installed-info',signal:new AbortController().signal});if(info.isError||info.value.productCount!==39)throw Error('Installed catalog check failed');}
finally{await ctx.fiber.dispose();}
const result={pass:true,installedPlugin:'dsh-megmeet@0.2.0',runtimePeer:'DSH v0.2.0-rc.2',codeIdenticalToDeliveredPackage:true,desktopProfileConfigured:true,toolCount:schemas.length,productCount:39,catalogPath:entry.config.catalogPath,reportDirectory:entry.config.reportDirectory,verificationScope:'Installed version/configuration/code hashes; byte-identical code tested in the rc.2 tool registry and native web UI. Electron-managed desktop must be reopened to load the new package.',reopenDesktopToLoadNewPackage:true};
await fs.writeFile(path.join(root,'desktop-install-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
