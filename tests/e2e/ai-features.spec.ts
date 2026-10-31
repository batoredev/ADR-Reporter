import { expect, test } from "@playwright/test";

test("guided answers, narrative and check decisions survive reload and mode changes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByRole("button", { name: /Demo Clinical Pharmacist/ }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/reports/new");
  await page.getByRole("button", { name: "Start a guided report" }).click();
  await expect(page.getByRole("region", { name: "Guided reporting" })).toBeVisible();
  await page.getByLabel("What are the patient's initials?").fill("G.T.");
  await page.getByLabel("How old were they when the reaction began?").fill("34");
  await page.getByLabel("Is that age in years, months, weeks or days?").selectOption("YEARS");
  await page.getByLabel("Question group").selectOption("reaction");
  await page.getByLabel("What reaction or symptoms were noticed?").fill("Rash");
  await page.getByRole("textbox", { name: /When did the reaction begin/ }).fill("2026-10-14");
  await page.getByRole("button", { name: "Switch to structured form" }).click();
  await expect(page.getByLabel("1. Patient initials")).toHaveValue("G.T.");
  await page.getByRole("button", { name: "2 Reaction", exact: true }).click();
  await expect(page.getByLabel("Reaction term(s)")).toHaveValue("Rash");

  await page.getByRole("button", { name: "Draft description from notes" }).click();
  await page
    .getByLabel("Rough notes")
    .fill("Amoxicillin started 12 October 2026. Rash 14 October. Stopped 15 October. Rash improved 17 October.");
  await page.getByRole("button", { name: "Draft narrative", exact: true }).click();
  await expect(page.getByLabel("Suggested description")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Suggested description")).toBeVisible();
  await page
    .getByLabel("Suggested description")
    .fill("A rash appeared on 14 October 2026 and improved on 17 October 2026.");
  await page.getByLabel("I checked the narrative, dates, doses and clinical statements against the source.").check();
  await page.getByRole("button", { name: "Put into item 7" }).click();
  await expect(page.getByLabel("7. Describe the reaction")).toHaveValue(/A rash appeared/);

  await page
    .locator("summary")
    .filter({ hasText: /^Check report$/ })
    .click();
  await page.getByRole("button", { name: "Check report", exact: true }).click();
  await expect(page.getByText(/description says the rash improved/)).toBeVisible();
  await page.getByRole("button", { name: "I am unsure" }).click();
  await expect(page.getByText(/Unsure.*reviewer attention needed/)).toBeVisible();
  await page.reload();
  await page
    .locator("summary")
    .filter({ hasText: /^Check report$/ })
    .click();
  await expect(page.getByText(/Unsure.*reviewer attention needed/)).toBeVisible();
  await page.getByRole("button", { name: "Switch to guided reporting" }).click();
  await expect(page.getByLabel("Question group")).toHaveValue("reaction");
  await expect(page.getByLabel("Describe what happened, in the order it happened.")).toHaveValue(/A rash appeared/);
  await page.getByRole("button", { name: "Suggest follow-up questions" }).click();
  await expect(page.getByRole("button", { name: "Check seriousness", exact: true })).toBeVisible();
});
