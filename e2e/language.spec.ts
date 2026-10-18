import { $, browser, expect } from "@wdio/globals";

describe("language startup", () => {
  it("uses the saved language in the native app", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "ja"));
      await browser.refresh();
      await expect($('//button[@aria-label="設定"]')).toBeDisplayed();
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  });

  it("switches from English to Traditional Chinese and restores it after refresh", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      await browser.refresh();
      const settingsTab = $('//button[@aria-label="Settings"]');
      await expect(settingsTab).toBeDisplayed();
      await settingsTab.click();

      const languageSelect = $('//button[@role="combobox" and normalize-space()="English"]');
      await expect(languageSelect).toBeDisplayed();
      await languageSelect.waitForEnabled();
      await languageSelect.click();
      const traditionalOption = $('//*[@role="option" and normalize-space()="繁體中文"]');
      await expect(traditionalOption).toBeDisplayed();
      await traditionalOption.click();

      const translatedSettingsTab = $('//button[@aria-label="設定"]');
      await expect($('h1=設定')).toBeDisplayed();
      await expect($('h3=語言設定')).toBeDisplayed();
      await expect($('//button[@role="combobox" and normalize-space()="繁體中文"]')).toBeDisplayed();
      expect(await browser.execute(() => localStorage.getItem("language"))).toBe("zh-Hant");

      await browser.refresh();
      await expect(translatedSettingsTab).toBeDisplayed();
      await translatedSettingsTab.click();
      await expect($('h3=語言設定')).toBeDisplayed();
      await expect($('//button[@role="combobox" and normalize-space()="繁體中文"]')).toBeDisplayed();
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
      await browser.refresh();
    }
  });
});
