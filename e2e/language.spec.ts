import { $, browser, expect } from "@wdio/globals";

describe("language startup", () => {
  it("uses the saved language in the native app", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "ja"));
      await browser.refresh();
      await expect($('//button[@role="tab" and normalize-space()="設定"]')).toBeDisplayed();
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  });
});
