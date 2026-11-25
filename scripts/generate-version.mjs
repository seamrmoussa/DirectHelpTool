import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve('public');
mkdirSync(outDir, { recursive: true });

const payload = {
  version: process.env.BUILD_VERSION || String(Date.now()),
  builtAt: new Date().toISOString(),
};

writeFileSync(resolve(outDir, 'version.json'), JSON.stringify(payload, null, 2));
console.log('Generated public/version.json:', payload);
