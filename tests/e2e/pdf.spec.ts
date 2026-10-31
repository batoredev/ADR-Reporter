import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const API_URL = "http://localhost:8100/api";

async function newDraft(page: Page) {
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByRole("button", { name: /Demo Clinical Pharmacist/ }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/reports/new");
  await page.getByRole("button", { name: "Start a structured report" }).click();
  await page.waitForURL(/\/reports\/edit\?id=/);
  await page.getByLabel("1. Patient initials").fill("P.D.");
  return new URL(page.url()).searchParams.get("id")!;
}

test("a draft saves before opening a PDF page with a working named download", async ({ page, context }) => {
  const caseId = await newDraft(page);
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "PvPI PDF", exact: true }).click();
  const viewer = await popup;
  await expect(viewer).toHaveURL(/\/files\/view\?path=/);
  const downloadButton = viewer.getByRole("link", { name: "Download PDF", exact: true });
  await expect(downloadButton).toBeVisible();
  await expect(viewer.getByRole("heading", { level: 1 })).toHaveText(/^ADR-\d+-draft-preview\.pdf$/);

  const downloaded = viewer.waitForEvent("download");
  await downloadButton.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^ADR-\d+-draft-preview\.pdf$/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);

  const token = await page.evaluate(() => localStorage.getItem("adr_session"));
  const saved = await page.request.get(`${API_URL}/cases/${caseId}/edit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).values.patientInitials).toBe("P.D.");
  await viewer.close();
});

test("a blocked popup opens the PDF page in the same tab after saving", async ({ page }) => {
  await newDraft(page);
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole("button", { name: "PvPI PDF", exact: true }).click();
  await expect(page).toHaveURL(/\/files\/view\?path=/);
  await expect(page.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to report" }).click();
  await expect(page).toHaveURL(/\/reports\/view\?id=/);
});

test("PDF failures show an error and a retry instead of a blank tab", async ({ page, context }) => {
  await newDraft(page);
  await context.route("**/api/cases/*/pdf*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The PDF template is temporarily unavailable." }),
    }),
  );
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: "PvPI PDF", exact: true }).click();
  const viewer = await popup;
  await expect(viewer.getByRole("alert").filter({ hasText: "The document could not be opened." })).toContainText(
    "The PDF template is temporarily unavailable.",
  );
  await expect(viewer.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Download PDF", exact: true })).toHaveCount(0);
  await context.unroute("**/api/cases/*/pdf*");
  await viewer.getByRole("button", { name: "Try again" }).click();
  await expect(viewer.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible();
  await viewer.close();
});
