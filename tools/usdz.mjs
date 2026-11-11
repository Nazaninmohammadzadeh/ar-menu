#!/usr/bin/env node
// glb2usdz.py'yi bulduğu Python ile çalıştırır (python3 / python / py — Windows uyumlu).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'glb2usdz.py');
const args = process.argv.slice(2);
for (const py of ['python3', 'python', 'py']) {
  const r = spawnSync(py, [script, ...args], { stdio: 'inherit' });
  if (r.error?.code === 'ENOENT') continue;
  process.exit(r.status ?? 1);
}
console.error('Python bulunamadı. https://www.python.org/downloads/ adresinden kur, sonra:\n  pip install -r tools/requirements.txt');
process.exit(1);
