/**
 * `drizzle-kit pull` natijasini src/db ga ko'chiradi, tanilmagan tiplarni
 * (geography, citext, bytea, tstzrange) custom type'larga almashtiradi va ikkala faylni
 * barqaror tartibga keltiradi.
 *
 * drizzle-kit introspection so'rovlarida ORDER BY yo'q: jadval, constraint va relation tartibi
 * bazaning fizik holatiga bog'liq (dev baza va toza bazada har xil chiqadi). Shuning uchun
 * deklaratsiyalar nomi bo'yicha saralanadi — bir xil sxemadan doim baytma-bayt bir xil fayl
 * chiqadi, diff faqat haqiqiy o'zgarishni ko'rsatadi, CI drift job'i esa farqni ushlaydi.
 * Import ro'yxatlari har nom alohida qatorda: ikki PR yangi jadval qo'shsa, bitta uzun qator
 * to'qnashmaydi.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KNOWN = ['geography', 'citext', 'bytea', 'tstzrange'];

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Kalitlar ro'yxati bo'yicha leksikografik solishtirish (locale'ga bog'liq emas). */
function sortBy<T>(items: T[], key: (item: T) => (string | number)[]): T[] {
  return items
    .map((item) => ({ item, k: key(item) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i++) {
        const x = a.k[i]!;
        const y = b.k[i]!;
        const d = typeof x === 'number' && typeof y === 'number' ? x - y : compare(String(x), String(y));
        if (d !== 0) return d;
      }
      return 0;
    })
    .map(({ item }) => item);
}

/** `text[i]` dagi satr/template literal oxirining indeksini qaytaradi. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      j++;
    } else if (quote === '`' && c === '$' && text[j + 1] === '{') {
      throw new Error(`template literal ichida \${...} kutilmagan: ${text.slice(i, j + 20)}`);
    } else if (c === quote) {
      return j;
    } else if (quote !== '`' && c === '\n') {
      break;
    }
  }
  throw new Error(`yopilmagan satr: ${text.slice(i, i + 40)}`);
}

/** Matnni 0-chuqurlikdagi vergullar bo'yicha bo'ladi (qavslar, satrlar va izohlar hisobga olinadi). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(text, i);
    } else if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? text.length : eol;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (--depth < 0) throw new Error(`ortiqcha yopuvchi qavs: ${text.slice(Math.max(0, i - 40), i + 1)}`);
    } else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new Error(`yopilmagan qavs: ${text.slice(0, 80)}`);
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** `import { a, b } from "<from>"` ni nomlar alfavit tartibida, har biri alohida qatorda yozadi. */
function normalizeImport(src: string, from: string): string {
  const re = new RegExp(`^import \\{([^}]*)\\} from "${from.replace(/[./]/g, '\\$&')}"(;?)$`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`import topilmadi: ${from}`);
  const names = sortBy(
    [...new Set(m[1]!.split(',').map((n) => n.trim()).filter(Boolean))],
    (n) => [n.replace(/^type /, '')],
  );
  return src.replace(re, `import {\n${names.map((n) => `\t${n},`).join('\n')}\n} from "${from}"${m[2]}`);
}

/** Fayl boshidagi importlar va `export const` deklaratsiyalariga bo'ladi. */
function splitDeclarations(src: string): { header: string; decls: string[] } {
  const first = src.search(/^export const /m);
  if (first === -1) throw new Error('export const topilmadi');
  return {
    header: src.slice(0, first).trimEnd(),
    decls: src.slice(first).split(/^(?=export const )/m).map((d) => d.trim()),
  };
}

// drizzle-kit `(table) => [...]` ichida guruhlarni shu tartibda chiqaradi; guruh ichida nom bo'yicha.
const TABLE_ELEMENTS = ['index', 'foreignKey', 'primaryKey', 'unique', 'pgPolicy', 'check'];

