"use client";

import { Button } from "./ui";

// Opens the browser's print window, where "Save as PDF" is one of the choices.
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="quiet" icon="download" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
