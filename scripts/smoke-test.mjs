import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('static/index.html', 'utf8');
const js = fs.readFileSync('static/app.js', 'utf8');
const css = fs.readFileSync('static/styles.css', 'utf8');

for (const needle of [
  '/static/styles.css',
  '/static/app.js',
  'id="filter-place"',
  'id="filter-readiness"',
  'id="sort-by"',
  'id="active-filters"',
]) {
  if (!html.includes(needle)) throw new Error(`Missing HTML hook: ${needle}`);
}

for (const needle of [
  'function readiness',
  'function resolvePlace',
  'function renderActiveFilters',
  'function applyFilters',
]) {
  if (!js.includes(needle)) throw new Error(`Missing app behavior: ${needle}`);
}

for (const needle of [
  '.svc-ready',
  '.active-filters',
  '.detail-section',
  '.filter-chip',
]) {
  if (!css.includes(needle)) throw new Error(`Missing CSS rule: ${needle}`);
}

new vm.Script(js);
console.log('Service Explorer smoke test passed');
