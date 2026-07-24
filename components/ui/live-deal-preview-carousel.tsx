'use client';

import { Card, CardContent } from '@/components/ui/card';
import { SafeCollectionImage } from '@/components/ui/safe-collection-image';
import { FEATURED_COLLECTIONS } from '@/lib/featured-collections';

export default function LiveDealPreviewCarousel() {
  const collections = FEATURED_COLLECTIONS.slice(0, 6); // show first 6 as examples

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-6 rounded-[2rem] bg-ethereum-purple/20 blur-3xl" />
      <Card className="relative overflow-hidden border-ethereum-purple/30 bg-gradient-to-br from-card/95 via-ethereum-purple/10 to-cyan-400/10 shadow-2xl shadow-ethereum-purple/10">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ethereum-purple">
                Live deal preview
              </p>
              <h3 className="text-xl font-semibold">Human deal, wallet settled</h3>
            </div>
            <span className="rounded-full border border-ethereum-purple/40 bg-ethereum-purple/10 px-3 py-1 text-xs text-ethereum-purple">
              No custody
            </span>
          </div>

          <div className="overflow-x-auto whitespace-nowrap scrollbar-hidden">
            <div className="inline-flex space-x-4">
              {collections.map((collection) => (
                <div
                  key={collection.address}
                  className="flex-shrink-0 flex items-center gap-3 rounded-xl border border-ethereum-purple/20 bg-background/60 p-3"
                >
                  <SafeCollectionImage
                    collectionAddress={collection.address}
                    alt={collection.name}
                    className="h-12 w-12 rounded-full"
                  />
                  <span className="font-medium text-foreground">{collection.name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Settlement</span>
              <span className="text-ethereum-purple">1 transaction</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full w-4/5 rounded-full bg-gradient-to-r from-ethereum-purple to-fuchsia-400" />
            </div>
            <p className="mt-2 text-xs text-foreground">
              Both wallets sign. The contract verifies ownership, approvals, and
              terms before anything moves.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
