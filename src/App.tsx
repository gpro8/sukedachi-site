import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { formatUnits, parseUnits, decodeEventLog, type Address, type Log } from "viem";
import {
  CHAIN,
  CHARITY_ABI,
  CROWDFUND_ABI,
  ERC20_ABI,
  EXPLORER,
  FACTORY_ABI,
  FACTORY_ADDRESS,
  JPYC_ADDRESS,
  PROFILE_ABI,
  PROFILE_ADDRESS,
  TOKEN_SYMBOL,
  MIN_GOAL_WHOLE,
  formatTokenAmount,
  arweaveToHttp,
  shortAddr,
} from "./config";
import {
  buildMetadataDataUri,
  parseMetadataUri,
  validateCreateForm,
  TITLE_MAX,
  DESC_MAX,
  RETURN_MAX,
  type CampaignMeta,
} from "./metadata";
import { SafeImage } from "./SafeImage";
import { buildCoverDataUri } from "./cover";
import { prepareImageFile, friendlyTxError, MAX_PFP_CHARS, PFP_MAX_EDGE } from "./imagePrep";
import {
  avatarSrc,
  emptyProfile,
  hasDisplayProfile,
  profileDisplayName,
  type UserProfile,
} from "./profile";
import { clearDraft, fmtDraftTime, loadDraft, saveDraft } from "./drafts";
import {
  FAQ_ITEMS,
  buildShareText,
  campaignDeepLink,
  campaignShareLink,
  formatJpDeadline,
  formatXHandleDisplay,
  normalizeXHandle,
  parseCampaignParam,
  siteBaseUrl,
  xIntentUrl,
  xProfileUrl,
} from "./faq";
import { showToast } from "./Toast";
import { ContributorsBlock } from "./ContributorsBlock";
import {
  IconBook,
  IconContract,
  IconList,
  IconMoon,
  IconNobori,
  IconRaise,
  IconScroll,
  IconSun,
  IconUser,
  IconWallet,
} from "./Icons";
import { initTheme, toggleTheme, type ThemeMode } from "./theme";

type Kind = "crowdfund" | "charity" | "unknown";

type Meta = CampaignMeta;

/** Payload after a successful 旗揚げ — drives post-create share panel */
type CreateSuccessInfo = {
  address: Address | null;
  kind: "crowdfund" | "charity";
  title: string;
  goalWei: bigint;
  deadlineUnix: number;
};

function parseCreatedFromLogs(
  logs: Log[]
): { address: Address; kind: "crowdfund" | "charity"; goalWei: bigint; deadlineUnix: number } | null {
  for (const log of logs) {
    try {
      const ev = decodeEventLog({
        abi: FACTORY_ABI,
        data: log.data,
        topics: log.topics,
      }) as {
        eventName: string;
        args: Record<string, unknown>;
      };
      if (ev.eventName === "CrowdfundCreated") {
        return {
          address: ev.args.campaign as Address,
          kind: "crowdfund",
          goalWei: (ev.args.goal as bigint) ?? 0n,
          deadlineUnix: Number(ev.args.deadline ?? 0n),
        };
      }
      if (ev.eventName === "CharityCreated") {
        return {
          address: ev.args.campaign as Address,
          kind: "charity",
          goalWei: (ev.args.softGoal as bigint) ?? 0n,
          deadlineUnix: Number(ev.args.deadline ?? 0n),
        };
      }
    } catch {
      /* not our event */
    }
  }
  return null;
}

/** On-chain enum alone is not enough — deadline may pass while state still Active */
function statusLabel(
  kind: Kind,
  state: number,
  deadline: number,
  now: number
): { text: string; tone: "open" | "closed" | "done" | "muted" } {
  const ended = deadline > 0 && now >= deadline;
  if (kind === "charity") {
    if (state === 0 && !ended) return { text: "受付中", tone: "open" };
    if (state === 0 && ended) return { text: "締切 · 精算待ち", tone: "closed" };
    if (state === 1) return { text: "確定 · 受取可", tone: "done" };
    if (state === 2) return { text: "支払済", tone: "done" };
    return { text: "—", tone: "muted" };
  }
  // crowdfund
  if (state === 0 && !ended) return { text: "旗揚げ中", tone: "open" };
  if (state === 0 && ended) return { text: "締切 · 精算待ち", tone: "closed" };
  if (state === 1) return { text: "達成", tone: "done" };
  if (state === 2) return { text: "未達 · 返金可", tone: "done" };
  if (state === 3) return { text: "支払済", tone: "done" };
  return { text: "—", tone: "muted" };
}

function isLotCompleted(
  kind: Kind,
  state: number,
  deadline: number,
  now: number
): boolean {
  const s = statusLabel(kind, state, deadline, now);
  return s.tone === "closed" || s.tone === "done";
}

