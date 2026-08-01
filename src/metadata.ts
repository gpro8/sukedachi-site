/** Free-forever campaign metadata: form → data:application/json;base64 URI */

export type CampaignMeta = {
  name?: string;
  description?: string;
  image?: string;
  attributes?: { trait_type?: string; value?: string | number }[];
  /** Convenience: Return attribute if present */
  returnText?: string;
};

const TITLE_MAX = 80;
const DESC_MAX = 2000;
const RETURN_MAX = 500;
const IMAGE_URL_MAX = 500;

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function buildMetadataDataUri(input: {
  title: string;
  description: string;
  returnText?: string;
  imageUrl?: string;
}): string {
  const name = input.title.trim().slice(0, TITLE_MAX);
  const description = input.description.trim().slice(0, DESC_MAX);
  const image = (input.imageUrl || "").trim().slice(0, IMAGE_URL_MAX);
  const ret = (input.returnText || "").trim().slice(0, RETURN_MAX);

  const attributes: { trait_type: string; value: string }[] = [];
  if (ret) attributes.push({ trait_type: "Return", value: ret });

  const json: Record<string, unknown> = {
    name,
    description,
  };
  if (image) json.image = image;
  if (attributes.length) json.attributes = attributes;

  const raw = JSON.stringify(json);
  return `data:application/json;base64,${utf8ToBase64(raw)}`;
}

export function parseMetadataUri(uri: string): CampaignMeta | null {
  if (!uri) return null;
  const t = uri.trim();

  // data:application/json;base64,...
  if (t.startsWith("data:application/json")) {
    try {
      const comma = t.indexOf(",");
      if (comma < 0) return null;
      const meta = t.slice(0, comma).toLowerCase();
      const payload = t.slice(comma + 1);
      const jsonStr = meta.includes(";base64")
        ? base64ToUtf8(payload)
        : decodeURIComponent(payload);
      return normalizeMeta(JSON.parse(jsonStr));
    } catch {
      return null;
    }
  }

  // data:application/json,... (raw)
  if (t.startsWith("data:") && t.includes("json")) {
    try {
      const comma = t.indexOf(",");
      if (comma < 0) return null;
      return normalizeMeta(JSON.parse(decodeURIComponent(t.slice(comma + 1))));
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeMeta(j: Record<string, unknown>): CampaignMeta {
  const attrs = Array.isArray(j.attributes)
    ? (j.attributes as CampaignMeta["attributes"])
    : undefined;
  let returnText: string | undefined;
  if (attrs) {
    const r = attrs.find(
      (a) =>
        a &&
        String(a.trait_type || "").toLowerCase() === "return" &&
        a.value != null
    );
    if (r) returnText = String(r.value);
  }
  return {
    name: typeof j.name === "string" ? j.name : undefined,
    description: typeof j.description === "string" ? j.description : undefined,
    image: typeof j.image === "string" ? j.image : undefined,
    attributes: attrs,
    returnText,
  };
}

export function validateCreateForm(input: {
  title: string;
  description: string;
  imageUrl?: string;
}): string | null {
  if (!input.title.trim()) return "タイトルを入力してください";
  if (input.title.trim().length > TITLE_MAX)
    return `タイトルは${TITLE_MAX}文字以内`;
  if (!input.description.trim()) return "説明を入力してください";
  if (input.description.trim().length > DESC_MAX)
    return `説明は${DESC_MAX}文字以内`;
  const img = (input.imageUrl || "").trim();
  if (img) {
    if (img.length > IMAGE_URL_MAX) return "画像URLが長すぎます";
    if (!/^https:\/\//i.test(img) && !/^ipfs:\/\//i.test(img)) {
      return "画像は https:// または ipfs:// のURLにしてください";
    }
  }
  return null;
}

export { TITLE_MAX, DESC_MAX, RETURN_MAX };
