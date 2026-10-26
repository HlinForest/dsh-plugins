import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {readJSON} from '../src/io.js';

test('JSON reader accepts normal and BOM JSON, separates invalid JSON and filesystem errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-json-read-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'record.json');
  for (const prefix of ['', '\uFEFF']) {
    await fs.writeFile(file,prefix+'{"ok":true,"note":"TSD-Header mentioned in valid content"}');
    assert.deepEqual(await readJSON(file),{ok:true,note:'TSD-Header mentioned in valid content'});
  }
  await fs.writeFile(file,'{"truncated":');
  await assert.rejects(readJSON(file),e=>e.code==='integrity'&&e.details.path===file);
  for (const prefix of ['%TSD-Header','%tsd-header','\uFEFF%TSD-Header']) {
    await fs.writeFile(file,prefix+'protected');
    await assert.rejects(readJSON(file),e=>e.code==='encrypted'&&e.details.path===file);
  }
  await assert.rejects(readJSON(path.join(root,'missing.json')),e=>e.code==='ENOENT');
});

