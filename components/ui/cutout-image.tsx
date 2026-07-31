"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import { cutoutBackground } from "@/lib/combat/cutout";
import { cn } from "@/lib/utils";

/**
 * Renders an NFT image with its solid background removed (client-side flood
 * fill). Shows the original image first, then swaps to the cutout once it's
 * ready; falls back to the original when the source can't be processed
 * (cross-origin taint) or has no solid background.
 */
export function CutoutImage({
  imageUrl,
  alt,
  className,
}: {
  imageUrl: string | null;
  alt: string;
  className?: string;
}) {
  const [cutout, setCutout] = useState<string | null>(null);

  useEffect(() => {
    setCutout(null);
    if (!imageUrl) return;
    let cancelled = false;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const out = cutoutBackground(img);
        if (!cancelled && out) setCutout(out);
      } catch {
        /* keep original */
      }
    };
    // onerror (incl. CORS blocking the anonymous load) → stay on original.
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  if (!imageUrl) {
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-white/[0.03] text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className="h-1/3 w-1/3" />
      </span>
    );
  }

  return (
    <img
      src={cutout ?? imageUrl}
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}
