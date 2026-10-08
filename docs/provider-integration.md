# Intégration des fournisseurs

Documentation officielle consultée le **2026-10-08**. Les API évoluent : revérifiez avant toute activation réelle. Aucun appel réel n'a été effectué pendant le développement (aucun crédit dépensé) ; les adaptateurs sont testés contre des réponses simulées conformes à la documentation (`tests/unit/hedra-contract.test.ts`).

## Hedra (vidéo) — `src/lib/providers/hedra.ts`

Sources : documentation API Hedra v3 (https://api.hedra.com/v3, référence publique Hedra) et page tarifaire officielle.

| Élément | Valeur utilisée |
| --- | --- |
| Base | `https://api.hedra.com/v3` (`HEDRA_API_BASE_URL`) |
| Authentification | en-tête `Authorization: Key <HEDRA_API_KEY>` |
| Envoi de fichiers | `POST /files` (multipart `file`) → `{ url, content_type, expires_at }`, URL valable environ 1 h |
| Création | `POST /models/hedra-character-3` avec `{ input: { prompt, aspect_ratio, resolution, duration_ms, start_image: { source: "url", url }, audio: { source: "url", url } }, idempotency_key }` → 202 `{ job_id, status }` |
| Statut | `GET /jobs/{id}/status` : `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED` |
| Résultat | `GET /jobs/{id}` → `outputs[].url` (temporaire, expire après 48 h), `cost`, `currency` |
| Webhooks (optionnel) | signature ed25519 sur `timestamp\nid\nevent\nredelivery\nsha256(body)`, en-têtes `X-Hedra-Webhook-*`, clé publique via `/v3/webhooks/public-key` → `HEDRA_WEBHOOK_PUBLIC_KEY` |

Correspondance interne :

| Hedra | Application |
| --- | --- |
| `IN_QUEUE` | `queued` (fournisseur) → statut `processing` côté app |
| `IN_PROGRESS` | `processing` |
| `COMPLETED` | téléchargement puis `storing` → `succeeded` |
| `FAILED` | `failed`, crédits rendus |
| 400/401/403/404/422 | rejet définitif (`rejected`) |
| 408/429/5xx avant envoi | `retryable` avec délai |
| coupure après envoi | `unknown` → `needs_reconciliation` |

Points d'attention :

- Le « prompt » est obligatoire : l'application envoie une consigne neutre si l'utilisateur n'en saisit pas.
- `findByIdempotencyKey` **renvoie la même requête avec la même `idempotency_key`** pour retrouver la tâche. Ce n'est sans risque que si Hedra garantit l'idempotence de cette clé, comme le décrit sa documentation au 2026-10-08. **À confirmer auprès de Hedra avant d'activer le mode réel.** En cas de doute, désactivez la recherche automatique et résolvez à la main depuis l'admin.
- Les URL de sortie expirent : la vidéo est copiée immédiatement dans le stockage privé.
- Tarif indicatif lu le 2026-10-08 : 0,025 / 0,05 / 0,0625 USD par seconde (540p / 720p / 1080p). Il n'est utilisé qu'en démo ; en live, le propriétaire doit saisir le tarif vérifié (`HEDRA_RATE_MICROS_*`, `HEDRA_PRICE_VERSION`).
- Identité visuelle : le nom, les textes et les assets de Hedra ne sont pas repris dans l'interface. Hedra n'est mentionné que comme fournisseur technique dans la documentation et la page de confidentialité.

## ElevenLabs (voix, optionnel) — `src/lib/providers/elevenlabs.ts`

- `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, en-tête `xi-api-key`, corps `{ text, model_id }` (défaut `eleven_multilingual_v2`).
- Activé seulement si `VOICE_GENERATION_ENABLED=true`, avec clé, voix et coût estimé (`ELEVENLABS_COST_MINOR_PER_1K_CHARS`).
- Le texte est limité en longueur ; l'audio produit est vérifié (ffprobe) et sa durée réelle sert au règlement.
- En démo, la « voix » est une simple tonalité dont la durée suit la longueur du texte.

## Stripe (paiement) — `src/lib/billing/stripe.ts`

- Checkout en mode `payment` avec le `stripe_price_id` du pack (table `credit_packs`). Le seed laisse ces identifiants vides : le propriétaire crée les prix **en mode test** et met à jour la table.
- Webhook `/api/billing/webhook` : signature vérifiée sur le corps brut, idempotence via `webhook_events`. Événements traités : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`.
- Remboursement ou litige : écriture de reprise (`reversal:`) qui retire les crédits du pack dans la limite du solde disponible (le solde ne devient jamais négatif). La part déjà dépensée est notée `uncovered` dans le grand livre et l'audit, pour traitement manuel.
- Les événements `livemode=true` sont refusés tant que `STRIPE_LIVE_ENABLED` n'est pas `true` ; une clé `sk_live_` sans ce drapeau empêche le démarrage.

## Ajouter un autre moteur

Implémenter `VideoProvider` (`src/lib/providers/types.ts`) : `capabilities`, `submit`, `getStatus`, `getResult`, et si possible `findByIdempotencyKey` et `cancel`. Classer chaque erreur en `rejected`, `retryable` ou `unknown`. Brancher l'adaptateur dans `src/lib/container.ts` et ajouter un test de contrat.
