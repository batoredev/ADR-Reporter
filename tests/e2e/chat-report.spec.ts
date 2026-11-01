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
test("batch photos and multi-page PDFs fill the report directly, without duplicate medicines", async ({ page }) => {
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
  // Three readings of the same prescription: each medicine is asked about once, then entered once.
  await expect(page.getByText("How is Amoxicillin 500 mg capsule related to this report?")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/Added to the report: .*Patient initials: R\.K\./).first()).toBeVisible();
  await page.getByRole("button", { name: "Suspected of causing the reaction" }).click();
  await expect(page.getByText("How is Paracetamol 500 mg tablet related to this report?")).toBeVisible();
  await page.getByRole("button", { name: "Another medicine the patient was taking" }).click();
  await expect(page.getByRole("heading", { name: /What reaction or symptoms did the patient have/ })).toBeVisible();
  await page.getByLabel("Your answer or additional details").fill("Rash");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText(/When did the reaction start/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/When did the reaction start/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/Ollama|Gemini|Claude|paid fallback|AI model/);
  // The unclear "SOS" reading went in, marked for a look at the final confirmation.
  await expect(page.getByText(/Please take a quick look/)).toBeVisible();
  await page.screenshot({ path: "test-results/chat-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Open form", exact: true }).click();
  await expect(page.getByLabel("1. Patient initials")).toHaveValue("R.K.");
  await page.getByRole("button", { name: "3 Medicines", exact: true }).click();
  await expect(page.locator('input[name="suspectedMedicines.0.name"]')).toHaveValue("Amoxicillin 500 mg capsule");
  await expect(page.locator('input[name="suspectedMedicines.1.name"]')).toHaveCount(0);
  await expect(page.locator('input[name="concomitantProducts.0.name"]')).toHaveValue("Paracetamol 500 mg tablet");
  await expect(page.locator('input[name="concomitantProducts.1.name"]')).toHaveCount(0);
});

test("a phone shows one panel at a time and keeps saved answers after reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.getByLabel("Your answer or additional details").fill("C.B.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText(/Added to the report: Patient initials: C\.B\./)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/How old was the patient/)).toBeVisible();
  await page.getByRole("button", { name: /^Report( \(|$)/ }).click();
  await expect(page.getByRole("region", { name: "Report conversation" })).toBeHidden();
  await expect(page.getByLabel("Report details so far")).toContainText("C.B.");
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
