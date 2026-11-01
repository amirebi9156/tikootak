// بررسی اینکه هر tr('...') ثابت در src/en.js ترجمه دارد.  اجرا: node check-i18n.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('./src/', import.meta.url));
const en = fs.readFileSync(dir + 'en.js', 'utf8');
const keys = new Set([...en.matchAll(/^\s*(["'])((?:\\.|(?!\1).)*)\1\s*:/gm)].map(m => m[2].replace(/\\(["'])/g, '$1')));
const miss = new Set();
for (const f of fs.readdirSync(dir).filter(f => /\.(jsx?|mjs)$/.test(f) && f !== 'en.js')) {
  const src = fs.readFileSync(dir + f, 'utf8');
  for (const m of src.matchAll(/\btr\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const k = m[2].replace(/\\(["'`])/g, '$1');
    if (/\$\{/.test(k) || !/[؀-ۿ]/.test(k)) continue;
    if (!keys.has(k)) miss.add(f + ': ' + k);
  }
}
console.log(miss.size ? 'بدون ترجمهٔ انگلیسی:\n' + [...miss].join('\n') : 'همهٔ کلیدها ترجمه دارند');
process.exit(miss.size ? 1 : 0);
