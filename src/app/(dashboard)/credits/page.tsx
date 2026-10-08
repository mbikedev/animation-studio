import { BuyPackButton } from "@/components/buy-pack";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/pricing";
import { billingMode } from "@/lib/billing/stripe";
import { getServices } from "@/lib/container";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Crédits" };

const EVENT_LABEL: Record<string, string> = {
  signup_bonus: "Bonus d'inscription",
  purchase: "Achat de crédits",
  reserve: "Réservation (génération)",
  consume: "Génération livrée",
  release: "Crédits rendus",
  admin_adjustment: "Ajustement administrateur",
  refund_reversal: "Remboursement / litige",
};

const PAYMENT_LABEL: Record<string, string> = {
  pending: "En attente",
  paid: "Payé",
  async_pending: "Paiement en cours de confirmation",
  failed: "Échec",
  expired: "Expiré",
  refunded: "Remboursé",
  disputed: "Litige",
};

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await requireUser();
  const services = getServices();
  const [account, ledger, packs, purchases, params] = await Promise.all([
    services.store.getCreditAccount(user.id),
    services.store.listLedger(user.id, 50),
    services.store.listPacks(),
    services.store.listPurchases(user.id),
    searchParams,
  ]);
  const mode = billingMode(services);
  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Crédits</h1>
        <p className="mt-1 text-sm text-muted">Les crédits sont une unité interne de l&apos;application, distincte de l&apos;euro, du dollar et des crédits du fournisseur vidéo.</p>
      </header>
      {params.checkout === "success" && (
        <Alert tone="success">Merci ! Les crédits sont ajoutés dès que le paiement est confirmé par Stripe (cela peut prendre quelques instants).</Alert>
      )}
      {params.checkout === "canceled" && <Alert>Paiement annulé : aucun montant débité.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardDescription className="mt-0">Disponibles</CardDescription>
          <p className="mt-1 text-3xl font-semibold">{account.availableCredits}</p>
        </Card>
        <Card>
          <CardDescription className="mt-0">Réservés par des générations en cours</CardDescription>
          <p className="mt-1 text-3xl font-semibold">{account.reservedCredits}</p>
        </Card>
      </div>
      <Card>
        <CardTitle>Packs de crédits</CardTitle>
        <CardDescription>
          {mode === "demo"
            ? "Démonstration : paiement simulé, aucun débit réel."
            : mode === "stripe"
              ? services.config.flags.stripeLive
                ? "Paiement sécurisé par Stripe."
                : "Stripe en mode test : utilisez une carte de test."
              : "Paiements non configurés."}{" "}
          Tarifs à valider par le propriétaire avant ouverture publique.
        </CardDescription>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {packs.map((p) => (
            <div key={p.id} className="grid gap-3 rounded-lg border border-border p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-muted">{formatMoney(p.amountMinor, p.currency)}</p>
              </div>
              <p className="text-2xl font-semibold">{p.credits} crédits</p>
              {mode !== "disabled" && <BuyPackButton packId={p.id} label="Acheter" />}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardTitle>Historique</CardTitle>
        {ledger.length === 0 ? (
          <CardDescription>Aucun mouvement.</CardDescription>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Opération</th>
                  <th className="py-2 text-right font-medium">Disponibles</th>
                  <th className="py-2 text-right font-medium">Réservés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 text-muted">{formatDate(l.createdAt)}</td>
                    <td className="py-2">{EVENT_LABEL[l.eventType] ?? l.eventType}</td>
                    <td className="py-2 text-right tabular-nums">{l.availableDelta > 0 ? `+${l.availableDelta}` : l.availableDelta || "—"}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{l.reservedDelta > 0 ? `+${l.reservedDelta}` : l.reservedDelta || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {purchases.length > 0 && (
        <Card>
          <CardTitle>Achats</CardTitle>
          <ul className="mt-3 divide-y divide-border text-sm">
            {purchases.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  {formatDate(p.createdAt)} · {p.creditsSnapshot} crédits · {formatMoney(p.amountMinor, p.currency)}
                </span>
                <Badge tone={p.paymentStatus === "paid" ? "success" : p.paymentStatus === "failed" || p.paymentStatus === "disputed" ? "danger" : "neutral"}>
                  {PAYMENT_LABEL[p.paymentStatus] ?? p.paymentStatus}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
