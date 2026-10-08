import { notFound } from "next/navigation";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/pricing";
import { getServices } from "@/lib/container";
import { DemoCheckoutActions } from "./actions-client";

export const metadata = { title: "Paiement simulé" };

export default async function DemoCheckoutPage({ searchParams }: { searchParams: Promise<{ purchase?: string }> }) {
  const user = await requireUser();
  const services = getServices();
  if (services.config.mode !== "demo" || services.config.stripe) notFound();
  const { purchase: purchaseId } = await searchParams;
  const purchase = purchaseId ? await services.store.getPurchase(purchaseId) : null;
  if (!purchase || purchase.userId !== user.id) notFound();
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardTitle>Paiement simulé (démonstration)</CardTitle>
        <CardDescription>Aucun paiement réel. Ce parcours utilise la même logique de crédit que le webhook Stripe.</CardDescription>
        <p className="mt-4 text-2xl font-semibold">
          {purchase.creditsSnapshot} crédits · {formatMoney(purchase.amountMinor, purchase.currency)}
        </p>
        <DemoCheckoutActions purchaseId={purchase.id} />
      </Card>
    </div>
  );
}
