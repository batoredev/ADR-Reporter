import { expect, test } from "@playwright/test";

test("focused form sections preserve entries and fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByRole("button", { name: /Demo Clinical Pharmacist/ }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/reports/new");
  await page.getByRole("button", { name: "Start a structured report" }).click();
  await page.getByLabel("1. Patient initials").fill("U.I.");
  await expect(page.getByLabel("Reaction term(s)")).toBeHidden();
  await page.getByRole("button", { name: "2 Reaction", exact: true }).click();
  await page.getByLabel("Reaction term(s)").fill("Fictional rash");
  await page.getByRole("button", { name: "1 Patient", exact: true }).click();
  await expect(page.getByLabel("1. Patient initials")).toHaveValue("U.I.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/Saved at|All changes saved/)).toBeVisible();
  await page.getByText("More", { exact: true }).click();
  await expect(page.getByRole("button", { name: "PvPI PDF", exact: true })).toBeVisible();
  await page.getByText("More", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/ui-phone-report.png", fullPage: true });

  const id = new URL(page.url()).searchParams.get("id");
  await page.goto(`/reports/view?id=${id}`);
  await page.getByRole("tab", { name: /^Documents/ }).click();
  await expect(page.getByText("No documents uploaded.")).toBeVisible();
  await page.getByRole("tab", { name: /^Documents/ }).press("End");
  await expect(page.getByRole("tab", { name: "Versions and history" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Timeline", exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/Ollama|Gemini|Claude|paid fallback|provider|AI model/i);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/ui-desktop-overview.png", fullPage: true });
});
