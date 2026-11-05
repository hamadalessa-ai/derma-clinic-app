import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { directionOf, type Locale } from "@/i18n/config";
import { RegisterServiceWorker } from "@/components/register-sw";
import { Toaster } from "@/components/ui/toast";
import { THEME } from "./theme";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** Times, file numbers and codes (always left-to-right). */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "منصة العيادات | Clinic Platform (Demo)",
  description: "Demo — fake data only",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "العيادة", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: THEME.brand };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = (await getLocale()) as Locale;
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${plexArabic.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Toaster>{children}</Toaster>
        </NextIntlClientProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
