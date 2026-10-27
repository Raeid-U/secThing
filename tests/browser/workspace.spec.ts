import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.setTimeout(60_000);

const company = {
  id: "1",
  cik: "123",
  legal_name: "Northstar Technology Inc.",
  tickers: ["NST"],
  ingestion_status: "complete",
  earliest_requested_filing_date: "2023-01-01",
  sic_description: "Enterprise software",
};
const filings = Array.from({ length: 50 }, (_, index) => ({
  id: String(index + 1),
  document_id: String(index + 1),
  accession_number: `0000000123-26-${String(index).padStart(6, "0")}`,
  form_type: index % 3 === 0 ? "10-K" : "10-Q",
  filing_date: "2026-01-01",
  report_date: "2025-12-31",
  is_supported: true,
  parse_status: "parsed",
  source_status: "downloaded",
  chunk_count: 20,
  last_error: null,
  sec_url: "https://www.sec.gov/fixture",
}));
const text = `Item 1. Business\n\nNorthstar provides cloud software to regulated industries.\n\n${"Its enterprise platform supports durable business growth. ".repeat(200)}`;
const hit = {
  chunk_id: "1",
  filing_id: "1",
  document_id: "1",
  normalized_document_id: "1",
  text_hash: "fixture-hash",
  start_offset: 18,
  end_offset: 74,
  form_type: "10-K",
  filing_date: "2026-01-01",
  accession_number: filings[0].accession_number,
  section_label: "Item 1. Business",
  snippet:
    "Northstar provides <mark>cloud software</mark> to regulated industries.",
  chunk_text: text.slice(18, 74),
  rank: 1,
};

async function fixture(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/source"))
      return route.fulfill({
        contentType: "text/html",
        body: "<h1>Original filing</h1><p>Northstar provides cloud software to regulated industries.</p>",
      });
    let body: unknown = {};
    if (url.pathname === "/api/v1/system/readiness")
      body = { status: "ready", checks: [{ name: "Database", status: "pass" }] };
    else if (url.pathname === "/api/v1/system/ai/status")
      body = {
        mode: "local", status: "available", models: [],
        chat: { configuredModel: "fixture-chat", available: true },
        embeddings: { configuredModel: "nomic-embed-text", available: true },
      };
    else if (url.pathname === "/api/v1/companies/resolve")
      body = {
        company: {
          id: "1",
          cik: "123",
          name: company.legal_name,
          ticker: "NST",
          existed: true,
        },
      };
    else if (
      url.pathname === "/api/v1/companies" &&
      route.request().method() === "POST"
    )
      body = { outcome: "refresh_queued", companyId: "1", jobId: "1" };
    else if (url.pathname === "/api/v1/companies") body = [company];
    else if (url.pathname === "/api/v1/companies/1/corpus" && route.request().method() === "DELETE")
      body = { companyDeleted: false, message: "The evidence corpus was deleted. The company remains in your library." };
    else if (url.pathname === "/api/v1/companies/1" && route.request().method() === "DELETE")
      body = { companyDeleted: true, message: "The company and its evidence were deleted." };
    else if (url.pathname.endsWith("/search/reindex")) body = { queued: 0 };
    else if (url.pathname.endsWith("/corpus")) body = {
      readiness: "ready", stageCounts: { embedded: 50 }, structuredFactsComplete: true,
      exclusions: [], failures: [], coverage: { earliestFilingDate: "2023-01-01", latestFilingDate: "2026-01-01", supportedFilings: 50, missingManifests: 0 }, externalEmbeddingEstimate: null,
    };
    else if (url.pathname.endsWith("/questions")) body = {
      status: "answered", findings: [{ statement: "Northstar provides cloud software to regulated industries.", citations: ["C1"] }],
      interpretation: [{ statement: "The filing presents regulated industries as a core market.", citations: ["C1"] }], limitations: [],
      citations: [{ label: "C1", kind: "chunk", text: hit.chunk_text, locator: { filingId: "1", documentId: "1", normalizedDocumentId: "1", textHash: "fixture-hash", startOffset: 18, endOffset: 74, formType: "10-K", accessionNumber: filings[0].accession_number } }],
      coverage: {}, modelRunId: "1", externalDisclosure: null,
    };
    else if (url.pathname.endsWith("/search"))
      body = {
        results: [hit],
        mode: url.searchParams.get("mode"),
        fallback: null,
      };
    else if (url.pathname.endsWith("/parsed"))
      body = {
        filing: {
          id: 1,
          formType: "10-K",
          accessionNumber: filings[0].accession_number,
        },
        document: {
          id: "1",
          normalizedDocumentId: "1",
          textHash: "fixture-hash",
          sourceHash: "original-hash",
          parserVersion: "html-text-v1",
          secUrl: "https://www.sec.gov/fixture",
          warnings: [],
        },
        sections: [
          {
            id: "1",
            section_label: "Item 1. Business",
            start_offset: 0,
            end_offset: text.length,
          },
        ],
        text,
      };
    else if (url.pathname === "/api/v1/companies/1")
      body = {
        company,
        filings,
        jobs: [],
        search: {
          configured: true,
          model: "nomic-embed-text",
          chunks: 1000,
          embedded: 900,
          pending: 1,
          failed: 0,
        },
      };
    await route.fulfill({ json: body });
  });
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .exclude("iframe")
    .exclude(".extracted-scroll")
    .analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await fixture(page);
});

