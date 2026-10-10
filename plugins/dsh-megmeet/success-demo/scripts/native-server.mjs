import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const child=spawn(process.execPath,[path.resolve(root,'../.verification/dsh-host/node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','megmeet-link-ui','--patch',path.join(root,'configs/native-ui.patch.yml'),'--no-open','--port','4775'],{cwd:root,windowsHide:true,env:{...process.env,DSH_TELEMETRY_DISABLED:'1',TEMP:path.join(process.env.LOCALAPPDATA,'Temp'),TMP:path.join(process.env.LOCALAPPDATA,'Temp')},stdio:['ignore','pipe','pipe']});
const redact=chunk=>process.stdout.write(chunk.toString().replace(/([?&#](?:token|key|auth|ticket)=)[^\s&#]+/gi,'$1[REDACTED]'));
child.stdout.on('data',redact);child.stderr.on('data',redact);child.on('exit',code=>process.exitCode=code);process.on('SIGINT',()=>child.kill());
