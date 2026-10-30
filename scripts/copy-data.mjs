import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'knowledge', 'data');
const target = join(root, 'dist', 'src', 'knowledge', 'data');

if (!existsSync(source)) {
  console.error(`knowledge data directory not found: ${source}`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`copied knowledge data -> ${target}`);
