// Bundle only the public message/stream value helpers; the running Harness owns LlmRuntime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const manifest = require.resolve('@deepseek-ai/dsh-llm/package.json');
const version = JSON.parse(await fs.readFile(manifest, 'utf8')).version;
if (version !== '0.2.0-rc.2') throw new Error('Revalidate message helpers before changing the supported Harness version.');
const result = await build({
  stdin: { contents: `export {createUserMessage} from '@deepseek-ai/dsh-llm/message';
    import {assembleAssistantStream} from '@deepseek-ai/dsh-llm/assistant-stream';
    export function createAssembler() { return assembleAssistantStream([]); }`, resolveDir: root },
  outfile: path.join(root, 'src/harness-messages.js'), platform: 'node', target: 'node22', format: 'esm',
  bundle: true, metafile: true, banner: { js: '// Generated from Harness 0.2.0-rc.2 public message helpers. See harness-messages.LICENSE.txt.' },
});
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(item => item.external && !item.path.startsWith('node:'))) throw new Error('Message helper bundle retained an external runtime package.');
}
await fs.copyFile(path.join(path.dirname(manifest), 'LICENSE'), path.join(root, 'src/harness-messages.LICENSE.txt'));
