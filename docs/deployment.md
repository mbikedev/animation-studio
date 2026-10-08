# Déploiement

> Rien n'a été déployé. Chaque étape ci-dessous est à réaliser par le propriétaire, dans l'ordre. Le déploiement public et l'activation des paiements réels sont deux décisions séparées.

## 1. Supabase

1. Créez un projet Supabase (région UE recommandée pour des utilisateurs en Belgique).
2. Appliquez la migration : avec la CLI (`supabase link --project-ref <ref>` puis `supabase db push`) ou en collant `supabase/migrations/20261008000100_initial_schema.sql` dans l'éditeur SQL.
3. Facultatif : exécutez `supabase/seed.sql` (deux packs, aucun utilisateur).
4. Vérifiez que le bucket `media` existe et est **privé**.
5. Auth → URL Configuration : `Site URL` = votre domaine, ajoutez `https://<domaine>/auth/confirm` aux redirections autorisées. Activez la confirmation par e-mail et configurez un SMTP (l'envoi par défaut de Supabase est limité).
6. Récupérez l'URL, la clé publishable et la clé `service_role` (cette dernière uniquement côté serveur).

## 2. Trigger.dev

1. Créez un projet ; notez la référence `proj_...` et la clé secrète de l'environnement.
2. `TRIGGER_PROJECT_REF=proj_... pnpm worker:deploy` déploie les tâches `process-generation` et `reconcile-generations` (toutes les 5 minutes). FFmpeg est inclus par l'extension de build.
3. Dans Trigger.dev, définissez les mêmes variables d'environnement serveur que l'application (Supabase, Hedra, ElevenLabs, plafonds).

## 3. Hébergement Next.js (Vercel ou équivalent Node 22)

1. Importez le dépôt, commande de build `pnpm build`.
2. Variables : copiez `.env.example`, `APP_MODE=live`, `APP_BASE_URL=https://<domaine>`, Supabase, Trigger.dev. **Laissez `REAL_GENERATION_ENABLED=false`.**
3. FFmpeg/ffprobe doivent être disponibles pour la validation des audios. Sur Vercel, ils ne le sont pas par défaut : fournissez des binaires statiques via `FFPROBE_PATH`/`FFMPEG_PATH`, ou hébergez l'application sur un serveur Node (Hostinger VPS, Railway, Render…) où vous installez FFmpeg.
4. Déployez, créez votre compte, puis accordez-vous le rôle admin : `APP_MODE=live ... pnpm admin:grant <votre-uuid>` (UUID visible dans Supabase → Authentication).

## 4. Stripe (mode test)

1. Dans le tableau de bord Stripe **en mode test**, créez un produit par pack avec un prix unique.
2. Renseignez `stripe_price_id` dans la table `credit_packs`.
3. Webhook : `https://<domaine>/api/billing/webhook`, événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`. Copiez le secret dans `STRIPE_WEBHOOK_SECRET`.
4. `STRIPE_SECRET_KEY=sk_test_...`. Testez avec la carte `4242 4242 4242 4242`.
5. En local : `stripe listen --forward-to localhost:3000/api/billing/webhook`.

Passer en paiements réels (clé `sk_live_`, `STRIPE_LIVE_ENABLED=true`) est une décision distincte, à prendre après la validation juridique (voir [privacy-and-launch.md](privacy-and-launch.md)).

## 5. Activer la génération réelle (décision du propriétaire)

1. Vérifiez le tarif sur la page officielle Hedra et renseignez `HEDRA_PRICE_VERSION` (par exemple `hedra-c3-2026-10-08`) et `HEDRA_RATE_MICROS_*`.
2. Fixez `MAX_GENERATION_COST_MINOR` et `DAILY_PROVIDER_BUDGET_MINOR` (voir [budget.md](budget.md)).
3. Ajoutez `HEDRA_API_KEY` dans l'application et dans Trigger.dev.
4. Passez `REAL_GENERATION_ENABLED=true`, redéployez, faites un essai court en 540p et comparez le coût réel.
5. Facultatif : webhooks Hedra (`/api/webhooks/hedra`, `HEDRA_WEBHOOK_PUBLIC_KEY`).

## Retour arrière

- Couper les dépenses : `REAL_GENERATION_ENABLED=false` (et `VOICE_GENERATION_ENABLED=false`), redéployez. Les générations déjà soumises continuent d'être suivies et réglées.
- Couper les paiements : retirez `STRIPE_SECRET_KEY` ou désactivez les packs (`active=false`).
