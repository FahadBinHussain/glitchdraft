// Tests for extension/popup.js, loaded for real in a vm sandbox with a
// minimal DOM stub: a dead worker must show LOUDLY in the popup (with an
// open-edge://extensions button), and Reset UI must report failure honestly
// instead of printing success when its message went nowhere.
// Run: node --test extension/tests/   (from the repo root)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement(id) {
    const handlers = {};
    return {
        id,
        value: '',
        textContent: '',
        className: '',
        style: {},
        _handlers: handlers,
        addEventListener: (type, fn) => { handlers[type] = fn; },
        click: function () { return handlers.click && handlers.click(); }
    };
}

function loadPopup({ workerDown, tabSendFails }) {
    const elements = {};
    const ids = ['firebaseConfigInput', 'neonConfigInput', 'saveFirebaseBtn', 'saveNeonBtn',
        'resetPositionBtn', 'status', 'supportedSites', 'openExtensionsBtn'];
    for (const id of ids) elements[id] = makeElement(id);
    elements.openExtensionsBtn.style.display = 'none';

    let domReady = null;
    const tabsCreateCalls = [];
    const sandbox = {
        console,
        setTimeout,
        fetch: async () => ({ json: async () => ({ content_scripts: [] }) }),
        document: {
            addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') domReady = fn; },
            getElementById: (id) => elements[id] || null
        },
        chrome: {
            runtime: {
                // A live extension page always has runtime.id; without it
                // gdClassifyDisconnect reports orphaned (correctly).
                id: 'test-extension-id',
                getURL: (p) => 'chrome-extension://test/' + p,
                sendMessage: async () => {
                    if (workerDown) {
                        throw new Error('Could not establish connection. Receiving end does not exist.');
                    }
                    return { success: true, provider: 'neon' };
                }
            },
            storage: { local: { get: async () => ({}), set: async () => {} } },
            tabs: {
                query: async () => [{ id: 7 }],
                sendMessage: async () => {
                    if (tabSendFails) {
                        throw new Error('Could not establish connection. Receiving end does not exist.');
                    }
                    return { success: true };
                },
                create: async (opts) => { tabsCreateCalls.push(opts); return { id: 9 }; }
            }
        }
    };
    vm.createContext(sandbox);
    // popup.html loads runtimeHealth.js before popup.js — same order here.
    const rhSrc = fs.readFileSync(path.join(__dirname, '..', 'runtimeHealth.js'), 'utf8');
    vm.runInContext(rhSrc, sandbox, { filename: 'runtimeHealth.js' });
    const src = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'popup.js' });
    assert.equal(typeof domReady, 'function', 'popup must listen for DOMContentLoaded');
    const flush = async () => {
        await domReady();
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    };
    return { elements, flush, tabsCreateCalls };
}

test('popup: dead worker shows loudly with an open-extensions button', async () => {
    const { elements, flush, tabsCreateCalls } = loadPopup({ workerDown: true });
    await flush();
    assert.match(elements.status.textContent, /not responding/i);
    assert.match(elements.status.textContent, /edge:\/\/extensions/);
    assert.notEqual(elements.openExtensionsBtn.style.display, 'none',
        'the open-extensions button must appear when the worker is dead');
    await elements.openExtensionsBtn.click();
    assert.equal(tabsCreateCalls.length, 1);
    assert.equal(tabsCreateCalls[0].url, 'edge://extensions');
});

test('popup: healthy worker shows the backend and hides the button', async () => {
    const { elements, flush } = loadPopup({ workerDown: false });
    await flush();
    assert.match(elements.status.textContent, /Active backend: Neon/);
    assert.equal(elements.openExtensionsBtn.style.display, 'none');
});

test('popup: reset UI reports failure honestly when the tab has no script', async () => {
    const { elements, flush } = loadPopup({ workerDown: false, tabSendFails: true });
    await flush();
    await elements.resetPositionBtn.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.match(elements.status.textContent, /Reset failed/);
    assert.doesNotMatch(elements.status.textContent, /randomized/);
});

test('popup: reset UI reports success only when the message lands', async () => {
    const { elements, flush } = loadPopup({ workerDown: false, tabSendFails: false });
    await flush();
    await elements.resetPositionBtn.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.match(elements.status.textContent, /randomized/);
});
