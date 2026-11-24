import { getTranslations, setRequestLocale } from "next-intl/server";
import { OwnerShell } from "@/components/owner-shell";
import { Button, Chip, Notice } from "@/components/ui";
import { testKey } from "@/lib/actions/owner";
import { supabaseProviders } from "@/lib/auth-providers";
import { keyStatus, type KeyStatus } from "@/lib/integrations";
import { requireOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

// Owner > Keys and switches (release 0.17): every free key the website can
// use, whether it is on, the exact name to add in Vercel and where the key
// comes from. Only names are shown, never a key's value.
export default async function OwnerKeysPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ test?: string; result?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireOwner(locale);
  const sp = await searchParams;
  const t = await getTranslations();
  const items = keyStatus(process.env, await supabaseProviders());
  const groups: KeyStatus["when"][] = ["now", "schools", "later"];

  return (
    <OwnerShell locale={locale} active="keys" title={t("owner.keys.title")}>
      <p className="text-sm text-muted">{t("owner.keys.intro")}</p>
      {sp.test && <Notice tone={sp.result === "ok" ? "good" : "danger"}>{t(`owner.keys.test.${sp.result === "ok" ? "ok" : "fail"}`, { name: t(`owner.keys.items.${sp.test === "meta" ? "meta" : "gemini"}.name`) })}</Notice>}
      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-base font-bold">{t(`owner.keys.when.${g}`)}</h2>
          <ul className="divide-y divide-border card" aria-label={t(`owner.keys.when.${g}`)}>
            {items
              .filter((k) => k.when === g)
              .map((k) => (
                <li key={k.key} className="space-y-1.5 px-4 py-3 text-sm" data-key={k.key}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{t(`owner.keys.items.${k.key}.name`)}</b>
                    <Chip tone={k.on ? "good" : g === "later" ? "grey" : "warn"}>{k.on ? t("owner.keys.on") : t("owner.keys.off")}</Chip>
                  </div>
                  <p className="text-muted">{t(`owner.keys.items.${k.key}.what`)}</p>
                  {!k.on && (
                    <div className="space-y-1">
                      {k.supabase ? (
                        <p>{t("owner.keys.inSupabase")}</p>
                      ) : (
                        <p>
                          {t("owner.keys.add")}{" "}
                          {k.missing.map((v) => (
                            <code key={v} dir="ltr" className="me-1 rounded bg-foreground/[.06] px-1.5 py-0.5 text-xs">
                              {v.split("|")[0]}
                            </code>
                          ))}
                        </p>
                      )}
                      <p className="text-xs text-muted">{t(`owner.keys.items.${k.key}.how`)}</p>
                    </div>
                  )}
                  {k.optional && k.optional.length > 0 && (
                    <p className="text-xs text-muted">
                      {t("owner.keys.optional")}{" "}
                      {k.optional.map((v) => (
                        <code key={v} dir="ltr" className="me-1 rounded bg-foreground/[.06] px-1.5 py-0.5">
                          {v}
                          {k.optionalSet.includes(v) ? " ✓" : ""}
                        </code>
                      ))}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <a href={k.where} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent-ink hover:underline">
                      {t("owner.keys.where")}
                    </a>
                    {k.test && k.on && (
                      <form action={testKey}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="key" value={k.test} />
                        <Button variant="quiet" icon="check" className="!px-2.5 !py-1 text-xs">
                          {t("owner.keys.testButton")}
                        </Button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted">{t("owner.keys.redeploy")}</p>
    </OwnerShell>
  );
}
