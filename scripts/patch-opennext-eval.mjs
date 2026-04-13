/**
 * Cloudflare Workers は eval を禁止する。OpenNext / esbuild の CJS 互換が
 * eval("quire".replace(/^/,"re")) のようなパターンを含むと GET / で EvalError になる。
 * @see https://github.com/opennextjs/opennextjs-cloudflare/issues/1155
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".open-next";

const PATCHES = [
  // esbuild CJS 互換（文字列はビルドごとに微妙に違うことがある）
  [/eval\("quire"\.replace\(\/\^\/,"re"\)\)/g, "require"],
  [/eval\('quire'\.replace\(\/\^\/,'re'\)\)/g, "require"],
  // 余白あり
  [/eval\(\s*"quire"\s*\.\s*replace\s*\(\s*\/\^\/\s*,\s*"re"\s*\)\s*\)/g, "require"],
];

/** 正規表現で取りこぼすときの完全一致（バンドルにそのまま出る場合） */
const LITERALS = [
  'eval("quire".replace(/^/,"re"))',
  "eval('quire'.replace(/^/,'re'))",
];

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) walk(p, files);
      else if (/\.(js|mjs|cjs)$/.test(name)) files.push(p);
    } catch {
      /* ignore */
    }
  }
  return files;
}

function main() {
  const files = walk(ROOT);
  let total = 0;
  for (const file of files) {
    let s = readFileSync(file, "utf8");
    const orig = s;
    for (const [re, to] of PATCHES) {
      s = s.replace(re, to);
    }
    for (const lit of LITERALS) {
      if (s.includes(lit)) s = s.split(lit).join("require");
    }
    if (s !== orig) {
      writeFileSync(file, s, "utf8");
      total++;
      console.log("patched:", file);
    }
  }
  if (total === 0) {
    console.log("patch-opennext-eval: no eval(quire) patterns found (already clean or different bundle)");
  }
}

main();
