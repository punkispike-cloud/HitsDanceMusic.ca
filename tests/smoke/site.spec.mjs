import { test, expect } from "@playwright/test";

const API = process.env.SMOKE_API_URL || "https://patient-endurance-production-21c8.up.railway.app";

test.describe("smoke site + API", () => {
  test("accueil charge sans erreur console bloquante", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#player")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#radioPlayer")).toBeAttached();
    const fatal = errors.filter((e) => !/ResizeObserver|Script error/i.test(e));
    expect(fatal, `erreurs page: ${fatal.join(" | ")}`).toEqual([]);
  });

  test("API /health et /v1/schedule répondent", async ({ request }) => {
    const health = await request.get(`${API}/health`);
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(body.ok).toBeTruthy();
    expect(body.db).toBeTruthy();

    const schedule = await request.get(`${API}/v1/schedule`);
    expect(schedule.ok()).toBeTruthy();
    const data = await schedule.json();
    expect(data).toBeTruthy();
  });
});
