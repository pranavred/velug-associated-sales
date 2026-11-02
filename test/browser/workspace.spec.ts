import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../app/server.js";
import {
  signIn,
  sessionPrincipal,
  provisionCompany,
  activateInvite,
} from "../../app/auth.js";
import { createResearch, processResearch } from "../../app/jobs.js";
import { listInventory, importInventory } from "../../app/inventory.js";
for (const prefix of ["/associated-sales", ""])
  test(`workspace flow at ${prefix || "root"}`, async ({ page, browser }) => {
    const dir = await mkdtemp(join(tmpdir(), "associated-sales-browser-"));
    const runtime = await startServer({
      PORT: "4419",
      PUBLIC_ORIGIN: "http://127.0.0.1:4419",
      BASE_PATH: prefix,
      DATABASE_PATH: join(dir, "test.sqlite"),
      BOOTSTRAP_EMAIL: "owner@example.test",
      BOOTSTRAP_PASSWORD: "browser owner password only",
      BOOTSTRAP_COMPANY: "Example Supply",
      OPENAI_API_KEY: "fixture-not-a-real-key",
    });
    const origin = "http://127.0.0.1:4419" + prefix;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(origin + "/inventory");
      await page.getByLabel("Work email").fill("owner@example.test");
      await page
        .getByLabel("Password", { exact: true })
        .fill("browser owner password only");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: "Know the buyer. Find the next fit.",
        }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Inventory", exact: true }).click();
      await page
        .getByLabel("CSV or JSON file")
        .setInputFiles("examples/inventory.csv");
      await expect(
        page.getByRole("button", { name: "Import inventory" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Import inventory" }).click();
      await expect(
        page.getByText("SAMPLE-FILTER", { exact: false }),
      ).toBeVisible();
      const p = (await sessionPrincipal(
        runtime.db,
        (
          await signIn(
            runtime.db,
            "owner@example.test",
            "browser owner password only",
          )
        ).token,
      ))!;
      const product = (await listInventory(runtime.db, p)).find(
        (x) => x.sku === "SAMPLE-FILTER",
      )!;
      const artifact = {
        narrative: "Example Manufacturing makes packaged food products.",
        sources: [
          {
            id: "S1",
            url: "https://example.com/manufacturing",
            title: "Example official source",
          },
        ],
        usage: {
          responseId: "fixture-research",
          model: "fixture",
          inputTokens: 100,
          outputTokens: 20,
          searchCalls: 1,
        },
      };
      const job = await createResearch(
        runtime.db,
        p,
        {
          name: "Example Manufacturing",
          region: "US",
          requestKey: "browser-fixture",
        },
        runtime.config,
      );
      await processResearch(runtime.db, job.id, runtime.config, {
        research: async () => artifact,
        match: async () => ({
          usage: {
            ...artifact.usage,
            responseId: "fixture-match",
            searchCalls: 0,
          },
          report: {
            identity: {
              name: "Example Manufacturing",
              status: "identified",
              reason: "Official source identifies this company",
            },
            companySummary: "Manufactures packaged food products.",
            findings: [
              {
                statement: "The company makes food products.",
                evidenceDate: "2026-01-01",
                sourceIds: ["S1"],
              },
            ],
            opportunities: [
              {
                productId: product.id,
                type: "complementary",
                rationale:
                  "Investigate the filtration requirements for the process water system.",
                sourceIds: ["S1"],
                questions: ["What flow rate does the process require?"],
                missingRequirements: ["Flow rate and particle rating"],
                disqualifiers: ["No applicable process water system"],
              },
            ],
            unknowns: ["Existing supplier unknown"],
          },
        }),
      });
      await page.goto(origin + "/research/" + job.id);
      await expect(
        page.getByRole("heading", { name: "Catalog opportunities" }),
      ).toBeVisible();
      await page
        .getByLabel("What flow rate does the process require?")
        .fill("20 cubic metres per hour.");
      await page
        .getByLabel("Review note")
        .fill("Confirm particle rating before proposing a product.");
      let saves = 0;
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().includes("/reviews/")) saves++;
      });
      await page.getByRole("button", { name: "Save answers & review" }).click();
      await expect(page.getByRole("status")).toContainText("saved");
      expect(saves).toBe(1);
      await page.reload();
      await expect(
        page.getByLabel("What flow rate does the process require?"),
      ).toHaveValue("20 cubic metres per hour.");
      await page.screenshot({
        path:
          "test-results/workspace-" +
          (prefix ? "prefix" : "root") +
          "-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path:
          "test-results/workspace-" +
          (prefix ? "prefix" : "root") +
          "-mobile.png",
        fullPage: true,
      });
      await page.getByRole("link", { name: "Team", exact: true }).click();
      await page
        .getByLabel("Email", { exact: true })
        .fill("member@example.test");
      await page.getByRole("button", { name: "Create invitation" }).click();
      const link = await page.locator("#invitation code").innerText();
      const context = await browser.newContext();
      const member = await context.newPage();
      await member.goto(link);
      await member
        .getByLabel("Password · 14 characters minimum")
        .fill("browser member password only");
      await member.getByRole("button", { name: "Activate invitation" }).click();
      await member.getByLabel("Work email").fill("member@example.test");
      await member
        .getByLabel("Password", { exact: true })
        .fill("browser member password only");
      await member
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(
        member.getByRole("heading", {
          name: "Know the buyer. Find the next fit.",
        }),
      ).toBeVisible();
      await expect(
        member.getByRole("link", { name: "Team", exact: true }),
      ).toHaveCount(0);
      await member
        .getByRole("link", { name: "Inventory", exact: true })
        .click();
      await expect(
        member.getByRole("button", { name: "Import inventory" }),
      ).toHaveCount(0);
      await context.close();
      expect(errors).toEqual([]);
    } finally {
      await runtime.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

test("shared browser tabs keep the visible company and mutation target aligned", async ({
  page,
}) => {
  const dir = await mkdtemp(join(tmpdir(), "associated-sales-tabs-"));
  const runtime = await startServer({
    PORT: "4419",
    PUBLIC_ORIGIN: "http://127.0.0.1:4419",
    BASE_PATH: "/associated-sales",
    DATABASE_PATH: join(dir, "test.sqlite"),
    BOOTSTRAP_EMAIL: "owner@example.test",
    BOOTSTRAP_PASSWORD: "browser owner password only",
    BOOTSTRAP_COMPANY: "Company A",
  });
  try {
    const principal = (await sessionPrincipal(
      runtime.db,
      (
        await signIn(
          runtime.db,
          "owner@example.test",
          "browser owner password only",
        )
      ).token,
    ))!;
    const b = await provisionCompany(
      runtime.db,
      principal,
      "Company B",
      principal.email,
    );
    await activateInvite(runtime.db, b.token, "browser owner password only");
    const origin = "http://127.0.0.1:4419/associated-sales";
    await page.goto(origin);
    await page.getByLabel("Work email").fill(principal.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser owner password only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("#company")).toHaveValue(principal.companyId);
    const second = await page.context().newPage();
    await second.goto(origin + "/research");
    await second.locator("#company").selectOption(b.companyId);
    await expect(second.locator("#company")).toHaveValue(b.companyId);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.locator("#company")).toHaveValue(b.companyId);
    await page.getByLabel("Label", { exact: true }).fill("B connector");
    await page
      .getByRole("button", { name: "Create token", exact: true })
      .click();
    await expect(page.locator("#new-token code")).toBeVisible();
    await assertToken("B connector", b.companyId);
    await page.locator("#company").selectOption(principal.companyId);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.locator("#company")).toHaveValue(principal.companyId);
    await page.getByLabel("Label", { exact: true }).fill("Stale A connector");
    await second.reload();
    await second.locator("#company").selectOption(b.companyId);
    await expect(second.locator("#company")).toHaveValue(b.companyId);
    await page
      .getByRole("button", { name: "Create token", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Company changed");
    await expect(page.locator("#company")).toHaveValue(b.companyId);
    expect(
      await runtime.db.get(
        "SELECT id FROM integration_tokens WHERE label=?",
        "Stale A connector",
      ),
    ).toBeUndefined();
    await second.close();
    await importInventory(runtime.db, principal, {
      source: "erp",
      key: "a",
      mode: "replace",
      rows: [{ sku: "A-PRIVATE", name: "A confidential part" }],
    });
    await importInventory(
      runtime.db,
      { ...principal, companyId: b.companyId },
      {
        source: "erp",
        key: "b",
        mode: "replace",
        rows: [{ sku: "B-PART", name: "B public part" }],
      },
    );
    let release!: () => void, ready!: () => void;
    const held = new Promise<void>((r) => (release = r)),
      intercepted = new Promise<void>((r) => (ready = r));
    await page.route("**/api/inventory?offset=0", async (route) => {
      if (
        route.request().headers()["x-associated-sales-company"] ===
        principal.companyId
      ) {
        const response = await route.fetch();
        ready();
        await held;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await page.locator("#company").selectOption(principal.companyId);
    await page
      .getByRole("heading", { name: "Know the buyer. Find the next fit." })
      .waitFor();
    await page.getByRole("link", { name: "Inventory", exact: true }).click();
    await intercepted;
    await page.locator("#company").selectOption(b.companyId);
    await page
      .getByRole("heading", { name: "Know the buyer. Find the next fit." })
      .waitFor();
    await page.getByRole("link", { name: "Inventory", exact: true }).click();
    await expect(
      page.getByText("B public part", { exact: true }),
    ).toBeVisible();
    const oldResponse = page.waitForResponse(
      (r) =>
        r.url().includes("/api/inventory?offset=0") &&
        r.request().headers()["x-associated-sales-company"] ===
          principal.companyId,
    );
    release();
    await (await oldResponse).finished();
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    await expect(
      page.getByText("A confidential part", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("B public part", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Label", { exact: true }).waitFor();
    let failSwitch!: () => void;
    const switchHeld = new Promise<void>((r) => (failSwitch = r));
    await page.route("**/api/company", async (route) => {
      await switchHeld;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test switch failure" }),
      });
    });
    await page.locator("#company").selectOption(principal.companyId);
    try {
      expect(await page.locator("#company").inputValue()).toBe(b.companyId);
      expect(await page.locator("#shell").evaluate((el) => (el as HTMLElement).inert)).toBe(
        true,
      );
    } finally {
      failSwitch();
    }
    await expect(page.getByRole("status")).toContainText("Test switch failure");
    await expect(page.locator("#company")).toHaveValue(b.companyId);
    await expect(page.locator("#shell")).toHaveJSProperty("inert", false);
    await page.getByLabel("Label", { exact: true }).fill("After failed switch");
    await page
      .getByRole("button", { name: "Create token", exact: true })
      .click();
    await expect(page.locator("#new-token code")).toBeVisible();
    await assertToken("After failed switch", b.companyId);
    async function assertToken(label: string, companyId: string) {
      expect(
        (
          await runtime.db.get(
            "SELECT company_id FROM integration_tokens WHERE label=?",
            label,
          )
        )?.company_id,
      ).toBe(companyId);
    }
  } finally {
    await runtime.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
