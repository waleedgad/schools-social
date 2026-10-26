"use client";

import { useState } from "react";

export function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-sm font-semibold text-accent hover:underline"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
