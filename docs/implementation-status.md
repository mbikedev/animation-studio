# État de l'implémentation

Date : 2026-10-08. Légende : ✅ fait et testé automatiquement · 🟡 fait mais non exécuté contre le vrai service · ⬜ non fait.

## Phases de la spécification

| Phase | Contenu | État |
| --- | --- | --- |
| A — Socle | Next.js 16 App Router, TypeScript strict, Tailwind 4, composants style shadcn, configuration validée demo/live, thème sombre/clair | ✅ |
| B — Données | Migration Supabase (tables, RLS, triggers, fonctions), seed sans admin, store démo | ✅ SQL testé sur PGlite · 🟡 jamais appliqué sur un vrai projet Supabase |
| C — Médias | Upload signé, validation par signature, EXIF, ffprobe, stockage privé, liens signés | ✅ démo · 🟡 Supabase Storage |
| D — Génération | Machine à états, outbox, worker, idempotence, réconciliation, adaptateurs Hedra et ElevenLabs | ✅ démo et contrats simulés · 🟡 Hedra/ElevenLabs/Trigger.dev réels |
| E — Crédits et paiement | Estimation, réservation, règlement, packs, Stripe Checkout + webhooks, remboursements/litiges | ✅ démo et webhooks signés en test · 🟡 compte Stripe test réel |
| F — Admin, compte, qualité | Admin (stats, résolution, ajustements audités), suppression de compte, tests, docs | ✅ |

## Résultats des vérifications (dernière exécution)

Voir le rapport final ; commandes : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.

Couverture des tests :

- **Unitaires** : tarification (secondes commencées, arrondis, marge), configuration (fail closed, clé Stripe live, secrets), détection de type et EXIF, anti-SSRF (IP privées, IPv6, redirections), contrat Hedra (requêtes, erreurs, statuts, signature webhook).
- **Intégration** : parcours de génération (succès, échec, annulation, double clic, plafonds, devis modifié, coupure après envoi, délai dépassé, outbox, reprise après plantage, transfert relancé, concurrence de workers, double règlement), uploads (formats, taille, durée, fichiers déguisés), Stripe (achat, doublons, remboursement, litige, événements live refusés), SQL réel (RLS entre utilisateurs, rôles non modifiables, immutabilité, transitions, soldes non négatifs).
- **E2E (Chromium, desktop et mobile)** : inscription, confirmation, achat simulé, upload, estimation, lancement, téléchargement MP4, échec simulé remboursé, galerie, grand livre, protections d'accès, refus cross-origin, lien média falsifié, absence de défilement horizontal sur mobile.

## Simulé ou non vérifié en conditions réelles

- Aucun appel réel à Hedra, ElevenLabs, Stripe, Supabase ou Trigger.dev n'a été fait (aucune dépense, aucun compte créé).
- L'idempotence de `idempotency_key` chez Hedra est reprise de la documentation, non vérifiée.
- Les e-mails Supabase (confirmation, réinitialisation) dépendent de la configuration SMTP du projet.
- La vidéo de démonstration n'est pas une animation : image fixe zoomée + audio.

## Limites connues de la V1

- Traductions anglaise et néerlandaise : structure prête, textes non rédigés (repli sur le français).
- Pas d'annulation après transmission au moteur (Hedra ne documente pas d'annulation garantie).
- Une seule génération simultanée par utilisateur par défaut (`MAX_CONCURRENT_JOBS_PER_USER`).
- Le mode démo stocke tout dans un fichier JSON local : un seul processus, pas pour la production.
- Sentry prévu dans la configuration mais non branché.
- Pas de file d'attente prioritaire ni de suivi de progression en pourcentage (le moteur n'en garantit pas).
- Durée maximale 30 s par vidéo.

## Prochaines étapes suggérées (non faites)

1. Projet Supabase + Stripe test + Trigger.dev, puis parcours complet en live avec `REAL_GENERATION_ENABLED=false`.
2. Un essai Hedra réel court et budgété, sur décision du propriétaire.
3. Traductions en/nl, textes juridiques validés, prix des packs recalculés.