test("library is the useful home and exposes service details", async ({ page }) => {
  await page.goto("/records");
  await expect(page.getByRole("heading", { name: "Your company library" })).toBeVisible();
  const companyRow = page.getByRole("main").getByRole("button", { name: /Northstar Technology/ });
  await expect(companyRow).toBeVisible();
  await page.getByRole("button", { name: "Services ready" }).click();
  await expect(page.getByRole("dialog", { name: "Services ready" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Close system status" }).click();
  await companyRow.click();
  await expect(page.getByRole("heading", { name: company.legal_name })).toBeVisible();
});

test("fixed frame, source comparison, passage navigation and retained search", async ({
  page,
}) => {
  await page.goto("/records?company=1");
  await expect(
    page.getByRole("heading", { name: company.legal_name }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  await page.getByLabel("Form filter").selectOption("10-Q");
  await expect(page.getByRole("button", { name: "Reset filters" })).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.getByLabel("Form filter")).toHaveValue("");
  await page.getByLabel("Search mode").selectOption("hybrid");
  await expect(page.getByLabel("Search mode")).toHaveValue("hybrid");
  await page.getByLabel("Search mode").selectOption("full_text");
  await page
    .getByRole("textbox", { name: "Search company evidence" })
    .fill("cloud software");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: /Item 1. Business/ }).click();
  await expect(
    page.getByRole("region", { name: "Document inspection" }),
  ).toBeVisible();
  await expect(page.locator(".extracted-scroll mark")).toContainText(
    "Northstar provides",
  );
  await expect(
    page
      .frameLocator('iframe[title="Preserved original SEC filing"]')
      .getByText("Original filing"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Evidence details" }).click();
  await expect(page.getByRole("dialog", { name: "Evidence details" })).toBeVisible();
  await expect(page.getByText("fixture-hash")).toBeVisible();
  await page.getByRole("button", { name: "Close evidence details" }).click();
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/workspace-desktop.png" });
  await page
    .getByRole("button", { name: "Close document", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search company evidence" }),
  ).toHaveValue("cloud software");
  await expect(
    page.getByRole("button", { name: /Item 1. Business/ }),
  ).toBeVisible();
  const repeated = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/search"));
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await repeated;
  await page.getByRole("button", { name: /Item 1. Business/ }).click();
  await page.getByRole("button", { name: "Close document", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("region", { name: "Document inspection" }),
  ).toBeVisible();
});

test("asks a grounded question and opens its exact cited generation", async ({ page }) => {
  await page.goto("/records?company=1");
  await expect(page.getByText("Answers use only this company’s indexed SEC evidence.")).toBeVisible();
  await page.getByLabel("Question").fill("What market does Northstar serve?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What the filings show" })).toBeVisible();
  await expect(page.getByText("Northstar provides cloud software to regulated industries.")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`C1.*10-K`) }).click();
  await expect(page).toHaveURL(/generation=1/);
  await expect(page.getByText("Extracted evidence", { exact: true })).toBeVisible();
});

test("requires explicit confirmation before deleting a corpus", async ({ page }) => {
  await page.goto("/records?company=1");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Manage ${company.legal_name}` });
  await expect(dialog).toBeVisible();
  const remove = dialog.getByRole("button", { name: "Delete evidence corpus" });
  await expect(remove).toBeDisabled();
  await dialog.getByLabel(/Type DELETE CORPUS/).fill("DELETE CORPUS");
  const deletion = page.waitForRequest((request) => request.method() === "DELETE" && new URL(request.url()).pathname.endsWith("/corpus"));
  await remove.click();
  await deletion;
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("evidence corpus was deleted");
});

test("guided intake resolves identity, confirms scope, and restores focus", async ({
  page,
}) => {
  await page.goto("/records");
  await page
    .getByRole("button", { name: "Add company", exact: true }).first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("textbox", { name: "Ticker", exact: true }).fill("NST");
  await page.getByRole("button", { name: "Find company", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("CIK 0000000123")).toBeVisible();
  await page.getByLabel("5 years", { exact: true }).check();
  await page
    .getByRole("button", { name: "Review coverage", exact: true })
    .click();
  await expect(
    page.getByText("10-K, 10-Q and 8-K primary filings"),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/intake-review.png" });
  await page
    .getByRole("button", { name: "Start research", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: company.legal_name }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add company", exact: true }).first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add company", exact: true }).first(),
  ).toBeFocused();
});

test("intermediate layout keeps the library and page controls usable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/records");
  await page.getByRole("button", { name: "Show company library" }).click();
  await expect(page.getByRole("complementary", { name: "Company library" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/library-tablet.png" });
});

test("mobile reader switches panes without introducing page scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/records?company=1&filing=1");
  await expect(page.locator(".extracted-scroll")).toBeVisible();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.locator("iframe")).toBeVisible();
  await page.getByRole("button", { name: "Extracted", exact: true }).click();
  await expect(page.locator(".extracted-scroll")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= window.innerHeight &&
        document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/workspace-mobile.png" });
});
