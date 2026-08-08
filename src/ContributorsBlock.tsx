import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { TOKEN_SYMBOL, shortAddr } from "./config";
import {
  fetchContributors,
  invalidateContributorCache,
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
  /** Bump after a successful pledge/donate to allow refresh */
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<ContributorRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  /** false until user clicks — no auto RPC on every page view */
  const [opened, setOpened] = useState(false);

  const title =
    kind === "charity" ? "義援した仲間" : "加勢した仲間";

  const load = useCallback(
    async (bypassCache = false) => {
      setLoading(true);
      setErr(null);
      try {
        if (bypassCache) {
          invalidateContributorCache(campaign, kind);
        }
        const list = await fetchContributors(campaign, kind, {
          bypassCache,
        });
        setRows(list);
      } catch (e) {
        setErr(
          e instanceof Error ? e.message : "仲間リストの取得に失敗しました。"
        );
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [campaign, kind]
  );

  // After own 加勢 success: if already opened, soft-refetch once
  useEffect(() => {
    if (!opened || refreshKey === 0) return;
    void load(true);
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpen = () => {
    setOpened(true);
    void load(false);
  };

  const shown =
    rows && (expanded ? rows : rows.slice(0, PREVIEW));
  const more = rows && rows.length > PREVIEW ? rows.length - PREVIEW : 0;
  const expandedAll =
    opened && !loading && !!rows && rows.length > PREVIEW && expanded;

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

      {!opened && !loading && (
        <div className="contributors-cta">
          <p className="contributors-empty">
            誰が加勢したかをオンチェーン履歴から表示します（ボタンを押したときだけ読み込み）。
          </p>
          <button type="button" className="btn ghost" onClick={onOpen}>
            仲間を表示
          </button>
        </div>
      )}

      {opened && err && (
        <div className="contributors-cta">
          <p className="hint contributors-err">{err}</p>
          <button
            type="button"
            className="btn ghost"
            disabled={loading}
            onClick={() => void load(true)}
          >
            再試行
          </button>
        </div>
      )}

      {opened && !loading && rows && rows.length === 0 && !err && (
        <p className="contributors-empty">
          まだ{kind === "charity" ? "義援" : "加勢"}
          はありません。最初の仲間になりませんか。
        </p>
      )}

      {opened && shown && shown.length > 0 && (
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

      {/* Expand / collapse — only when there is more to show */}
      {opened && !loading && more > 0 && !expanded && (
        <button
          type="button"
          className="contributors-more primary-more"
          onClick={() => setExpanded(true)}
        >
          さらに表示（残り {more} 人）
        </button>
      )}
      {opened && !loading && expandedAll && (
        <button
          type="button"
          className="contributors-more"
          onClick={() => setExpanded(false)}
        >
          折りたたむ
        </button>
      )}

      {/* End state: no more rows to reveal in the list UI */}
      {opened &&
        !loading &&
        rows &&
        rows.length > 0 &&
        (more === 0 || expanded) && (
          <p className="contributors-end">
            すべての履歴を表示しています（{rows.length}人）
          </p>
        )}

      {/* Explicit refresh — secondary, not confused with "more" */}
      {opened && !loading && rows && rows.length > 0 && !err && (
        <button
          type="button"
          className="contributors-refresh"
          disabled={loading}
          onClick={() => void load(true)}
          title="チェーンから最新の加勢を再取得"
        >
          最新に更新
        </button>
      )}
    </div>
  );
}
