// Tests for extension/content.js draft card actions, loaded for real in a vm
// sandbox with a minimal fake DOM. Every card — the current chat's own or a
// foreign row in the merged person view — must show Edit/Delete, and those
// actions must hit the ROW's thread, never the current chat.
//
// 2026-11-21: foreign rows were Copy-only, so a user sitting in a chat with
// no drafts of its own saw no Edit/Delete button anywhere in the panel.
// The gate existed because edit/delete hard-coded getCurrentChatId(); the
// fix threads the row's thread id + contact name through instead.
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
                        drafts[msg.chatId] = { contactName: msg.contactName, messages: msg.messages.map((m) => ({ ...m })) };
                        return done({ success: true });
                    }
                    if (msg.action === 'getPerson') {
                        return done({ success: true, person: null, drafts: {}, candidates: [], linkablePeople: [] });
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
    // let the top-level getSettings callback settle (it only touches the DOM)
    return {
        hooks,
        sent,
        drafts,
        saves: () => sent.filter((m) => m.action === 'saveDraft'),
        // the delete/edit success path re-renders via loadSavedMessages,
        // which is promise-based — let it settle so a throw there fails
        // the test loudly instead of surfacing as an unhandled rejection
        settle: () => new Promise((r) => setImmediate(r))
    };
}

function buttonClasses(card) {
    return findAll(card, (el) => el.tagName === 'BUTTON').map((b) => b.className);
}

function foreignEntry() {
    return {
        message: { timestamp: 222, html: 'https://www.facebook.com/share/r/1MoxRJjKA/' },
        threadId: FOREIGN_THREAD,
        contactName: 'Cat Fren',
        draftLastModified: 0
    };
}

function ownEntry() {
    return {
        message: { timestamp: 111, html: 'own draft' },
        threadId: OWN_CHAT,
        contactName: 'Lutfull Kabir BRACU',
        draftLastModified: 0
    };
}

test('card: a foreign row shows Copy + Edit + Delete, but no Use', () => {
    const s = loadContent();
    assert.equal(s.hooks.getCurrentChatId(), OWN_CHAT, 'sanity: the sandbox chat is the own chat');
    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const classes = buttonClasses(card);
    assert.ok(classes.includes('saved-message-copy'), 'Copy present');
    assert.ok(classes.includes('saved-message-edit'), 'Edit present on a foreign row');
    assert.ok(classes.includes('saved-message-delete'), 'Delete present on a foreign row');
    assert.ok(!classes.includes('saved-message-use'), 'Use stays own-chat-only — it would type into the wrong app');
    assert.ok(!card.title.includes('read-only'), 'foreign card is no longer labelled read-only: ' + card.title);
});

test('card: the current chat row shows all four buttons', () => {
    const s = loadContent();
    const card = s.hooks.buildDraftCard(ownEntry(), { foreign: false });
    const classes = buttonClasses(card);
    assert.deepEqual(
        classes.sort(),
        ['saved-message-copy', 'saved-message-delete', 'saved-message-edit', 'saved-message-use'].sort()
    );
});

test('card: a foreign row shows its source badge (the exact screenshot case)', () => {
    const s = loadContent();
    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const source = card.querySelector('.gd-card-source');
    assert.ok(source, 'foreign card has a source header');
    const badge = findAll(source, (el) => el.className.split(' ').includes('gd-platform-badge'))[0];
    assert.ok(badge, 'source header has a platform badge');
    assert.equal(badge.textContent, '🌐 IG · Web');
});

test('delete: a foreign delete removes the message from the ROW thread, not the current chat', async () => {
    const s = loadContent();
    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const del = findAll(card, (el) => el.className === 'saved-message-delete')[0];
    assert.ok(del, 'delete button exists on the foreign card');
    del.click();
    await s.settle();

    const saves = s.saves();
    assert.equal(saves.length, 1, 'exactly one saveDraft, got: ' + JSON.stringify(saves));
    assert.equal(saves[0].chatId, FOREIGN_THREAD, 'delete must save to the row thread');
    assert.equal(saves[0].contactName, 'Cat Fren', 'delete must keep the row thread name, not the current chat name');
    assert.deepEqual(saves[0].messages.map((m) => m.timestamp), [223], 'only the clicked message is removed');
    // the current chat's draft is untouched
    assert.deepEqual(s.drafts[OWN_CHAT].messages.map((m) => m.timestamp), [111]);
});

test('edit: a foreign edit writes the new text to the ROW thread', async () => {
    const s = loadContent();
    const card = s.hooks.buildDraftCard(foreignEntry(), { foreign: true });
    const edit = findAll(card, (el) => el.className === 'saved-message-edit')[0];
    assert.ok(edit, 'edit button exists on the foreign card');
    edit.click();

    // the textarea must land in the MESSAGE text div, not the source badge
    // row (the old 'div:first-child' lookup hit the badge on foreign cards)
    const textDiv = card.querySelector('.saved-message-text');
    const textarea = findAll(textDiv, (el) => el.tagName === 'TEXTAREA')[0];
    assert.ok(textarea, 'textarea opens inside the message text, not the source header');
    assert.equal(textarea.value, 'https://www.facebook.com/share/r/1MoxRJjKA/');

    textarea.value = 'edited draft\nsecond line';
    const save = findAll(card, (el) => el.tagName === 'BUTTON' && el.textContent === 'Save')[0];
    assert.ok(save, 'Save button appears while editing');
    save.click();
    await s.settle();

    const saves = s.saves();
    assert.equal(saves.length, 1, 'exactly one saveDraft, got: ' + JSON.stringify(saves));
    assert.equal(saves[0].chatId, FOREIGN_THREAD, 'edit must save to the row thread');
    assert.equal(saves[0].contactName, 'Cat Fren', 'edit must keep the row thread name');
    const edited = saves[0].messages.find((m) => m.timestamp === 222);
    assert.equal(edited.html, 'edited draft<br>second line', 'newlines become <br>');
    assert.deepEqual(s.drafts[OWN_CHAT].messages.map((m) => m.timestamp), [111], 'current chat untouched');
});

test('delete/edit: the current chat row still targets the current chat', async () => {
    const s = loadContent();
    const card = s.hooks.buildDraftCard(ownEntry(), { foreign: false });
    const del = findAll(card, (el) => el.className === 'saved-message-delete')[0];
    del.click();
    await s.settle();

    const saves = s.saves();
    assert.equal(saves.length, 1);
    assert.equal(saves[0].chatId, OWN_CHAT, 'own-row delete still saves to the current chat');
    assert.equal(saves[0].contactName, 'Lutfull Kabir BRACU');
    assert.deepEqual(saves[0].messages, [], 'the only own message is removed');
});
