import { statusLabel } from "@/lib/generation/state-machine";
import { Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { formatMoney } from "@/lib/billing/pricing";
import { getServices } from "@/lib/container";
import { GENERATION_STATUSES, type GenerationStatus } from "@/lib/domain";
import { formatDate } from "@/lib/utils";
import { AdjustCredits, ReconcileButton, ResolveGeneration } from "./admin-actions";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const services = getServices();
  const params = await searchParams;
  const filter = GENERATION_STATUSES.includes(params.status as GenerationStatus) ? (params.status as GenerationStatus) : undefined;
  const currency = services.config.limits.currency;
  const [stats, generations, toReconcile, users, audit] = await Promise.all([
    services.store.adminStats(currency),
    services.store.listAllGenerations({ status: filter, limit: 50 }),
    services.store.listAllGenerations({ status: "needs_reconciliation", limit: 20 }),
    services.store.listUsers(100),
    services.store.listAudit(30),
  ]);
  const emails = Object.fromEntries(users.map((u) => [u.userId, u.email]));
  const budget = services.config.limits.dailyProviderBudgetMinor;

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
          <p className="mt-1 text-sm text-muted">
            Mode {services.config.mode} · génération réelle {services.config.flags.realGeneration ? "activée" : "désactivée"} · Stripe {services.config.stripe ? (services.config.flags.stripeLive ? "live" : "test") : "non configuré"}
          </p>
        </div>
        <ReconcileButton />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardDescription className="mt-0">Dépense estimée (toutes générations)</CardDescription>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(stats.estimatedCostMinor, currency)}</p>
        </Card>
        <Card>
          <CardDescription className="mt-0">Dépense réelle déclarée par le fournisseur</CardDescription>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(stats.actualCostMinor, currency)}</p>
        </Card>
        <Card>
          <CardDescription className="mt-0">Aujourd&apos;hui (réservé + dépensé)</CardDescription>
          <p className="mt-1 text-2xl font-semibold">
            {formatMoney((stats.budgetToday?.reservedMinor ?? 0) + (stats.budgetToday?.spentMinor ?? 0), currency)}
          </p>
          <p className="text-xs text-muted">Plafond : {budget !== undefined ? formatMoney(budget, currency) : "non défini"}</p>
        </Card>
        <Card>
          <CardDescription className="mt-0">Échecs 24 h · à vérifier</CardDescription>
          <p className="mt-1 text-2xl font-semibold">
            {stats.failures24h} · <span className={stats.needsReconciliation ? "text-warning" : ""}>{stats.needsReconciliation}</span>
          </p>
        </Card>
      </div>

      {toReconcile.length > 0 && (
        <Card>
          <CardTitle>Générations à vérifier</CardTitle>
          <CardDescription>Résultat fournisseur incertain : les crédits restent réservés jusqu&apos;à résolution. Aucune relance facturable n&apos;est faite automatiquement.</CardDescription>
          <ul className="mt-4 grid gap-4">
            {toReconcile.map((g) => (
              <li key={g.id} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_auto]">
                <div className="text-sm">
                  <p className="font-mono text-xs text-muted">{g.id}</p>
                  <p>
                    {emails[g.ownerId] ?? g.ownerId} · {formatDate(g.createdAt)} · {g.provider}/{g.modelId}
                  </p>
                  <p className="text-xs text-muted">
                    Code : {g.errorCode ?? "—"} · tâche fournisseur : {g.providerJobId ?? "inconnue"}
                  </p>
                </div>
                <ResolveGeneration generationId={g.id} hasProviderJob={Boolean(g.providerJobId)} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Générations</CardTitle>
          <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-1 text-xs">
            <a href="/admin" className={`rounded px-2 py-1 ${!filter ? "bg-accent-soft text-accent" : "text-muted"}`}>
              Toutes
            </a>
            {GENERATION_STATUSES.map((s) => (
              <a key={s} href={`/admin?status=${s}`} className={`rounded px-2 py-1 ${filter === s ? "bg-accent-soft text-accent" : "text-muted"}`}>
                {statusLabel(s)} ({stats.generationsByStatus[s] ?? 0})
              </a>
            ))}
          </nav>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Utilisateur</th>
                <th className="py-2 font-medium">Statut</th>
                <th className="py-2 font-medium">Moteur</th>
                <th className="py-2 text-right font-medium">Crédits</th>
                <th className="py-2 text-right font-medium">Estimé</th>
                <th className="py-2 text-right font-medium">Réel</th>
                <th className="py-2 font-medium">Erreur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {generations.map((g) => (
                <tr key={g.id}>
                  <td className="py-2 text-muted">{formatDate(g.createdAt)}</td>
                  <td className="max-w-48 truncate py-2">{emails[g.ownerId] ?? g.ownerId.slice(0, 8)}</td>
                  <td className="py-2">
                    <Badge tone={g.status === "succeeded" ? "success" : g.status === "failed" ? "danger" : g.status === "needs_reconciliation" ? "warning" : "neutral"}>
                      {statusLabel(g.status)}
                    </Badge>
                  </td>
                  <td className="py-2 text-xs text-muted">
                    {g.provider} · {g.modelId} · {g.priceVersion}
                  </td>
                  <td className="py-2 text-right tabular-nums">{g.reservedCredits}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(g.estimatedCostMinor, g.currency)}</td>
                  <td className="py-2 text-right tabular-nums">{g.actualCostMinor === null ? "—" : formatMoney(g.actualCostMinor, g.currency)}</td>
                  <td className="py-2 text-xs text-danger">{g.errorCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Utilisateurs</CardTitle>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Inscription</th>
                <th className="py-2 text-right font-medium">Disponibles</th>
                <th className="py-2 text-right font-medium">Réservés</th>
                <th className="py-2 text-right font-medium">Générations</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.userId}>
                  <td className="py-2">
                    {u.email ?? u.userId} {u.isAdmin && <Badge tone="accent">admin</Badge>}
                  </td>
                  <td className="py-2 text-muted">{formatDate(u.createdAt)}</td>
                  <td className="py-2 text-right tabular-nums">{u.availableCredits}</td>
                  <td className="py-2 text-right tabular-nums">{u.reservedCredits}</td>
                  <td className="py-2 text-right tabular-nums">{u.generations}</td>
                  <td className="py-2 text-right">
                    <AdjustCredits userId={u.userId} email={u.email} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Journal d&apos;audit</CardTitle>
        <ul className="mt-3 divide-y divide-border text-sm">
          {audit.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-3 py-2">
              <span className="text-muted">{formatDate(a.createdAt)}</span>
              <span className="font-medium">{a.action}</span>
              <span className="text-muted">
                {a.targetType} {a.targetId?.slice(0, 8)}
              </span>
              <span className="text-xs text-muted">{JSON.stringify(a.sanitizedMetadata)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
