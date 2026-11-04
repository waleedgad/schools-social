"use client";

import { useTransition } from "react";
import { signOut } from "@/lib/actions/auth";

// Sign out as a plain button. A server-action <form> here sometimes failed
// to hydrate when the server was busy (bug B-25: React error #418 on random
// pages, always at this form), so the action is called from a click instead.
export function SignOutButton({ locale, label, className }: { locale: string; label: string; className: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("locale", locale);
          await signOut(fd);
        })
      }
    >
      {label}
    </button>
  );
}
