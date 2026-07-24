"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Single source of truth for the "Expires in" selector shared by the Deal
 * creation flow (app/create) and the Wanted board (app/wanted). Presets are
 * expressed in seconds so callers can compute an absolute expiry from a signed
 * timestamp.
 */
export const EXPIRY_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "4 hour", seconds: 14400 },
  { label: "12 hours", seconds: 43200 },
  { label: "1 days", seconds: 86400 },
];

export const DEFAULT_EXPIRY_SECONDS = 86400;

export function formatExpiryLabel(seconds: number) {
  const preset = EXPIRY_OPTIONS.find((e) => e.seconds === seconds);
  if (preset) return preset.label;

  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} custom day${days === 1 ? "" : "s"}`;
  }

  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} custom hour${hours === 1 ? "" : "s"}`;
  }

  return `${Math.round(seconds / 3600)} custom hours`;
}

export function ExpirySelector({
  value,
  onChange,
  label = "Expires in",
  helpText = "Enter any positive duration. The listing expires after this amount of time.",
}: {
  value: number;
  onChange: (seconds: number) => void;
  label?: string;
  helpText?: string;
}) {
  const [customExpiryValue, setCustomExpiryValue] = useState("");
  const [customExpiryUnit, setCustomExpiryUnit] = useState<"hours" | "days">(
    "hours",
  );
  const [showCustomExpiry, setShowCustomExpiry] = useState(false);

  const customExpirySeconds =
    Number(customExpiryValue) *
    (customExpiryUnit === "hours" ? 60 * 60 : 24 * 60 * 60);

  function applyCustomExpiry(inputValue: string, unit: "hours" | "days") {
    setCustomExpiryValue(inputValue);
    const numeric = Number(inputValue);
    if (Number.isFinite(numeric) && numeric > 0) {
      onChange(
        Math.round(numeric * (unit === "hours" ? 60 * 60 : 24 * 60 * 60)),
      );
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="flex flex-wrap gap-2">
        {EXPIRY_OPTIONS.map((opt) => (
          <Button
            key={opt.seconds}
            type="button"
            size="sm"
            variant={value === opt.seconds ? "default" : "secondary"}
            onClick={() => {
              onChange(opt.seconds);
              setShowCustomExpiry(false);
            }}
          >
            {opt.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={
            showCustomExpiry && value === customExpirySeconds
              ? "default"
              : "secondary"
          }
          onClick={() => setShowCustomExpiry(true)}
        >
          Custom
        </Button>
      </div>

      {showCustomExpiry && (
        <div className="mt-3 grid gap-2 rounded-lg border border-ethereum-purple/30 bg-ethereum-purple/5 p-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Input
            placeholder="Custom time"
            inputMode="decimal"
            value={customExpiryValue}
            onChange={(e) => applyCustomExpiry(e.target.value, customExpiryUnit)}
          />
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={customExpiryUnit}
            onChange={(e) => {
              const unit = e.target.value as "hours" | "days";
              setCustomExpiryUnit(unit);
              applyCustomExpiry(customExpiryValue, unit);
            }}
          >
            <option value="hours">Hours</option>
            <option value="days">Days</option>
          </select>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {helpText}
          </p>
        </div>
      )}
    </div>
  );
}
