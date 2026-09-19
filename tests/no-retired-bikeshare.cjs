// Run with: node tests/no-retired-bikeshare.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const file of ['index.html', 'styles.css', 'sw.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /citrix|cardinalbikeshare\.com|Cardinal Bikeshare/i, file);
}
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
assert(html.includes('bike-parking-checkbox'), 'Public bike parking remains available');
assert(!fs.existsSync(path.join(root, 'img/citrix.jpg')));
console.log('Retired bikeshare references removed; inline scripts parse and bike parking remains.');
