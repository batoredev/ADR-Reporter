import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

async function start(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByRole("button", { name: /Demo Clinical Pharmacist/ }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/reports/new");
  await page.getByRole("button", { name: "Start a conversation" }).click();
  await expect(page.getByRole("heading", { name: "Report assistant", exact: true })).toBeVisible();
}
test("batch photos and multi-page PDFs become checked form details without duplicate medicines", async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Fictional patient R.K. 34 y");
  pdf.addPage().drawText("Fictional second page");
  await page.getByLabel("Report documents").setInputFiles([
    {
      name: "fictional-prescription-clean.png",
      mimeType: "image/png",
      buffer: await readFile("samples/prescriptions/fictional-prescription-clean.png"),
    },
    { name: "two-pages.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) },
  ]);
  await expect(page.getByRole("button", { name: "Review suggested details" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Review suggested details" }).click();
  await expect(page.getByRole("button", { name: /Save checked details/ })).toBeVisible();
  await expect(page.getByLabel("Role for Amoxicillin 500 mg capsule")).toBeEnabled({ timeout: 60_000 });
  await page.getByLabel("Role for Amoxicillin 500 mg capsule").selectOption("SUSPECTED");
  await page.getByLabel("Role for Paracetamol 500 mg tablet").selectOption("CONCOMITANT");
  await page.getByLabel(/The reading is unclear. I checked this value directly/).check();
  await page
    .getByLabel("I checked the selected details against their sources and confirmed they belong to this report.")
    .check();
  await page.getByRole("button", { name: /Save checked details/ }).click();
  await expect(page.getByText("What reaction or symptoms were noticed?", { exact: true })).toBeVisible();
  await page.getByLabel("Your answer or additional details").fill("Rash");
  await page.getByRole("button", { name: "Send answer" }).click();
  await page
    .getByLabel("I checked the selected details against their sources and confirmed they belong to this report.")
    .check();
  await page.getByRole("button", { name: /Save checked details/ }).click();
  await expect(page.getByText(/When did the reaction begin/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/When did the reaction begin/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/Ollama|Gemini|Claude|paid fallback|AI model/);
  await page.screenshot({ path: "test-results/chat-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Open form", exact: true }).click();
  await expect(page.getByLabel("1. Patient initials")).toHaveValue("R.K.");
  await page.getByRole("button", { name: "3 Medicines", exact: true }).click();
  await expect(page.locator('input[name="suspectedMedicines.0.name"]')).toHaveValue("Amoxicillin 500 mg capsule");
  await expect(page.locator('input[name="suspectedMedicines.1.name"]')).toHaveCount(0);
  await expect(page.locator('input[name="concomitantProducts.0.name"]')).toHaveValue("Paracetamol 500 mg tablet");
});

test("a phone shows one panel at a time and retains an unanswered suggestion after reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.getByLabel("Your answer or additional details").fill("C.B.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByRole("button", { name: "Review suggested details" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Review suggested details" }).click();
  await expect(page.getByLabel("Patient initials value")).toHaveValue("C.B.");
  await expect(page.getByRole("region", { name: "Report conversation" })).toBeHidden();
  await page
    .getByLabel("I checked the selected details against their sources and confirmed they belong to this report.")
    .check();
  await page.getByRole("button", { name: /Save checked details/ }).click();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.getByText(/How old was the patient/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/chat-phone.png", fullPage: true });
});

test("the form remains available while a hosted API has not enabled the assistant", async ({ page }) => {
  await start(page);
  await page.route("**/api/health*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  await page.goto("/reports/new");
  await expect(page.getByRole("button", { name: "Start a conversation" })).toBeDisabled();
  await page.getByRole("button", { name: "Start a structured report" }).click();
  await expect(page.getByLabel("1. Patient initials")).toBeVisible();
});
