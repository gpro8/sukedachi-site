import { useState } from "react";
import { buildCoverDataUri, type CoverKind } from "./cover";
import { isLikelyDisplayableImageSrc } from "./imagePrep";

type Props = {
  src?: string;
  title?: string;
  kind?: CoverKind;
  alt?: string;
  className?: string;
  /** Wrapper class for cover area (card) */
  placeholderClassName?: string;
};

/**
 * Never shows a broken image icon.
 * Falls back to free-forever generated 和色 cover from title.
 */
export function SafeImage({
  src,
  title = "旗揚げ",
  kind = "unknown",
  alt = "",
  className,
  placeholderClassName = "placeholder",
}: Props) {
  const [failed, setFailed] = useState(false);
  const usable = isLikelyDisplayableImageSrc(src) && !failed;
  const fallback = buildCoverDataUri({ title, kind });

  if (!usable) {
    return (
      <img
        src={fallback}
        alt={alt}
        className={className || placeholderClassName}
        draggable={false}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
