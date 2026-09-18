const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(fetch) {
    const handlers = {}, entries = new Map(), deleted = [];
    const cache = { addAll: async () => {}, match: async key => entries.get(typeof key === 'string' ? key : key.url)?.clone(), put: async (key, response) => entries.set(typeof key === 'string' ? key : key.url, response) };
    vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../sw.js'), 'utf8'), {
        self: {location: {origin: 'https://example.com'}, addEventListener: (name, fn) => handlers[name] = fn},
        URL, fetch, console, caches: { open: async () => cache, keys: async () => ['bikeways-cache-v1', 'bikeways-cache-v2', 'unrelated'], delete: async name => deleted.push(name) }
    });
    async function request(path, options = {}) {
        let response; const work = [];
        handlers.fetch({request: {url: 'https://example.com' + path, method: 'GET', mode: 'cors', ...options}, respondWith: p => response = p, waitUntil: p => work.push(p)});
        const result = await response; await Promise.all(work); return result;
    }
    return {handlers, entries, deleted, request};
}
test('online visits refresh existing cached files without a worker version change', async () => {
    const app = setup(async () => new Response('new'));
    app.entries.set('https://example.com/styles.css', new Response('old'));
    assert.equal(await (await app.request('/styles.css')).text(), 'new');
    assert.equal(await app.entries.get('https://example.com/styles.css').text(), 'new');
});
test('offline navigation with query parameters falls back to the app shell', async () => {
    const app = setup(async () => {throw Error('offline');}); app.entries.set('/', new Response('shell'));
    assert.equal(await (await app.request('/?customTracking', {mode:'navigate'})).text(), 'shell');
});
test('HTTP errors preserve and serve the last good asset', async () => {
    const app = setup(async () => new Response('failure', {status:503}));
    app.entries.set('https://example.com/styles.css', new Response('good'));
    assert.equal(await (await app.request('/styles.css')).text(), 'good');
});
test('network requests outside the cache scope pass through', async () => {
    const app = setup(() => {throw Error('must not intercept');});
    for (const [path, options] of [['/api',{}],['/styles.css',{method:'POST'}],['/styles.css',{url:'https://other.com/styles.css'}]]) assert.equal(await app.request(path,options), undefined);
});
test('offline cache misses reject', async () => {
    const app = setup(async () => {throw Error('offline');}); await assert.rejects(app.request('/styles.css'), /offline/);
});
test('activation retains the current cache and unrelated caches', async () => {
    const app=setup(); let work; app.handlers.activate({waitUntil: p => work=p}); await work; assert.deepEqual(app.deleted,['bikeways-cache-v1']);
});
