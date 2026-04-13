/**
 * Cloudflare Workers は eval を禁止。OpenNext の handler に含まれる
 * esbuild の `eval("quire".replace(/^/,"re"))` を `require` に置き換える。
 * @see https://github.com/opennextjs/opennextjs-cloudflare/issues/1155
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".open-next";

/** sed と同じ: s/eval("quire".replace(\/^\/,"re"))/require/g */
function patchContents(s, fileLabel) {
  const orig = s;

  const needles = [
    // 公式 issue / sed と同一
    'eval("quire".replace(/^/,"re"))',
    "eval('quire'.replace(/^/,'re'))",
    // カンマ周りに空白
    'eval("quire".replace(/^/, "re"))',
    'eval("quire".replace( /^/ ,"re"))',
  ];

  for (const n of needles) {
    if (s.includes(n)) {
      s = s.split(n).join("require");
      console.log("patch-opennext-eval: replaced literal in", fileLabel);
    }
  }

  // 2) 正規表現（minify で改行・空白が潰れた場合）
  const res = [
    [/eval\("quire"\.replace\(\/\^\/,\s*"re"\)\)/g, "require"],
    [/eval\('quire'\.replace\(\/\^\/,\s*'re'\)\)/g, "require"],
    [/eval\(\s*"quire"\s*\.\s*replace\s*\(\s*\/\^\/\s*,\s*"re"\s*\)\s*\)/g, "require"],
  ];
  for (const [re, to] of res) {
    const next = s.replace(re, to);
    if (next !== s) {
      console.log("patch-opennext-eval: regex", re, "→", fileLabel);
      s = next;
    }
  }

  // 3) まだ残っていればログ用に断片を出す（CI で原因特定用）
  if (s.includes('eval("quire"') || s.includes("eval('quire'")) {
    const idx = s.indexOf('eval("quire"');
    const idx2 = s.indexOf("eval('quire'");
    const i = idx >= 0 ? idx : idx2;
    if (i >= 0) {
      const frag = s.slice(i, Math.min(s.length, i + 120));
      console.warn("patch-opennext-eval: STILL has eval(quire) in", fileLabel);
      console.warn("  fragment:", frag.replace(/\n/g, "\\n"));
    }
  }

  return { next: s, changed: s !== orig };
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
  let changedFiles = 0;
  let stillBad = false;

  for (const file of files) {
    let s = readFileSync(file, "utf8");
    const { next, changed } = patchContents(s, file);
    s = next;
    if (changed) {
      writeFileSync(file, s, "utf8");
      changedFiles++;
      console.log("patched file:", file);
    }
    if (s.includes('eval("quire"') || s.includes("eval('quire'")) {
      stillBad = true;
    }
  }

  if (changedFiles === 0) {
    console.log(
      "patch-opennext-eval: no substitutions applied (check bundle for new eval patterns)",
    );
  }

  if (stillBad) {
    console.error(
      "patch-opennext-eval: FATAL: eval(quire) remains after patch — see fragments above",
    );
    process.exit(1);
  }
}

main();
