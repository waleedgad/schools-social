import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/shell";
import { Button, Card, Notice, Select, TextArea } from "@/components/ui";
import { reportProblem } from "@/lib/actions/support";
import { requireMembership } from "@/lib/session";

const GUIDES = ["start", "post", "approve", "calendar", "brand", "mac", "upload", "pause"] as const;
const NEWS = ["n1", "n2", "n3", "n4", "n5", "n6"] as const;

// Help centre: short guides, a guide for the person's own role, what's new,
// keyboard shortcuts and "report a problem".
export default async function HelpPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ reported?: string; q?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { membership, workspaces } = await requireMembership(locale);
  const sp = await searchParams;
  const t = await getTranslations();
  const q = (sp.q ?? "").trim().toLowerCase();
  const guides = GUIDES.filter((g) => !q || `${t(`help.guides.${g}.title`)} ${t(`help.guides.${g}.body`)}`.toLowerCase().includes(q));
  const whatsapp = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");

  return (
    <AppShell locale={locale} membership={membership} workspaces={workspaces} active="help" title={t("help.title")} subtitle={t("help.subtitle")}>
      {sp.reported && <Notice tone="good">{t("help.reported")}</Notice>}
      <form className="flex gap-2">
        <input name="q" defaultValue={sp.q} placeholder={t("help.search")} className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" />
        <Button variant="quiet" icon="search">{t("help.searchButton")}</Button>
      </form>
      <Card title={t("help.yourRole", { role: t(`roles.${membership.role}`) })}>
        <p className="whitespace-pre-line text-sm">{t(`help.roles.${membership.role}`)}</p>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {guides.map((g) => (
          <details key={g} className="rounded-xl border border-border bg-surface p-4 open:shadow-sm">
            <summary className="cursor-pointer font-semibold">{t(`help.guides.${g}.title`)}</summary>
            <p className="mt-2 whitespace-pre-line text-sm text-muted">{t(`help.guides.${g}.body`)}</p>
          </details>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("help.news")}>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {NEWS.map((n) => (
              <li key={n}>{t(`help.whatsNew.${n}`)}</li>
            ))}
          </ul>
        </Card>
        <Card title={t("help.report")}>
          <form action={reportProblem} className="space-y-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="page" value="/help" />
            <Select label={t("help.kind")} name="kind" defaultValue="problem">
              <option value="problem">{t("help.kinds.problem")}</option>
              <option value="idea">{t("help.kinds.idea")}</option>
              <option value="question">{t("help.kinds.question")}</option>
            </Select>
            <TextArea label={t("help.what")} name="body" rows={4} required maxLength={2000} />
            <Button>{t("help.send")}</Button>
            {whatsapp && (
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-good">
                {t("help.whatsapp")}
              </a>
            )}
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
