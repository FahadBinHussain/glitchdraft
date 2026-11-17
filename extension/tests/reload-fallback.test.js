// Tests for extension/reload.js, loaded for real in a vm sandbox:
// with a dead worker the page must reload the extension directly
// (chrome.runtime.reload needs no service worker), and only fall back to
// the manual edge://extensions text when even that throws.
// Run: node --test extension/tests/   (from the repo root)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadReload({ sendBehavior, reloadBehavior }) {
    const el = { textContent: '' };
    const calls = { reload: 0 };
    const sandbox = {
        console,
        document: { getElementById: () => el },
        chrome: {
            runtime: {
                lastError: undefined,
                sendMessage: (msg, cb) => {
                    if (sendBehavior === 'dead-worker') {
                        sandbox.chrome.runtime.lastError = {
                            message: 'Could not establish connection. Receiving end does not exist.'
                        };
                        cb(undefined);
                        sandbox.chrome.runtime.lastError = undefined;
                    } else if (sendBehavior === 'throw') {
                        throw new Error('Extension context invalidated.');
                    } else {
                        cb({ ok: true });
                    }
                },
                reload: () => {
                    calls.reload++;
                    if (reloadBehavior === 'throw') throw new Error('reload unavailable');
                }
            }
        }
    };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, '..', 'reload.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'reload.js' });
    return { el, calls };
}

test('reload: dead worker triggers a direct chrome.runtime.reload', () => {
    const { el, calls } = loadReload({ sendBehavior: 'dead-worker' });
    assert.equal(calls.reload, 1, 'must attempt the direct reload when the worker is dead');
    assert.match(el.textContent, /directly/i);
});

test('reload: healthy worker keeps the selfReload path (no direct reload)', () => {
    const { el, calls } = loadReload({ sendBehavior: 'ok' });
    assert.equal(calls.reload, 0, 'must not double-reload when selfReload works');
    assert.match(el.textContent, /reloading/i);
});

test('reload: direct reload throwing falls back to loud manual instructions', () => {
    const { el, calls } = loadReload({ sendBehavior: 'dead-worker', reloadBehavior: 'throw' });
    assert.equal(calls.reload, 1);
    assert.match(el.textContent, /edge:\/\/extensions/);
});

test('reload: sendMessage throwing still attempts the direct reload', () => {
    const { calls } = loadReload({ sendBehavior: 'throw' });
    assert.equal(calls.reload, 1);
});
