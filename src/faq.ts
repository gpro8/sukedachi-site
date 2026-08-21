/** 助太刀 FAQ — static copy (Polygon · JPYC live) */

export type FaqItem = { q: string; a: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "助太刀（Sukedachi）とは？",
    a: "仲間の「旗揚げ」に JPYC で加勢する場です。皆済（目標達成で受け取り・未達は返金）と義援（期間内 All-in）の二種類があります。BushiDAO の思想に沿い、SaaS に頼らない永続メタデータを目指しています。",
  },
  {
    q: "皆済の旗と義援の旗の違いは？",
    a: "皆済（AoN）は目標金額に届かなければ支援者へ返金されます。義援は寄付型で返金はなく、締切後に受取人が引き出します。",
  },
  {
    q: "ガス代は誰が払う？",
    a: "旗を揚げる人・加勢する人・精算する人が、それぞれの操作のガス（Polygon の POL）を払います。運営が預かって代行する仕組みはありません。",
  },
  {
    q: "下書きはどこに保存される？",
    a: "このブラウザの localStorage です。ウォレットやサーバーには送られません。端末やブラウザを変えると見えません。提出前に内容を確認してください。",
  },
  {
    q: "プロフィールのアイコンが高いのはなぜ？",
    a: "アイコンをオンチェーンに直接書くため、データ量に応じてガスがかかります。名前のみなら安く、画像は小さく圧縮されます。",
  },
  {
    q: "完了した旗はどこで見る？",
    a: "一覧上部の「募集中 / 完了」で切り替えられます。完了は締切後または精算済みの旗です。",
  },
  {
    q: "加勢（コントリビューション）履歴は？",
    a: "マイページの「加勢・義援の記録」に、接続ウォレットが皆済で誓約した額と義援した額を表示します。",
  },
  {
    q: "X（旧 Twitter）で共有するには？",
    a: "各旗の詳細の「リンクをコピー」で Discord 用の共有文、「Xで知らせる」で投稿文案付き共有ができます。URL の ?c=0x… がその旗への直リンクです。プロフィールに X 名を保存すると旗手チップからリンクします。",
  },
  {
    q: "どのネットワーク・トークン？",
    a: "Polygon 上で公式 JPYC を使います。ウォレットを Polygon に接続し、JPYC とガス用の POL をご用意ください。",
  },
];

export function xIntentUrl(text: string, url?: string): string {
  const u = new URL("https://twitter.com/intent/tweet");
  u.searchParams.set("text", text);
  if (url) u.searchParams.set("url", url);
  return u.toString();
}

export function siteBaseUrl(): string {
  if (typeof window === "undefined") {
    return "https://gpro8.github.io/sukedachi-site/";
  }
  const path = window.location.pathname.replace(/index\.html$/i, "");
  const base = path.endsWith("/") ? path : `${path}/`;
  return `${window.location.origin}${base}`;
}

/** Deep link to a campaign detail (site SPA). */
export function campaignDeepLink(campaign: string): string {
  const base = siteBaseUrl();
  const u = new URL(base.endsWith("/") ? base : `${base}/`);
  u.searchParams.set("c", campaign);
  return u.toString();
}

/**
 * Public share URL for X / Discord unfurl.
 * Worker returns static OG HTML (crawlers) + redirect to site (humans).
 * Avoids GH Pages SPA + og:url root mismatch that drops X cards on ?c= links.
 */
export const SHARE_OG_BASE =
  "https://sukedachi-polygon-rpc.bushidao.workers.dev/share";

export function campaignShareLink(campaign: string): string {
  const u = new URL(SHARE_OG_BASE);
  u.searchParams.set("c", campaign);
  return u.toString();
}

export function parseCampaignParam(search = "", hash = ""): string | null {
  try {
    const q = new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search
    );
    const fromQ = q.get("c") || q.get("campaign");
    if (fromQ && /^0x[a-fA-F0-9]{40}$/.test(fromQ)) return fromQ;
    const m = hash.match(/0x[a-fA-F0-9]{40}/);
    if (m) return m[0];
    const h = hash.startsWith("#") ? hash.slice(1) : hash;
    if (h.includes("=")) {
      const hq = new URLSearchParams(h);
      const fromH = hq.get("c");
      if (fromH && /^0x[a-fA-F0-9]{40}$/.test(fromH)) return fromH;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function formatJpDeadline(unixSec: number): string {
  if (!unixSec) return "—";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(unixSec * 1000));
  } catch {
    return new Date(unixSec * 1000).toISOString();
  }
}

export function clipShareReturn(raw: string, max = 42): string {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const chars = [...s];
  if (chars.length <= max) return s;
  return `${chars.slice(0, max).join("")}…`;
}

export function buildShareText(opts: {
  title: string;
  kindLabel: string;
  raised: string;
  goal: string;
  deadlineLabel: string;
  url: string;
  returnText?: string;
}): string {
  const goalBit =
    opts.goal && opts.goal !== "0"
      ? `${opts.raised} / ${opts.goal} JPYC`
      : `${opts.raised} JPYC`;
  const ret = clipShareReturn(opts.returnText || "");
  const lines = [
    `【助太刀】${opts.title}`,
    `${opts.kindLabel} · ${goalBit}`,
    `締切 ${opts.deadlineLabel}`,
  ];
  if (ret) lines.push(`恩返し ${ret}`);
  lines.push("仲間の加勢を募集中 #助太刀 #BushiDAO", opts.url);
  return lines.join("\n");
}

export function normalizeXHandle(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "");
  s = s.split(/[/?#]/)[0] || "";
  s = s.replace(/^[＠@]+/u, "");
  s = s.replace(/[＠@]/gu, "");
  s = s.replace(/[^\w]/g, "");
  return s.slice(0, 15);
}

export function xProfileUrl(handle: string): string {
  const h = normalizeXHandle(handle);
  if (!h) return "";
  return `https://x.com/${h}`;
}

export function formatXHandleDisplay(handle: string): string {
  const h = normalizeXHandle(handle);
  return h ? `@${h}` : "";
}
