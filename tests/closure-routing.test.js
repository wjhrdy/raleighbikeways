const test = require('node:test');
const assert = require('node:assert/strict');
const { createAvoidance, intersectsClosures, routeUrl, validateRoute, loadClosures } = require('../closure-routing');

const line = (status = 'CLOSED_TEMP', coordinates = [[-78.65, 35.8], [-78.65, 35.81]]) => ({
    type: 'Feature', properties: { GWSTATUS: status }, geometry: { type: 'LineString', coordinates }
});
const collection = (...features) => ({ type: 'FeatureCollection', features });
const route = coords => collection(line('OPEN', coords));

test('temporary and storm closures are buffered, while open and alert trails remain passable', () => {
    for (const status of ['CLOSED_TEMP', 'CLOSED_STORM']) {
        const avoidance = createAvoidance(collection(line(status)));
        assert.ok(avoidance.polygons);
        // Parallel OSM line offset ~9 m, with no exact GIS intersection.
        assert.ok(intersectsClosures(route([[-78.6499, 35.802], [-78.6499, 35.808]]), avoidance));
        assert.equal(intersectsClosures(route([[-78.649, 35.802], [-78.649, 35.808]]), avoidance), false);
    }
    for (const status of ['OPEN', 'ALERT', 'PERIODIC_CLOSURE']) {
        assert.deepEqual(createAvoidance(collection(line(status))), { polygons: '', areas: [] });
    }
});

test('multipart and adjacent closure lines produce valid BRouter exclusion rings', () => {
    const feature = line();
    feature.geometry = { type: 'MultiLineString', coordinates: [
        [[-78.65, 35.8], [-78.65, 35.805]], [[-78.65, 35.805], [-78.65, 35.81]],
        [[-78.66, 35.8], [-78.66, 35.81]]
    ] };
    const avoidance = createAvoidance(collection(feature));
    assert.equal(avoidance.areas.length, 2);
    const url = new URL(routeUrl({ lng: -78.67, lat: 35.79 }, { lng: -78.64, lat: 35.82 }, 'custom:test', avoidance));
    assert.equal(url.searchParams.get('polygons'), avoidance.polygons);
    assert.equal(url.searchParams.get('profile'), 'custom:test');
    for (const area of avoidance.areas) {
        const ring = area.geometry.coordinates[0];
        assert.deepEqual(ring[0], ring.at(-1));
    }
});

test('rejects endpoints inside buffers and routes crossing or entirely inside closures', () => {
    const avoidance = createAvoidance(collection(line()));
    assert.throws(() => routeUrl({ lng: -78.65, lat: 35.805 }, { lng: -78.64, lat: 35.82 }, 'test', avoidance), /too close/);
    assert.throws(() => validateRoute(route([[-78.651, 35.805], [-78.649, 35.805]]), avoidance), /still crosses/);
    assert.throws(() => validateRoute(route([[-78.65, 35.804], [-78.65, 35.806]]), avoidance), /still crosses/);
    assert.doesNotThrow(() => validateRoute(route([[-78.64, 35.804], [-78.64, 35.806]]), avoidance));
});

test('empty closure data allows normal routing; invalid data cannot silently disable avoidance', () => {
    const empty = createAvoidance(collection());
    assert.equal(new URL(routeUrl({ lng: -78.65, lat: 35.8 }, { lng: -78.64, lat: 35.81 }, 'test', empty)).searchParams.has('polygons'), false);
    const invalid = line(); invalid.geometry = null;
    assert.throws(() => createAvoidance(collection(invalid)), /invalid geometry/);
    assert.throws(() => createAvoidance(collection(line('CLOSED_TEMP', [[NaN, 35.8], [-78, 35]]))), /invalid coordinates/);
    const missingStatus = line(); missingStatus.properties = {};
    assert.throws(() => createAvoidance(collection(missingStatus)), /missing its status/);
    assert.throws(() => validateRoute(collection(), empty), /usable route/);
    assert.throws(() => routeUrl({ lng: -78, lat: 35 }, { lng: -77, lat: 36 }, 'test', { areas: [], polygons: '1'.repeat(8000) }), /too many/);
});

test('closure fetch handles pagination and sends the closure-only filter', async () => {
    const calls = [];
    const fetcher = async (url, options) => {
        const params = new URL(url).searchParams;
        calls.push(Number(params.get('resultOffset')));
        assert.match(params.get('where'), /CLOSED_TEMP.*CLOSED_STORM/);
        assert.equal(options.cache, 'no-store');
        return { ok: true, json: async () => collection(...Array(calls.length === 1 ? 1000 : 1).fill(line())) };
    };
    const result = await loadClosures('https://example.com/0', undefined, fetcher);
    assert.equal(result.features.length, 1001);
    assert.deepEqual(calls, [0, 1000]);
});

test('ArcGIS errors, HTTP failures and canceled requests are not treated as zero closures', async () => {
    await assert.rejects(loadClosures('https://example.com/0', undefined, async () => ({ ok: false })), /Could not load/);
    await assert.rejects(loadClosures('https://example.com/0', undefined, async () => ({ ok: true, json: async () => ({ error: { code: 400 } }) })), /unavailable/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(loadClosures('https://example.com/0', controller.signal, async (_, { signal }) => {
        signal.throwIfAborted();
    }), { name: 'AbortError' });
});
