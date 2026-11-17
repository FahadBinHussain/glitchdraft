// Tests for extension/background.js message routing, loaded for real in a
// vm sandbox with the chrome API stubbed: the ping probe, the null-request
// guard, and the unknown-action catch-all.
// Run: node --test extension/tests/   (from the repo root)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground() {
    const listeners = {};
    const sandbox = {
        console,
        self: {
            importScripts: () => {},
            addEventListener: () => {},
            skipWaiting: () => {},
            clients: { claim: () => {} }
        },
        // importScripts is stubbed out, so the service classes are pre-defined.
        FirestoreService: class {},
        NeonService: class {},
        chrome: {
            runtime: {
                onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
                onMessage: { addListener: (fn) => { listeners.message = fn; } },
                reload: () => {}
            },
            storage: { local: { get: async () => ({}), set: async () => {} } },
            tabs: { query: (q, cb) => cb([]), reload: async () => {}, update: async () => {} }
        },
        setTimeout
    };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'background.js' });
    assert.equal(typeof listeners.message, 'function', 'background must register onMessage');
    return listeners.message;
}

function invoke(listener, request) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (response) => { if (!settled) { settled = true; resolve(response); } };
        const ret = listener(request, {}, done);
        // Sync handlers answer via sendResponse; async ones return true and
        // answer later. A handler that answers nothing leaves the promise to
        // the timeout — that itself is the failure under test.
        if (ret !== true) setTimeout(() => done(undefined), 50);
    });
}

test('background: ping answers without touching the backend', async () => {
    const listener = loadBackground();
    const res = await invoke(listener, { action: 'ping' });
    // Field checks, not deepEqual: the object comes from the vm realm, so
    // its prototype differs from this realm's Object.prototype.
    assert.equal(res && res.success, true);
    assert.equal(res && res.pong, true);
});

test('background: null request does not throw', async () => {
    const listener = loadBackground();
    let threw = null;
    try {
        await invoke(listener, null);
    } catch (e) { threw = e; }
    assert.equal(threw, null);
});

test('background: unknown action gets an explicit failure, not silence', async () => {
    const listener = loadBackground();
    const res = await invoke(listener, { action: 'definitely-not-a-real-action' });
    assert.equal(res && res.success, false);
    assert.match(res.message, /Unknown action/);
});
