/** Free-forever campaign metadata: form → data:application/json;base64 URI */

import { buildCoverDataUri, type CoverKind } from "./cover";
import {
  MAX_IMAGE_FIELD_CHARS,
  MAX_METADATA_URI_CHARS,
} from "./imagePrep";

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
  /** https URL, data:image/…, or empty → auto cover */
  image?: string;
  kind?: CoverKind;
}): string {
  const name = input.title.trim().slice(0, TITLE_MAX);
  const description = input.description.trim().slice(0, DESC_MAX);
  const ret = (input.returnText || "").trim().slice(0, RETURN_MAX);

  let image = (input.image || "").trim();
  if (!image) {
    image = buildCoverDataUri({ title: name, kind: input.kind });
  } else if (image.startsWith("data:image/")) {
    if (image.length > MAX_IMAGE_FIELD_CHARS) {
      // Safety: fall back rather than produce unusable tx
      image = buildCoverDataUri({ title: name, kind: input.kind });
    }
  } else {
    image = image.slice(0, IMAGE_URL_MAX);
  }

  const attributes: { trait_type: string; value: string }[] = [];
  if (ret) attributes.push({ trait_type: "Return", value: ret });

  const json: Record<string, unknown> = {
    name,
    description,
    image,
  };
  if (attributes.length) json.attributes = attributes;

  const raw = JSON.stringify(json);
  const uri = `data:application/json;base64,${utf8ToBase64(raw)}`;
  if (uri.length > MAX_METADATA_URI_CHARS) {
    // Drop custom image, keep generated cover only
    const slim = {
      name,
      description,
      image: buildCoverDataUri({ title: name, kind: input.kind }),
      ...(attributes.length ? { attributes } : {}),
    };
    return `data:application/json;base64,${utf8ToBase64(JSON.stringify(slim))}`;
  }
  return uri;
}

export function parseMetadataUri(uri: string): CampaignMeta | null {
  if (!uri) return null;
  const t = uri.trim();

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
  image?: string;
}): string | null {
  if (!input.title.trim()) return "タイトルを入力してください";
  if (input.title.trim().length > TITLE_MAX)
    return `タイトルは${TITLE_MAX}文字以内`;
  if (!input.description.trim()) return "説明を入力してください";
  if (input.description.trim().length > DESC_MAX)
    return `説明は${DESC_MAX}文字以内`;
  const img = (input.image || "").trim();
  if (img) {
    if (img.startsWith("data:image/")) {
      if (img.length > MAX_IMAGE_FIELD_CHARS) {
        return "画像が大きすぎます。別の画像か自動カバーをご利用ください";
      }
    } else if (img.startsWith("https://") || img.startsWith("ipfs://")) {
      if (img.length > IMAGE_URL_MAX) return "画像URLが長すぎます";
    } else if (!img.startsWith("http://")) {
      return "画像はアップロード、https://、または自動カバーを使ってください";
    }
  }
  return null;
}

export { TITLE_MAX, DESC_MAX, RETURN_MAX };
