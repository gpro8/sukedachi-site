/** localStorage drafts for 旗揚げ create form — free forever, no backend */

export const DRAFT_KEY = "sukedachi.flag.draft.v1";

export type FlagDraft = {
  mode: "crowdfund" | "charity";
  goal: string;
  softGoal: string;
  days: string;
  beneficiary: string;
  title: string;
  description: string;
  returnText: string;
  imageField: string;
  imageMode: "auto" | "file" | "url";
  uriOverride: string;
  savedAt: number;
};

export function loadDraft(): FlagDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as FlagDraft;
    if (!d || typeof d !== "object") return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(d: Omit<FlagDraft, "savedAt">): void {
  const payload: FlagDraft = { ...d, savedAt: Date.now() };
  // Avoid huge localStorage if someone pasted huge uri — cap image
  if (payload.imageField && payload.imageField.length > 80_000) {
    payload.imageField = "";
    payload.imageMode = "auto";
  }
  localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

export function fmtDraftTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
