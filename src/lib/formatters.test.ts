import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { formatCompactNumber, formatCurrency, formatNumber, formatPercent } from "./formatters";

describe("localized number formatting", () => {
  const originalLanguage = i18n.language;

  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  it("uses the active language while keeping costs in USD", async () => {
    await i18n.changeLanguage("en");
    expect(formatNumber(1234567)).toBe(new Intl.NumberFormat("en-US").format(1234567));
    const englishCompact = formatCompactNumber(1_000_000);

    await i18n.changeLanguage("zh");
    expect(formatCompactNumber(1_000_000)).toBe(new Intl.NumberFormat("zh-CN", {
      notation: "compact", maximumFractionDigits: 2,
    }).format(1_000_000));
    expect(formatCompactNumber(1_000_000)).not.toBe(englishCompact);

    await i18n.changeLanguage("ja");
    expect(formatNumber(1234567)).toBe(new Intl.NumberFormat("ja-JP").format(1234567));
    expect(formatCurrency(12.5)).toBe(new Intl.NumberFormat("ja-JP", {
      style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4,
    }).format(12.5));
    expect(formatPercent(0.125)).toBe(new Intl.NumberFormat("ja-JP", {
      style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(0.125));
  });
});
