// Browser bundle: npm run build. Geometry uses Turf (MIT), pinned in package-lock.json.
const { buffer } = require('@turf/buffer');
const { simplify } = require('@turf/simplify');
const { booleanIntersects } = require('@turf/boolean-intersects');

const CLOSED_STATUSES = ['CLOSED_TEMP', 'CLOSED_STORM'];
const BUFFER_METERS = 25;

async function loadClosures(layerUrl, signal, fetcher = fetch) {
    const features = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
        const params = new URLSearchParams({
            where: `GWSTATUS IN ('CLOSED_TEMP','CLOSED_STORM')`,
            outSR: '4326', outFields: 'OBJECTID,GWSTATUS', f: 'geojson',
            orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: String(pageSize)
        });
        const response = await fetcher(`${layerUrl}/query?${params}`, { signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load current Raleigh closures. Try again, or turn off closure avoidance.');
        const page = await response.json();
        if (page.type !== 'FeatureCollection' || !Array.isArray(page.features) || page.error) {
            throw new Error('Raleigh closure data is unavailable. Try again, or turn off closure avoidance.');
        }
        features.push(...page.features);
        if (page.features.length < pageSize && !page.exceededTransferLimit && !page.properties?.exceededTransferLimit) break;
        if (!page.features.length) throw new Error('Raleigh closure data is incomplete. Please retry.');
    }
    return { type: 'FeatureCollection', features };
}

function createAvoidance(data) {
    const lines = [];
    for (const feature of data.features) {
        const status = feature.properties?.GWSTATUS;
        if (!status) throw new Error('Raleigh closure data is missing its status field.');
        if (!CLOSED_STATUSES.includes(status)) continue;
        const geometry = feature.geometry;
        if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) {
            throw new Error('A mapped closure has invalid geometry. Please retry later.');
        }
        const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
        if (!parts.length || parts.some(line => line.length < 2 || line.some(point =>
            !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
            Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90))) {
            throw new Error('A mapped closure has invalid coordinates. Please retry later.');
        }
        lines.push(...parts);
    }
    if (!lines.length) return { polygons: '', areas: [] };

    // Union overlapping buffers so adjacent GIS segments produce compact corridors.
    // A 25 m buffer allows for GIS/OSM alignment differences, but can also cover
    // nearby roads or grade-separated crossings: this is deliberately conservative.
    const corridor = buffer({ type: 'Feature', properties: {}, geometry: {
        type: 'MultiLineString', coordinates: lines
    } }, BUFFER_METERS, { units: 'meters', steps: 4 });
    if (!corridor) throw new Error('Could not build closure avoidance areas.');
    const simplified = simplify(corridor, { tolerance: 0.00003, highQuality: true });
    const polygons = simplified.geometry.type === 'Polygon'
        ? [simplified.geometry.coordinates] : simplified.geometry.coordinates;
    // BRouter accepts outer rings only. Fill holes conservatively, and use the
    // same rounded geometry when checking endpoints and the returned route.
    const rings = polygons.map(polygon => polygon[0].map(point => point.map(value => Number(value.toFixed(6)))));
    return {
        polygons: rings.map(ring => ring.map(point => point.join(',')).join(',')).join('|'),
        areas: rings.map(ring => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }))
    };
}

function intersectsClosures(geojson, avoidance) {
    return avoidance.areas.some(area => booleanIntersects(geojson, area));
}

function routeUrl(start, end, profile, avoidance) {
    for (const location of [start, end]) {
        if (intersectsClosures({ type: 'Point', coordinates: [location.lng, location.lat] }, avoidance)) {
            throw new Error('Start or destination is too close to a mapped closure. Move it outside the closed section.');
        }
    }
    const params = new URLSearchParams({
        lonlats: `${start.lng},${start.lat}|${end.lng},${end.lat}`,
        profile, alternativeidx: '0', format: 'geojson'
    });
    if (avoidance.polygons) params.set('polygons', avoidance.polygons);
    const url = `https://brouter.de/brouter?${params}`;
    // The public server does not currently accept routing POST bodies. Never
    // truncate exclusions or silently retry a route without them.
    if (url.length > 7500) throw new Error('There are too many mapped closures for this routing service. Try again later, or turn off closure avoidance.');
    return url;
}

function validateRoute(route, avoidance) {
    if (route.type !== 'FeatureCollection' || !route.features?.length ||
        route.features.some(feature => feature.geometry?.type !== 'LineString' || feature.geometry.coordinates.length < 2)) {
        throw new Error('The routing service did not return a usable route. Try moving the start or destination.');
    }
    if (intersectsClosures(route, avoidance)) {
        throw new Error('The route still crosses a mapped closure. Try another start or destination.');
    }
    return route;
}

module.exports = { CLOSED_STATUSES, BUFFER_METERS, loadClosures, createAvoidance, intersectsClosures, routeUrl, validateRoute };
