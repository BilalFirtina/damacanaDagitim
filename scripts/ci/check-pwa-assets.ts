/**
 * PWA varlık kontrolü — CI'de build sonrası çalışır.
 *
 * Manifest alanları, ikon dosyaları ve service worker'ın temel yaşam döngüsü
 * olmadan PWA kurulumu bozulur. Ağ/dış servis gerektirmez.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const base = fs.existsSync(dist) ? dist : path.join(root, 'public');

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`);
  }
}

const manifestPath = path.join(base, 'manifest.json');
check('manifest.json mevcut', fs.existsSync(manifestPath));

let manifest: any = {};
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    check('manifest JSON geçerli', true);
  } catch {
    check('manifest JSON geçerli', false);
  }
}

check('name dolu', typeof manifest.name === 'string' && manifest.name.trim().length > 0);
check(
  'short_name dolu',
  typeof manifest.short_name === 'string' && manifest.short_name.trim().length > 0
);
check('start_url /', manifest.start_url === '/');
check('scope /', manifest.scope === '/');
check('display standalone', manifest.display === 'standalone');
check('theme_color dolu', typeof manifest.theme_color === 'string' && manifest.theme_color.length > 0);
check(
  'background_color dolu',
  typeof manifest.background_color === 'string' && manifest.background_color.length > 0
);

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
const iconSizes = new Set(icons.map((icon: any) => String(icon?.sizes || '')));
check('192x192 ikon tanımlı', iconSizes.has('192x192'));
check('512x512 ikon tanımlı', iconSizes.has('512x512'));
check(
  'maskable ikon tanımlı',
  icons.some((icon: any) => String(icon?.purpose || '').includes('maskable'))
);

for (const icon of icons) {
  const src = String(icon?.src || '').split('?')[0];
  if (!src) continue;
  const file = path.join(base, src.replace(/^\//, ''));
  check(`ikon dosyası: ${src}`, fs.existsSync(file));
}

const swPath = path.join(base, 'sw.js');
check('sw.js mevcut', fs.existsSync(swPath));
if (fs.existsSync(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  check("service worker 'install' içeriyor", /addEventListener\(\s*['"]install['"]/.test(sw));
  check("service worker 'activate' içeriyor", /addEventListener\(\s*['"]activate['"]/.test(sw));
  check("service worker 'fetch' içeriyor", /addEventListener\(\s*['"]fetch['"]/.test(sw));
  check('service worker cache açıyor', /caches\.open\s*\(/.test(sw));
}

const indexHtml = path.join(base, 'index.html');
if (fs.existsSync(indexHtml)) {
  const html = fs.readFileSync(indexHtml, 'utf8');
  check('index.html manifest bağlantısı', /rel=["']manifest["']/.test(html));
  check('index.html theme-color', /name=["']theme-color["']/.test(html));
}

console.log(`\nPWA kontrolü: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
