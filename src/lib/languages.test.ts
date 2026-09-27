import { describe, expect, it } from "vitest";
import { findLanguage, languages } from "./languages";
import { getReleaseNotes } from "./release-notes";

describe("language configuration", () => {
  it("matches supported system locales without treating Traditional Chinese as Simplified Chinese", () => {
    expect(findLanguage("en-GB")).toBe("en");
    expect(findLanguage("zh-Hans-SG")).toBe("zh");
    expect(findLanguage("ja-JP")).toBe("ja");
    expect(findLanguage("zh-Hant-TW")).toBeUndefined();
    expect(languages.ja.dateLocale.code).toBe("ja");
  });

  it("selects localized release notes and falls back to English", () => {
    const notes = JSON.stringify({ en: "English notes", zh: "中文说明", ja: "日本語の説明" });
    expect(getReleaseNotes(notes, "ja-JP")).toBe("日本語の説明");
    expect(getReleaseNotes(notes, "fr-FR")).toBe("English notes");
    expect(getReleaseNotes('{"en":"English notes","ja":null}', "ja")).toBe("English notes");
    expect(getReleaseNotes("Plain notes", "ja")).toBe("Plain notes");
  });
});
