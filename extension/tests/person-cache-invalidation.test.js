// Tests for the 60s person cache vs delete/edit, loaded for real in a vm
// sandbox with a minimal fake DOM (same harness as draft-card-actions).
//
// 2026-11-21: deleting a foreign draft looked like it took ~60s — the panel
// kept showing the deleted card. The server delete finished in seconds; the
// merged view renders from personCache (60s TTL), and only link/unlink
// invalidated it. delete/edit re-rendered from the stale cache, and the 10s
// sync tick only hashes the CURRENT chat, so it never noticed a foreign row
// change. The fix: invalidatePersonCache() on delete/edit success.
// Run: node --test extension/tests/   (from the repo root)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Minimal fake DOM element: enough for buildDraftCard/editMessage and the
// top-level createUI() that runs when content.js loads.
class FakeEl {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.className = '';
        this.id = '';
        this.title = '';
        this.dataset = {};
        this.style = {};
        this._attrs = {};
        this._html = '';
        this._text = undefined;
        this.onclick = null;
        this.onchange = null;
        this.value = '';
        this.type = '';
        this.accept = '';
        const self = this;
        this.classList = {
            add: (c) => {
                const list = self.className.split(' ').filter(Boolean);
                if (!list.includes(c)) list.push(c);
                self.className = list.join(' ');
            },
            remove: (c) => {
                self.className = self.className.split(' ').filter((x) => x && x !== c).join(' ');
            },
            contains: (c) => self.className.split(' ').includes(c),
            toggle: (c) => {
                if (self.classList.contains(c)) self.classList.remove(c);
                else self.classList.add(c);
            }
        };
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) {
        this._html = String(v);
        // setting innerHTML replaces children in a real DOM
        this.children = [];
        this._text = undefined;
    }
    get textContent() {
        if (this._text !== undefined) return this._text;
        if (this._html) return this._html.replace(/<[^>]*>/g, '');
        return this.children.map((c) => c.textContent).join('');
    }
    set textContent(v) {
        this._text = String(v);
        this.children = [];
        this._html = '';
    }
    get innerText() { return this.textContent; }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        this.children = this.children.filter((c) => c !== child);
        child.parentNode = null;
        return child;
    }
    remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
    }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) { return this._attrs[k] ?? null; }
    addEventListener() {}
    removeEventListener() {}
    focus() {}
    click() { if (this.onclick) this.onclick(); }
    querySelector(sel) {
        // only the selectors content.js uses on a card element
        if (sel === 'div:first-child') {
            return this.children.find((c) => c.tagName === 'DIV') || null;
        }
        if (sel.startsWith('.')) {
            const cls = sel.slice(1);
            const walk = (el) => {
                for (const c of el.children) {
                    if (c.className.split(' ').includes(cls)) return c;
                    const hit = walk(c);
                    if (hit) return hit;
                }
                return null;
            };
            return walk(this);
        }
        return null;
    }
    querySelectorAll() { return []; }
}

function findAll(el, pred, out = []) {
    for (const c of el.children) {
        if (pred(c)) out.push(c);
        findAll(c, pred, out);
    }
    return out;
}

const OWN_CHAT = 'messenger_web_111111';
const FOREIGN_THREAD = 'instagram_web_222222_catfren';

