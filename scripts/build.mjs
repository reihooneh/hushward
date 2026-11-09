// Builds the site from its sources (run after `npm run asbuild`):
//   src/pages/*.html + the shared layout  ->  site/*.html (strict CSP, no inline code)
//   src/web/*.js                          ->  site/assets/js/ (bare 'three' imports pointed at the self-hosted copy)
//   src/css/site.css, wards/*.json        ->  site/assets/
//   three.js and the fonts (pinned npm)   ->  site/assets/vendor, site/assets/fonts
// CI rebuilds the site and checks the committed copy matches.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

function copy(from, to, transform) {
  mkdirSync(dirname(at(to)), { recursive: true });
  if (transform) writeFileSync(at(to), transform(readFileSync(at(from), 'utf8')));
  else copyFileSync(at(from), at(to));
}

rmSync(at('site/assets/js'), { recursive: true, force: true });
rmSync(at('site/assets/wards'), { recursive: true, force: true });

const vendor = [
  ['node_modules/three/build/three.module.js', 'site/assets/vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'site/assets/vendor/three.core.js'],
  ['node_modules/three/LICENSE', 'site/assets/vendor/three.LICENSE.txt'],
  ['node_modules/@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', 'site/assets/fonts/fraunces.woff2'],
  ['node_modules/@fontsource-variable/fraunces/LICENSE', 'site/assets/fonts/fraunces.LICENSE.txt'],
  ['node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2', 'site/assets/fonts/public-sans.woff2'],
  ['node_modules/@fontsource-variable/public-sans/LICENSE', 'site/assets/fonts/public-sans.LICENSE.txt'],
  ['src/css/site.css', 'site/assets/css/site.css'],
  ['src/icon.svg', 'site/assets/icon.svg'],
];
for (const [from, to] of vendor) copy(from, to);
copy('node_modules/three/examples/jsm/controls/OrbitControls.js', 'site/assets/vendor/OrbitControls.js', (js) => js.replace(/from 'three';/g, "from './three.module.js';"));

for (const f of readdirSync(at('wards')).filter((x) => x.endsWith('.json')).sort()) copy(`wards/${f}`, `site/assets/wards/${f}`);

for (const f of readdirSync(at('src/web')).filter((x) => x.endsWith('.js')).sort()) {
  copy(`src/web/${f}`, `site/assets/js/${f}`, (js) =>
    js.replace(/from 'three';/g, "from '../vendor/three.module.js';").replace(/from 'three\/addons\/controls\/OrbitControls\.js';/g, "from '../vendor/OrbitControls.js';"));
}

// ---------- Pages ----------
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const NAV = [
  ['index', 'index.html', 'Home'],
  ['planner', 'planner.html', 'Plan a quiet night'],
  ['sound', 'sound.html', 'How sound travels'],
  ['method', 'method.html', 'How it works'],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const built = [];
for (const file of readdirSync(at('src/pages')).filter((f) => f.endsWith('.html')).sort()) {
  const raw = readFileSync(at(`src/pages/${file}`), 'utf8');
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->\n/);
  if (!m) throw new Error(`${file}: missing the JSON header comment`);
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const nav = NAV.map(([id, href, label]) => `<a href="${href}"${id === meta.nav ? ' aria-current="page"' : ''}>${label}</a>`).join('\n        ');
  const html = `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <meta name="referrer" content="no-referrer">
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="preload" href="assets/fonts/public-sans.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="assets/css/site.css">
  <script type="module" src="assets/js/${meta.script}"></script>
</head>
<body class="page-${meta.nav}">
  <a class="skip" href="#main">Skip to the content</a>
  <header class="top">
    <div class="top-inner">
      <a class="mark" href="index.html" aria-label="Hushward home">
        <svg class="mark-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M20 5a11 11 0 1 0 7 16 9 9 0 0 1-7-16z"/><path d="M8 25c2-1.4 3-1.4 5 0s3 1.4 5 0"/></svg>
        <span>Hushward</span>
      </a>
      <nav class="nav" aria-label="Pages">
        ${nav}
      </nav>
    </div>
  </header>
  <main id="main">
${body.trimEnd()}
  </main>
  <footer class="foot">
    <div class="foot-inner">
      <p>Hushward is open source (MIT). It runs entirely in your browser: no sign-in, no tracking, and ward plans you load never leave your device. It uses invented example wards and patients, and its sleep model is an estimate for comparing options: measure a real ward before changing it.</p>
      <p><a href="https://github.com/reihooneh/hushward">Source code and tests on GitHub</a></p>
    </div>
  </footer>
</body>
</html>
`;
  writeFileSync(at(`site/${file}`), html);
  built.push(file);
}
console.log(`Built ${built.length} pages: ${built.join(', ')}.`);
