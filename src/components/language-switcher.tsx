"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: locale === "ar" ? "en" : "ar" })}
      className="text-sm font-semibold text-accent hover:underline"
    >
      {t("language")}
    </button>
  );
}