function loadContent() {
    const sent = []; // every chrome.runtime.sendMessage call, in order
    const drafts = {
        [OWN_CHAT]: {
            contactName: 'Lutfull Kabir BRACU',
            messages: [{ timestamp: 111, html: 'own draft' }]
        },
        [FOREIGN_THREAD]: {
            contactName: 'Cat Fren',
            messages: [
                { timestamp: 222, html: 'https://www.facebook.com/share/r/1MoxRJjKA/' },
                { timestamp: 223, html: 'second foreign draft' }
            ]
        }
    };
    let failNextSave = false;
    const hooks = {};
    // content.js constructs a ResizeObserver at the top level (panel resize
    // tracking) and init() uses MutationObserver — neither ever fires here,
    // but both must exist for the file to load.
    class NoopObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    const sandbox = {
        console,
        setTimeout, clearTimeout, setInterval, clearInterval,
        ResizeObserver: NoopObserver,
        MutationObserver: NoopObserver,
        __gdTestHooks: hooks,
        document: {
            hidden: false,
            // getCurrentChatName falls back to document.title on Messenger;
            // empty keeps the sandbox chat id slug-free (messenger_web_111111)
            title: '',
            head: new FakeEl('head'),
            body: new FakeEl('body'),
            createElement: (tag) => new FakeEl(tag),
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => null,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        window: {
            location: {
                href: 'https://www.messenger.com/t/111111',
                hostname: 'www.messenger.com',
                hash: ''
            },
            addEventListener: () => {}
        },
        chrome: {
            runtime: {
                id: 'test-extension-id',
                lastError: undefined,
                onMessage: { addListener: () => {} },
                sendMessage: (msg, cb) => {
                    sent.push(msg);
                    const done = (resp) => { if (cb) cb(resp); };
                    if (msg.action === 'getSettings') return done({ success: true, settings: {} });
                    if (msg.action === 'getDraft') {
                        const d = drafts[msg.chatId];
                        return done(d
                            ? { success: true, exists: true, messages: d.messages.map((m) => ({ ...m })), contactName: d.contactName, lastModified: 0 }
                            : { success: true, exists: false, messages: [], contactName: null, lastModified: 0 });
                    }
                    if (msg.action === 'saveDraft') {
                        if (failNextSave) {
                            failNextSave = false;
                            return done({ success: false, message: 'boom' });
                        }
                        drafts[msg.chatId] = { contactName: msg.contactName, messages: msg.messages.map((m) => ({ ...m })) };
                        return done({ success: true });
                    }
                    if (msg.action === 'getPerson') {
                        // built from the LIVE store, so a refetch after a
                        // delete/edit returns post-change data — exactly what
                        // the real backend does
                        const personDrafts = {};
                        for (const [id, d] of Object.entries(drafts)) {
                            personDrafts[id] = { messages: d.messages.map((m) => ({ ...m })), contactName: d.contactName, lastModified: 0 };
                        }
                        return done({ success: true, person: null, drafts: personDrafts, candidates: [], linkablePeople: [] });
                    }
                    return done({ success: true });
                }
            },
            storage: { local: { set: async () => {}, get: async () => ({}) } }
        }
    };
    vm.createContext(sandbox);
    for (const file of ['runtimeHealth.js', 'draftSync.js', 'content.js']) {
        const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        vm.runInContext(src, sandbox, { filename: file });
    }
    return {
        hooks,
        sent,
        drafts,
        getPersonCalls: () => sent.filter((m) => m.action === 'getPerson').length,
        saves: () => sent.filter((m) => m.action === 'saveDraft'),
        failNextSave: () => { failNextSave = true; },
        seedPersonCache: () => new Promise((r) => hooks.loadPerson(OWN_CHAT, r)),
        // the delete/edit success path re-renders via loadSavedMessages,
        // which is promise-based — let it settle so a throw there fails
        // the test loudly instead of surfacing as an unhandled rejection
        settle: () => new Promise((r) => setTimeout(r, 10))
    };
}

function foreignEntry() {
    return {
        message: { timestamp: 222, html: 'https://www.facebook.com/share/r/1MoxRJjKA/' },
        threadId: FOREIGN_THREAD,
        contactName: 'Cat Fren',
        draftLastModified: 0
    };
}

test('delete: a successful foreign delete refetches the person instead of serving the 60s cache', async () => {
    const s = loadContent();
    await s.seedPersonCache();
    assert.equal(s.getPersonCalls(), 1, 'seed: one getPerson');
    assert.deepEqual(
        s.hooks.getPersonCache().drafts[FOREIGN_THREAD].messages.map((m) => m.timestamp),
        [222, 223],
        'seed: cache holds both foreign messages'
    );

    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const del = findAll(card, (el) => el.className === 'saved-message-delete')[0];
    del.click();
    await s.settle();

    assert.equal(s.getPersonCalls(), 2, 'delete must refetch the person (cache invalidated), not serve the stale cache');
    assert.deepEqual(
        s.hooks.getPersonCache().drafts[FOREIGN_THREAD].messages.map((m) => m.timestamp),
        [223],
        'the refetched cache no longer contains the deleted message'
    );
});

test('edit: a successful foreign edit refetches the person instead of serving the 60s cache', async () => {
    const s = loadContent();
    await s.seedPersonCache();
    assert.equal(s.getPersonCalls(), 1, 'seed: one getPerson');

    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const edit = findAll(card, (el) => el.className === 'saved-message-edit')[0];
    edit.click();
    const textarea = findAll(card.querySelector('.saved-message-text'), (el) => el.tagName === 'TEXTAREA')[0];
    textarea.value = 'edited draft';
    const save = findAll(card, (el) => el.tagName === 'BUTTON' && el.textContent === 'Save')[0];
    save.click();
    await s.settle();

    assert.equal(s.getPersonCalls(), 2, 'edit must refetch the person (cache invalidated)');
    const edited = s.hooks.getPersonCache().drafts[FOREIGN_THREAD].messages.find((m) => m.timestamp === 222);
    assert.equal(edited.html, 'edited draft', 'the refetched cache carries the new text');
});

test('delete: a failed save keeps the cache — the cached data is still correct', async () => {
    const s = loadContent();
    await s.seedPersonCache();
    s.failNextSave();

    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const del = findAll(card, (el) => el.className === 'saved-message-delete')[0];
    del.click();
    await s.settle();

    assert.equal(s.getPersonCalls(), 1, 'no refetch after a failed delete');
    assert.deepEqual(
        s.hooks.getPersonCache().drafts[FOREIGN_THREAD].messages.map((m) => m.timestamp),
        [222, 223],
        'cache untouched: the message was NOT deleted server-side'
    );
    assert.deepEqual(
        s.drafts[FOREIGN_THREAD].messages.map((m) => m.timestamp),
        [222, 223],
        'store untouched'
    );
});

test('person cache: a second loadPerson within 60s serves the cache (no extra getPerson)', async () => {
    const s = loadContent();
    await s.seedPersonCache();
    await s.seedPersonCache();
    assert.equal(s.getPersonCalls(), 1, 'the 60s TTL still applies — the fix invalidates on write, it does not remove the cache');
});
