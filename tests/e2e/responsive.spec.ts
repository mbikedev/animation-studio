import { expect, test } from "@playwright/test";

test("landing and auth pages fit a phone screen without horizontal scroll", async ({ page }) => {
  for (const url of ["/", "/login", "/signup"]) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Commencer" })).toBeVisible();
});
