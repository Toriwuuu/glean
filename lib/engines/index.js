'use strict';
/**
 * lib/engines/index.js — 分析引擎登記表與統一入口。
 * 未來新增引擎：在此 require 並加入 ENGINES，其餘程式不需更動。
 */
const claude = require('./claude');

const ENGINES = { claude };
const DEFAULT = 'claude';

function getEngine(id) { return ENGINES[id] || ENGINES[DEFAULT]; }
function listEngines() { return Object.values(ENGINES); }
function resolveBin(id, explicit) { return getEngine(id).resolveBin(explicit); }
function runAgent(id, opts) { return getEngine(id).run(opts); }

module.exports = { getEngine, listEngines, resolveBin, runAgent, DEFAULT };
