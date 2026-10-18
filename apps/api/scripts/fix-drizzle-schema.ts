/**
 * `drizzle-kit pull` natijasini src/db ga ko'chiradi va tanilmagan tiplarni
 * (geography, citext, bytea, tstzrange) custom type'larga almashtiradi.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const KNOWN = ['geography', 'citext', 'bytea', 'tstzrange'];

let schema = readFileSync(join(root, 'drizzle/schema.ts'), 'utf8');
schema = schema.replace(
  /\/\/ TODO: failed to parse database type '([a-z_]+)'\n(\s+)(\w+): unknown\("([a-z_0-9]+)"\)/g,
  (_match, type: string, _indent: string, prop: string, col: string) => {
    if (!KNOWN.includes(type)) throw new Error(`Noma'lum tip: ${type} (${col})`);
    return `${prop}: ${type}("${col}")`;
  },
);
// users <-> media_assets aylanma FK'si TypeScript inferensiyasini buzadi (TS7022). Haqiqiy FK
// DB'da qoladi; Drizzle metadata'sidan faqat users -> media_assets yo'nalishi olib tashlanadi.
const before = schema.length;
schema = schema.replace(
  /\tforeignKey\(\{\s*columns: \[table\.avatarMediaId\],[\s\S]*?name: "users_avatar_fk"\s*\}\),\n/,
  '',
);
if (schema.length === before) throw new Error('users_avatar_fk topilmadi');
if (schema.includes('unknown(')) throw new Error('schema.ts da hali ham unknown() bor');
schema =
  `// AUTO-GENERATED: \`pnpm db:pull\` (drizzle-kit pull + scripts/fix-drizzle-schema.ts). Qo'lda tahrirlamang —\n` +
  `// o'zgarishlar db/migrations/*.sql orqali kiritiladi.\n` +
  `import { ${KNOWN.join(', ')} } from './custom-types';\n` +
  schema;
writeFileSync(join(root, 'src/db/schema.ts'), schema);

const relations = readFileSync(join(root, 'drizzle/relations.ts'), 'utf8');
writeFileSync(join(root, 'src/db/relations.ts'), `// AUTO-GENERATED: \`pnpm db:pull\`\n` + relations);
console.log('src/db/schema.ts va src/db/relations.ts yangilandi');