function kindLabel(kind: Kind): string {
  if (kind === "charity") return "義援";
  if (kind === "crowdfund") return "皆済";
  return "助太刀";
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function fmtLeft(sec: number) {
  if (sec <= 0) return "終了";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}日 ${h}時間`;
  return `${h}時間 ${m}分`;
}

function resolveImageUrl(uri?: string): string {
  if (!uri) return "";
  // Already embeddable forever
  if (uri.startsWith("data:image/")) return uri;
  if (uri.startsWith("ipfs://")) {
    return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  }
  return arweaveToHttp(uri);
}

async function loadMeta(uri: string): Promise<Meta> {
  if (!uri) return {};
  // Free-forever path: data URI JSON (no pin service)
  const local = parseMetadataUri(uri);
  if (local) {
    return {
      ...local,
      image: local.image ? resolveImageUrl(local.image) : undefined,
    };
  }
  try {
    const res = await fetch(arweaveToHttp(uri));
    const t = await res.text();
    if (t.trimStart().startsWith("{")) {
      const j = JSON.parse(t) as Meta;
      const attrs = j.attributes;
      let returnText = j.returnText;
      if (!returnText && attrs) {
        const r = attrs.find(
          (a) => String(a.trait_type || "").toLowerCase() === "return"
        );
        if (r?.value != null) returnText = String(r.value);
      }
      return {
        ...j,
        returnText,
        image: j.image ? resolveImageUrl(j.image) : undefined,
      };
    }
  } catch {
    /* ignore */
  }
  return {};
}

function CreatorChip({
  address,
  profile,
  compact,
}: {
  address?: Address;
  profile?: UserProfile;
  compact?: boolean;
}) {
  if (!address) return null;
  const show = hasDisplayProfile(profile);
  const name = profileDisplayName(profile, address);
  const xUrl = profile?.xHandle ? xProfileUrl(profile.xHandle) : "";
  const xLabel = profile?.xHandle ? formatXHandleDisplay(profile.xHandle) : "";
  return (
    <span className={`creator-chip ${compact ? "compact" : ""}`} title={address}>
      <img src={avatarSrc(profile, address)} alt="" className="creator-av" />
      <span className="creator-name">{show ? name : shortAddr(address)}</span>
      {xUrl && (
        <a
          className="x-link"
          href={xUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={xLabel || "X"}
        >
          𝕏{!compact && xLabel ? ` ${xLabel}` : ""}
        </a>
      )}
    </span>
  );
}

function useProfile(address?: Address) {
  const { data, refetch } = useReadContract({
    address: PROFILE_ADDRESS,
    abi: PROFILE_ABI,
    functionName: "profileOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const profile: UserProfile = useMemo(() => {
    if (!data || !Array.isArray(data)) return emptyProfile();
    return {
      name: String(data[0] || ""),
      imageURI: String(data[1] || ""),
      xHandle: String(data[2] || ""),
    };
  }, [data]);
  return { profile, refetch };
}

function CampaignCard({
  address,
  kind,
  selected,
  onSelect,
}: {
  address: Address;
  kind: Kind;
  selected: boolean;
  onSelect: () => void;
}) {
  const abi = kind === "charity" ? CHARITY_ABI : CROWDFUND_ABI;
  const { data } = useReadContracts({
    contracts: [
      { address, abi, functionName: "metadataURI" },
      { address, abi, functionName: "totalRaised" },
      { address, abi, functionName: "deadline" },
      { address, abi, functionName: "state" },
      { address, abi, functionName: "creator" },
      ...(kind === "crowdfund"
        ? ([{ address, abi, functionName: "goal" }] as const)
        : ([{ address, abi, functionName: "softGoal" }] as const)),
    ],
    query: { refetchInterval: 12_000 },
  });

  const uri = (data?.[0]?.result as string) || "";
  const raised = (data?.[1]?.result as bigint) ?? 0n;
  const deadline = Number((data?.[2]?.result as bigint) ?? 0n);
  const state = Number((data?.[3]?.result as number) ?? 0);
  const creator = data?.[4]?.result as Address | undefined;
  const goalOrSoft = (data?.[5]?.result as bigint) ?? 0n;
  const { profile: creatorProfile } = useProfile(creator);
  const [meta, setMeta] = useState<Meta>({});
  const now = useNow();

  useEffect(() => {
    let c = false;
    loadMeta(uri).then((m) => {
      if (!c) setMeta(m);
    });
    return () => {
      c = true;
    };
  }, [uri]);

  const title =
    meta.name ||
    (kind === "charity" ? "義援の旗" : "旗揚げ");
  const label = kindLabel(kind);
  const status = statusLabel(kind, state, deadline, now);

  return (
    <button
      type="button"
      className={`card ${selected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="card-cover">
        <SafeImage
          src={meta.image}
          title={title}
          kind={kind}
          className=""
        />
        <div className="card-cover-badge">
          <span className={`pill ${kind}`}>{label}</span>
          <span className={`pill status-${status.tone}`}>{status.text}</span>
        </div>
      </div>
      <div className="card-body">
        <h3>{title}</h3>
        {creator && (
          <div className="card-creator">
            <CreatorChip address={creator} profile={creatorProfile} compact />
          </div>
        )}
        <div className="card-bar-wrap" aria-hidden>
          <div className="card-bar">
            <div
              className="card-bar-fill"
              style={{
                width: `${
                  goalOrSoft > 0n
                    ? Math.min(100, Number((raised * 10000n) / goalOrSoft) / 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
        <div className="card-stats">
          <span>
            {formatUnits(raised, 18)}
            <span className="muted">
              {" "}
              / {goalOrSoft > 0n ? formatUnits(goalOrSoft, 18) : "—"} {TOKEN_SYMBOL}
            </span>
          </span>
          <span className="muted">{fmtLeft(deadline - now)}</span>
        </div>
        <div className="card-addr">{shortAddr(address)}</div>
      </div>
    </button>
  );
}

function DetailPanel({
  address,
  kind,
  onBack,
}: {
  address: Address;
  kind: Kind;
  onBack: () => void;
}) {
  const { address: user, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const now = useNow();
  const abi = kind === "charity" ? CHARITY_ABI : CROWDFUND_ABI;

  const { data, refetch } = useReadContracts({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: [
      { address, abi, functionName: "metadataURI" },
      { address, abi, functionName: "totalRaised" },
      { address, abi, functionName: "deadline" },
      { address, abi, functionName: "state" },
      { address, abi, functionName: "beneficiary" },
      { address, abi, functionName: "creator" },
      { address, abi, functionName: "isLive" },
      ...(kind === "crowdfund"
        ? [
            { address, abi, functionName: "goal" },
            {
              address,
              abi,
              functionName: "pledged",
              args: user ? [user] : undefined,
            },
          ]
        : [{ address, abi, functionName: "softGoal" }]),
    ] as any,
    query: { refetchInterval: 8_000 },
  });

  const { data: bal } = useReadContract({
    address: JPYC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 10_000 },
  });

  const { data: allowance } = useReadContract({
    address: JPYC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: user ? [user, address] : undefined,
    query: { enabled: !!user, refetchInterval: 5_000 },
  });

  const uri = (data?.[0]?.result as string) || "";
  const raised = (data?.[1]?.result as bigint) ?? 0n;
  const deadline = Number((data?.[2]?.result as bigint) ?? 0n);
  const state = Number((data?.[3]?.result as number) ?? 0);
  const beneficiary = data?.[4]?.result as Address | undefined;
  const creator = data?.[5]?.result as Address | undefined;
  const live = Boolean(data?.[6]?.result);
  const goalOrSoft = (data?.[7]?.result as bigint) ?? 0n;
  const myPledge =
    kind === "crowdfund" ? ((data?.[8]?.result as bigint) ?? 0n) : 0n;
  const { profile: creatorProfile } = useProfile(creator);

  const [meta, setMeta] = useState<Meta>({});
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState<string | null>(null);
  const [contribKey, setContribKey] = useState(0);

  useEffect(() => {
    let c = false;
    loadMeta(uri).then((m) => {
      if (!c) setMeta(m);
    });
    return () => {
      c = true;
    };
  }, [uri]);

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (isSuccess) {
      setStatus("確認済み");
      refetch();
      setContribKey((k) => k + 1);
      reset();
    }
  }, [isSuccess, refetch, reset]);

  const ensure = useCallback(async () => {
    if (chainId !== CHAIN.id) {
      switchChain?.({ chainId: CHAIN.id });
      throw new Error("Polygon に切り替えてください");
    }
  }, [chainId, switchChain]);

  const amountWei = useMemo(() => {
    try {
      return parseUnits(amount || "0", 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const onApprove = async () => {
    try {
      setStatus(null);
      await ensure();
      writeContract({
        address: JPYC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [address, amountWei],
        chainId: CHAIN.id,
      } as any);
      setStatus("承認中…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "エラー");
    }
  };

  const onPledgeOrDonate = async () => {
    try {
      setStatus(null);
      await ensure();
      if (amountWei <= 0n) {
        setStatus("金額を入力してください");
        return;
      }
      writeContract({
        address,
        abi,
        functionName: kind === "charity" ? "donate" : "pledge",
        args: [amountWei],
        chainId: CHAIN.id,
      } as any);
      setStatus(kind === "charity" ? "義援送信中…" : "加勢送信中…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "エラー");
    }
  };

  const onFinalize = async () => {
    try {
      setStatus(null);
      await ensure();
      writeContract({
        address,
        abi,
        functionName: "finalize",
        chainId: CHAIN.id,
      } as any);
      setStatus("締め処理中…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "エラー");
    }
  };

  const onClaimFunds = async () => {
    try {
      setStatus(null);
      await ensure();
      writeContract({
        address,
        abi,
        functionName: "claimFunds",
        chainId: CHAIN.id,
      } as any);
      setStatus("受取中…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "エラー");
    }
  };

  const onClaimRefund = async () => {
    try {
      setStatus(null);
      await ensure();
      writeContract({
        address,
        abi: CROWDFUND_ABI,
        functionName: "claimRefund",
        chainId: CHAIN.id,
      } as any);
      setStatus("返金中…");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "エラー");
    }
  };

  const title = meta.name || shortAddr(address);
  const needApprove = amountWei > 0n && (allowance as bigint | undefined ?? 0n) < amountWei;
  const canFinalize = !live && state === 0 && now >= deadline;
  const cfSuccess = kind === "crowdfund" && state === 1;
  const cfFailed = kind === "crowdfund" && state === 2;
  const chFinalized = kind === "charity" && state === 1;
  const isBeneficiary =
    user && beneficiary && user.toLowerCase() === beneficiary.toLowerCase();

  const pct =
    goalOrSoft > 0n
      ? Math.min(100, Number((raised * 10000n) / goalOrSoft) / 100)
      : 0;

  const lotStatus = statusLabel(kind, state, deadline, now);

  return (
    <section className="detail">
      <button type="button" className="linkish" onClick={onBack}>
        ← 一覧
      </button>
      <div className="detail-head">
        <SafeImage
          src={meta.image}
          title={title}
          kind={kind}
          className="detail-cover"
        />
        <div className="card-tags" style={{ marginBottom: "0.35rem" }}>
          <span className={`pill ${kind}`}>{kindLabel(kind)}</span>
          <span className={`pill status-${lotStatus.tone}`}>{lotStatus.text}</span>
        </div>
        <h2>{title}</h2>
        {creator && (
          <div className="detail-creator">
            <span className="muted">旗手</span>{" "}
            <CreatorChip address={creator} profile={creatorProfile} />
          </div>
        )}
        <div className="share-row">
          <button
            type="button"
            className="btn ghost"
            onClick={async () => {
              const url = campaignShareLink(address);
              const text = buildShareText({
                title,
                kindLabel: kindLabel(kind),
                raised: formatUnits(raised, 18),
                goal: goalOrSoft > 0n ? formatUnits(goalOrSoft, 18) : "0",
                deadlineLabel: formatJpDeadline(deadline),
                url,
              });
              try {
                await navigator.clipboard.writeText(text);
                showToast("コピーしました — Discord / X に貼れます", "ok");
                setStatus(null);
              } catch {
                showToast("コピーに失敗 — 下の文を長押しで選択", "err");
                setStatus(text);
              }
            }}
          >
            リンクをコピー
          </button>
          <a
            className="btn ghost"
            href={xIntentUrl(
              buildShareText({
                title,
                kindLabel: kindLabel(kind),
                raised: formatUnits(raised, 18),
                goal: goalOrSoft > 0n ? formatUnits(goalOrSoft, 18) : "0",
                deadlineLabel: formatJpDeadline(deadline),
                url: campaignShareLink(address),
              })
            )}
            target="_blank"
            rel="noreferrer"
          >
            𝕏 で知らせる
          </a>
        </div>
        {meta.description && (
          <p className="desc">{meta.description}</p>
        )}
        {meta.returnText && (
          <div className="return-box">
            <div className="return-label">恩返し / 特典</div>
            <p>{meta.returnText}</p>
          </div>
        )}
      </div>

      <div className="bar-wrap">
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${pct}%`,
            }}
          />
        </div>
        <div className="bar-labels">
          <span>
            集まった義金 {formatUnits(raised, 18)} {TOKEN_SYMBOL}
            {kind === "crowdfund" && goalOrSoft > 0n && (
              <> / 目標 {formatUnits(goalOrSoft, 18)}</>
            )}
            {kind === "charity" && goalOrSoft > 0n && (
              <> / 希望 {formatUnits(goalOrSoft, 18)}{pct >= 100 ? " · 到達" : ""}</>
            )}
          </span>
          <span>
            {lotStatus.tone === "closed"
              ? "受付終了"
              : fmtLeft(deadline - now)}
          </span>
        </div>
      </div>

      <ContributorsBlock
        campaign={address}
        kind={kind === "unknown" ? "crowdfund" : kind}
        refreshKey={contribKey}
      />

      <dl className="meta-grid">
        <div>
          <dt>受取人</dt>
          <dd>{shortAddr(beneficiary)}</dd>
        </div>
        <div>
          <dt>状態</dt>
          <dd>
            <span className={`pill status-${lotStatus.tone}`}>{lotStatus.text}</span>
          </dd>
        </div>
        <div>
          <dt>賢契約</dt>
          <dd>
            <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
              {shortAddr(address)}
            </a>
          </dd>
        </div>
        {kind === "crowdfund" && myPledge > 0n && (
          <div>
            <dt>あなたの加勢</dt>
            <dd>{formatUnits(myPledge, 18)} {TOKEN_SYMBOL}</dd>
          </div>
        )}
      </dl>

      {kind === "crowdfund" && (
        <p className="hint">
          <strong>皆済（All-or-Nothing）</strong>
          ：目標未達なら期限後に<strong>全額返金</strong>できます。
        </p>
      )}
      {kind === "charity" && (
        <p className="hint">
          <strong>義援（All-in）</strong>
          ：寄付は<strong>返金不可</strong>。期限後に受取人が引き出します。
        </p>
      )}

      {live && isConnected && (
        <div className="action-box">
          <div className="bid-head">
            <span className="bid-label">
              {kind === "charity" ? `義援額 (${TOKEN_SYMBOL})` : `加勢額 (${TOKEN_SYMBOL})`}
            </span>
            <span className="bid-hint">
              残高 {bal != null ? formatUnits(bal as bigint, 18) : "—"}
            </span>
          </div>
          <div className="input-wrap">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="100"
            />
          </div>
          {needApprove ? (
            <button
              className="btn primary wide"
              disabled={isPending || confirming}
              onClick={onApprove}
            >
              {TOKEN_SYMBOL} を承認
            </button>
          ) : (
            <button
              className="btn primary wide"
              disabled={isPending || confirming}
              onClick={onPledgeOrDonate}
            >
              {kind === "charity" ? "義援する" : "加勢する"}
            </button>
          )}
        </div>
      )}

      {canFinalize && (
        <button
          className="btn accent wide"
          disabled={!isConnected || isPending}
          onClick={onFinalize}
        >
          締め処理（finalize）
        </button>
      )}

      {cfSuccess && isBeneficiary && (
        <button
          className="btn accent wide"
          disabled={isPending}
          onClick={onClaimFunds}
        >
          資金を受け取る
        </button>
      )}

      {cfFailed && myPledge > 0n && (
        <button
          className="btn ghost wide"
          disabled={isPending}
          onClick={onClaimRefund}
        >
          返金を受け取る ({formatUnits(myPledge, 18)} {TOKEN_SYMBOL})
        </button>
      )}

      {chFinalized && isBeneficiary && (
        <button
          className="btn accent wide"
          disabled={isPending}
          onClick={onClaimFunds}
        >
          寄付を受け取る
        </button>
      )}

      {!isConnected && live && (
        <p className="hint">加勢・義援にはウォレット接続が必要です。</p>
      )}

      {status && <p className="status">{status}</p>}
      {txHash && (
        <p className="status">
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            Tx {txHash.slice(0, 12)}…
          </a>
        </p>
      )}
    </section>
  );
}

