"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { CollectionSearchResult } from "@/lib/types";

type Props = {
  onSelect: (collection: CollectionSearchResult) => void;
  selected?: CollectionSearchResult | null;
  minLength?: number;
};

const clientCache = new Map<string, CollectionSearchResult[]>();

function chainLabel(chain?: string | null) {
  if (!chain) return "Unknown chain";
  return chain.toLowerCase() === "ethereum" ? "Ethereum" : chain;
}

function shortAddress(address?: string | null) {
  return address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "Contract pending";
}

export function CollectionSearch({ onSelect, selected, minLength = 2 }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const canSearch = trimmed.length >= minLength;

  useEffect(() => {
    if (!canSearch) {
      abortRef.current?.abort();
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const key = trimmed.toLowerCase();
    const cached = clientCache.get(key);
    if (cached) {
      setResults(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/collections/search?q=${encodeURIComponent(trimmed)}`,
          {
            signal: controller.signal,
          },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Collection search failed");
        const nextResults = Array.isArray(body.results) ? body.results : [];
        clientCache.set(key, nextResults);
        setResults(nextResults);
      } catch (err) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(
          err instanceof Error ? err.message : "Collection search failed",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canSearch, minLength, trimmed]);

  const status = useMemo(() => {
    if (!trimmed) return `Type at least ${minLength} characters to search.`;
    if (!canSearch)
      return `${minLength - trimmed.length} more character${minLength - trimmed.length === 1 ? "" : "s"} to search.`;
    return null;
  }, [canSearch, minLength, trimmed]);

  return (
    <div className="space-y-2 rounded-xl border border-ethereum-purple/25 bg-ethereum-purple/5 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search collection by name or slug"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ethereum-purple" />
        )}
      </div>

      {selected && (
        <p className="text-xs text-muted-foreground">
          Selected: <span className="text-foreground">{selected.name}</span> ·{" "}
          {selected.slug} ·{" "}
          {selected.contractAddress
            ? shortAddress(selected.contractAddress)
            : "contract resolution pending/unavailable"}
        </p>
      )}

      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5" /> Error searching collections.
          Try again.
        </p>
      )}
      {canSearch && !loading && !error && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No collections found</p>
      )}

      {results.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background/80">
          {results.map((collection) => (
            <button
              key={`${collection.slug}:${collection.contractAddress ?? "pending"}`}
              type="button"
              onClick={() => onSelect(collection)}
              className="flex w-full items-center gap-3 border-b border-border/70 p-3 text-left transition-colors last:border-b-0 hover:bg-ethereum-purple/10"
            >
              <div className="relative h-10 w-10 overflow-hidden rounded-lg border border-border bg-secondary">
                {collection.imageUrl ? (
                  <Image
                    src={collection.imageUrl}
                    alt={`${collection.name} logo`}
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                    NFT
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {collection.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {collection.slug}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {shortAddress(collection.contractAddress)} ·{" "}
                  {chainLabel(collection.chain)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
