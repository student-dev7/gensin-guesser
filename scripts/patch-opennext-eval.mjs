/**
 * Cloudflare Workers は eval を禁止。OpenNext のバンドルに残る CJS 互換（eval / 間接 eval）を除去する。
 * @see https://github.com/opennextjs/opennextjs-cloudflare/issues/1155
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".open-next";

/** より具体的なパターンを先に並べる */
const REPLACEMENT_ROUNDS = [
  // __dirname を eval で取るパターン（issue #561 系）
  [
    /\(0\s*,\s*eval\)\s*\(\s*["']__dirname["']\s*\)/g,
    '(typeof __dirname!=="undefined"?__dirname:"")',
  ],
  [/eval\s*\(\s*["']__dirname["']\s*\)/g, '(typeof __dirname!=="undefined"?__dirname:"")'],
  // 間接 eval（esbuild / ncc でよく出る）— 直書き eval より先に処理
  [/\(0\s*,\s*eval\)\s*\(\s*["']require["']\s*\)/g, "require"],
  [
    /\(0\s*,\s*eval\)\s*\(\s*"quire"\.replace\s*\(\s*\/\^\/\s*,\s*"re"\s*\)\s*\)/g,
    "require",
  ],
  [
    /\(0\s*,\s*eval\)\s*\(\s*'quire'\.replace\s*\(\s*\/\^\/\s*,\s*'re'\s*\)\s*\)/g,
    "require",
  ],
  // 空白ゆるめの quire（ミニファイ差分）
  [
    /\(0\s*,\s*eval\)\s*\(\s*"quire"\s*\.\s*replace\s*\(\s*\/\^\/\s*,\s*"re"\s*\)\s*\)/g,
    "require",
  ],
  // 直 eval
  [/eval\s*\(\s*["']require["']\s*\)/g, "require"],
  [/eval\s*\(\s*"quire"\.replace\s*\(\s*\/\^\/\s*,\s*"re"\s*\)\s*\)/g, "require"],
  [/eval\s*\(\s*'quire'\.replace\s*\(\s*\/\^\/\s*,\s*'re'\s*\)\s*\)/g, "require"],
  [
    /eval\s*\(\s*"quire"\s*\.\s*replace\s*\(\s*\/\^\/\s*,\s*"re"\s*\)\s*\)/g,
    "require",
  ],
];

/** 文字列リテラルとして残っている既知の形（split で最終掃除） */
const NEEDLES = [
  'eval("quire".replace(/^/,"re"))',
  "eval('quire'.replace(/^/,'re'))",
  'eval("quire".replace(/^/, "re"))',
  'eval("quire".replace( /^/ ,"re"))',
  'eval("require")',
  "eval('require')",
  '(0,eval)("require")',
  "(0,eval)('require')",
  '(0,eval)("quire".replace(/^/,"re"))',
  "(0,eval)('quire'.replace(/^/,'re'))",
  '(0,eval)("__dirname")',
  "(0,eval)('__dirname')",
];

function patchContents(s, fileLabel) {
  let out = s;
  const orig = s;

  for (const needle of NEEDLES) {
    if (out.includes(needle)) {
      out = out.split(needle).join("require");
      console.log("patch-opennext-eval: replaced literal needle in", fileLabel);
    }
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < 30) {
    guard++;
    changed = false;
    for (const [re, to] of REPLACEMENT_ROUNDS) {
      const next = out.replace(re, to);
      if (next !== out) {
        console.log("patch-opennext-eval: regex", String(re), "→", fileLabel);
        out = next;
        changed = true;
      }
    }
  }

  if (out.includes('eval("quire"') || out.includes("eval('quire'")) {
    const idx = out.includes('eval("quire"')
      ? out.indexOf('eval("quire"')
      : out.indexOf("eval('quire'");
    const frag = out.slice(idx, Math.min(out.length, idx + 140));
    console.warn("patch-opennext-eval: STILL has eval(quire) fragment in", fileLabel);
    console.warn("  fragment:", frag.replace(/\n/g, "\\n"));
  }

  return { next: out, changed: out !== orig };
}

/** sourceMappingURL の base64 等に偶然 eval( が含まれる誤検知を避ける */
function stripSourceMapNoise(s) {
  return s
    .replace(/\/\/# sourceMappingURL=[^\n]*/g, "")
    .replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, "");
}

/** コードとしての eval( / new Function( を検出（コメントはミニファイで消えている前提） */
function findForbiddenCodegen(s) {
  const hits = [];
  const evalRe = /\beval\s*\(/g;
  const nfRe = /\bnew\s+Function\s*\(/g;
  for (const re of [evalRe, nfRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const i = m.index;
      hits.push({
        kind: re === evalRe ? "eval" : "new Function",
        index: i,
        snippet: s.slice(i, Math.min(s.length, i + 160)).replace(/\s+/g, " "),
      });
    }
  }
  return hits;
}

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
  if (files.length === 0) {
    console.error("patch-opennext-eval: no files under", ROOT, "(run opennext build first)");
    process.exit(1);
  }

  let changedFiles = 0;
  let stillQuireOrRequire = false;

  for (const file of files) {
    let s = readFileSync(file, "utf8");
    const { next, changed } = patchContents(s, file);
    s = next;
    if (changed) {
      writeFileSync(file, s, "utf8");
      changedFiles++;
      console.log("patched file:", file);
    }
    if (
      s.includes('eval("quire"') ||
      s.includes("eval('quire'") ||
      /eval\s*\(\s*["']require["']\s*\)/.test(s) ||
      /\(0\s*,\s*eval\)\s*\(\s*["']quire/.test(s)
    ) {
      stillQuireOrRequire = true;
    }
  }

  if (changedFiles === 0) {
    console.log(
      "patch-opennext-eval: no file content changes (patterns may already be clean or differ)",
    );
  }

  if (stillQuireOrRequire) {
    console.error(
      "patch-opennext-eval: FATAL: eval(quire|require) pattern still present after patch",
    );
    process.exit(1);
  }

  /** 任意の eval( / new Function( が残っていればデプロイしても EvalError になる */
  let fatal = false;
  for (const file of files) {
    const s = stripSourceMapNoise(readFileSync(file, "utf8"));
    const hits = findForbiddenCodegen(s);
    if (hits.length === 0) continue;
    fatal = true;
    console.error("patch-opennext-eval: FATAL: forbidden codegen in", file);
    for (const h of hits.slice(0, 5)) {
      console.error(`  [${h.kind}]`, h.snippet);
    }
  }
  if (fatal) {
    console.error(
      "patch-opennext-eval: fix patterns above or adjust dependencies; Workers disallow these calls.",
    );
    process.exit(1);
  }

  console.log("patch-opennext-eval: OK — no eval( / new Function( in bundle");
}

main();
