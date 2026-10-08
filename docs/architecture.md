# Architecture

## Vue d'ensemble

```
Navigateur ──▶ Next.js (App Router, routes API, server actions)
                 │  config validée (src/lib/config/env.ts)
                 │  Services (src/lib/container.ts) : store, storage, providers, dispatcher
                 ├─▶ Store : DemoStore (JSON local)  |  SupabaseStore (RPC Postgres, RLS)
                 ├─▶ Storage : disque local signé HMAC |  bucket Supabase privé
                 └─▶ Dispatcher : en processus (démo) |  Trigger.dev (live)
                                         │
                                         ▼
                            Worker (src/lib/generation/worker.ts)
                            voix ▶ soumission ▶ suivi ▶ stockage MP4
                                         │
                            VideoProvider : Demo | Hedra Character 3
                            SpeechProvider : Demo | ElevenLabs
```

Tout le code métier dépend d'interfaces (`Store`, `MediaStorage`, `VideoProvider`, `SpeechProvider`, `Dispatcher`). Le mode démo et le mode live partagent le même worker, la même machine à états et la même logique de crédits ; seuls les adaptateurs changent.

## Cycle de vie d'une génération

États (`src/lib/generation/state-machine.ts`, miroir SQL `generation_transition_allowed`) :

```
queued ─▶ preparing_audio ─▶ submitting ─▶ processing ─▶ storing ─▶ succeeded
  │             │                 │              │            │
  └─▶ canceled  └─────────────────┴──────────────┴────────────┴─▶ failed / needs_reconciliation
```

1. **Estimation** (`/api/generations/estimate`) : durée réelle de l'audio (ffprobe) ou estimée depuis le texte, tarif versionné, crédits. Elle renvoie une empreinte `quoteId`.
2. **Lancement** (`/api/generations`) : le serveur recalcule l'estimation ; si elle diffère du `quoteId` affiché, refus `quote_changed`. Dans une seule transaction : vérification des plafonds par génération et par jour, réservation des crédits (clé `reserve:<id>`), création de la génération et d'une entrée d'outbox. Clé d'idempotence `launch:<submissionId>` : un double clic ne crée qu'une génération.
3. **Dispatch** : l'outbox est vidée vers le dispatcher. Si le dispatch échoue, la réconciliation le rejoue.
4. **Worker** : chaque étape est une transition *compare-and-set* (`from` attendu + `expectedAttempts`). Deux workers concurrents ne peuvent pas traiter la même étape.
5. **Soumission** : la clé d'idempotence fournisseur est déterministe (`generationId` + tentative). Une erreur dont l'issue est inconnue (coupure réseau après envoi) ne déclenche **pas** de nouvel envoi aveugle : la génération passe en `needs_reconciliation`.
6. **Stockage** : la vidéo est téléchargée (anti-SSRF, taille maximale, délai), vérifiée par ffprobe, puis écrite à un chemin déterministe `<owner>/video/<generationId>`. Une reprise après plantage réécrit le même objet sans doublon.
7. **Règlement** : `complete_generation` consomme la réservation (`consume:<id>`), `fail_generation` la libère (`release:<id>`). Les clés du grand livre sont uniques : un règlement ne peut pas se produire deux fois. Les lignes terminales sont immuables (trigger SQL).

## Données (Supabase)

Migration unique : `supabase/migrations/20261008000100_initial_schema.sql`.

- Tables : `profiles`, `user_roles`, `projects`, `assets`, `generations`, `credit_accounts`, `credit_ledger`, `credit_packs`, `purchases`, `webhook_events`, `job_outbox`, `audit_logs`, `budget_days`, `rate_limits`.
- RLS activée partout. Le client lit ses propres lignes ; il ne peut écrire que des champs inoffensifs (nom de projet, par exemple). Les rôles sont dans `user_roles`, jamais dans `profiles`, et ne sont modifiables par aucun client.
- Toutes les opérations sensibles (crédits, transitions, achats, admin) passent par des fonctions `security definer` exécutables uniquement par `service_role`, appelées côté serveur.
- `claim_outbox` utilise `FOR UPDATE SKIP LOCKED`.
- Bucket `media` privé ; une politique de lecture limitée au dossier `<auth.uid()>/`.

## Sécurité

- Configuration validée au démarrage, refus en live si incomplète (`ConfigError`).
- Aucun secret dans `NEXT_PUBLIC_*`. La clé `service_role` n'est utilisée que dans `src/lib/db/supabase.ts` (`server-only`).
- Mutations protégées par vérification d'origine (`assertSameOrigin`) et limitation de débit (`hit_rate_limit` en SQL, magasin local en démo).
- Fichiers : type détecté par signature binaire (pas par extension), dimensions et durée contrôlées, EXIF supprimé (orientation appliquée avant), chemins de stockage générés par le serveur.
- Téléchargements sortants : HTTPS uniquement, résolution DNS vérifiée contre les plages privées, chaque redirection revérifiée.
- Liens média signés et expirants (5 min). Les journaux sont assainis (clés, jetons, URLs signées masqués).
- En-têtes de sécurité (CSP de base, `X-Frame-Options`, `Referrer-Policy`, etc.) dans `next.config.ts`.

## Décisions et écarts

| Décision | Raison |
| --- | --- |
| Next.js 16.4 avec `src/proxy.ts` (ancien `middleware.ts`) | Convention de la version installée. Le proxy ne rafraîchit la session Supabase qu'en live. |
| Cache Components désactivé | Pages entièrement dynamiques et dépendantes de l'utilisateur ; évite les incohérences de cache sur les crédits et statuts. |
| Composants « shadcn/ui » écrits à la main | Le registre shadcn n'était pas accessible depuis l'environnement de développement. Mêmes conventions (Radix, `cva`, `cn`), donc compatible avec un ajout ultérieur via la CLI. |
| Mode démo avec stockage JSON local | Permet de tester tout le parcours sans aucun compte cloud. Un seul processus ; pas prévu pour la production. |
| Tests SQL avec PGlite | Exécute la vraie migration (RLS, triggers, fonctions) sans Docker ; les schémas `auth` et `storage` sont simulés. |
| Retries Trigger.dev à 1 tentative | Les reprises sont gérées par le worker et la réconciliation, qui connaissent l'idempotence ; une reprise aveugle de la plateforme pourrait doubler une soumission payante. |
| Interface en français, structure i18n | Dictionnaire `fr` complet ; `en` et `nl` prévus mais vides (repli sur le français). |
