// Copies the Melody web app into desktop/app as a stand-alone version (accounts and payments simulated, like the demo).
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'app');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of ['css', 'js', 'icons', 'catalog', 'podcasts', 'legal', 'vendor', 'manifest.webmanifest']) {
  fs.cpSync(path.join(SRC, item), path.join(OUT, item), { recursive: true });
}
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8').replace('<html lang="de">', '<html lang="de" data-demo="1">');
if (!html.includes('data-demo="1"')) throw new Error('index.html: <html lang="de"> nicht gefunden');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('App vorbereitet:', OUT);
