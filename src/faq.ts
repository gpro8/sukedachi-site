/** 助太刀 FAQ — static copy */

export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "助太刀（Sukedachi）とは？",
    a: "仲間の「旗揚げ」に tJPYC（テスト時）／JPYC（本線）で加勢する場です。皆済（目標達成で受け取り・未達は返金）と義援（期間内 All-in）の二種類があります。BushiDAO の思想に沿い、SaaS に頼らない永続メタデータを目指しています。",
  },
  {
    q: "皆済の旗と義援の旗の違いは？",
    a: "皆済（AoN）は目標金額に届かなければ支援者へ返金されます。義援は寄付型で返金はなく、締切後に受取人が引き出します。",
  },
  {
    q: "ガス代は誰が払う？",
    a: "旗を揚げる人・加勢する人・精算する人が、それぞれの操作のガス（Amoy では POL）を払います。運営が預かって代行する仕組みはありません。",
  },
  {
    q: "下書きはどこに保存される？",
    a: "このブラウザの localStorage です。ウォレットやサーバーには送られません。端末やブラウザを変えると見えません。提出前に内容を確認してください。",
  },
  {
    q: "プロフィールのアイコンが高いのはなぜ？",
    a: "アイコンをオンチェーンに直接書くため、データ量に応じてガスがかかります。名前のみなら安く、画像は小さく圧縮されます。Polygon 本線では通常 Amoy より安く感じることが多いです。",
  },
  {
    q: "完了した旗はどこで見る？",
    a: "一覧上部の「募集中 / 完了」で切り替えられます。完了は締切後または精算済みの旗です。",
  },
  {
    q: "加勢（コントリビューション）履歴は？",
    a: "マイページに、接続ウォレットが皆済で誓約した旗と金額を表示します。義援の個別履歴は今後イベント索引で拡充予定です。",
  },
  {
    q: "X（旧 Twitter）で共有するには？",
    a: "各旗の詳細ページにある「Xで知らせる」を押すと、投稿文案付きで X が開きます。プロフィールに X ユーザー名を保存すると旗手チップからプロフィールへリンクします。",
  },
  {
    q: "メインネットはいつ？",
    a: "Amoy での検証とコミュニティフィードバックの後、公式 JPYC と Safe 運用で Polygon 本線へ進む予定です。",
  },
];

export function xIntentUrl(text: string, url?: string): string {
  const u = new URL("https://twitter.com/intent/tweet");
  u.searchParams.set("text", text);
  if (url) u.searchParams.set("url", url);
  return u.toString();
}

export function normalizeXHandle(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("@")) s = s.slice(1);
  s = s.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
  s = s.split(/[/?#]/)[0] || "";
  return s.slice(0, 32);
}

export function xProfileUrl(handle: string): string {
  const h = normalizeXHandle(handle);
  if (!h) return "";
  return `https://x.com/${encodeURIComponent(h)}`;
}
