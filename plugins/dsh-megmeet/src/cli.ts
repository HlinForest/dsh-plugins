import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { executeBusiness } from './service.js';
import type { BusinessCommand, BusinessArgs } from './service.js';
const argv=process.argv.slice(2),options:Record<string,string>={};
for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||argv[i+1]===undefined)throw new Error('CLI参数必须使用--name value。');options[argv[i].slice(2)]=argv[i+1];}
const command=options.command??'search';
if(!['info','parse','search','validate','report','export'].includes(command))throw new Error('不支持的command。');
const args:BusinessArgs=options.args?JSON.parse(options.args):{};
if(options['args-file'])Object.assign(args,JSON.parse(await readFile(resolve(options['args-file']),'utf8')));
if(options['text-file'])args.text=await readFile(resolve(options['text-file']),'utf8');
if(options.text)args.text=options.text;
if(options['expected-revision'])args.expectedCatalogRevision=options['expected-revision'];
if(options['product-id'])args.productId=options['product-id'];
try{const maxCandidates=Number(options['max-candidates']??50);if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>50)throw Error('max-candidates必须为1–50整数。');const value=await executeBusiness(command as BusinessCommand,args,{catalogPath:options.catalog?resolve(options.catalog):'',maxCandidates,maxInputChars:60000,reportDirectory:options['report-dir']?resolve(options['report-dir']):''});process.stdout.write(JSON.stringify(value,null,2)+'\n');}
catch(error){process.stderr.write(JSON.stringify({error:error instanceof Error?error.message:String(error)})+'\n');process.exitCode=1;}
