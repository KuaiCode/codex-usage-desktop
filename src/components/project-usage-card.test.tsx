// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProjectUsageCard } from "./project-usage-card";
import type { OverviewResponse } from "@/lib/api";

vi.mock("./usage-trends-card", () => ({
  UsageTrendsCard: ({ daily, title }: { daily: OverviewResponse["daily"]; title: string }) => (
    <div aria-label={title}>{daily.map((day) => `${day.date}: ${day.totalTokens}`).join(", ")}</div>
  ),
}));

function project(displayName: string, totalTokens: number, costUSD: number): OverviewResponse["projects"][number] {
  const outputTokens = Math.min(totalTokens, 20);
  return { project: `/repo/${displayName}`, displayName, inputTokens: totalTokens - outputTokens, cachedInputTokens: Math.min(totalTokens - outputTokens, 20), outputTokens, totalTokens, costUSD };
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("ProjectUsageCard", () => {
  it("sorts, switches direction, and opens rows with keyboard", async () => {
    const onProjectClick = vi.fn();
    render(<ProjectUsageCard projects={[project("Alpha", 100, 3), project("Bravo", 200, 9)]} onProjectClick={onProjectClick} />);

    const rows = () => screen.getAllByRole("button", { name: /Open analytics/ });
    expect(rows()[0]).toHaveAccessibleName("Open analytics for Bravo");
    screen.getByRole("combobox", { name: "Sort by" }).focus();
    await userEvent.keyboard("[Enter][Home][ArrowDown][ArrowDown][Enter]");
    expect(rows()[0]).toHaveAccessibleName("Open analytics for Alpha");
    await userEvent.click(screen.getByRole("button", { name: "Ascending order" }));
    expect(rows()[0]).toHaveAccessibleName("Open analytics for Bravo");
    rows()[0].focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onProjectClick).toHaveBeenCalledTimes(2);
  });

  it("shows peak badges and relative cost tones", () => {
    render(<ProjectUsageCard projects={[project("Zero", 0, 0), project("Low", 100, 3), project("Medium", 100, 6), project("High", 100, 9)]} />);
    const row = (name: string) => screen.getByText(name).closest("tr")!;
    expect(row("Zero").querySelector("[data-cost-tone='zero']")).toBeInTheDocument();
    expect(row("Low").querySelector("[data-cost-tone='low']")).toBeInTheDocument();
    expect(row("Medium").querySelector("[data-cost-tone='medium']")).toBeInTheDocument();
    expect(row("High").querySelector("[data-cost-tone='high']")).toBeInTheDocument();
    expect(within(row("Zero")).queryByText("Highest")).not.toBeInTheDocument();
    expect(within(row("High")).getAllByText("Highest").length).toBeGreaterThan(0);
  });

  it("sorts by recent activity", async () => {
    render(<ProjectUsageCard projects={[
      { ...project("Alpha", 100, 3), lastActiveDate: "2026-09-01" },
      { ...project("Bravo", 200, 9), lastActiveDate: "2026-09-02" },
    ]} onProjectClick={vi.fn()} />);

    const rows = () => screen.getAllByRole("button", { name: /Open analytics/ });
    screen.getByRole("combobox", { name: "Sort by" }).focus();
    await userEvent.keyboard("[Enter][Home][ArrowDown][Enter]");
    expect(rows()[0]).toHaveAccessibleName("Open analytics for Bravo");
    await userEvent.click(screen.getByRole("button", { name: "Descending order" }));
    expect(rows()[0]).toHaveAccessibleName("Open analytics for Alpha");
  });

  it("uses a Codex project name as an optional label without replacing the cwd", () => {
    render(<ProjectUsageCard projects={[{
      ...project("codex-usage-desktop", 100, 1),
      codexProjectId: "local-app",
      codexProjectName: "Codex Usage Desktop",
      codexProjectRoot: "/repo/codex-usage-desktop",
    }]} />);

    expect(screen.getByText("Codex Usage Desktop")).toBeInTheDocument();
    expect(screen.getByText("Codex project")).toBeInTheDocument();
    expect(screen.getByText("/repo/codex-usage-desktop")).toBeInTheDocument();
    expect(screen.queryByText("codex-usage-desktop", { selector: "p" })).not.toBeInTheDocument();
  });

  it("shows each project's daily values and updates them with the selected range", () => {
    const alpha = project("Alpha", 100, 3);
    const bravo = project("Bravo", 200, 9);
    const daily = (date: string, totalTokens: number): OverviewResponse["daily"][number] => ({
      date, inputTokens: totalTokens, cachedInputTokens: 0, outputTokens: 0, totalTokens, costUSD: 0,
    });
    const { rerender } = render(<ProjectUsageCard projects={[alpha, bravo]} projectDaily={{
      [alpha.project]: [daily("2026-09-27", 10), daily("2026-09-28", 90)],
      [bravo.project]: [daily("2026-09-27", 200), daily("2026-09-28", 0)],
    }} />);

    expect(screen.getByLabelText("Daily trend: Alpha")).toHaveTextContent("2026-09-27: 10, 2026-09-28: 90");
    expect(screen.getByLabelText("Daily trend: Bravo")).toHaveTextContent("2026-09-27: 200, 2026-09-28: 0");

    rerender(<ProjectUsageCard projects={[alpha, bravo]} projectDaily={{
      [alpha.project]: [daily("2026-09-28", 90)],
      [bravo.project]: [daily("2026-09-28", 0)],
    }} />);

    expect(screen.getByLabelText("Daily trend: Alpha")).toHaveTextContent("2026-09-28: 90");
    expect(screen.getByLabelText("Daily trend: Alpha")).not.toHaveTextContent("2026-09-27");
  });
});
