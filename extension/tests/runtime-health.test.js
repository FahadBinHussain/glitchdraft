// Tests for extension/runtimeHealth.js — disconnect classification, bounded
// retry, tick recovery state, and shared user-facing copy.
// Run: node --test extension/tests/   (from the repo root)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rh = require('../runtimeHealth.js');

const RECEIVING_END = 'Could not establish connection. Receiving end does not exist.';
const INVALIDATED = 'Extension context invalidated.';

// Fake a live extension context (chrome.runtime.id defined). Without it,
// everything classifies as orphaned — that is the point of the check.
function withLiveChrome() {
    global.chrome = { runtime: { id: 'test-extension-id', lastError: undefined } };
}
function withoutChrome() {
    delete global.chrome;
}

test('classify: receiving-end error is worker-down', () => {
    withLiveChrome();
    try {
        assert.equal(rh.gdClassifyDisconnect(new Error(RECEIVING_END)), 'worker-down');
        assert.equal(rh.gdClassifyDisconnect({ message: RECEIVING_END }), 'worker-down');
        assert.equal(rh.gdClassifyDisconnect(RECEIVING_END), 'worker-down');
    } finally { withoutChrome(); }
});

test('classify: context-invalidated error is orphaned', () => {
    withLiveChrome();
    try {
        assert.equal(rh.gdClassifyDisconnect(new Error(INVALIDATED)), 'orphaned');
    } finally { withoutChrome(); }
});

test('classify: missing runtime.id is orphaned even for a worker-down message', () => {
    global.chrome = { runtime: {} }; // orphaned content script: id gone
    try {
        assert.equal(rh.gdClassifyDisconnect(new Error(RECEIVING_END)), 'orphaned');
        assert.equal(rh.gdIsOrphaned(), true);
    } finally { withoutChrome(); }
    assert.equal(rh.gdClassifyDisconnect(new Error('boom')), 'orphaned');
});

test('classify: anything else is other', () => {
    withLiveChrome();
    try {
        assert.equal(rh.gdClassifyDisconnect(new Error('Neon request failed')), 'other');
        assert.equal(rh.gdClassifyDisconnect(new Error('')), 'other');
    } finally { withoutChrome(); }
});

test('gdChromeSend: resolves on response, rejects on lastError, rejects on throw', async () => {
    const calls = [];
    global.chrome = {
        runtime: {
            id: 'test-extension-id',
            lastError: undefined,
            sendMessage: (msg, cb) => {
                calls.push(msg);
                if (msg.action === 'boom') {
                    global.chrome.runtime.lastError = { message: RECEIVING_END };
                    cb(undefined);
                    global.chrome.runtime.lastError = undefined;
                } else if (msg.action === 'throw') {
                    throw new Error('sync throw');
                } else {
                    cb({ success: true });
                }
            }
        }
    };
    try {
        assert.deepEqual(await rh.gdChromeSend({ action: 'ping' }), { success: true });
        await assert.rejects(rh.gdChromeSend({ action: 'boom' }), /Receiving end does not exist/);
        await assert.rejects(rh.gdChromeSend({ action: 'throw' }), /sync throw/);
        assert.equal(calls.length, 3);
    } finally { withoutChrome(); }
});

test('retry: worker-down retries with backoff, then succeeds', async () => {
    withLiveChrome();
    try {
        let attempts = 0;
        const slept = [];
        const send = () => {
            attempts++;
            if (attempts < 3) return Promise.reject(new Error(RECEIVING_END));
            return Promise.resolve({ success: true });
        };
        const res = await rh.gdSendWithRetry({ action: 'getDraft' }, {
            send, sleep: (ms) => { slept.push(ms); return Promise.resolve(); }
        });
        assert.deepEqual(res, { success: true });
        assert.equal(attempts, 3);
        assert.deepEqual(slept, [500, 1500]);
    } finally { withoutChrome(); }
});

test('retry: orphaned fails fast with no retry', async () => {
    withLiveChrome();
    try {
        let attempts = 0;
        const send = () => { attempts++; return Promise.reject(new Error(INVALIDATED)); };
        await assert.rejects(
            rh.gdSendWithRetry({ action: 'getDraft' }, { send, sleep: () => Promise.resolve() }),
            (e) => { assert.equal(e.gdKind, 'orphaned'); return true; }
        );
        assert.equal(attempts, 1);
    } finally { withoutChrome(); }
});

test('retry: persistent worker-down gives up after 2 retries and keeps its kind', async () => {
    withLiveChrome();
    try {
        let attempts = 0;
        const send = () => { attempts++; return Promise.reject(new Error(RECEIVING_END)); };
        await assert.rejects(
            rh.gdSendWithRetry({ action: 'getDraft' }, { send, sleep: () => Promise.resolve() }),
            (e) => { assert.equal(e.gdKind, 'worker-down'); return true; }
        );
        assert.equal(attempts, 3);
    } finally { withoutChrome(); }
});

test('tick recovery: markUp returns true exactly once per outage', () => {
    rh.gdResetWorkerState();
    assert.equal(rh.gdMarkWorkerUp(), false);
    rh.gdMarkWorkerDown();
    assert.equal(rh.gdWasWorkerDown(), true);
    assert.equal(rh.gdMarkWorkerUp(), true);
    assert.equal(rh.gdMarkWorkerUp(), false);
    assert.equal(rh.gdWasWorkerDown(), false);
    rh.gdMarkWorkerDown();
    rh.gdResetWorkerState();
    assert.equal(rh.gdWasWorkerDown(), false);
});

test('hints: worker-down points at the extension, orphaned points at the tab', () => {
    const down = rh.gdDisconnectHints('worker-down');
    assert.match(down.lines.join(' '), /edge:\/\/extensions/);
    assert.match(down.lines.join(' '), /reload-extension\.ps1/);
    const orphan = rh.gdDisconnectHints('orphaned');
    assert.match(orphan.lines.join(' '), /Reload THIS TAB/);
    assert.doesNotMatch(orphan.lines.join(' '), /edge:\/\/extensions/);
});
