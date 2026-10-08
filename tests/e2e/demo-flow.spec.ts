import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const fixtures = path.join(process.cwd(), "tests", "fixtures");

async function blockExternal(page: Page, attempts: string[]) {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    attempts.push(url.href);
    return route.abort();
  });
}

async function signUpAndLogin(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-solide-42");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Compte créé")).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir le lien" }).click();
  await expect(page.getByText("Adresse confirmée")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-solide-42");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
}

test("demo: full journey without any external call", async ({ page }) => {
  const external: string[] = [];
  await blockExternal(page, external);
  const email = `e2e-${Date.now()}@example.test`;

  await page.goto("/");
  await expect(page.getByText("EXEMPLE")).toBeVisible();
  await expect(page.getByText("Démonstration : aucune génération IA réelle").first()).toBeVisible();

  await signUpAndLogin(page, email);

  // Buy credits through the simulated checkout (same fulfillment as Stripe).
  await page.getByRole("link", { name: "Crédits" }).first().click();
  await page.getByRole("button", { name: "Acheter" }).first().click();
  await expect(page.getByText("Paiement simulé (démonstration)")).toBeVisible();
  await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await expect(page.getByText("Achat de crédits")).toBeVisible();

  // Studio: project, image, audio, estimate, confirm.
  await page.getByRole("link", { name: "Studio" }).first().click();
  await page.getByPlaceholder("Nouveau projet").fill("Conte de Leuk");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByLabel("Projet", { exact: true })).toHaveValue(/.+/);

  await page.locator("#image-input").setInputFiles(path.join(fixtures, "portrait.png"));
  await expect(page.getByText(/Image validée · 640×640/)).toBeVisible();
  await page.locator("#audio-input").setInputFiles(path.join(fixtures, "voice.mp3"));
  await expect(page.getByText(/Durée mesurée par le serveur/)).toBeVisible();

  await expect(page.getByText(/crédits$/).filter({ hasText: /^\d+ crédits$/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Générer la vidéo" }).click();
  await page.getByRole("button", { name: /Confirmer/ }).click();

  await expect(page.getByText("crédits réservés")).toBeVisible();
  await expect(page.getByRole("link", { name: "Télécharger MP4" })).toBeVisible({ timeout: 60_000 });
  const video = page.locator("video").last();
  await expect(video).toHaveAttribute("src", /\/api\/media\?/);

  // The download link serves an MP4.
  const href = await page.getByRole("link", { name: "Télécharger MP4" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("video/mp4");
  expect(res.headers()["content-disposition"]).toContain("attachment");

  // Simulated failure path: credits are returned.
  await page.getByLabel("Simuler un échec (démonstration)").check();
  await page.getByRole("button", { name: "Générer la vidéo" }).click();
  await page.getByRole("button", { name: /Confirmer/ }).click();
  await expect(page.getByText(/Échec simulé \(démonstration\)\. Les crédits réservés ont été rendus\./)).toBeVisible({ timeout: 60_000 });

  // Gallery shows both, with download for the successful one.
  await page.getByRole("link", { name: "Projets" }).first().click();
  await expect(page.getByText("Conte de Leuk").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "MP4" })).toHaveCount(1);
  await expect(page.getByText("Échec").first()).toBeVisible();

  await page.getByRole("link", { name: "Crédits" }).first().click();
  await expect(page.getByText("Crédits rendus")).toBeVisible();
  await expect(page.getByText("Génération livrée")).toBeVisible();

  expect(external).toEqual([]);
});

test("protected pages and APIs require a session", async ({ page, request }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/login/);
  const api = await request.post("/api/generations/estimate", { data: {}, headers: { origin: "http://localhost:3100" } });
  expect(api.status()).toBe(401);
  const admin = await request.post("/api/admin/reconcile", { headers: { origin: "http://localhost:3100" } });
  expect(admin.status()).toBe(401);
});

test("cross-origin mutations are rejected", async ({ request }) => {
  const res = await request.post("/api/projects", { data: { title: "x" }, headers: { origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
});

test("signed media links cannot be forged", async ({ request }) => {
  const res = await request.get("/api/media?p=00000000-0000-4000-8000-000000000000/video/00000000-0000-4000-8000-000000000000&e=9999999999&s=forged");
  expect(res.status()).toBe(403);
});
