import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, vi } from "vitest";
import "../i18n";

vi.mock("recharts", async (importOriginal) => {
  const recharts = await importOriginal<typeof import("recharts")>();

  return {
    ...recharts,
    // jsdom has no layout engine; give real charts a measurable viewport in unit tests.
    ResponsiveContainer: (props: ComponentProps<typeof recharts.ResponsiveContainer>) =>
      createElement(recharts.ResponsiveContainer, { ...props, width: 800, height: 300 }),
  };
});

afterEach(() => {
  cleanup();
});
