import { expect, test, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../../src/lib/demo";

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL("**/dashboard");
}

async function signOut(page: Page) {
  await page.locator("header").getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}

const navLabels = (page: Page) => page.locator("aside nav a").allInnerTexts();

test("visitors without a session are sent to the login page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Fictional demonstration system")).toBeVisible();
});

test("a wrong password is rejected with a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByLabel("Email").fill("pharmacist@demo.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Next.js renders its own (empty) route-announcer alert, so match ours by its text.
  await expect(page.getByRole("alert").filter({ hasText: "The email or password is incorrect." })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("typing credentials signs in and signing out ends the session", async ({ page }) => {
  await page.goto("/login");
  await page.getByText("Try a demo account", { exact: true }).click();
  await page.getByLabel("Email").fill("physician@demo.test");
  await page.getByLabel("Password", { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: /^(Overview|Review overview)$/ })).toBeVisible();
  await signOut(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("every demo account can sign in and sees navigation for its role", async ({ page }) => {
  for (const account of DEMO_ACCOUNTS) {
    await signInAs(page, account.name);
    await expect(page.getByText(`Signed in as ${account.name}`)).toBeVisible();
    const labels = await navLabels(page);
    expect(labels.includes("New ADR report"), account.email).toBe(account.roles.includes("REPORTER"));
    expect(labels.includes("Review queue"), account.email).toBe(account.roles.includes("REVIEWER"));
    expect(labels.includes("Urgent escalations"), account.email).toBe(Boolean(account.isUrgentContact));
    await signOut(page);
  }
});

test("pages a role may not use lead to the access-denied page, not only hidden from the menu", async ({ page }) => {
  await signInAs(page, "Demo Clinical Pharmacist");
  for (const path of ["/review", "/escalations", "/submissions"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/access-denied$/);
  }
  await signOut(page);

  await signInAs(page, "Demo Clinical Pharmacologist");
  for (const path of ["/reports/new", "/my-reports", "/escalations"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/access-denied$/);
  }
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
});

// Other tests add cases, so these look only at the seeded ones (ADR-001 to ADR-008).
test("a reporter's dashboard lists only their own reports", async ({ page }) => {
  await signInAs(page, "Demo Clinical Pharmacist");
  await page.goto("/dashboard?q=ADR-00");
  const table = page.getByRole("table");
  for (const own of ["ADR-001", "ADR-002", "ADR-004", "ADR-006", "ADR-008"]) {
    await expect(table.getByRole("link", { name: own, exact: true })).toBeVisible();
  }
  for (const other of ["ADR-003", "ADR-005", "ADR-007"]) {
    await expect(table.getByRole("link", { name: other, exact: true })).toHaveCount(0);
  }
});

test("reviewers see the pool without other people's drafts, serious cases first on request", async ({ page }) => {
  await signInAs(page, "Demo HoD, Pharmacy Practice");
  await expect(page.getByText(/\d+ open urgent escalations?/)).toBeVisible();
  await page.goto("/dashboard?q=ADR-00");
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: "ADR-002", exact: true })).toHaveCount(0);
  await expect(table.getByRole("link", { name: "ADR-007", exact: true })).toHaveCount(0);

  await page.getByLabel("Sort cases").selectOption("serious");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(table.locator("tbody tr").first()).toContainText("ADR-006");
  await expect(table.locator("tbody tr").first()).toContainText("Potentially serious");
});

test("reviewers who are not urgent contacts do not get the escalation banner", async ({ page }) => {
  await signInAs(page, "Demo Consultant Physician");
  await expect(page.getByRole("heading", { name: /^(Overview|Review overview)$/ })).toBeVisible();
  await expect(page.getByText(/open urgent escalation/)).toHaveCount(0);
});

test("the navigation drawer works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, "Demo AMC Coordinator");
  await expect(page.locator("aside")).toBeHidden();
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("link", { name: "Urgent escalations" })).toBeVisible();
  await drawer.getByRole("link", { name: "Review queue" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("dialog")).toBeHidden();
});
