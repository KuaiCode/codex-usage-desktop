// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSessionDaysResponse, SessionDetailRow } from "@/lib/api";
import { ProjectSessionsModal } from "./project-sessions-modal";
import { ProjectSessionDayView } from "./project-session-day";
import i18n from "@/i18n";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const project = { project: "/repo/app", displayName: "app", totalTokens: 140, costUSD: 0.001 };
const day = (date: string) => ({ date, sessionCount: 1, totalTokens: 140, costUSD: 0.001 });
const response = (dates: string[], nextBefore: string | null = null): ProjectSessionDaysResponse => ({
  startDate: "2026-07-01", endDate: "2026-07-10", timezone: "UTC", totalSessions: 10, matchingSessions: 10,
  days: dates.map(day), nextBefore,
});
const session = (date: string, index = 0): SessionDetailRow => ({
  path: `/tmp/task-${index}.jsonl`, sessionId: `task-${index}`, threadName: `Task ${index}`,
  modifiedAtMs: Date.parse(`${date}T08:00:00Z`) - index, sizeBytes: 100,
  inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 0, totalTokens: 140, costUSD: 0.001,
  models: ["gpt-5"], projects: [project.project],
  dailyUsage: [{ ...day(date), inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 0, models: ["gpt-5"], projects: [project.project] }],
});

function renderModal(range = "custom:2026-07-01_2026-07-10") {
  return render(<ProjectSessionsModal project={project} range={range} onClose={vi.fn()} onGoToSessions={vi.fn()} />);
}

describe("project session pagination", () => {
  beforeEach(async () => {
    invoke.mockReset();
    await i18n.changeLanguage("en");
  });

  it("appends days without loading their details or changing the session count", async () => {
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") throw new Error("analytics offline");
      if (command === "fetch_project_session_days") return args.before ? response(["2026-07-03", "2026-07-02", "2026-07-01"]) : response(["2026-07-10", "2026-07-09", "2026-07-08", "2026-07-07", "2026-07-06", "2026-07-05", "2026-07-04"], "2026-07-04");
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    const first = document.getElementById("date-group-2026-07-10")!;
    await userEvent.click(within(first).getAllByRole("button")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(document.querySelectorAll('[id^="date-group-"]')).toHaveLength(10));
    expect(document.getElementById("date-group-2026-07-10")).toBe(first);
    expect(within(first).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Load more days" })).not.toBeInTheDocument();
    expect(invoke.mock.calls.filter(([command]) => command === "fetch_project_day_sessions")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", { project: project.project, range: "custom:2026-07-01_2026-07-10", query: "", before: "2026-07-04" });
  });

  it("searches dates that have not been loaded and ignores an old pagination response", async () => {
    let completeMore!: (value: ProjectSessionDaysResponse) => void;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") throw new Error("analytics offline");
      if (command === "fetch_project_session_days") {
        if (args.query) return { ...response(["2026-07-01"]), matchingSessions: 1 };
        if (args.before) return new Promise<ProjectSessionDaysResponse>((resolve) => { completeMore = resolve; });
        return response(["2026-07-10"], "2026-07-10");
      }
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search project sessions" }), "old task");
    await waitFor(() => expect(document.getElementById("date-group-2026-07-01")).toBeInTheDocument());
    expect(screen.getByText("Showing 1 matching sessions")).toBeInTheDocument();
    await act(async () => completeMore(response(["2026-07-09"])));
    expect(document.getElementById("date-group-2026-07-09")).toBeNull();
    expect(document.getElementById("date-group-2026-07-10")).toBeNull();
  });

  it("retries a failed append while preserving existing days", async () => {
    let attempts = 0;
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") throw new Error("analytics offline");
      if (command === "fetch_project_session_days") {
        if (!args.before) return response(["2026-07-10"], "2026-07-10");
        if (++attempts === 1) throw new Error("page unavailable");
        return response(["2026-07-09"]);
      }
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    renderModal();
    await screen.findByText("Task 0");
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("page unavailable");
    expect(screen.getByText("Task 0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more days" }));
    await waitFor(() => expect(document.getElementById("date-group-2026-07-09")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets loaded days when the selected range changes", async () => {
    invoke.mockImplementation(async (command: string, args: any) => {
      if (command === "fetch_project_analytics") throw new Error("analytics offline");
      if (command === "fetch_project_session_days") return response([args.range === "1d" ? "2026-07-10" : "2026-07-01"]);
      if (command === "fetch_project_day_sessions") return [session(args.date)];
      throw new Error(command);
    });
    const { rerender } = renderModal();
    await waitFor(() => expect(document.getElementById("date-group-2026-07-01")).toBeInTheDocument());
    rerender(<ProjectSessionsModal project={project} range="1d" onClose={vi.fn()} onGoToSessions={vi.fn()} />);
    await waitFor(() => expect(document.getElementById("date-group-2026-07-10")).toBeInTheDocument());
    expect(document.getElementById("date-group-2026-07-01")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("fetch_project_session_days", expect.objectContaining({ range: "1d" }));
  });

  it("loads a day on expansion, retries failures and limits initially rendered sessions", async () => {
    let attempts = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command !== "fetch_project_day_sessions") throw new Error(command);
      if (++attempts === 1) throw new Error("day unavailable");
      return Array.from({ length: 65 }, (_, index) => session("2026-07-10", index));
    });
    render(<ProjectSessionDayView day={{ ...day("2026-07-10"), sessionCount: 65 }} project={project.project} range="7d" query="" initiallyExpanded={false} />);
    expect(invoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("day unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByTestId("session-card")).toHaveLength(30));
    fireEvent.click(screen.getByRole("button", { name: "Load more sessions" }));
    expect(screen.getAllByTestId("session-card")).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Load more sessions" }));
    expect(screen.getAllByTestId("session-card")).toHaveLength(65);
    expect(screen.queryByRole("button", { name: "Load more sessions" })).not.toBeInTheDocument();
    const toggle = screen.getAllByRole("button")[0];
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(attempts).toBe(2);
  });
});
