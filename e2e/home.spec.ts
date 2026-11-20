import { expect, test } from "@playwright/test";

test("home page opens", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Amtsklar" }),
  ).toBeVisible();
});

test("letter text over the limit is kept and flagged", async ({ page }) => {
  await page.goto("/");
  const field = page.getByRole("textbox", { name: "Text des Briefs" });

  await field.fill("a".repeat(20_001));

  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("20.001 von 20.000 Zeichen")).toBeVisible();
  await expect(page.getByText(/länger als 20\.000 Zeichen/)).toBeVisible();
  expect(await field.inputValue()).toHaveLength(20_001);
});
