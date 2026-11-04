import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ErrorReporter } from "@/components/error-reporter";
import { routing } from "@/i18n/routing";
import "../globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const plex = IBM_Plex_Sans_Arabic({ subsets: ["arabic"], weight: ["400", "500", "600", "700"], variable: "--font-plex" });

// Applies the saved light/dark choice before the page paints.
const THEME = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
// Catches errors from the very start (even before the page is ready) and hands
// them to the error reporter once it loads (components/error-reporter.tsx).
const ERRORS = `(function(){var q=window.__errq=[];function add(m,s){if(window.__report)window.__report(m,s);else if(q.length<20)q.push([m,s])}addEventListener("error",function(e){if(e.message||e.error)add(e.message||String(e.error),e.error&&e.error.stack)});addEventListener("unhandledrejection",function(e){var r=e.reason;add(r&&r.message||String(r),r&&r.stack)})})()`;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return { title: t("name"), description: t("tagline") };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
        <script dangerouslySetInnerHTML={{ __html: ERRORS }} />
      </head>
      <body className={`${inter.variable} ${plex.variable} antialiased`}>
        <ErrorReporter />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
