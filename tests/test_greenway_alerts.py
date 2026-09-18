import copy
import json
from pathlib import Path
import tempfile
import unittest

from scripts.fetch_greenway_alerts import API, PlainText, collect, update


def page():
    return {'data': [{
        'id': 'alert-1', 'type': 'node--status_alert',
        'attributes': {
            'title': 'Trail closure', 'status': True,
            'path': {'alias': '/status-alerts/trail-closure'},
            'field_subtitle': 'Mile 10–11',
            'field_text_intro': {'processed': '<p>Not closed yet &amp; work is planned.</p><p><a href="/map.pdf">Map</a></p>'},
            'field_affected_date': {'value': '2026-09-04T08:00:00-04:00', 'end_value': '2028-01-01T00:00:00-05:00'},
            'changed': '2026-09-18T12:00:00+00:00',
        },
        'relationships': {
            'field_alert_type': {'data': {'type': 'taxonomy_term--status_alert', 'id': 'red'}},
            'field_place_affected': {'data': []},
            'field_project_affected': {'data': []},
        },
    }], 'included': [{
        'type': 'taxonomy_term--status_alert', 'id': 'red',
        'attributes': {'name': 'Code Red'},
    }], 'links': {}}


class AlertsTests(unittest.TestCase):
    def test_normalization_preserves_wording_dates_and_links(self):
        alert = collect(lambda _: page())[0]
        self.assertEqual(alert['code'], 'red')
        self.assertIn('Not closed yet & work is planned.', alert['description'])
        self.assertNotIn('<p>', alert['description'])
        self.assertEqual(alert['links'], ['https://raleighnc.gov/map.pdf'])
        self.assertEqual(alert['startsAt'], '2026-09-04T08:00:00-04:00')
        self.assertEqual(alert['places'], [])

    def test_pagination_resolves_relationships_across_pages(self):
        first = page()
        first['links']['next'] = {'href': API + '?page[offset]=50'}
        first['included'] = []
        second = page()
        second['data'][0]['id'] = 'alert-2'
        pages = iter([first, second])
        self.assertEqual([item['id'] for item in collect(lambda _: next(pages))], ['alert-1', 'alert-2'])

    def test_rejects_partial_error_and_unknown_classification(self):
        variants = [
            {'errors': [{'detail': 'unavailable'}]},
            {**page(), 'meta': {'omitted': {'detail': 'not authorized'}}},
            {**page(), 'included': []},
        ]
        unknown = page()
        unknown['included'][0]['attributes']['name'] = 'Code Purple'
        variants.append(unknown)
        for invalid in variants:
            with self.subTest(invalid=invalid), self.assertRaises((ValueError, KeyError)):
                collect(lambda _: invalid)

    def test_rejects_untrusted_pagination_and_duplicates(self):
        invalid = page()
        invalid['links']['next'] = {'href': 'https://example.com/alerts'}
        with self.assertRaisesRegex(ValueError, 'pagination URL'):
            collect(lambda _: invalid)
        duplicate = page()
        duplicate['data'].append(copy.deepcopy(duplicate['data'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            collect(lambda _: duplicate)

    def test_failed_second_page_keeps_last_good_snapshot(self):
        first = page()
        first['links']['next'] = {'href': API + '?page[offset]=50'}
        pages = iter([first, {'errors': [{'detail': 'failed'}]}])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'alerts.json'
            target.write_text('last good snapshot')
            with self.assertRaises(ValueError):
                update(target, lambda _: next(pages))
            self.assertEqual(target.read_text(), 'last good snapshot')

    def test_valid_empty_response_removes_expired_or_unpublished_notices(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'alerts.json'
            update(target, lambda _: {'data': []})
            snapshot = json.loads(target.read_text())
            self.assertEqual(snapshot['alerts'], [])
            self.assertTrue(snapshot['fetchedAt'].endswith('Z'))
            self.assertEqual(snapshot['schemaVersion'], 1)

    def test_only_web_links_are_exported(self):
        parser = PlainText()
        parser.feed('<a href="javascript:alert(1)">Bad</a><a href="mailto:x@example.com">Contact</a><a href="/map.pdf">Map</a>')
        self.assertEqual(parser.links, {'https://raleighnc.gov/map.pdf'})


if __name__ == '__main__':
    unittest.main()
