import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

// No locale in the URL: the language comes from a cookie, Arabic by default.
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;
  return {
    locale,
    timeZone: "Asia/Riyadh",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
