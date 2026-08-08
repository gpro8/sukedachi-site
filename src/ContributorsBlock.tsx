import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { TOKEN_SYMBOL, shortAddr } from "./config";
import {
  fetchContributors,
  type ContributorRow,
} from "./contributors";
import {
  avatarSrc,
  hasDisplayProfile,
  profileDisplayName,
} from "./profile";
import {
  formatXHandleDisplay,
  xProfileUrl,
} from "./faq";

const PREVIEW = 5;

export function ContributorsBlock({
  campaign,
  kind,
  refreshKey = 0,
}: {
  campaign: Address;
  kind: "crowdfund" | "charity" | "unknown";
  /** Bump after a successful pledge/donate to refetch */
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<ContributorRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchContributors(campaign, kind)
      .then((list) => {
        if (!cancelled) {
          setRows(list);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "読込に失敗しました");
          setRows([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaign, kind, refreshKey]);

  const title =
    kind === "charity" ? "義援した仲間" : "加勢した仲間";
  const shown =
    rows && (expanded ? rows : rows.slice(0, PREVIEW));
  const more = rows && rows.length > PREVIEW ? rows.length - PREVIEW : 0;

  return (
    <div className="contributors">
      <div className="contributors-head">
        <h3 className="contributors-title">
          {title}
          {rows && rows.length > 0 ? (
            <span className="contributors-count"> · {rows.length}</span>
          ) : null}
        </h3>
        {loading && <span className="contributors-status">読込中…</span>}
      </div>

      {err && <p className="hint contributors-err">{err}</p>}

      {!loading && rows && rows.length === 0 && !err && (
        <p className="contributors-empty">
          まだ{kind === "charity" ? "義援" : "加勢"}はありません。最初の仲間になりませんか。
        </p>
      )}

      {shown && shown.length > 0 && (
        <ul className="contributors-list">
          {shown.map((r) => {
            const show = hasDisplayProfile(r.profile);
            const name = profileDisplayName(r.profile, r.address);
            const xUrl = r.profile.xHandle
              ? xProfileUrl(r.profile.xHandle)
              : "";
            const xLabel = r.profile.xHandle
              ? formatXHandleDisplay(r.profile.xHandle)
              : "";
            return (
              <li key={r.address.toLowerCase()} className="contributor-row">
                <img
                  src={avatarSrc(r.profile, r.address)}
                  alt=""
                  className="contributor-av"
                />
                <div className="contributor-who">
                  <span className="contributor-name" title={r.address}>
                    {show ? name : shortAddr(r.address)}
                  </span>
                  {xUrl ? (
                    <a
                      className="x-link"
                      href={xUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={xLabel || "X"}
                    >
                      𝕏{xLabel ? ` ${xLabel}` : ""}
                    </a>
                  ) : null}
                </div>
                <span className="contributor-amt">
                  {formatUnits(r.total, 18)} {TOKEN_SYMBOL}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && more > 0 && (
        <button
          type="button"
          className="contributors-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "折りたたむ" : `すべて表示（+${more}）`}
        </button>
      )}
    </div>
  );
}
