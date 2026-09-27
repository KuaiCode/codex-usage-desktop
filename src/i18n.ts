import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { findLanguage, languageCodes, languages } from "./lib/languages";

// Initialize language from localStorage or navigator language
const getInitialLanguage = (): string => {
  try {
    const saved = localStorage.getItem("language");
    if (saved && languageCodes.includes(saved as (typeof languageCodes)[number])) {
      return saved;
    }
  } catch (e) {
    // Ignore localStorage errors (e.g. in environments where it's disabled)
  }

  // Try browser language fallback
  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const browserLang of browserLanguages) {
    const language = findLanguage(browserLang);
    if (language) return language;
  }
  return "en";
};

void i18n
  .use(initReactI18next)
  .init({
    resources: Object.fromEntries(languageCodes.map((code) => [code, { translation: languages[code].translations }])),
    lng: getInitialLanguage(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already protects against XSS
    },
  });

export default i18n;
