import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardLease } from '../src/board-lease.js';
test('board ownership persists across calls and prevents another chat overwriting it', () => {
  const lease = new BoardLease();
  lease.before('mcp__kicad__open_project', 'chat1');
  lease.before('mcp__kicad__save_board', 'chat1');
  assert.throws(() => lease.before('mcp__kicad__open_project', 'chat2'), /another chat/);
  assert.throws(() => lease.before('mcp__kicad__save_board', 'chat2'), /another chat/);
  lease.after('mcp__kicad__close_project', 'chat1', { isError: false, value: { content: [{ type: 'text', text: '{"success":false}' }] } });
  assert.throws(() => lease.before('mcp__kicad__open_project', 'chat2'), /another chat/);
  lease.after('mcp__kicad__close_project', 'chat1', { isError: false, value: { content: [{ type: 'text', text: '{"success":true}' }] } });
  lease.before('mcp__kicad__open_project', 'chat2');
  assert.equal(lease.owner, 'chat2');
});
