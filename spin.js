/* Spin Raleigh's public GBFS feed. No API key or rider account is used. */
(function () {
    const feedBase = 'https://gbfs.spin.pm/api/gbfs/v2_3/raleigh/';
    const maxAge = 300; // GBFS availability must be no more than five minutes old.
    const empty = () => ({ type: 'FeatureCollection', features: [] });

    function availableBikes(status, types, now = Date.now() / 1000) {
        if (!Number.isFinite(status.last_updated) || status.last_updated > now + 60 ||
            now - status.last_updated >= maxAge || !Array.isArray(status.data?.bikes) ||
            !Array.isArray(types.data?.vehicle_types)) throw new Error('Unavailable or stale Spin feed');
        const bicycles = new Set(types.data.vehicle_types
            .filter(type => type.form_factor === 'bicycle' && type.propulsion_type === 'electric_assist')
            .map(type => type.vehicle_type_id));
        return {
            type: 'FeatureCollection',
            features: status.data.bikes.filter(bike => {
                const reported = bike.last_reported ?? status.last_updated;
                return bicycles.has(bike.vehicle_type_id) && bike.is_reserved === false && bike.is_disabled === false &&
                    Number.isFinite(bike.lat) && Math.abs(bike.lat) <= 90 &&
                    Number.isFinite(bike.lon) && Math.abs(bike.lon) <= 180 &&
                    Number.isFinite(reported) && reported <= now + 60 && now - reported < maxAge;
            }).map(bike => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [bike.lon, bike.lat] },
                properties: {
                    reported: bike.last_reported ?? status.last_updated,
                    ...(Number.isFinite(bike.current_fuel_percent) && bike.current_fuel_percent >= 0 && bike.current_fuel_percent <= 1
                        ? { battery: Math.round(bike.current_fuel_percent * 100) } : {}),
                    ...(Number.isFinite(bike.current_range_meters) && bike.current_range_meters >= 0
                        ? { miles: Math.round(bike.current_range_meters / 1609.344) } : {})
                }
            }))
        };
    }

    function mount(map, checkbox, statusText) {
        const id = 'spin-available-bikes';
        let data = empty(), statusFeed = null, typeFeed = null;
        let controller = null, refreshTimer = null, expiryTimer = null, popup = null;

        function draw() {
            if (map.getSource(id)) map.getSource(id).setData(data);
            if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', checkbox.checked ? 'visible' : 'none');
        }

        function clear() {
            clearTimeout(expiryTimer);
            statusFeed = typeFeed = null;
            data = empty();
            if (popup) { popup.remove(); popup = null; }
            draw();
        }

        function updateAvailable() {
            clearTimeout(expiryTimer);
            if (popup) { popup.remove(); popup = null; }
            try {
                data = availableBikes(statusFeed, typeFeed);
                const updated = new Date(statusFeed.last_updated * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                statusText.textContent = `${data.features.length} e-bikes available. Feed updated ${updated}.`;
                const expires = Math.min(statusFeed.last_updated, ...data.features.map(feature => feature.properties.reported)) + maxAge;
                expiryTimer = setTimeout(updateAvailable, Math.max(1, expires * 1000 - Date.now() + 1));
            } catch (error) {
                clear();
                statusText.textContent = 'Spin locations are out of date. Retrying automatically.';
            }
            draw();
        }

        async function refresh() {
            if (!checkbox.checked || document.hidden || controller) return;
            const request = new AbortController();
            controller = request;
            const timeout = setTimeout(() => request.abort(), 12000);
            try {
                const responses = await Promise.all(['free_bike_status', 'vehicle_types'].map(async name => {
                    const response = await fetch(feedBase + name, { signal: request.signal, cache: 'no-store', credentials: 'omit' });
                    if (!response.ok) throw new Error('Spin request failed');
                    return response.json();
                }));
                if (controller !== request || !checkbox.checked || document.hidden) return;
                [statusFeed, typeFeed] = responses;
                updateAvailable();
            } catch (error) {
                if (controller !== request) return;
                clear();
                statusText.textContent = 'Spin locations unavailable. Retrying automatically.';
            } finally {
                clearTimeout(timeout);
                if (controller === request) controller = null;
            }
        }

        function sync() {
            clearInterval(refreshTimer);
            if (controller) { controller.abort(); controller = null; }
            clear();
            if (!checkbox.checked) {
                statusText.textContent = 'Live availability from Spin. Enable to load bikes.';
            } else if (document.hidden) {
                statusText.textContent = 'Updates paused while this page is hidden.';
            } else {
                statusText.textContent = 'Loading Spin e-bikes...';
                refresh();
                refreshTimer = setInterval(refresh, 60000);
            }
        }

        function addLayer() {
            if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
            if (!map.getLayer(id)) map.addLayer({
                id, type: 'circle', source: id, minzoom: 11,
                layout: { visibility: checkbox.checked ? 'visible' : 'none' },
                paint: {
                    'circle-color': '#f36b21', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8]
                }
            });
        }

        map.on('style.load', addLayer);
        if (map.isStyleLoaded()) addLayer();
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
        map.on('click', id, event => {
            const feature = event.features?.[0];
            if (!checkbox.checked || !feature || Date.now() / 1000 - feature.properties.reported >= maxAge) return;
            if (popup) popup.remove();
            const content = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = 'Spin e-bike';
            content.appendChild(title);
            const details = feature.properties;
            const lines = ['Reported available; availability can change.'];
            if (details.battery !== undefined) lines.push(`Battery: ${details.battery}%`);
            if (details.miles !== undefined) lines.push(`Estimated range: ${details.miles} miles`);
            lines.push('Find and unlock this bike in the Spin app.');
            lines.forEach(text => {
                const line = document.createElement('p');
                line.textContent = text;
                content.appendChild(line);
            });
            const link = document.createElement('a');
            link.href = 'https://www.spin.app/';
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = 'Get the Spin app';
            content.appendChild(link);
            popup = new mapboxgl.Popup().setLngLat(feature.geometry.coordinates).setDOMContent(content).addTo(map);
        });
        checkbox.addEventListener('change', sync);
        document.addEventListener('visibilitychange', sync);
        sync();
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { availableBikes, mount };
    else window.SpinBikes = { mount };
}());
