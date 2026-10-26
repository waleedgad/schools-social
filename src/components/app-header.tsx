import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { signOut } from "@/lib/actions/auth";
import { LanguageSwitcher } from "./language-switcher";

export async function AppHeader({ locale, signedIn }: { locale: string; signedIn: boolean }) {
  const t = await getTranslations("common");
  const app = await getTranslations("app");

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-bold">
          {app("name")}
        </Link>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          {signedIn && (
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <button className="text-sm text-muted hover:underline">{t("signOut")}</button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

export function PageBody({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <main className={`mx-auto space-y-6 px-4 py-10 ${narrow ? "max-w-md" : "max-w-4xl"}`}>
      {children}
    </main>
  );
}
