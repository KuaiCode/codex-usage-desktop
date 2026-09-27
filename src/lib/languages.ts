import { enUS, ja, zhCN } from "date-fns/locale";
import en from "@/locales/en.json";
import jaTranslations from "@/locales/ja.json";
import zh from "@/locales/zh.json";

export const languages = {
  en: { name: "English", translations: en, dateLocale: enUS, intlLocale: "en-US", systemLocales: ["en"] },
  zh: { name: "简体中文", translations: zh, dateLocale: zhCN, intlLocale: "zh-CN", systemLocales: ["zh-CN", "zh-SG", "zh-Hans"] },
  ja: { name: "日本語", translations: jaTranslations, dateLocale: ja, intlLocale: "ja-JP", systemLocales: ["ja"] },
} as const;

export type Language = keyof typeof languages;
export const languageCodes = Object.keys(languages) as Language[];

export function findLanguage(locale: string): Language | undefined {
  const normalized = locale.toLowerCase();
  return languageCodes.find((code) =>
    normalized === code || languages[code].systemLocales.some((systemLocale) => {
      const supported = systemLocale.toLowerCase();
      return normalized === supported || normalized.startsWith(`${supported}-`);
    }),
  );
}

export function getLanguage(locale: string): Language {
  return findLanguage(locale) ?? "en";
}