function MyPagePanel({
  onOpenCampaign,
}: {
  onOpenCampaign: (addr: Address, kind: Kind) => void;
}) {
  const { address: user, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const { profile, refetch } = useProfile(user);
  const [name, setName] = useState("");
  const [imageURI, setImageURI] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "err" | "info">("info");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile.name);
    setImageURI(profile.imageURI);
    setXHandle(profile.xHandle);
  }, [profile.name, profile.imageURI, profile.xHandle]);

  const { data: myCamps, refetch: refetchMine } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getCampaignsByCreator",
    args: user ? [user] : undefined,
    query: { enabled: !!user, refetchInterval: 12_000 },
  });

  const mine = (myCamps as Address[] | undefined) || [];

  // Contribution history: pledged amounts on all crowdfund flags
  const { data: allCount } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "campaignCount",
    query: { enabled: !!user },
  });
  const allN = Number(allCount ?? 0n);
  const allIdx = useMemo(
    () => Array.from({ length: allN }, (_, i) => i),
    [allN]
  );
  const { data: allAddrRes } = useReadContracts({
    contracts: allIdx.map((i) => ({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "campaigns",
      args: [BigInt(i)],
    })) as any,
    query: { enabled: !!user && allN > 0 },
  });
  const allAddrs = useMemo(() => {
    if (!allAddrRes) return [] as Address[];
    return allAddrRes
      .map((r) => r.result as Address | undefined)
      .filter((a): a is Address => !!a);
  }, [allAddrRes]);

  const { data: pledgeProbe } = useReadContracts({
    contracts: allAddrs.flatMap((a) => [
      {
        address: a,
        abi: CROWDFUND_ABI,
        functionName: "pledged",
        args: user ? [user] : undefined,
      },
      { address: a, abi: CROWDFUND_ABI, functionName: "metadataURI" },
      { address: a, abi: CROWDFUND_ABI, functionName: "goal" },
    ]) as any,
    query: { enabled: !!user && allAddrs.length > 0 },
  });

  const contributions = useMemo(() => {
    if (!pledgeProbe || !user) return [] as { addr: Address; amount: bigint; uri: string }[];
    const out: { addr: Address; amount: bigint; uri: string }[] = [];
    for (let i = 0; i < allAddrs.length; i++) {
      const base = i * 3;
      const amtRes = pledgeProbe[base];
      const uriRes = pledgeProbe[base + 1];
      const goalRes = pledgeProbe[base + 2];
      if (goalRes?.status !== "success") continue; // not crowdfund
      const amount = (amtRes?.result as bigint) ?? 0n;
      if (amount <= 0n) continue;
      out.push({
        addr: allAddrs[i],
        amount,
        uri: String(uriRes?.result || ""),
      });
    }
    return out.reverse();
  }, [pledgeProbe, allAddrs, user]);

  const { data: kindProbes } = useReadContracts({
    contracts: mine.flatMap((a) => [
      { address: a, abi: CROWDFUND_ABI, functionName: "goal" },
      { address: a, abi: CHARITY_ABI, functionName: "softGoal" },
    ]) as any,
    query: { enabled: mine.length > 0 },
  });

  const kinds: Kind[] = useMemo(() => {
    if (!kindProbes) return mine.map(() => "unknown" as Kind);
    return mine.map((_, i) => {
      if (kindProbes[i * 2]?.status === "success") return "crowdfund";
      if (kindProbes[i * 2 + 1]?.status === "success") return "charity";
      return "unknown";
    });
  }, [mine, kindProbes]);

  const { writeContractAsync } = useWriteContract();

  const imageBytesHint = useMemo(() => {
    if (!imageURI) return null;
    const chars = imageURI.length;
    const kb = Math.round((chars * 3) / 4 / 1024);
    return { chars, kb };
  }, [imageURI]);

  const onSaveProfile = async () => {
    try {
      setMsg(null);
      setBusy(true);
      if (!isConnected || !user) {
        setMsgTone("err");
        setMsg("ウォレットを接続してください");
        return;
      }
      if (chainId !== CHAIN.id) {
        switchChain?.({ chainId: CHAIN.id });
        setMsgTone("info");
        setMsg("Polygon に切替後もう一度");
        return;
      }
      const n = name.trim();
      if (n.length > 32) {
        setMsgTone("err");
        setMsg("表示名は32文字以内");
        return;
      }
      // Hard client cap — large data URIs dominate gas
      if (imageURI.length > MAX_PFP_CHARS + 200) {
        setMsgTone("err");
        setMsg(
          "アイコンが大きすぎます。画像を選び直すかクリアしてください（ガス節約のため小さく圧縮します）"
        );
        return;
      }
      const x = normalizeXHandle(xHandle);
      setMsgTone("info");
      setMsg(
        imageURI
          ? "プロフィール保存中…（画像あり · データ量に応じてガスがかかります）"
          : "プロフィール保存中…（名前/X · ガス控えめ）"
      );
      const hash = await writeContractAsync({
        address: PROFILE_ADDRESS,
        abi: PROFILE_ABI,
        functionName: "setProfile",
        args: [n, imageURI, x],
        chainId: CHAIN.id,
      } as any);
      setMsgTone("ok");
      setMsg(`保存しました ${String(hash).slice(0, 10)}…`);
      refetch();
    } catch (e) {
      setMsgTone("err");
      setMsg(friendlyTxError(e));
    } finally {
      setBusy(false);
    }
  };

  const onPickPfp = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    const prep = await prepareImageFile(file, {
      maxChars: MAX_PFP_CHARS,
      maxEdge: PFP_MAX_EDGE,
      minEdge: 48,
    });
    setBusy(false);
    if (!prep.ok) {
      setMsgTone("err");
      setMsg(prep.error);
      return;
    }
    setImageURI(prep.dataUri);
    setMsgTone("info");
    setMsg(
      `アイコン圧縮完了 ~${prep.bytesApprox} bytes · 保存でオンチェーン反映（名前のみよりガス多め）`
    );
  };

  if (!isConnected) {
    return (
      <section className="mypage surface">
        <h2>マイページ</h2>
        <p className="hint">ウォレット接続でプロフィールと自分の旗揚げを表示します。</p>
      </section>
    );
  }

  return (
    <section className="mypage">
      <div className="surface mypage-profile">
        <div className="mypage-list-head">
          <h2>わが姿（プロフィール）</h2>
          <button
            type="button"
            className="btn ghost"
            onClick={() => disconnect()}
          >
            切断
          </button>
        </div>
        <p className="hint">
          表示名・𝕏・アイコンはオンチェーン（永続）。
          <strong>名前 / 𝕏 のみ</strong>なら安いです。アイコンは小さく圧縮。
        </p>
        <div className="mypage-preview">
          <CreatorChip address={user} profile={{ name, imageURI, xHandle }} />
          <span className="muted">{shortAddr(user)}</span>
        </div>
        <label className="field">
          <span>表示名（最大32字）</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            placeholder="例: 武者太郎"
          />
        </label>
        <label className="field">
          <span>𝕏 ユーザー名（任意 · @は不要・自動で除去）</span>
          <input
            value={xHandle}
            onChange={(e) => setXHandle(e.target.value)}
            onBlur={() => setXHandle(normalizeXHandle(xHandle))}
            maxLength={40}
            placeholder="bushi_dao（@なし）"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {normalizeXHandle(xHandle) && (
            <span className="hint gas-hint">
              保存後のリンク:{" "}
              <a
                href={xProfileUrl(xHandle)}
                target="_blank"
                rel="noreferrer"
              >
                {xProfileUrl(xHandle)}
              </a>
            </span>
          )}
        </label>
        <div className="field">
          <span>アイコン（任意 · 小さいほど安い）</span>
          <div className="image-actions">
            <label className="btn file-btn">
              {busy ? "処理中…" : "画像を選ぶ"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={busy}
                onChange={(e) => onPickPfp(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setImageURI("");
                setMsgTone("info");
                setMsg("アイコンを外しました（名前のみ保存が最安）");
              }}
            >
              クリア
            </button>
          </div>
          {(imageURI || user) && (
            <img
              src={avatarSrc({ name, imageURI, xHandle }, user)}
              alt=""
              className="pfp-preview"
            />
          )}
          {imageBytesHint && (
            <p className="hint gas-hint">
              オンチェーン画像 ~{imageBytesHint.kb} KB（{imageBytesHint.chars} chars）
              {imageBytesHint.chars > 2000
                ? " · ガス多め"
                : " · 比較的コンパクト"}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={onSaveProfile}
        >
          {busy ? "処理中…" : "プロフィールを保存"}
        </button>
        {msg && (
          <p className={`status short-status status-${msgTone}`}>{msg}</p>
        )}
      </div>

      <div className="surface mypage-list">
        <div className="mypage-list-head">
          <h2>掲げた旗</h2>
          <button type="button" className="linkish" onClick={() => refetchMine()}>
            更新
          </button>
        </div>
        {mine.length === 0 ? (
          <p className="hint">まだ旗がありません。「旗を揚げる」から作成できます。</p>
        ) : (
          <div className="grid">
            {mine
              .slice()
              .reverse()
              .map((a, idx) => {
                const i = mine.length - 1 - idx;
                const k = kinds[i] === "unknown" ? "crowdfund" : kinds[i];
                return (
                  <CampaignCard
                    key={a}
                    address={a}
                    kind={k}
                    selected={false}
                    onSelect={() => onOpenCampaign(a, k)}
                  />
                );
              })}
          </div>
        )}
      </div>

      <div className="surface mypage-list">
        <h2>加勢の記録</h2>
        <p className="hint">皆済の旗への誓約（{TOKEN_SYMBOL}）。義援の明細は今後拡充します。</p>
        {contributions.length === 0 ? (
          <p className="hint">まだ加勢の記録がありません。</p>
        ) : (
          <ul className="contrib-list">
            {contributions.map((c) => (
              <ContribRow
                key={c.addr}
                addr={c.addr}
                amount={c.amount}
                uri={c.uri}
                onOpen={() => onOpenCampaign(c.addr, "crowdfund")}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ContribRow({
  addr,
  amount,
  uri,
  onOpen,
}: {
  addr: Address;
  amount: bigint;
  uri: string;
  onOpen: () => void;
}) {
  const [title, setTitle] = useState(shortAddr(addr));
  useEffect(() => {
    let c = false;
    loadMeta(uri).then((m) => {
      if (!c && m.name) setTitle(m.name);
    });
    return () => {
      c = true;
    };
  }, [uri]);
  return (
    <li>
      <button type="button" className="contrib-row" onClick={onOpen}>
        <span className="contrib-title">{title}</span>
        <span className="contrib-amt">{formatUnits(amount, 18)} {TOKEN_SYMBOL}</span>
      </button>
    </li>
  );
}

function EmptyListPanel({
  mode,
  totalCampaigns,
  onCreate,
  onFaq,
  onShowDone,
}: {
  mode: "open" | "done";
  totalCampaigns: number;
  onCreate: () => void;
  onFaq: () => void;
  onShowDone: () => void;
}) {
  if (mode === "done") {
    return (
      <div className="empty-panel surface">
        <h3>完了した旗はまだありません</h3>
        <p className="hint">
          締切後や精算済みの旗がここに並びます。募集中の旗は「募集中」タブをご覧ください。
        </p>
      </div>
    );
  }

  if (totalCampaigns > 0) {
    return (
      <div className="empty-panel surface">
        <h3>いま募集中の旗はありません</h3>
        <p className="hint">
          締切済み・完了の旗は「完了・履歴」にあります。新しい旗が立つとここに表示されます。
        </p>
        <div className="empty-actions">
          <button type="button" className="btn ghost" onClick={onShowDone}>
            完了・履歴を見る
          </button>
          <button type="button" className="btn primary" onClick={onCreate}>
            旗を揚げる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="empty-panel surface">
      <h3>まだ旗が立っていません</h3>
      <p className="empty-lead">
        助太刀は<strong>本番稼働中</strong>です。最初の旗揚げを待っている状態です。
      </p>
      <div className="empty-cols">
        <div className="empty-col">
          <div className="empty-col-title">加勢したい人</div>
          <p>
            旗が出たらここに並びます。用意しておくもの：
            <br />
            <strong>Polygon</strong> · <strong>{TOKEN_SYMBOL}</strong> · ガス用{" "}
            <strong>POL</strong>
          </p>
        </div>
        <div className="empty-col">
          <div className="empty-col-title">旗を揚げたい人</div>
          <p>
            いまは<strong>アローリスト制</strong>
            です。許可ウォレットのみ作成できます。
          </p>
        </div>
      </div>
      <div className="empty-actions">
        <a className="btn ghost" href="./allowlist.html">
          AL申請
        </a>
        <button type="button" className="btn primary" onClick={onCreate}>
          旗を揚げる
        </button>
        <button type="button" className="btn ghost" onClick={onFaq}>
          心得
        </button>
      </div>
    </div>
  );
}

function JustCreatedSharePanel({
  info,
  onOpenDetail,
  onDismiss,
}: {
  info: CreateSuccessInfo;
  onOpenDetail: () => void;
  onDismiss: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const goalStr = formatUnits(info.goalWei, 18);
  const url = info.address ? campaignShareLink(info.address) : "";
  const shareText = buildShareText({
    title: info.title,
    kindLabel: kindLabel(info.kind),
    raised: "0",
    goal: info.goalWei > 0n ? goalStr : "0",
    deadlineLabel: formatJpDeadline(info.deadlineUnix),
    url: url || siteBaseFallback(),
  });

  return (
    <section className="just-created surface">
      <h2>旗が立ちました</h2>
      <p className="just-created-sub">
        <span className={`pill ${info.kind}`}>{kindLabel(info.kind)}</span>{" "}
        <strong>{info.title}</strong>
      </p>
      <dl className="meta-grid just-created-meta">
        <div>
          <dt>進捗</dt>
          <dd>
            0
            {info.goalWei > 0n ? ` / ${goalStr}` : ""} {TOKEN_SYMBOL}
          </dd>
        </div>
        <div>
          <dt>締切</dt>
          <dd>{formatJpDeadline(info.deadlineUnix)}</dd>
        </div>
        {info.address && (
          <div>
            <dt>直リンク</dt>
            <dd className="mono-break">{url}</dd>
          </div>
        )}
      </dl>
      {!info.address && (
        <p className="hint">アドレス確認中… しばらくして詳細から共有もできます。</p>
      )}
      <div className="share-row">
        <button
          type="button"
          className="btn primary"
          disabled={!info.address}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareText);
              showToast("コピーしました — Discord / X に貼れます", "ok");
              setStatus(null);
            } catch {
              showToast("コピーに失敗 — 文を長押しで選択", "err");
              setStatus(url || shareText);
            }
          }}
        >
          リンクをコピー
        </button>
        <a
          className={`btn ghost${info.address ? "" : " disabled-link"}`}
          href={info.address ? xIntentUrl(shareText) : undefined}
          target="_blank"
          rel="noreferrer"
          aria-disabled={!info.address}
          onClick={(e) => {
            if (!info.address) e.preventDefault();
          }}
        >
          𝕏 で知らせる
        </a>
      </div>
      <div className="empty-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={!info.address}
          onClick={onOpenDetail}
        >
          詳細を開く
        </button>
        <button type="button" className="btn ghost" onClick={onDismiss}>
          一覧へ
        </button>
      </div>
      <p className="hint">ヒント: Discord に貼ると仲間がそのまま加勢できます。</p>
      {status && <p className="status status-ok">{status}</p>}
    </section>
  );
}

function siteBaseFallback(): string {
  return "https://gpro8.github.io/sukedachi-site/";
}

function CreatePanel({
  onCreated,
}: {
  onCreated: (info: CreateSuccessInfo) => void;
}) {
  const { address: user, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [mode, setMode] = useState<"crowdfund" | "charity">("crowdfund");
  const [goal, setGoal] = useState(String(MIN_GOAL_WHOLE));
  const [softGoal, setSoftGoal] = useState("0");
  const [days, setDays] = useState("1");
  const [beneficiary, setBeneficiary] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [returnText, setReturnText] = useState("");
  /** Final image for metadata: data URI (upload/cover) or https */
  const [imageField, setImageField] = useState("");
  const [imageMode, setImageMode] = useState<"auto" | "file" | "url">("auto");
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uriOverride, setUriOverride] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  /** Snapshot at submit so success handler has stable title/kind/goal */
  const pendingSnap = useRef<{
    kind: "crowdfund" | "charity";
    title: string;
    goalWei: bigint;
    deadlineUnix: number;
  } | null>(null);

  // Restore draft once
  useEffect(() => {
    const d = loadDraft();
    if (!d) return;
    setMode(d.mode);
    setGoal(d.goal);
    setSoftGoal(d.softGoal);
    setDays(d.days);
    if (d.beneficiary) setBeneficiary(d.beneficiary);
    setTitle(d.title);
    setDescription(d.description);
    setReturnText(d.returnText);
    setImageField(d.imageField);
    setImageMode(d.imageMode);
    setUriOverride(d.uriOverride || "");
    setDraftNote(`下書きを復元（${fmtDraftTime(d.savedAt)} JST 頃）`);
  }, []);

  useEffect(() => {
    if (user && !beneficiary) setBeneficiary(user);
  }, [user, beneficiary]);

  const previewSrc = useMemo(() => {
    if (imageField) return imageField;
    return buildCoverDataUri({
      title: title || "旗揚げ",
      kind: mode === "charity" ? "charity" : "crowdfund",
    });
  }, [imageField, title, mode]);

  const { data: minGoal } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "minGoal",
  });

  const { data: createOpen } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "createOpen",
  });

  const { data: isAllowed } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "isAllowedCreator",
    args: user ? [user] : undefined,
    query: { enabled: !!user },
  });

  const canCreateFlag =
    createOpen === true || isAllowed === true;

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const {
    data: receipt,
    isSuccess,
    isLoading,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!isSuccess || !receipt) return;
    const snap = pendingSnap.current;
    const parsed = parseCreatedFromLogs(receipt.logs as Log[]);
    const info: CreateSuccessInfo = {
      address: parsed?.address ?? null,
      kind: parsed?.kind ?? snap?.kind ?? "crowdfund",
      title: snap?.title || "旗揚げ",
      goalWei: parsed?.goalWei ?? snap?.goalWei ?? 0n,
      deadlineUnix:
        parsed?.deadlineUnix ||
        snap?.deadlineUnix ||
        Math.floor(Date.now() / 1000),
    };
    setMsg("作成完了");
    clearDraft();
    setDraftNote(null);
    setConfirmOpen(false);
    pendingSnap.current = null;
    onCreated(info);
    reset();
  }, [isSuccess, receipt, onCreated, reset]);

  const draftPayload = () => ({
    mode,
    goal,
    softGoal,
    days,
    beneficiary,
    title,
    description,
    returnText,
    imageField,
    imageMode,
    uriOverride,
  });

  const onSaveDraft = () => {
    saveDraft(draftPayload());
    setDraftNote(`下書きを保存しました（${fmtDraftTime(Date.now())}）· この端末のブラウザのみ`);
    setMsg(null);
  };

  const onClearDraft = () => {
    clearDraft();
    setDraftNote("下書きを削除しました");
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setImageBusy(true);
    setImageNote(null);
    const prep = await prepareImageFile(file);
    setImageBusy(false);
    if (!prep.ok) {
      setImageNote(prep.error);
      return;
    }
    setImageMode("file");
    setImageField(prep.dataUri);
    setImageNote(
      `画像を圧縮してオンチェーン保存します（約 ${Math.round(prep.bytesApprox / 1024)} KB）· 外部ホスト不要`
    );
  };

  const clearImage = () => {
    setImageMode("auto");
    setImageField("");
    setImageNote("タイトルから和色カバーを自動生成します（永続・無料）");
  };

  const validateBeforeSubmit = (): string | null => {
    if (chainId !== CHAIN.id) {
      switchChain?.({ chainId: CHAIN.id });
      return "Polygon に切替後もう一度";
    }
    const ben = (beneficiary || "").trim() as Address;
    if (!ben || !ben.startsWith("0x") || ben.length !== 42) {
      return "受取人アドレスを入力";
    }
    if (!uriOverride.trim()) {
      const err = validateCreateForm({
        title,
        description,
        image: imageField,
      });
      if (err) return err;
    }
    return null;
  };

  const openConfirm = () => {
    setMsg(null);
    if (!canCreateFlag) {
      setMsg(
        "旗揚げは現在アローリスト制です。許可されたウォレットのみ作成できます（後日オープン予定）。"
      );
      return;
    }
    const err = validateBeforeSubmit();
    if (err) {
      setMsg(err);
      return;
    }
    setConfirmOpen(true);
  };

  const submit = async () => {
    try {
      setMsg(null);
      const err = validateBeforeSubmit();
      if (err) {
        setMsg(err);
        setConfirmOpen(false);
        return;
      }
      const ben = (beneficiary || "").trim() as Address;

      let metadataURI = uriOverride.trim();
      if (!metadataURI) {
        metadataURI = buildMetadataDataUri({
          title,
          description,
          returnText,
          image: imageField,
          kind: mode === "charity" ? "charity" : "crowdfund",
        });
      }

      const duration = BigInt(Math.max(1, Math.floor(Number(days) * 86400)));
      const durSec = duration < 3600n ? 3600n : duration;
      const deadlineUnix = Math.floor(Date.now() / 1000) + Number(durSec);

      if (mode === "crowdfund") {
        const g = parseUnits(goal || "0", 18);
        pendingSnap.current = {
          kind: "crowdfund",
          title: title.trim() || "旗揚げ",
          goalWei: g,
          deadlineUnix,
        };
        writeContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createCrowdfund",
          args: [g, durSec, ben, metadataURI],
          chainId: CHAIN.id,
        } as any);
      } else {
        const sg = parseUnits(softGoal || "0", 18);
        pendingSnap.current = {
          kind: "charity",
          title: title.trim() || "旗揚げ",
          goalWei: sg,
          deadlineUnix,
        };
        writeContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createCharity",
          args: [durSec, ben, sg, metadataURI],
          chainId: CHAIN.id,
        } as any);
      }
      setMsg("作成中…");
      setConfirmOpen(false);
    } catch (e) {
      setMsg(friendlyTxError(e));
      setConfirmOpen(false);
    }
  };

  if (!isConnected) {
    return (
      <section className="create">
        <h2>旗を揚げる</h2>
        <p className="hint">旗揚げにはウォレット接続が必要です。</p>
      </section>
    );
  }

  return (
    <section className="create">
      <h2>旗を揚げる</h2>
      <p className="hint">
        タイトル・説明はオンチェーン保存（data URI）。画像は<strong>自動和色カバー</strong>
        （永続無料）が既定。任意でファイルを圧縮して一緒に保存できます。外部ピン留め不要です。
        {!canCreateFlag && (
          <>
            <br />
            <strong>現在はアローリスト制</strong>
            です。許可ウォレットのみ旗を揚げられます（後日オープン）。
          </>
        )}
      </p>
      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "crowdfund" ? "on" : ""}
          onClick={() => setMode("crowdfund")}
        >
          皆済の旗 (AoN)
        </button>
        <button
          type="button"
          className={mode === "charity" ? "on" : ""}
          onClick={() => setMode("charity")}
        >
          義援の旗 (All-in)
        </button>
      </div>

      <label className="field">
        <span>タイトル * （{TITLE_MAX}字以内）</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          placeholder="例: 地域の祭りを支えたい"
        />
      </label>
      <label className="field">
        <span>説明 * （{DESC_MAX}字以内）</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESC_MAX}
          rows={5}
          placeholder="何のための資金か、なぜ必要か…"
        />
      </label>
      <label className="field">
        <span>リターン / 恩返し（任意・{RETURN_MAX}字）</span>
        <textarea
          value={returnText}
          onChange={(e) => setReturnText(e.target.value)}
          maxLength={RETURN_MAX}
          rows={2}
          placeholder="例: お礼の一筆 / 限定ステッカー など"
        />
      </label>

      <div className="field">
        <span>カバー画像</span>
        <div className="image-actions">
          <label className="btn file-btn">
            {imageBusy ? "処理中…" : "ファイルを選ぶ"}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={imageBusy}
              onChange={(e) => onPickFile(e.target.files?.[0] || null)}
            />
          </label>
          <button type="button" className="btn ghost" onClick={clearImage}>
            自動カバー
          </button>
        </div>
        <p className="field-hint">
          既定: タイトルから<strong>和色カバーを自動生成</strong>（チェーンに保存・期限なし）。
          ファイルはブラウザで圧縮し metadata に埋め込みます（ガス上限内）。
        </p>
        {imageNote && <p className="field-hint ok">{imageNote}</p>}
        <input
          value={
            imageMode === "url" || imageField.startsWith("http")
              ? imageField
              : ""
          }
          onChange={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              clearImage();
              return;
            }
            setImageMode("url");
            setImageField(v);
            setImageNote(
              "外部URLは消えることがあります。壊れたら自動カバーに切り替わります。"
            );
          }}
          placeholder="（任意・非推奨）https:// 外部URL"
          spellCheck={false}
          style={{ marginTop: "0.45rem" }}
        />
        <img src={previewSrc} alt="" className="create-preview" />
        <span className="field-hint">
          プレビュー · {imageMode === "auto" ? "自動カバー" : imageMode === "file" ? "アップロード" : "URL"}
        </span>
      </div>

      {mode === "crowdfund" ? (
        <label className="field">
          <span>
            目標 {TOKEN_SYMBOL}（最低{" "}
            {minGoal != null
              ? Number(formatUnits(minGoal as bigint, 18)).toLocaleString("ja-JP")
              : MIN_GOAL_WHOLE.toLocaleString("ja-JP")}
            ）
          </span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} />
        </label>
      ) : (
        <label className="field">
          <span>希望額 {TOKEN_SYMBOL}（任意・表示のみ）</span>
          <input value={softGoal} onChange={(e) => setSoftGoal(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>期間（日）· 最低1時間相当</span>
        <input value={days} onChange={(e) => setDays(e.target.value)} />
      </label>
      <label className="field">
        <span>受取人アドレス</span>
        <input
          value={beneficiary}
          onChange={(e) => setBeneficiary(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
      </label>

      <button
        type="button"
        className="linkish"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "詳細を閉じる" : "詳細（URIを直接指定）"}
      </button>
      {showAdvanced && (
        <label className="field">
          <span>metadata URI 上書き（空ならフォームから自動生成）</span>
          <input
            value={uriOverride}
            onChange={(e) => setUriOverride(e.target.value)}
            spellCheck={false}
            placeholder="data:… or ar://… or https://…"
          />
        </label>
      )}

      <button
        type="button"
        className="btn ghost wide"
        onClick={onSaveDraft}
      >
        下書きを保存
      </button>
      <button
        type="button"
        className="linkish"
        onClick={onClearDraft}
        style={{ marginBottom: "0.5rem" }}
      >
        下書きを捨てる
      </button>
      {draftNote && <p className="hint">{draftNote}</p>}

      <button
        className="btn primary wide"
        disabled={isPending || isLoading}
        onClick={openConfirm}
      >
        {isPending || isLoading ? "処理中…" : "確認して旗を揚げる"}
      </button>
      {msg && <p className="status short-status">{msg}</p>}
      {txHash && (
        <p className="status">
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            Tx {txHash.slice(0, 12)}…
          </a>
        </p>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirmOpen(false)}>
          <div
            className="modal surface"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>旗揚げの確認</h3>
            <p className="hint">オンチェーン送信前の最終確認です。内容は後から変えられません。</p>
            <ul className="confirm-list">
              <li>
                <strong>種類</strong> {mode === "charity" ? "義援の旗" : "皆済の旗"}
              </li>
              <li>
                <strong>タイトル</strong> {title || "（URI指定）"}
              </li>
              <li>
                <strong>期間</strong> {days} 日
              </li>
              <li>
                <strong>
                  {mode === "crowdfund" ? "目標" : "希望額"}
                </strong>{" "}
                {mode === "crowdfund" ? goal : softGoal || "—"} {TOKEN_SYMBOL}
              </li>
              <li>
                <strong>受取人</strong> {shortAddr(beneficiary as Address)}
              </li>
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setConfirmOpen(false)}>
                戻る
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={isPending || isLoading}
                onClick={submit}
              >
                送信する
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [theme, setTheme] = useState<ThemeMode>(() => initTheme("light"));

  const { data: count, refetch: refetchCount } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "campaignCount",
    query: { refetchInterval: 15_000 },
  });

  const n = Number(count ?? 0n);
  const indices = useMemo(() => Array.from({ length: n }, (_, i) => i).reverse(), [n]);

  const { data: addrResults, refetch: refetchAddrs } = useReadContracts({
    contracts: indices.map((i) => ({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "campaigns",
      args: [BigInt(i)],
    })) as any,
    query: { enabled: n > 0, refetchInterval: 15_000 },
  });

  const addresses = useMemo(() => {
    if (!addrResults) return [] as Address[];
    return addrResults
      .map((r) => r.result as Address | undefined)
      .filter((a): a is Address => !!a);
  }, [addrResults]);

  // Detect kind via crowdfund goal() success vs charity
  const { data: kindProbes } = useReadContracts({
    contracts: addresses.flatMap((a) => [
      { address: a, abi: CROWDFUND_ABI, functionName: "goal" },
      { address: a, abi: CHARITY_ABI, functionName: "softGoal" },
    ]) as any,
    query: { enabled: addresses.length > 0 },
  });

  const kinds: Kind[] = useMemo(() => {
    if (!kindProbes) return addresses.map(() => "unknown" as Kind);
    return addresses.map((_, i) => {
      const goalRes = kindProbes[i * 2];
      if (goalRes?.status === "success") return "crowdfund";
      const soft = kindProbes[i * 2 + 1];
      if (soft?.status === "success") return "charity";
      return "unknown";
    });
  }, [addresses, kindProbes]);

  const [selected, setSelected] = useState<Address | null>(null);
  const [selectedKindOverride, setSelectedKindOverride] = useState<Kind | null>(
    null
  );
  const [tab, setTab] = useState<"list" | "create" | "me" | "faq">("list");
  const [listFilter, setListFilter] = useState<"open" | "done">("open");
  const [justCreated, setJustCreated] = useState<CreateSuccessInfo | null>(null);
  const now = useNow();
  const { profile: myProfile } = useProfile(address);

  // Open ?c=0x… deep links
  useEffect(() => {
    if (typeof window === "undefined") return;
    const c = parseCampaignParam(window.location.search, window.location.hash);
    if (!c) return;
    setSelected(c as Address);
    setSelectedKindOverride(null);
    setTab("list");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selected) {
      url.searchParams.set("c", selected);
    } else {
      url.searchParams.delete("c");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selected]);

  // status probes for filter
  const { data: statusProbe } = useReadContracts({
    contracts: addresses.flatMap((a, i) => {
      const abi = kinds[i] === "charity" ? CHARITY_ABI : CROWDFUND_ABI;
      return [
        { address: a, abi, functionName: "deadline" },
        { address: a, abi, functionName: "state" },
      ];
    }) as any,
    query: { enabled: addresses.length > 0, refetchInterval: 15_000 },
  });

  const filtered = useMemo(() => {
    return addresses
      .map((a, i) => ({
        addr: a,
        kind: (kinds[i] === "unknown" ? "crowdfund" : kinds[i]) as Kind,
        idx: i,
      }))
      .filter((row) => {
        if (!statusProbe) return listFilter === "open";
        const d = Number(statusProbe[row.idx * 2]?.result ?? 0n);
        const st = Number(statusProbe[row.idx * 2 + 1]?.result ?? 0);
        const done = isLotCompleted(row.kind, st, d, now);
        return listFilter === "done" ? done : !done;
      });
  }, [addresses, kinds, statusProbe, listFilter, now]);

  const selectedKind: Kind = useMemo(() => {
    if (selectedKindOverride) return selectedKindOverride;
    if (selected != null) {
      const k = kinds[addresses.indexOf(selected)];
      if (k && k !== "unknown") return k;
    }
    return "crowdfund";
  }, [selectedKindOverride, selected, kinds, addresses]);

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            <IconNobori className="logo-icon" />
          </span>
          <div className="brand-text">
            <div className="brand-name">助太刀 Sukedachi</div>
            <div className="brand-sub">
              {CHAIN.name} · {TOKEN_SYMBOL} · BushiDAO
            </div>
          </div>
        </div>
        <nav className="nav" aria-label="サイト">
          <button
            type="button"
            className="nav-ico theme-toggle"
            onClick={() => setTheme((t) => toggleTheme(t))}
            aria-label={theme === "dark" ? "陽モード" : "陰モード"}
            title={theme === "dark" ? "陽" : "陰"}
          >
            {theme === "dark" ? <IconSun /> : <IconMoon />}
            <span className="nav-label">{theme === "dark" ? "陽" : "陰"}</span>
          </button>
          <a
            href="./allowlist.html"
            className="nav-ico"
            aria-label="AL申請"
            title="AL申請"
          >
            <IconScroll />
            <span className="nav-label">AL申請</span>
          </a>
          <a
            href={`${EXPLORER}/address/${FACTORY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="nav-ico"
            aria-label="賢契約"
            title="賢契約"
          >
            <IconContract />
            <span className="nav-label">賢契約</span>
          </a>
          {!isConnected ? (
            <button
              type="button"
              className="btn primary nav-ico nav-connect"
              disabled={connecting}
              onClick={() => connect({ connector: connectors[0] })}
              aria-label="ウォレット接続"
              title="ウォレット接続"
            >
              <IconWallet />
              <span className="nav-label">接続</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost header-user nav-ico"
              onClick={() => {
                setTab("me");
                setSelected(null);
              }}
              aria-label="マイページ"
              title="マイページ"
            >
              <span className="header-user-av" aria-hidden>
                <img
                  src={avatarSrc(myProfile, address)}
                  alt=""
                  className="header-av-img"
                />
              </span>
              <span className="nav-label header-user-label">
                {hasDisplayProfile(myProfile)
                  ? profileDisplayName(myProfile, address!)
                  : shortAddr(address)}
              </span>
            </button>
          )}
        </nav>
      </header>

      {chainId && chainId !== CHAIN.id && isConnected && (
        <button
          className="btn warn wide banner"
          onClick={() => switchChain?.({ chainId: CHAIN.id })}
        >
          Polygon に切替
        </button>
      )}

      <div className="tabs" role="tablist" aria-label="メインメニュー">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "list"}
          className={tab === "list" ? "on" : ""}
          onClick={() => {
            setTab("list");
            setSelected(null);
            setJustCreated(null);
          }}
          aria-label="旗揚げ一覧"
          title="旗揚げ一覧"
        >
          <IconList className="tab-ico" />
          <span className="tab-label">旗揚げ一覧</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "create"}
          className={tab === "create" ? "on" : ""}
          onClick={() => setTab("create")}
          aria-label="旗を揚げる"
          title="旗を揚げる"
        >
          <IconRaise className="tab-ico" />
          <span className="tab-label">旗を揚げる</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "me"}
          className={tab === "me" ? "on" : ""}
          onClick={() => {
            setTab("me");
            setSelected(null);
          }}
          aria-label="マイページ"
          title="マイページ"
        >
          <IconUser className="tab-ico" />
          <span className="tab-label">マイページ</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "faq"}
          className={tab === "faq" ? "on" : ""}
          onClick={() => {
            setTab("faq");
            setSelected(null);
          }}
          aria-label="心得（FAQ）"
          title="心得（FAQ）"
        >
          <IconBook className="tab-ico" />
          <span className="tab-label">心得</span>
        </button>
      </div>

      {tab === "create" ? (
        <CreatePanel
          onCreated={(info) => {
            refetchCount();
            refetchAddrs();
            setJustCreated(info);
            setSelected(null);
            setSelectedKindOverride(info.kind);
            setTab("list");
            if (info.address) {
              // keep URL ready if they open detail later
              const url = new URL(window.location.href);
              url.searchParams.set("c", info.address);
              window.history.replaceState(
                {},
                "",
                `${url.pathname}${url.search}${url.hash}`
              );
            }
          }}
        />
      ) : tab === "me" ? (
        <MyPagePanel
          onOpenCampaign={(addr, kind) => {
            setJustCreated(null);
            setSelected(addr);
            setSelectedKindOverride(kind === "unknown" ? "crowdfund" : kind);
            setTab("list");
          }}
        />
      ) : tab === "faq" ? (
        <section className="faq surface">
          <h2>心得 · よくある質問</h2>
          <p className="hint">
            助太刀の使い方と思想。困ったらまずここを。各項目を開くと説明が出ます。
          </p>
          <div className="faq-list">
            {FAQ_ITEMS.map((item) => (
              <details key={item.q} className="faq-item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      ) : justCreated ? (
        <JustCreatedSharePanel
          info={justCreated}
          onOpenDetail={() => {
            if (justCreated.address) {
              setSelected(justCreated.address);
              setSelectedKindOverride(justCreated.kind);
            }
            setJustCreated(null);
          }}
          onDismiss={() => setJustCreated(null)}
        />
      ) : selected ? (
        <DetailPanel
          address={selected}
          kind={selectedKind === "unknown" ? "crowdfund" : selectedKind}
          onBack={() => {
            setSelected(null);
            setSelectedKindOverride(null);
          }}
        />
      ) : (
        <section className="list">
          <p className="intro">
            仲間の<strong>旗揚げ</strong>に {TOKEN_SYMBOL} で加勢する場。
            <strong>皆済</strong>は目標未達なら返金、
            <strong>義援</strong>は期間内の All-in です。
          </p>
          <div className="list-filter">
            <button
              type="button"
              className={listFilter === "open" ? "on" : ""}
              onClick={() => setListFilter("open")}
            >
              募集中
            </button>
            <button
              type="button"
              className={listFilter === "done" ? "on" : ""}
              onClick={() => setListFilter("done")}
            >
              完了・履歴
            </button>
          </div>
          {filtered.length === 0 ? (
            <EmptyListPanel
              mode={listFilter}
              totalCampaigns={n}
              onCreate={() => setTab("create")}
              onFaq={() => setTab("faq")}
              onShowDone={() => setListFilter("done")}
            />
          ) : (
            <div className="grid">
              {filtered.map((row) => (
                <CampaignCard
                  key={row.addr}
                  address={row.addr}
                  kind={row.kind}
                  selected={false}
                  onSelect={() => {
                    setSelected(row.addr);
                    setSelectedKindOverride(row.kind);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="foot">
        <span>助太刀 · BushiDAO</span>
        <span className="foot-right">
          <a href="./notes.html" className="foot-link">
            利用上の注意
          </a>
          <span className="foot-sep" aria-hidden>
            ·
          </span>
          <span>
            {CHAIN.name} · {TOKEN_SYMBOL}
          </span>
        </span>
      </footer>
    </div>
  );
}
