#!/usr/bin/env python3
"""Fetch published Raleigh Greenways notices into a static, normalized snapshot."""
import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import subprocess
from urllib.parse import urlencode, urljoin, urlsplit

BASE = 'https://raleighnc.gov'
API = BASE + '/jsonapi/node/status_alert'
SOURCE = BASE + '/status-alerts?alert_category=746&field_alert_type_target_id=All&title='
PARAMS = {
    'filter[field_alert_category.drupal_internal__tid]': '746',
    'filter[status]': '1',
    'include': 'field_alert_type,field_place_affected,field_project_affected',
    'page[limit]': '50',
    'sort': 'drupal_internal__nid',
}
OUTPUT = Path(__file__).resolve().parents[1] / 'data/greenway-alerts.json'


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.links = set()

    def handle_starttag(self, tag, attrs):
        if tag in ('p', 'br', 'li', 'div'):
            self.parts.append('\n')
        if tag == 'a':
            href = dict(attrs).get('href', '')
            url = urljoin(BASE, href)
            if href and urlsplit(url).scheme in ('https', 'http'):
                self.links.add(url)

    def handle_data(self, data):
        self.parts.append(data)

    def handle_endtag(self, tag):
        if tag in ('p', 'li', 'div'):
            self.parts.append('\n')

    def text(self):
        return '\n\n'.join(' '.join(line.split()) for line in ''.join(self.parts).splitlines() if line.strip())


def fetch_page(url):
    # The city currently rejects urllib requests with HTTP 403 while curl works.
    # curl is preinstalled on GitHub's Ubuntu runners. Retry transient failures;
    # HTTP errors, timeouts and malformed JSON all leave the prior file intact.
    result = subprocess.run([
        'curl', '--fail', '--silent', '--show-error', '--location',
        '--proto', '=https', '--proto-redir', '=https',
        '--connect-timeout', '15', '--max-time', '60',
        '--retry', '3', '--retry-max-time', '240', url,
    ], capture_output=True, text=True, check=True, timeout=300)
    return json.loads(result.stdout)


def collect(fetcher=fetch_page):
    url = API + '?' + urlencode(PARAMS)
    seen = set()
    records = {}
    included = {}
    while url:
        if url in seen or len(seen) >= 100:
            raise ValueError('Invalid or excessive API pagination')
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != 'raleighnc.gov' or parsed.path != '/jsonapi/node/status_alert':
            raise ValueError('Unexpected pagination URL')
        seen.add(url)
        page = fetcher(url)
        if page.get('errors') or not isinstance(page.get('data'), list):
            raise ValueError('Invalid alerts API response')
        if page.get('meta', {}).get('omitted'):
            raise ValueError('API omitted records; refusing an incomplete snapshot')
        for item in page.get('included', []):
            included[(item['type'], item['id'])] = item
        for item in page['data']:
            if item['type'] != 'node--status_alert' or item['id'] in records:
                raise ValueError('Unexpected or duplicate alert record')
            records[item['id']] = item
        link = page.get('links', {}).get('next')
        url = urljoin(BASE, link['href'] if isinstance(link, dict) else link) if link else None
    return [normalize(item, included) for item in sorted(records.values(), key=lambda item: item['id'])]


def normalize(item, included):
    attrs = item['attributes']
    if attrs['status'] is not True or not attrs['title'].strip():
        raise ValueError('Expected a titled, published alert')

    def related(field):
        refs = item['relationships'][field]['data']
        refs = refs if isinstance(refs, list) else ([refs] if refs else [])
        result = []
        for ref in refs:
            resource = included[(ref['type'], ref['id'])]
            values = resource['attributes']
            alias = values.get('path', {}).get('alias')
            result.append({
                'id': ref['id'],
                'name': (values.get('name') or values['title']).strip(),
                'url': urljoin(BASE, alias) if alias else None,
            })
        return sorted(result, key=lambda value: value['id'])

    types = related('field_alert_type')
    if len(types) != 1 or types[0]['name'] not in ('Code Red', 'Code Yellow', 'Code Green'):
        raise ValueError('Unknown alert classification')
    description = PlainText()
    description.feed(attrs['field_text_intro']['processed'])
    dates = attrs['field_affected_date']
    # Preserve upstream dates and wording; Code Red may describe a future closure.
    for date in (dates['value'], dates['end_value'], attrs['changed']):
        datetime.fromisoformat(date.replace('Z', '+00:00'))
    alias = attrs['path']['alias']
    if not alias or not alias.startswith('/status-alerts/'):
        raise ValueError('Missing canonical alert path')
    return {
        'id': item['id'], 'title': attrs['title'].strip(),
        'url': BASE + alias, 'code': types[0]['name'].removeprefix('Code ').lower(),
        'subtitle': attrs.get('field_subtitle') or '',
        'description': description.text(), 'links': sorted(description.links),
        'startsAt': dates['value'], 'endsAt': dates['end_value'], 'updatedAt': attrs['changed'],
        'places': related('field_place_affected'), 'projects': related('field_project_affected'),
    }


def update(output=OUTPUT, fetcher=fetch_page):
    alerts = collect(fetcher)
    snapshot = {
        'schemaVersion': 1, 'sourceUrl': SOURCE,
        'fetchedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        'alerts': alerts,
    }
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Fetch and validate every page before atomically replacing the prior snapshot.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        temporary.replace(output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    print(f'Saved {len(alerts)} alerts to {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT)
    update(parser.parse_args().output)
