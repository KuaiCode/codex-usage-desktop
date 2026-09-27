import i18n from "@/i18n";
import { getLanguage, languageCodes, languages } from "@/lib/languages";

const formatters = Object.fromEntries(languageCodes.map((code) => {
  const locale = languages[code].intlLocale;
  return [code, {
    number: new Intl.NumberFormat(locale),
    currency: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }),
    currencyShort: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    compactNumber: new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 2,
    }),
    percent: new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  }];
})) as Record<(typeof languageCodes)[number], {
  number: Intl.NumberFormat;
  currency: Intl.NumberFormat;
  currencyShort: Intl.NumberFormat;
  compactNumber: Intl.NumberFormat;
  percent: Intl.NumberFormat;
}>;

function currentFormatters() {
  return formatters[getLanguage(i18n.resolvedLanguage ?? i18n.language)];
}

export function formatNumber(value: number) {
  return currentFormatters().number.format(Math.round(value));
}

export function formatCompactNumber(value: number) {
  if (Math.abs(value) < 1_000_000) {
    return formatNumber(value);
  }

  return currentFormatters().compactNumber.format(value);
}

export function formatCurrency(value: number) {
  return currentFormatters().currency.format(value);
}

export function formatCurrencyShort(value: number) {
  return currentFormatters().currencyShort.format(value);
}

export function formatPercent(value: number) {
  return currentFormatters().percent.format(value);
}
