import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";

test("home page has one main landmark containing a single top-level heading", () => {
  render(<Home />);

  const main = screen.getByRole("main");
  const headings = within(main).getAllByRole("heading", { level: 1 });

  expect(headings).toHaveLength(1);
  expect(headings[0]?.textContent).toBe("Behördenbrief");
});
