'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const claude = require('../lib/engines/claude');
const engines = require('../lib/engines');

test('paramsFor: 視覺分析允許工具', () => {
  const p = claude.paramsFor();
  assert.strictEqual(p.allowedTools, 'Read,Write,Edit,Glob');
});

test('buildArgs: posix 把 prompt 放進參數', () => {
  const { args, useStdin } = claude.buildArgs({ prompt: 'HELLO', model: 'sonnet', win: false });
  assert.strictEqual(useStdin, false);
  assert.deepStrictEqual(args, ['-p', 'HELLO', '--model', 'sonnet', '--strict-mcp-config', '--permission-mode', 'bypassPermissions', '--allowedTools', 'Read,Write,Edit,Glob']);
});

test('buildArgs: windows 走 stdin、prompt 不進參數', () => {
  const { args, useStdin } = claude.buildArgs({ prompt: 'P', model: 'sonnet', win: true });
  assert.strictEqual(useStdin, true);
  assert.ok(!args.includes('P'));
  assert.ok(args.includes('sonnet'));
});

test('getEngine: 未知 id 退回 claude', () => {
  assert.strictEqual(engines.getEngine('nope').id, 'claude');
  assert.strictEqual(engines.getEngine('claude').id, 'claude');
});

test('runAgent / resolveBin 已接好', () => {
  assert.strictEqual(typeof engines.runAgent, 'function');
  assert.strictEqual(typeof engines.resolveBin, 'function');
});
