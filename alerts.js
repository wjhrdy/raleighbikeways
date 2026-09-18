/* The nightly snapshot is rendered as text; upstream HTML is never injected. */
(() => {
    const panel = document.getElementById('alerts-panel');
    const openButton = document.getElementById('alerts-open');
    const list = document.getElementById('alerts-list');
    const message = document.getElementById('alerts-message');
    const freshness = document.getElementById('alerts-freshness');
    const retry = document.getElementById('alerts-retry');
    const dates = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' });
    let request;

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function link(label, value) {
        try {
            const url = new URL(value);
            if (!['https:', 'http:'].includes(url.protocol)) return null;
            const node = element('a', label);
            node.href = url.href;
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
            return node;
        } catch (_) { return null; }
    }

    function date(value) {
        return value && Number.isFinite(Date.parse(value)) ? dates.format(new Date(value)) : 'Not specified';
    }

    function card(alert) {
        const article = element('article', '', 'alert-card');
        const code = ['red', 'yellow', 'green'].includes(alert.code) ? alert.code : 'unknown';
        article.append(element('span', code === 'unknown' ? 'Notice' : `Code ${code[0].toUpperCase()}${code.slice(1)}`, `alert-badge alert-${code}`));
        article.append(element('h3', alert.title));
        if (alert.subtitle) article.append(element('p', alert.subtitle, 'alert-section'));
        article.append(element('p', `Affected: ${date(alert.startsAt)} – ${date(alert.endsAt)}`, 'alert-dates'));
        const paragraphs = alert.description.split(/\n\s*\n/).filter(Boolean);
        if (paragraphs.length) article.append(element('p', paragraphs[0], 'alert-description'));
        const details = element('details');
        details.append(element('summary', 'Details and links'));
        for (const paragraph of paragraphs.slice(1)) details.append(element('p', paragraph, 'alert-description'));
        const resources = element('ul', '', 'alert-links');
        function resource(label, url) {
            const anchor = link(label, url);
            if (anchor) { const item = element('li'); item.append(anchor); resources.append(item); }
        }
        resource('Read official notice ↗', alert.url);
        for (const [index, url] of (alert.links || []).entries()) {
            resource(`City reference${alert.links.length > 1 ? ` ${index + 1}` : ''}${/\.pdf(?:$|\?)/i.test(url) ? ' (PDF)' : ''} ↗`, url);
        }
        for (const place of (alert.places || [])) resource(place.name, place.url);
        for (const project of (alert.projects || [])) resource(project.name, project.url);
        details.append(resources, element('p', `Notice updated ${date(alert.updatedAt)}`, 'alert-dates'));
        article.append(details);
        return article;
    }

    async function load() {
        if (request) request.abort();
        const controller = new AbortController();
        request = controller;
        const timeout = setTimeout(() => controller.abort(), 12000);
        list.replaceChildren();
        freshness.textContent = '';
        message.textContent = 'Loading greenway notices…';
        retry.hidden = true;
        try {
            // Do not use the app shell's cache for a snapshot that changes nightly.
            const response = await fetch('data/greenway-alerts.json', { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('Snapshot unavailable');
            const snapshot = await response.json();
            if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.alerts) || !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
                snapshot.alerts.some(alert => !alert || typeof alert.title !== 'string' || typeof alert.description !== 'string')) {
                throw new Error('Invalid snapshot');
            }
            if (request !== controller) return;
            const stale = Date.now() - Date.parse(snapshot.fetchedAt) > 48 * 60 * 60 * 1000;
            freshness.textContent = `Last synced ${new Date(snapshot.fetchedAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} Eastern · Refreshed nightly`;
            message.textContent = stale ? 'This snapshot is over two days old. Check the official notices for current conditions.'
                : snapshot.alerts.length ? `${snapshot.alerts.length} published notices` : 'No published greenway notices in this snapshot.';
            message.classList.toggle('alerts-warning', stale);
            const order = { red: 0, yellow: 1, green: 2 };
            const alerts = [...snapshot.alerts].sort((a, b) => (order[a.code] ?? 3) - (order[b.code] ?? 3) || a.title.localeCompare(b.title));
            // Build the entire list before insertion so malformed records never leave a partial list.
            list.replaceChildren(...alerts.map(card));
            openButton.textContent = `Alerts (${alerts.length})`;
        } catch (_) {
            if (request !== controller) return;
            list.replaceChildren();
            freshness.textContent = '';
            openButton.textContent = 'Alerts';
            message.textContent = 'Could not load greenway notices. Try again or visit the official alerts page below.';
            message.classList.add('alerts-warning');
            retry.hidden = false;
        } finally {
            clearTimeout(timeout);
            if (request === controller) request = null;
        }
    }

    openButton.addEventListener('click', () => { panel.showModal(); load(); });
    document.getElementById('alerts-close').addEventListener('click', () => panel.close());
    panel.addEventListener('close', () => {
        if (request) request.abort();
        request = null;
        openButton.focus();
    });
    retry.addEventListener('click', load);
})();
