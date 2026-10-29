import { expect, test, type Browser, type Page } from "@playwright/test";

// The API the test site talks to (see playwright.config.ts).
const API_URL = "http://localhost:8100/api";
const caseIdFrom = (page: Page) => new URL(page.url()).searchParams.get("id") ?? "";

// The whole institutional workflow in one browser session per person, on a new
// fictional report (the AI provider is the saved test fixture, see playwright.config.ts).

async function signIn(browser: Browser, baseURL: string, name: string): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL("**/dashboard");
  return page;
}

async function verifyChecklist(page: Page, exception?: string) {
  const items = page.locator("[data-checklist-item]");
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    if (i === 3 && exception) {
      await item.getByRole("button", { name: "With exception…" }).click();
      await item.getByLabel("Exception reason").fill(exception);
      await item.getByRole("button", { name: "Save exception" }).click();
    } else {
      await item.getByRole("button", { name: "Verified", exact: true }).click();
    }
    await expect(item.getByText(/^Verified (by|with)/)).toBeVisible();
  }
}

test("a report goes from AI-assisted entry through review, approval and external submission", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const reporter = await signIn(browser, baseURL!, "Demo Clinical Pharmacist");
  let caseId = "";
  let caseNumber = "";

  await test.step("the reporter fills the form, with medicines read from a prescription", async () => {
    await reporter.goto("/reports/new");
    await reporter.getByRole("button", { name: "Start a structured report" }).click();
    await reporter.waitForURL(/\/reports\/edit\?id=/);
    caseId = caseIdFrom(reporter);
    await reporter.getByLabel("1. Patient initials").fill("E.T.");
    await reporter.getByLabel("2. Age at onset").fill("52");
    await reporter.getByLabel("Reaction term(s)").fill("Maculopapular rash");
    await reporter.locator("#field-reactionStartDate").fill("2026-10-20");

    await reporter.getByLabel("Document file").setInputFiles("samples/prescriptions/fictional-prescription-clean.png");
    await reporter.getByRole("button", { name: "Upload" }).click();
    await reporter.getByRole("button", { name: "Read with AI" }).first().click();
    await expect(reporter.getByText("Check every suggestion against the document")).toBeVisible();
    await reporter.getByRole("radio", { name: "Add as suspected medicine" }).first().check();
    await reporter.getByRole("radio", { name: "Add as concomitant product" }).nth(1).check();
    // An unclear value is only used once a person confirms it.
    await reporter.getByText("Unclear on the document. I have checked this value myself.").first().click();
    await reporter
      .getByLabel("I verified that this document belongs to this report despite the different initials.")
      .check();
    await reporter
      .getByLabel("I checked the selected values, dates, doses and units against the source document.")
      .check();
    await reporter.getByRole("button", { name: "Add to report" }).click();

    await expect(reporter.locator('input[name="suspectedMedicines.0.name"]')).toHaveValue(/Amoxicillin/);
    await expect(reporter.locator('input[name="concomitantProducts.0.name"]')).toHaveValue(/Paracetamol/);
    await expect(reporter.locator('input[name="concomitantProducts.0.frequency"]')).toHaveValue("SOS");
    await expect(reporter.getByText(/Saved at|All changes saved/)).toBeVisible({ timeout: 10_000 });

    await reporter.getByRole("button", { name: "Review and submit" }).click();
    await reporter.waitForURL(/\/reports\/submit\?id=/);
    await reporter.getByRole("checkbox", { name: /I confirm this report/ }).check();
    await reporter.getByRole("button", { name: "Submit for institutional review" }).click();
    await reporter.waitForURL(/submitted=1$/);
    caseNumber = (await reporter.getByRole("heading", { level: 1 }).innerText()).trim();
    expect(caseNumber).toMatch(/^ADR-\d{3,}$/);
  });

  const reviewer = await signIn(browser, baseURL!, "Demo HoD, Pharmacy Practice");

  await test.step("a reviewer takes the case up, raises an issue and returns it", async () => {
    await reviewer.goto("/review");
    await reviewer.getByRole("row").filter({ hasText: caseNumber }).getByRole("button", { name: "Take up" }).click();
    await reviewer.waitForURL(`**/review/case?id=${caseId}`);
    // Values read from the prescription show their source.
    await expect(reviewer.getByText(/From fictional-prescription-clean\.png/).first()).toBeVisible();

    const field = reviewer.locator("#comment-field");
    const batch = (await field.locator("option").allInnerTexts()).find((o) => /\(i\): Batch/.test(o))!;
    await field.selectOption({ label: batch });
    await reviewer.locator("#comment-body").fill("Please add the batch number from the strip.");
    await reviewer.getByRole("button", { name: "Raise issue" }).click();
    await expect(reviewer.getByText("Please add the batch number from the strip.")).toBeVisible();

    await verifyChecklist(reviewer);
    await expect(reviewer.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(reviewer.getByText(/1 open issue/).first()).toBeVisible();

    await reviewer.getByRole("button", { name: "Return for correction" }).click();
    await reviewer.getByLabel("Message to the reporter").fill("Please add the batch number, or say it is unavailable.");
    await reviewer.getByRole("button", { name: "Return to reporter" }).click();
    await expect(reviewer.getByText(/Returned to the reporter by/)).toBeVisible();
  });

  await test.step("the reporter corrects the report and resubmits it", async () => {
    await reporter.goto(`/reports/edit?id=${caseId}`);
    await expect(reporter.getByText("Please add the batch number from the strip.").first()).toBeVisible();
    await reporter.locator('input[name="suspectedMedicines.0.batchLot"]').fill("AMX2610B");
    await expect(reporter.getByText(/Saved at/)).toBeVisible({ timeout: 10_000 });
    await reporter.goto(`/reports/submit?id=${caseId}`);
    await reporter.getByLabel(/Note to the reviewer/).fill("Batch number added from the strip.");
    await reporter.getByRole("checkbox", { name: /I confirm this report/ }).check();
    await reporter.getByRole("button", { name: "Resubmit for review" }).click();
    await reporter.waitForURL(/submitted=2$/);
  });

  await test.step("the same reviewer resumes, closes the issue and approves", async () => {
    await reviewer.goto("/review?filter=mine");
    await reviewer.getByRole("row").filter({ hasText: caseNumber }).getByRole("button", { name: "Resume" }).click();
    await reviewer.waitForURL(`**/review/case?id=${caseId}`);
    await expect(reviewer.locator('[data-path$=".batchLot"]').getByText("Changed in this version")).toBeVisible();

    await reviewer.getByRole("button", { name: "Close issue" }).click();
    await reviewer.getByLabel("Note or reason").fill("Batch number now provided.");
    await reviewer.getByRole("dialog").getByRole("button", { name: "Close issue" }).click();
    await expect(reviewer.getByText("· Resolved")).toBeVisible();

    await verifyChecklist(reviewer, "Investigations genuinely unavailable: none were done.");
    reviewer.once("dialog", (dialog) => void dialog.accept());
    await reviewer.getByRole("button", { name: "Approve" }).click();
    await expect(reviewer.getByText(/Institutionally approved as v3/)).toBeVisible({ timeout: 30_000 });

    // Files need the session token, which the site keeps in localStorage.
    const token = await reviewer.evaluate(() => localStorage.getItem("adr_session"));
    const pdf = await reviewer.request.get(`${API_URL}/cases/${caseId}/pdf?version=3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  await test.step("a coordinator records the external submission and its acknowledgement", async () => {
    const coordinator = await signIn(browser, baseURL!, "Demo AMC Coordinator");
    await coordinator.goto("/submissions");
    const item = coordinator.locator("section[aria-labelledby=awaiting] li").filter({ hasText: caseNumber });
    await item.getByRole("button", { name: "Record submission" }).click();
    const dialog = coordinator.getByRole("dialog");
    await dialog.getByLabel("How it was sent").selectOption("AMC_EMAIL");
    await dialog.getByLabel("Sent to").fill("AMC, Demo Medical College (fictional)");
    await dialog.getByRole("button", { name: "Record submission" }).click();

    const submitted = coordinator.locator("section[aria-labelledby=submitted] li").filter({ hasText: caseNumber });
    await submitted.getByRole("button", { name: "Record acknowledgement" }).click();
    await coordinator
      .getByRole("dialog")
      .getByLabel(/Reference given/)
      .fill("AMC-ACK-FICT-0001");
    await coordinator.getByRole("dialog").getByRole("button", { name: "Record acknowledgement" }).click();
    await expect(
      coordinator.locator("section[aria-labelledby=acknowledged] li").filter({ hasText: caseNumber }),
    ).toContainText("AMC-ACK-FICT-0001");
  });

  await test.step("reviewers can see the submission list but not record on it", async () => {
    await reviewer.goto("/submissions");
    await expect(reviewer.getByRole("heading", { name: "External submissions" })).toBeVisible();
    await expect(reviewer.getByRole("button", { name: /Record/ })).toHaveCount(0);
  });
});

test("a potentially serious draft reaches the urgent contacts before any review", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const physician = await signIn(browser, baseURL!, "Demo Resident Physician");
  await physician.goto("/reports/new");
  await physician.getByRole("button", { name: "Start a structured report" }).click();
  await physician.waitForURL(/\/reports\/edit\?id=/);
  const caseId = caseIdFrom(physician);
  await physician.getByLabel("1. Patient initials").fill("K.P.");
  await physician.getByLabel("Reaction term(s)").fill("Suspected anaphylaxis");
  await physician.getByRole("checkbox", { name: /Hospitalisation/ }).check();
  await physician.getByRole("checkbox", { name: /Life threatening/ }).check();
  await expect(physician.getByText(/Saved at/)).toBeVisible({ timeout: 10_000 });

  await physician.getByRole("button", { name: "Escalate urgently" }).first().click();
  await physician.getByLabel("Urgency note").fill("Collapsed after the IV dose; treated in casualty.");
  await physician.getByRole("button", { name: "Escalate now" }).click();
  await expect(physician.getByText("An urgent escalation is open")).toBeVisible();

  const contact = await signIn(browser, baseURL!, "Demo Chief Pharmacist");
  await contact.goto("/escalations");
  const card = contact.locator("article").filter({ has: contact.locator(`a[href="/reports/view?id=${caseId}"]`) });
  await expect(card).toContainText("Collapsed after the IV dose");
  await expect(card).toContainText("Draft");
  await card.getByRole("button", { name: "Acknowledge" }).click();
  await expect(card).toContainText("Acknowledged by Demo Chief Pharmacist");
  await card.getByRole("button", { name: "Close" }).click();
  await contact.getByRole("dialog").getByLabel("What was done").fill("AMC informed by phone; full report to follow.");
  await contact.getByRole("dialog").getByRole("button", { name: "Close escalation" }).click();
  await expect(contact.locator("section[aria-labelledby=closed-escalations]")).toContainText("AMC informed by phone");
});
