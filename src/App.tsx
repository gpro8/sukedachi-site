import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatUnits, parseUnits, type Address } from "viem";
import {
  CHAIN,
  CHARITY_ABI,
  CROWDFUND_ABI,
  ERC20_ABI,
  EXPLORER,
  FACTORY_ABI,
  FACTORY_ADDRESS,
  JPYC_ADDRESS,
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

type Kind = "crowdfund" | "charity" | "unknown";

type Meta = CampaignMeta;

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
  const goalOrSoft = (data?.[4]?.result as bigint) ?? 0n;
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
        {meta.image ? (
          <img src={meta.image} alt="" />
        ) : (
          <div className="placeholder">助</div>
        )}
        <div className="card-cover-badge">
          <span className={`pill ${kind}`}>{label}</span>
          <span className={`pill status-${status.tone}`}>{status.text}</span>
        </div>
      </div>
      <div className="card-body">
        <h3>{title}</h3>
        <div className="card-stats">
          <span>
            {formatUnits(raised, 18)}
            <span className="muted">
              {" "}
              / {goalOrSoft > 0n ? formatUnits(goalOrSoft, 18) : "—"} tJPYC
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
  const live = Boolean(data?.[5]?.result);
  const goalOrSoft = (data?.[6]?.result as bigint) ?? 0n;
  const myPledge =
    kind === "crowdfund" ? ((data?.[7]?.result as bigint) ?? 0n) : 0n;

  const [meta, setMeta] = useState<Meta>({});
  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState<string | null>(null);

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
      reset();
    }
  }, [isSuccess, refetch, reset]);

  const ensure = useCallback(async () => {
    if (chainId !== CHAIN.id) {
      switchChain?.({ chainId: CHAIN.id });
      throw new Error("Polygon Amoy に切り替えてください");
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
        {meta.image && (
          <img src={meta.image} alt="" className="detail-cover" />
        )}
        <div className="card-tags" style={{ marginBottom: "0.35rem" }}>
          <span className={`pill ${kind}`}>{kindLabel(kind)}</span>
          <span className={`pill status-${lotStatus.tone}`}>{lotStatus.text}</span>
        </div>
        <h2>{title}</h2>
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
            集まった義金 {formatUnits(raised, 18)} tJPYC
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
          <dt>契約</dt>
          <dd>
            <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer">
              {shortAddr(address)}
            </a>
          </dd>
        </div>
        {kind === "crowdfund" && myPledge > 0n && (
          <div>
            <dt>あなたの加勢</dt>
            <dd>{formatUnits(myPledge, 18)} tJPYC</dd>
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
              {kind === "charity" ? "義援額 (tJPYC)" : "加勢額 (tJPYC)"}
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
              tJPYC を承認
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
          返金を受け取る ({formatUnits(myPledge, 18)} tJPYC)
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

function CreatePanel({ onCreated }: { onCreated: () => void }) {
  const { address: user, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [mode, setMode] = useState<"crowdfund" | "charity">("crowdfund");
  const [goal, setGoal] = useState("100");
  const [softGoal, setSoftGoal] = useState("0");
  const [days, setDays] = useState("1");
  const [beneficiary, setBeneficiary] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [returnText, setReturnText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uriOverride, setUriOverride] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (user && !beneficiary) setBeneficiary(user);
  }, [user, beneficiary]);

  const { data: minGoal } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "minGoal",
  });

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isSuccess, isLoading } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      setMsg("作成完了");
      onCreated();
      reset();
    }
  }, [isSuccess, onCreated, reset]);

  const submit = async () => {
    try {
      setMsg(null);
      if (chainId !== CHAIN.id) {
        switchChain?.({ chainId: CHAIN.id });
        setMsg("Amoy に切替後もう一度");
        return;
      }
      const ben = (beneficiary || "").trim() as Address;
      if (!ben || !ben.startsWith("0x") || ben.length !== 42) {
        setMsg("受取人アドレスを入力");
        return;
      }

      let metadataURI = uriOverride.trim();
      if (!metadataURI) {
        const err = validateCreateForm({ title, description, imageUrl });
        if (err) {
          setMsg(err);
          return;
        }
        metadataURI = buildMetadataDataUri({
          title,
          description,
          returnText,
          imageUrl,
        });
      }

      const duration = BigInt(Math.max(1, Math.floor(Number(days) * 86400)));
      // Min duration factory is 1 hour
      const durSec = duration < 3600n ? 3600n : duration;

      if (mode === "crowdfund") {
        const g = parseUnits(goal || "0", 18);
        writeContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createCrowdfund",
          args: [g, durSec, ben, metadataURI],
          chainId: CHAIN.id,
        } as any);
      } else {
        const sg = parseUnits(softGoal || "0", 18);
        writeContract({
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createCharity",
          args: [durSec, ben, sg, metadataURI],
          chainId: CHAIN.id,
        } as any);
      }
      setMsg("作成中…");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "エラー");
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
        タイトル・説明はフォームから自動でオンチェーン保存（data URI）。
        有料ピン留め不要です。画像は https のURLを貼ってください。
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
      <label className="field">
        <span>画像URL（任意・https）</span>
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://…"
          spellCheck={false}
        />
      </label>
      {imageUrl.trim().startsWith("https") && (
        <img src={imageUrl.trim()} alt="" className="create-preview" />
      )}

      {mode === "crowdfund" ? (
        <label className="field">
          <span>
            目標 tJPYC（最低{" "}
            {minGoal != null ? formatUnits(minGoal as bigint, 18) : "…"}）
          </span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} />
        </label>
      ) : (
        <label className="field">
          <span>希望額 tJPYC（任意・表示のみ）</span>
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
        className="btn primary wide"
        disabled={isPending || isLoading}
        onClick={submit}
      >
        {isPending || isLoading ? "処理中…" : "旗を揚げる"}
      </button>
      {msg && <p className="status">{msg}</p>}
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

export default function App() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

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
  const [tab, setTab] = useState<"list" | "create">("list");

  const selectedKind =
    selected != null
      ? kinds[addresses.indexOf(selected)] || "crowdfund"
      : "crowdfund";

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo">助</span>
          <div>
            <div className="brand-name">助太刀 Sukedachi</div>
            <div className="brand-sub">和色 · Polygon Amoy · tJPYC · BushiDAO</div>
          </div>
        </div>
        <nav className="nav">
          <a
            href={`${EXPLORER}/address/${FACTORY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
          >
            契約
          </a>
          {!isConnected ? (
            <button
              className="btn primary"
              disabled={connecting}
              onClick={() => connect({ connector: connectors[0] })}
            >
              ウォレット接続
            </button>
          ) : (
            <button className="btn ghost" onClick={() => disconnect()}>
              {shortAddr(address)}
            </button>
          )}
        </nav>
      </header>

      {chainId && chainId !== CHAIN.id && isConnected && (
        <button
          className="btn warn wide banner"
          onClick={() => switchChain?.({ chainId: CHAIN.id })}
        >
          Polygon Amoy に切替
        </button>
      )}

      <div className="tabs">
        <button
          type="button"
          className={tab === "list" ? "on" : ""}
          onClick={() => {
            setTab("list");
            setSelected(null);
          }}
        >
          旗揚げ一覧
        </button>
        <button
          type="button"
          className={tab === "create" ? "on" : ""}
          onClick={() => setTab("create")}
        >
          旗を揚げる
        </button>
      </div>

      {tab === "create" ? (
        <CreatePanel
          onCreated={() => {
            refetchCount();
            refetchAddrs();
            setTab("list");
          }}
        />
      ) : selected ? (
        <DetailPanel
          address={selected}
          kind={selectedKind === "unknown" ? "crowdfund" : selectedKind}
          onBack={() => setSelected(null)}
        />
      ) : (
        <section className="list">
          <p className="intro">
            仲間の<strong>旗揚げ</strong>に tJPYC で加勢する場。
            <strong>皆済</strong>は目標未達なら返金、
            <strong>義援</strong>は期間内の All-in です。
          </p>
          {addresses.length === 0 ? (
            <p className="hint">
              まだ旗が立っていません。「旗を揚げる」から始められます。
            </p>
          ) : (
            <div className="grid">
              {addresses.map((a, i) => (
                <CampaignCard
                  key={a}
                  address={a}
                  kind={kinds[i] || "unknown"}
                  selected={false}
                  onSelect={() => setSelected(a)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="foot">
        <span>助太刀 · BushiDAO</span>
        <span>Amoy {CHAIN.id}</span>
      </footer>
    </div>
  );
}
