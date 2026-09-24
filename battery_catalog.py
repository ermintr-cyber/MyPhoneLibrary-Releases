"""One-time, backed-up import of the attributed Nokia reference catalog."""
import copy
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data' / 'nokia-batteries.json'

def code(value):
    return re.sub(r'^(nokia|microsoft|byd)\s+', '', str(value).strip(), flags=re.I).casefold()

def apply_battery_catalog(store):
    data = json.loads(DATA.read_text(encoding='utf-8'))
    marker = 'battery_catalog_import:' + data['revision']
    if store.meta(marker, False):
        return None
    # Keep a verified collection backup before replacing any existing catalog data.
    store.backup()
    with store.connect() as c:
        if store.meta(marker, False, c):
            return None
        items = store.catalog(c)
        previous = copy.deepcopy(items)
        by_code = {}
        for item in items:
            if item['category'] == 'battery':
                by_code.setdefault(code(item['name']), []).append(item)
        changed = []
        for entry in data['entries']:
            key = code(entry['name'])
            matches = by_code.get(key, [])
            if not matches:
                import uuid
                matches = [{'id': uuid.uuid4().hex, 'rev': 0, 'category': 'battery', 'name': entry['name']}]
                items.extend(matches)
                by_code[key] = matches
            for item in matches:
                # Retain IDs, display names and phone links to avoid breaking collection references.
                item.update(description=entry['description'], source=entry['source'],
                            specs={**item.get('specs', {}), **entry['specs']},
                            supported_models=copy.deepcopy(entry['supported_models']),
                            source_models=entry['source_models'], manufacturer=entry['manufacturer'],
                            suggestion_excluded=entry.get('suggestion_excluded', False),
                            source_revision=data['revision'], source_warnings=entry['warnings'],
                            compatible_batteries=[], rev=item.get('rev', 0)+1)
                changed.append(item['id'])
        # Replace stale links touching imported entries; add only explicitly full compatibility.
        for item in items:
            old_links = item.get('compatible_batteries', [])
            item['compatible_batteries'] = [v for v in old_links if v not in changed]
            if item['compatible_batteries'] != old_links and item['id'] not in changed:
                item['rev'] = item.get('rev', 0)+1
        for entry in data['entries']:
            for item in by_code[code(entry['name'])]:
                item['compatible_batteries'] = [other['id'] for name in entry['compatible_names']
                    for other in by_code[code(name)] if other['id'] != item['id']]
        store.setmeta(c, 'battery_catalog_before_import:' + data['revision'], previous)
        store.setmeta(c, 'catalog', items)
        imported_codes = {code(e['name']) for e in data['entries']}
        store.setmeta(c, 'catalog_deleted', [v for v in store.meta('catalog_deleted', [], c)
                      if not (v[0] == 'battery' and code(v[1]) in imported_codes)])
        store.catalog(c)
        report = {'revision': data['revision'], 'entries': len(data['entries']),
                  'updated_ids': changed, 'warnings': {e['name']: e['warnings'] for e in data['entries'] if e['warnings']}}
        store.setmeta(c, marker, report)
        return report
