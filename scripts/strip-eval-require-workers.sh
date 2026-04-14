#!/usr/bin/env bash
# Cloudflare Workers では eval が禁止。OpenNext のバンドルに残る CJS 互換を除去する。
# issue #1155 の sed と OpenNext の fixRequire（eval("require")）を両方適用。
set -euo pipefail
ROOT="${1:-.open-next}"
if [[ ! -d "$ROOT" ]]; then
  echo "strip-eval-require-workers: missing $ROOT"
  exit 1
fi

while IFS= read -r -d '' f; do
  # upstream fixRequire と同等
  perl -i -pe 's/eval\("require"\)/require/g' "$f"
  # ncc / esbuild（issue #1155 の sed と同じ）
  perl -i -pe 's/eval\("quire"\.replace\(\/\^\/,"re"\)\)/require/g' "$f"
  # シングルクォート版（\x27 = '）
  perl -i -pe 's/eval\(\x27quire\x27\.replace\(\/\^\/,\x27re\x27\)\)/require/g' "$f"
done < <(find "$ROOT" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print0)

echo "strip-eval-require-workers: done"

if grep -rEq "eval\(['\"]quire" "$ROOT" 2>/dev/null; then
  echo "::error::eval(quire) pattern still in bundle"
  grep -rEn "eval\(['\"]quire" "$ROOT" 2>/dev/null | head -40 || true
  exit 1
fi
if grep -rFq 'eval("require")' "$ROOT" 2>/dev/null; then
  echo "::error::eval(\"require\") still in bundle"
  grep -rFn 'eval("require")' "$ROOT" | head -20
  exit 1
fi