function tableElementKey(el: string): (string | number)[] {
  const kind = /^(\w+)\(/.exec(el)?.[1] ?? '';
  const rank = TABLE_ELEMENTS.indexOf(kind === 'uniqueIndex' ? 'index' : kind);
  const name = (kind === 'foreignKey' || kind === 'primaryKey' ? /\bname: "([^"]+)"/ : /^\w+\("([^"]+)"/).exec(el)?.[1];
  if (rank === -1 || !name) throw new Error(`noma'lum jadval elementi: ${el.slice(0, 80)}`);
  return [rank, name, el];
}

function sortTableElements(decl: string): string {
  const m = /^([\s\S]*?\n\}, \(table\) => \[)\n([\s\S]*)\n\]\);$/.exec(decl);
  if (!m) {
    if (!/\n\}\);$/.test(decl)) throw new Error(`jadval formati kutilmagan: ${decl.slice(0, 80)}`);
    return decl;
  }
  const elements = sortBy(splitTopLevel(m[2]!), tableElementKey);
  return `${m[1]}\n${elements.map((el) => `\t${el},`).join('\n')}\n]);`;
}

const SCHEMA_DECLS: Record<string, number> = { pgEnum: 0, pgSequence: 1, pgTable: 2, pgView: 3, pgMaterializedView: 3 };

export function normalizeSchema(src: string): string {
  const { header, decls } = splitDeclarations(src);
  const parsed = decls.map((decl) => {
    const m = /^export const (\w+) = (\w+)\(/.exec(decl);
    const rank = m ? SCHEMA_DECLS[m[2]!] : undefined;
    if (!m || rank === undefined) throw new Error(`noma'lum deklaratsiya: ${decl.slice(0, 80)}`);
    return { name: m[1]!, rank, text: rank === 2 ? sortTableElements(decl) : decl };
  });
  const sorted = sortBy(parsed, (d) => [d.rank, d.name]);
  // Enum'lar jadvallardan oldin bo'lishi shart (ustun ta'rifida darhol chaqiriladi).
  const enums = sorted.filter((d) => d.rank === 0).map((d) => d.text);
  const rest = sorted.filter((d) => d.rank !== 0).map((d) => d.text);
  const body = [enums.join('\n'), rest.join('\n\n')].filter(Boolean).join('\n\n');
  return `${normalizeImport(header, 'drizzle-orm/pg-core')}\n\n${body}\n`;
}

function relationKey(field: string): (string | number)[] {
  const m = /^(\w+): (one|many)\(/.exec(field);
  if (!m) throw new Error(`noma'lum relation: ${field.slice(0, 80)}`);
  return [m[2] === 'one' ? 0 : 1, m[1]!];
}

export function normalizeRelations(src: string): string {
  const { header, decls } = splitDeclarations(src);
  const parsed = decls.map((decl) => {
    const m = /^(export const (\w+) = relations\(\w+, \(\{[\w, ]*\}\) => \(\{)\n([\s\S]*)\n\}\)\);$/.exec(decl);
    if (!m) throw new Error(`relations formati kutilmagan: ${decl.slice(0, 80)}`);
    const fields = sortBy(splitTopLevel(m[3]!), relationKey);
    return { name: m[2]!, text: `${m[1]}\n${fields.map((f) => `\t${f},`).join('\n')}\n}));` };
  });
  const body = sortBy(parsed, (d) => [d.name]).map((d) => d.text).join('\n\n');
  return `${normalizeImport(header, './schema')}\n\n${body}\n`;
}

/** Normalizatsiya idempotent bo'lishi kerak — aks holda parser biror joyni noto'g'ri bo'lgan. */
function stable(fn: (src: string) => string, src: string, file: string): string {
  const out = fn(src);
  if (fn(out) !== out) throw new Error(`${file}: normalizatsiya barqaror emas`);
  return out;
}

function main() {
  const root = join(__dirname, '..');

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
  writeFileSync(join(root, 'src/db/schema.ts'), stable(normalizeSchema, schema, 'schema.ts'));

  const relations = `// AUTO-GENERATED: \`pnpm db:pull\`\n` + readFileSync(join(root, 'drizzle/relations.ts'), 'utf8');
  writeFileSync(join(root, 'src/db/relations.ts'), stable(normalizeRelations, relations, 'relations.ts'));
  console.log('src/db/schema.ts va src/db/relations.ts yangilandi');
}

if (require.main === module) main();
