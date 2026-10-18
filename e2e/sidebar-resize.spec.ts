import { $, browser, expect } from "@wdio/globals";

describe("sidebar resizing", () => {
  it("drags within width limits and preserves the width across collapse and settings", async () => {
    await browser.execute(() => localStorage.setItem("language", "en"));
    await browser.refresh();
    const sidebar = $("[data-app-sidebar]");
    const handle = $('[role="separator"][aria-label="Resize sidebar"]');
    await handle.waitForDisplayed();
    expect(await sidebar.getSize("width")).toBe(208);

    const dragBy = async (delta: number) => {
      const { x, y } = await handle.getLocation();
      await browser.action("pointer")
        .move({ x: Math.round(x + 4), y: Math.round(y + 100) })
        .down()
        .move({ x: Math.round(x + 4 + delta), y: Math.round(y + 100), duration: 300 })
        .up()
        .perform();
    };
    const expectWidth = async (width: number) => {
      await expect(handle).toHaveAttribute("aria-valuenow", String(width));
      expect(await sidebar.getSize("width")).toBe(width);
      expect(await $("[data-app-content]").getLocation("x")).toBe(width);
    };

    await dragBy(80);
    await expectWidth(288);
    await dragBy(300);
    await expectWidth(360);
    await dragBy(-300);
    await expectWidth(160);
    await dragBy(96);
    await expectWidth(256);

    // Releasing the pointer ends the drag, including outside the handle.
    await browser.action("pointer").move({ x: 500, y: 100 }).perform();
    await expectWidth(256);

    await $('button[aria-label="Collapse sidebar"]').click();
    expect(await sidebar.getSize("width")).toBe(64);
    await expect(handle).not.toBeExisting();
    await $('button[aria-label="Expand sidebar"]').click();
    await expectWidth(256);

    await $('button[aria-label="Settings"]').click();
    await expect($("h1=Settings")).toBeDisplayed();
    await expect(sidebar).not.toBeExisting();
    await $("button=Back").click();
    await expectWidth(256);

    await handle.execute((element) => element.focus());
    await browser.keys("ArrowRight");
    await expectWidth(264);
    await browser.keys("ArrowLeft");
    await expectWidth(256);
    await browser.saveScreenshot("/tmp/codex-usage-sidebar-resize.png");
  }).timeout(180_000);
});
