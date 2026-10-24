// Copia os arquivos estáticos para dentro do build standalone (necessário para o app desktop e para `node .next/standalone/server.js`).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
if (!fs.existsSync(standalone)) {
  console.error('Build standalone não encontrado. Confira output: "standalone" no next.config.mjs');
  process.exit(1);
}
const copies = [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  [path.join(root, 'public'), path.join(standalone, 'public')],
];
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log('copiado', path.relative(root, from), '→', path.relative(root, to));
}
console.log('postbuild ok');
