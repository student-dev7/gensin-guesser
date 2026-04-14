/**
 * Cloudflare 切り分け用: デプロイ経路・アカウントが生きているかだけ確認する。
 * 本番 OpenNext とは別 Worker（wrangler.smoke.jsonc）でデプロイする。
 *
 * - これで OK が見える → ルート/トークン/デプロイは概ね正常。アプリバンドル側を疑う。
 * - これでも 500 → Worker 名/ルート/アカウント/デプロイ設定を疑う。
 */
export default {
  async fetch() {
    return new Response("<h1>OK</h1>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
