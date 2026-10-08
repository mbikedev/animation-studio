# Animation Studio

Application web pour animer un personnage à partir d'une image et d'une voix : on importe une image de personnage et un audio (ou un texte à transformer en voix), on lance une génération vidéo, on suit son avancement et on télécharge le MP4.

> **État : V1 locale et testable.** Le mode démonstration fonctionne de bout en bout sans aucun secret. Le mode réel (Supabase, Hedra, ElevenLabs, Stripe test, Trigger.dev) est implémenté mais **n'a pas été exécuté contre de vrais services** : aucun crédit fournisseur n'a été dépensé. Voir [docs/implementation-status.md](docs/implementation-status.md).

## Ce que fait l'application

- Comptes (inscription, confirmation e-mail, connexion, mot de passe oublié), projets, galerie.
- Import d'image (JPEG, PNG, WebP) et d'audio (MP3, WAV, 30 s max) avec validation réelle du contenu, suppression des métadonnées EXIF et stockage privé.
- Voix optionnelle à partir d'un texte (ElevenLabs), désactivée par défaut.
- Estimation du coût en crédits **avant** lancement, réservation des crédits, consommation à la réussite, remboursement automatique à l'échec.
- Suivi par états réels (en attente, génération, sauvegarde, terminée) sans pourcentage inventé.
- Téléchargement MP4 par lien signé de courte durée.
- Achat de packs de crédits (Stripe Checkout en mode test, ou paiement simulé en démo).
- Espace administrateur : statistiques, générations bloquées, ajustement de crédits motivé et audité.
- Suppression du compte et des données.

## Prérequis

- Node.js 22 (voir `.nvmrc`) et pnpm 10 (`corepack enable`).
- FFmpeg et ffprobe dans le `PATH` (ou `FFMPEG_PATH` / `FFPROBE_PATH`). Sans FFmpeg, la démo utilise une vidéo d'exemple fixe et la durée des audios ne peut pas être vérifiée (l'import audio est alors refusé).

## Démarrage rapide (mode démo, sans secret)

```bash
pnpm install
cp .env.example .env.local   # facultatif : les valeurs par défaut suffisent
pnpm dev
```

Ouvrez http://localhost:3000 puis :

1. **Créer un compte.** En démo, aucun e-mail n'est envoyé : un lien de confirmation s'affiche à l'écran.
2. **Crédits** : achetez un pack avec le paiement simulé (aucun argent réel).
3. **Studio** : importez une image et un audio, choisissez le format, vérifiez l'estimation, lancez.
4. Suivez la génération puis téléchargez le MP4.

La vidéo de démonstration est un zoom lent sur l'image avec l'audio et la mention « DEMONSTRATION - aucune IA ». **Ce n'est pas une animation IA** : la démo sert à tester le parcours, pas la qualité du moteur.

Pour obtenir le rôle administrateur en démo (aucun admin par défaut) :

```bash
pnpm admin:grant votre-email@example.com
```

Pour effacer toutes les données locales de démo : `pnpm demo:reset`.

## Commandes

| Commande | Rôle |
| --- | --- |
| `pnpm dev` | Serveur de développement |
| `pnpm build` / `pnpm start` | Build de production / serveur de production |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript strict (`tsc --noEmit`) |
| `pnpm test` | Tests unitaires et d'intégration (Vitest, SQL réel via PGlite) |
| `pnpm test:e2e` | Parcours complet dans un navigateur (Playwright, desktop + mobile) |
| `pnpm worker:dev` / `pnpm worker:deploy` | Worker Trigger.dev (mode live) |
| `pnpm reconcile` | Une passe de réconciliation (outbox, tâches bloquées) |
| `pnpm admin:grant <email démo | UUID live>` | Accorder le rôle admin à un utilisateur précis |
| `pnpm demo:reset` | Supprimer les données de démo |

Tests E2E : Playwright lance `next build` + `next start` sur le port 3100 avec un dossier de données isolé. Si le navigateur Playwright n'est pas installé (`pnpm exec playwright install chromium`), indiquez un Chromium existant :

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/chemin/vers/chromium pnpm test:e2e
```

## Mode démo et mode live

| | `APP_MODE=demo` (défaut) | `APP_MODE=live` |
| --- | --- | --- |
| Secrets | Aucun | Supabase + Trigger.dev obligatoires, sinon refus de démarrer |
| Comptes et données | Fichier JSON local (`.demo-data/`) | Supabase Auth + Postgres avec RLS |
| Fichiers | Disque local, liens signés HMAC | Bucket Supabase privé, URLs signées 5 min |
| Moteur vidéo | Simulé (FFmpeg, gratuit) | Hedra Character 3, **seulement si** `REAL_GENERATION_ENABLED=true` et tarif + plafonds configurés |
| Voix | Tonalité simulée | ElevenLabs, seulement si `VOICE_GENERATION_ENABLED=true` |
| Paiement | Simulé | Stripe Checkout (clés test ; clé live refusée sans `STRIPE_LIVE_ENABLED`) |
| Tâches longues | Dans le processus Node | Trigger.dev |

Le mode live ne retombe **jamais** silencieusement en démo. Les dépenses sont bloquées par défaut : voir [docs/budget.md](docs/budget.md).

## Documentation

- [Architecture et décisions](docs/architecture.md)
- [Intégration des fournisseurs (Hedra, ElevenLabs, Stripe)](docs/provider-integration.md)
- [Budget, crédits et plafonds](docs/budget.md)
- [Déploiement (étapes réservées au propriétaire)](docs/deployment.md)
- [Exploitation et incidents](docs/operations.md)
- [Confidentialité et lancement (brouillon)](docs/privacy-and-launch.md)
- [État de l'implémentation](docs/implementation-status.md)

## Structure

```
src/app/            Pages (App Router) et routes API
src/components/     Composants d'interface (style shadcn/ui, écrits à la main)
src/lib/config/     Lecture et validation de la configuration (fail closed)
src/lib/providers/  Adaptateurs Hedra, ElevenLabs et démo
src/lib/generation/ Machine à états, worker, dispatcher, réconciliation
src/lib/billing/    Tarification, crédits, Stripe
src/lib/repositories/ Accès données (démo JSON, Supabase RPC)
src/lib/media/      Validation, EXIF, FFmpeg/ffprobe
src/lib/security/   Téléchargement anti-SSRF, signatures
src/trigger/        Tâches Trigger.dev
supabase/           Migration SQL (tables, RLS, fonctions) et seed
tests/              Unitaires, intégration (SQL via PGlite), E2E
```
