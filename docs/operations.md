# Exploitation

## Surveillance quotidienne

- **Admin** (`/admin`, rôle admin requis) : générations par statut, crédits vendus et consommés, budget du jour, générations « à vérifier ».
- **Journaux** : JSON structuré (`src/lib/logger.ts`), secrets et URLs signées masqués. Événements utiles : `generation.*`, `upload.*`, `stripe.*`, `reconcile.*`.
- **Trigger.dev** : exécutions de `process-generation` et de `reconcile-generations` (toutes les 5 minutes).
- `SENTRY_DSN` est prévu dans la configuration mais l'intégration Sentry n'est pas branchée en V1.

## Réconciliation

La tâche planifiée (ou `pnpm reconcile`) :

1. vide l'outbox (générations créées mais jamais transmises au worker) ;
2. relance les générations dont le worker semble mort (aucune activité depuis 2 minutes) ;
3. tente de résoudre les générations `needs_reconciliation` en interrogeant le fournisseur.

## Générations « à vérifier » (`needs_reconciliation`)

Cause : l'application ne sait pas si le fournisseur a reçu la demande ou si le transfert du résultat a réussi. Les crédits restent réservés. Actions admin (toutes motivées et auditées) :

| Action | Quand l'utiliser |
| --- | --- |
| Réinterroger le fournisseur | Cas par défaut : retrouve la tâche par son identifiant ou sa clé d'idempotence. |
| Reprendre le transfert | La tâche fournisseur est terminée mais la copie du MP4 a échoué. Attention : les sorties Hedra expirent après 48 h. |
| Clôturer et rembourser | La vidéo n'existe pas ou ne sera jamais récupérable. Vérifiez d'abord dans le tableau de bord Hedra pour éviter de rembourser une vidéo payée et livrée. |

## Incidents types

| Symptôme | Vérifications |
| --- | --- |
| Toutes les générations échouent avec `unauthorized` | Clé Hedra expirée ou révoquée. |
| `daily_budget_exceeded` | Budget du jour atteint ; il se réinitialise à minuit UTC. Augmentez-le seulement après analyse. |
| Générations bloquées en `queued` | Worker Trigger.dev non déployé, clé secrète erronée, ou outbox non vidée (lancer `pnpm reconcile`). |
| Paiement réussi sans crédits | Webhook Stripe : URL, secret, événements abonnés ; rejouer l'événement depuis Stripe (traitement idempotent). |
| Import audio refusé « impossible d'analyser » | ffprobe absent ou `FFPROBE_PATH` incorrect sur le serveur. |
| Dépense anormale | `REAL_GENERATION_ENABLED=false` et redéploiement immédiat, puis analyse de `audit_logs` et `credit_ledger`. |

## Ajustement manuel de crédits

Depuis `/admin` : montant positif ou négatif, motif obligatoire, enregistré dans le grand livre (`admin:`) et dans `audit_logs`.

## Données et suppressions

- Suppression de compte depuis `/account` : refusée tant qu'une génération est en cours. Sinon les fichiers sont effacés du stockage, puis la suppression du compte d'authentification efface en cascade profil, projets, assets, générations, crédits et achats. Une ligne d'audit `account.delete` est conservée. Les justificatifs de paiement restent chez Stripe ; si une conservation comptable côté application est requise, il faut l'ajouter (point à valider juridiquement).
- Sauvegardes : activez les sauvegardes Supabase (Point-in-Time Recovery selon l'offre).
