/**
 * Frontend bundle boyut bütçesi — CI'de build sonrası çalışır.
 *
 * Amaç: fark edilmeden büyüyen JS/CSS paketlerini yakalamak.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.join(root, 'dist', 'assets');
const MAX_JS_BYTES = 700 * 1024;
const MAX_CSS_BYTES = 120 * 1024;

if (!fs.existsSync(assetsDir)) {
  console.error('dist/assets bulunamadı. Önce vite build çalıştırılmalı.');
  process.exit(1);
}

const files = fs.readdirSync(assetsDir);
const sumBy = (ext: string) =>
  files
    .filter((file) => file.endsWith(ext))
    .reduce((sum, file) => sum + fs.statSync(path.join(assetsDir, file)).size, 0);

const jsBytes = sumBy('.js');
const cssBytes = sumBy('.css');
const kb = (bytes: number) => `${(bytes / 1024).toFixed(2)} KB`;

let failed = 0;
function check(name: string, actual: number, limit: number) {
  if (actual <= limit) {
    console.log(`  PASS  ${name}: ${kb(actual)} (limit ${kb(limit)})`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}: ${kb(actual)} > ${kb(limit)}`);
  }
}

check('JavaScript toplam boyutu', jsBytes, MAX_JS_BYTES);
check('CSS toplam boyutu', cssBytes, MAX_CSS_BYTES);

const largestJs = files
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({
    file,
    size: fs.statSync(path.join(assetsDir, file)).size,
  }))
  .sort((a, b) => b.size - a.size)[0];

if (largestJs) {
  console.log(`  Bilgi: en büyük JS ${largestJs.file} — ${kb(largestJs.size)}`);
}

console.log(`\nBundle bütçesi: ${failed === 0 ? 'başarılı' : `${failed} aşım`}`);
if (failed > 0) process.exit(1);
