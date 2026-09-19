const assert = require('node:assert/strict');
const { availableBikes, mount } = require('../spin.js');
const types = { data: { vehicle_types: [
    { vehicle_type_id: 'bike', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
    { vehicle_type_id: 'scooter', form_factor: 'scooter', propulsion_type: 'electric' }
] } };
const bike = { vehicle_type_id: 'bike', is_reserved: false, is_disabled: false, lat: 35.78, lon: -78.64, last_reported: 990, current_fuel_percent: 0, current_range_meters: 0 };
const feed = bikes => ({ last_updated: 1000, data: { bikes } });
const mixed = availableBikes(feed([bike, ...[
    { vehicle_type_id: 'scooter' }, { vehicle_type_id: 'unknown' }, { is_reserved: true },
    { is_disabled: true }, { lat: '35.78' }, { lon: Infinity }, { lat: 100 },
    { last_reported: 700 }, { last_reported: 1061 }, { is_disabled: undefined }
].map(change => ({ ...bike, ...change }))]), types, 1000);
assert.equal(mixed.features.length, 1);
assert.equal(mixed.features[0].properties.battery, 0);
assert.equal(mixed.features[0].properties.miles, 0);
assert.deepEqual(mixed.features[0].geometry.coordinates, [-78.64, 35.78]);
assert.equal(availableBikes(feed([]), types, 1000).features.length, 0);
assert.equal(availableBikes(feed([{ ...bike, last_reported: undefined }]), types, 1000).features[0].properties.reported, 1000);
assert.throws(() => availableBikes(feed([bike]), types, 1300), /stale/);
assert.throws(() => availableBikes({ last_updated: 2000, data: { bikes: [] } }, types, 1000), /stale/);
assert.throws(() => availableBikes({ last_updated: 1000, data: {} }, types, 1000));
assert.throws(() => availableBikes(feed([bike]), { data: {} }, 1000));

// Exercise the mounted controller using browser/map stand-ins and controlled requests.
(async () => {
    const timers = new Map(), intervals = new Map(), events = {}, requests = [], sources = {}, layers = {};
    let timerId = 0;
    global.setTimeout = (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; };
    global.clearTimeout = id => timers.delete(id);
    global.setInterval = fn => { intervals.set(++timerId, fn); return timerId; };
    global.clearInterval = id => intervals.delete(id);
    global.document = { hidden: false, addEventListener: (name, fn) => events[name] = fn };
    global.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    const checkbox = { checked: false, addEventListener: (_, fn) => events.change = fn };
    const status = { textContent: '' };
    const map = {
        on: (name, ...args) => events[name] = args.at(-1), isStyleLoaded: () => true,
        getSource: id => sources[id], getLayer: id => layers[id],
        addSource: (id, source) => sources[id] = { data: source.data, setData(data) { this.data = data; } },
        addLayer: layer => layers[layer.id] = layer,
        setLayoutProperty: (id, name, value) => layers[id].layout[name] = value
    };
    const id = 'spin-available-bikes';
    const flush = () => new Promise(require('node:timers').setImmediate);
    const finish = async batch => {
        const now = Date.now() / 1000;
        batch[0].resolve({ ok: true, json: async () => ({ last_updated: now, data: { bikes: [{ ...bike, last_reported: now }] } }) });
        batch[1].resolve({ ok: true, json: async () => types });
        await flush();
    };
    mount(map, checkbox, status);
    assert.equal(requests.length, 0, 'off by default does not contact Spin');
    checkbox.checked = true; events.change();
    assert.equal(requests.length, 2);
    assert(requests.every(r => r.options.cache === 'no-store' && r.options.credentials === 'omit'));
    checkbox.checked = false; events.change();
    assert(requests[0].options.signal.aborted);
    await finish(requests.slice(0, 2));
    assert.equal(sources[id].data.features.length, 0, 'late response cannot restore disabled bikes');
    checkbox.checked = true; events.change(); await finish(requests.slice(2, 4));
    assert.equal(sources[id].data.features.length, 1);
    delete sources[id]; delete layers[id]; events['style.load']();
    assert.equal(sources[id].data.features.length, 1, 'style reload retains live bikes');
    assert.equal(layers[id].layout.visibility, 'visible');
    const realNow = Date.now;
    Date.now = () => realNow() + 301000;
    [...timers.values()].find(t => t.ms > 12000).fn();
    Date.now = realNow;
    assert.equal(sources[id].data.features.length, 0, 'stale bikes disappear without waiting for network');
    [...intervals.values()][0]();
    requests[4].reject(new Error('offline')); requests[5].reject(new Error('offline'));
    await flush(); assert.match(status.textContent, /unavailable/);
    document.hidden = true; events.visibilitychange(); assert.equal(intervals.size, 0);
    document.hidden = false; events.visibilitychange(); await finish(requests.slice(6, 8));
    assert.equal(sources[id].data.features.length, 1, 'returning to the page reloads bikes');
    checkbox.checked = false; events.change();
    assert.equal(intervals.size, 0); assert.equal(timers.size, 0);
    console.log('Spin filtering, freshness, request races, errors, visibility, and style reload checks pass.');
})().catch(error => { console.error(error); process.exitCode = 1; });
