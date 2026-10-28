import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {version} from '../src/contracts.js';
import {clientVersion,confirmationError} from '../frontend/confirmation.js';
test('package, service and visible client use one compatible protocol version',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(clientVersion,version);assert.equal(version,pkg.version);
 const error=confirmationError({id:'release-check',stages:[{id:6,status:'stale'}]},6,version);
 assert.equal(error.info.details.clientVersion,pkg.version);
});
