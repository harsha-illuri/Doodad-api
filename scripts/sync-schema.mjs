// Copies the allowlist from the Doodad app's repo (packages/telemetry), so
// this service checks exactly what the app does. Run after it changes:
//   pnpm sync-schema            (expects ../Doodad beside this repo)
//   DOODAD_REPO=/path pnpm sync-schema
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.env.DOODAD_REPO ?? join(import.meta.dirname, '..', '..', 'Doodad');
const source = join(repo, 'packages', 'telemetry', 'src', 'index.ts');
const text = readFileSync(source, 'utf8');
const header = `// Copied from the Doodad repo's packages/telemetry/src/index.ts by
// scripts/sync-schema.mjs. Don't edit here: change it there, then run
// \`pnpm sync-schema\`. The app checks every report against these before
// sending, and this service checks them again.

`;
writeFileSync(join(import.meta.dirname, '..', 'src', 'schema.ts'), header + text);
console.log(`Copied ${source}`);
