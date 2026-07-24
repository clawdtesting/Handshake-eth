"use client";

import { useEffect, useState } from "react";
import {
  clearTxLog,
  subscribeTxLog,
  type TxLogRecord,
} from "@/lib/chains/tx-log";

/**
 * Developer-only transaction debug panel. Renders nothing in production. In
 * development it shows the structured lifecycle of every on-chain write
 * (prepare → validate → simulate → submit → receipt → success/error) with the
 * wallet, chain, contract, function, args, tx hash, receipt status, and any
 * decoded revert reason — so failing flows are diagnosable at a glance.
 */
export function TxDebugPanel() {
  const [records, setRecords] = useState<TxLogRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeTxLog(setRecords), []);

  if (process.env.NODE_ENV === "production") return null;

  const errors = records.filter((r) => r.phase === "error").length;

  return (
    <div className="fixed bottom-3 left-3 z-[100] font-mono text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-ethereum-purple/40 bg-background/90 px-2.5 py-1.5 text-[11px] text-ethereum-purple shadow-lg backdrop-blur"
      >
        tx log ({records.length}){errors > 0 ? ` · ${errors} err` : ""}
      </button>

      {open && (
        <div className="mt-2 max-h-[60vh] w-[min(92vw,28rem)] overflow-y-auto rounded-lg border border-ethereum-purple/30 bg-background/95 p-2 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground">transaction log</span>
            <button
              type="button"
              onClick={() => clearTxLog()}
              className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          </div>
          {records.length === 0 ? (
            <p className="px-1 py-3 text-center text-muted-foreground">
              No transactions yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {records
                .slice()
                .reverse()
                .map((r, i) => (
                  <li
                    key={`${r.id}-${r.phase}-${i}`}
                    className={`rounded border px-2 py-1 ${
                      r.phase === "error"
                        ? "border-red-500/40 bg-red-500/10 text-red-300"
                        : r.phase === "success"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-border/60 bg-secondary/30 text-foreground/80"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{r.label}</span>
                      <span className="text-[10px] uppercase tracking-wide">
                        {r.phase}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {r.functionName}
                      {r.chainId !== undefined ? ` · chain ${r.chainId}` : ""}
                      {r.simulationOk === false ? " · sim✗" : ""}
                      {r.simulationOk === true ? " · sim✓" : ""}
                    </div>
                    {r.txHash && (
                      <div className="truncate text-[10px] text-ethereum-purple">
                        {r.txHash}
                      </div>
                    )}
                    {r.receiptStatus && (
                      <div className="text-[10px]">
                        receipt: {r.receiptStatus}
                      </div>
                    )}
                    {r.errorName && (
                      <div className="text-[10px]">
                        {r.errorName}
                        {r.revertReason ? ` (${r.revertReason})` : ""}:{" "}
                        {r.errorMessage}
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
