import { $, browser, expect } from "@wdio/globals";

describe("project details", () => {
  it("fills the native window and preserves project state when returning from a session", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      await browser.refresh();
      const tab = $('[data-testid="projects-nav-tab"]');
      await tab.waitForDisplayed({ timeout: 90_000 });
      await tab.click();
      await $('[data-testid="project-comparison"] tbody tr[role="button"]').waitForDisplayed({ timeout: 90_000 });
      const rowIndex = await browser.execute(() => [...document.querySelectorAll('[data-testid="project-comparison"] tbody tr[role="button"]')].findIndex((row) => row.querySelector("td > p")?.textContent?.trim()));
      expect(rowIndex).toBeGreaterThanOrEqual(0);
      const trigger = $(`[data-testid="project-comparison"] tbody tr[role="button"]:nth-child(${rowIndex + 1})`);
      await trigger.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" }));
      await trigger.click();

      const project = $('[role="dialog"][aria-labelledby="modal-project-title"]');
      await project.waitForDisplayed();
      await $('[aria-labelledby="modal-project-title"] [data-testid="session-card"]').waitForExist({ timeout: 90_000 });
      await $('[data-testid="project-daily-trend"] .recharts-surface').waitForExist();
      const layout = await browser.execute(() => {
        const modal = document.querySelector('[aria-labelledby="modal-project-title"]')!;
        const rect = modal.getBoundingClientRect();
        const chart = modal.querySelector('[data-testid="project-daily-trend"]')!.getBoundingClientRect();
        const scroll = modal.querySelector('[data-testid="project-modal-scroll"]')!;
        const groups = modal.querySelectorAll('[id^="date-group-"]');
        return {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          windowWidth: window.innerWidth, windowHeight: window.innerHeight,
          chartWidth: chart.width, scrollWidth: scroll.clientWidth,
          selectedRange: modal.textContent!.includes("Sessions within the selected date range"),
          modelShare: modal.textContent!.includes("Model token share"),
          backgroundInert: document.querySelector("main")!.closest("[inert]") !== null,
          scrollable: scroll.scrollHeight > scroll.clientHeight,
          projectPath: modal.querySelector("header p[title]")!.getAttribute("title")!,
          secondGroupId: groups[1]?.id,
          secondGroupExpanded: groups[1]?.querySelector("button")?.getAttribute("aria-expanded"),
        };
      });
      expect(layout.x).toBe(0);
      expect(layout.y).toBe(0);
      expect(layout.width).toBe(layout.windowWidth);
      expect(layout.height).toBe(layout.windowHeight);
      expect(layout.chartWidth).toBeGreaterThan(layout.scrollWidth * 0.9);
      expect(layout.selectedRange).toBe(true);
      expect(layout.modelShare).toBe(false);
      expect(layout.backgroundInert).toBe(true);
      expect(layout.scrollable).toBe(true);
      expect(layout.secondGroupExpanded).toBe("false");

      const query = layout.projectPath[0];
      expect(query).toBeTruthy();
      const search = $('[aria-label="Search project sessions"]');
      await search.setValue(query);
      await browser.waitUntil(async () => browser.execute(() => document.querySelector('[aria-labelledby="modal-project-title"]')!.textContent!.includes("matching sessions")));
      const collapse = $(`#${layout.secondGroupId} > button`);
      await expect(collapse).toHaveAttribute("aria-expanded", "false");
      await collapse.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" }));
      await collapse.click();
      await $(`#${layout.secondGroupId} [data-testid="session-card"]`).waitForExist({ timeout: 90_000 });
      await collapse.click();
      const card = $('[aria-labelledby="modal-project-title"] [data-testid="session-card"]');
      await card.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center", inline: "center" }));
      const beforeDetail = await browser.execute(() => ({
        headerTop: document.querySelector('[data-testid="project-modal-header"]')!.getBoundingClientRect().top,
        scrollTop: document.querySelector('[data-testid="project-modal-scroll"]')!.scrollTop,
      }));
      expect(beforeDetail.headerTop).toBe(0);
      expect(beforeDetail.scrollTop).toBeGreaterThan(0);
      await card.click();
      const detail = $('[role="dialog"][aria-labelledby="session-detail-title"]');
      await detail.waitForDisplayed();
      const detailState = await browser.execute(() => ({
        projectInert: document.querySelector<HTMLElement>('[aria-labelledby="modal-project-title"]')!.inert,
        focusLabel: document.activeElement?.getAttribute("aria-label"),
      }));
      expect(detailState.projectInert).toBe(true);
      expect(detailState.focusLabel).toBe("Close session detail");
      await browser.keys("Escape");
      await detail.waitForExist({ reverse: true });
      const restored = await browser.execute((groupId) => ({
        search: document.querySelector<HTMLInputElement>('[aria-label="Search project sessions"]')!.value,
        expanded: document.getElementById(groupId)!.querySelector("button")!.getAttribute("aria-expanded"),
        cardFocused: document.activeElement === document.querySelector('[aria-labelledby="modal-project-title"] [data-testid="session-card"]'),
        scrollTop: document.querySelector('[data-testid="project-modal-scroll"]')!.scrollTop,
      }), layout.secondGroupId!);
      expect(restored.search).toBe(query);
      expect(restored.expanded).toBe("false");
      expect(restored.cardFocused).toBe(true);
      expect(restored.scrollTop).toBe(beforeDetail.scrollTop);
      await browser.keys("Escape");
      await project.waitForExist({ reverse: true });
      const closed = await browser.execute((index) => ({
        triggerFocused: document.activeElement === document.querySelector(`[data-testid="project-comparison"] tbody tr[role="button"]:nth-child(${index + 1})`),
        dialogs: document.querySelectorAll('[role="dialog"]').length,
      }), rowIndex);
      expect(closed.triggerFocused).toBe(true);
      expect(closed.dialogs).toBe(0);
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(300_000);
});
