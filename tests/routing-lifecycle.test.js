const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const geometry = require('../closure-routing');

const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const functions = html.slice(html.indexOf('    function setRouteStatus('), html.indexOf('    async function setBrouterProfile('));
const start = { lng: -78.65, lat: 35.8 }, end = { lng: -78.64, lat: 35.81 };
const route = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: [[start.lng, start.lat], [end.lng, end.lat]] } }] };

function harness({ checked = true, loadClosures = async () => ({ type: 'FeatureCollection', features: [] }), fetcher } = {}) {
    const status = { textContent: '', classList: { toggle() {} } };
    const results = [];
    const context = vm.createContext({
        AbortController, setTimeout, clearTimeout,
        document: { getElementById: id => id === 'route-status' ? status : { checked } },
        ClosureRouting: { ...geometry, loadClosures },
        existingRaleighGreenwaysURL: 'https://example.com/0',
        setBrouterProfile: async () => 'test',
        fetch: fetcher || (async () => ({ ok: true, json: async () => route })),
        setBrouterRoute() {}, toggleLoader() {}, onException() {},
        handleGeoJsonResponse: value => results.push(value)
    });
    vm.runInContext(`let routeRequestController = null, brouterRoute = null, brouterCustomProfile = null;\n${functions}`, context);
    return { run: () => context.fetchRouteFromBRouter(start, end), status, results };
}

test('a closure data failure never publishes or requests an unchecked route', async () => {
    const app = harness({ loadClosures: async () => { throw new Error('Closures unavailable'); },
        fetcher: () => { assert.fail('Routing must not run without closure data'); } });
    await app.run();
    assert.equal(app.results.length, 0);
    assert.equal(app.status.textContent, 'Closures unavailable');
});

test('explicit opt-out skips closure loading and labels the result', async () => {
    const app = harness({ checked: false, loadClosures: () => { assert.fail('Opt-out must skip closure loading'); } });
    await app.run();
    assert.equal(app.results.length, 1);
    assert.equal(app.status.textContent, 'Closure avoidance is off.');
});

test('an older routing response cannot overwrite the newest route', async () => {
    let releaseOld;
    let beganOld;
    const oldStarted = new Promise(resolve => { beganOld = resolve; });
    const oldResponse = new Promise(resolve => { releaseOld = resolve; });
    let calls = 0;
    const app = harness({ fetcher: async () => {
        if (++calls === 1) { beganOld(); return oldResponse; }
        return { ok: true, json: async () => route };
    } });
    const pending = app.run();
    await oldStarted;
    await app.run();
    releaseOld({ ok: true, json: async () => ({ ...route, stale: true }) });
    await pending;
    assert.equal(app.results.length, 1);
    assert.equal(app.results[0].stale, undefined);
    assert.match(app.status.textContent, /Route avoids/);
});
