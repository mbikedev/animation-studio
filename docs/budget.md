# Budget, crédits et plafonds

## Principe : aucune dépense par défaut

Une génération payante n'est possible que si **toutes** ces conditions sont réunies (sinon l'interface affiche les raisons du blocage) :

1. `APP_MODE=live` ;
2. `REAL_GENERATION_ENABLED=true` ;
3. `HEDRA_API_KEY` renseignée ;
4. tarif vérifié par le propriétaire : `HEDRA_PRICE_VERSION` et `HEDRA_RATE_MICROS_540P/720P/1080P` ;
5. `MAX_GENERATION_COST_MINOR` (plafond par génération) ;
6. `DAILY_PROVIDER_BUDGET_MINOR` (plafond global par jour UTC).

La voix ElevenLabs a ses propres conditions (`VOICE_GENERATION_ENABLED`, clé, voix, coût estimé). Une clé présente n'est jamais une autorisation de dépense.

## Calcul

Les montants sont des entiers (pas de virgule flottante) :

- tarif en micro-unités par seconde (`25000` = 0,025 USD/s) ;
- **toute seconde commencée est facturée** : 10,2 s → 11 s ;
- coût fournisseur (unités mineures, arrondi au supérieur) = secondes × tarif / 10 000 ;
- crédits = ⌈ coût × `CREDIT_MARKUP_BPS` / 10 000 / `CREDIT_VALUE_MINOR` ⌉.

Exemple avec les valeurs par défaut (tarif indicatif 720p 0,05 USD/s, marge ×1,5, 1 crédit = 0,05 USD) :

| Durée | Résolution | Coût fournisseur | Crédits |
| --- | --- | --- | --- |
| 10 s | 540p | 0,25 USD | 8 |
| 10 s | 720p | 0,50 USD | 15 |
| 30 s | 720p | 1,50 USD | 45 |
| 30 s | 1080p | 1,88 USD | 57 |

Le coût de la voix (si activée) s'ajoute selon la longueur du texte.

L'estimation affichée porte une empreinte (`quoteId`) qui inclut la version du tarif. Si le tarif ou les paramètres changent entre l'affichage et le lancement, le serveur refuse (`quote_changed`) et l'utilisateur voit la nouvelle estimation.

## Packs (seed, à ajuster)

| Pack | Crédits | Prix |
| --- | --- | --- |
| Découverte | 100 | 5,00 EUR |
| Créateur | 500 | 20,00 EUR |

Attention : le coût fournisseur est en `COST_CURRENCY` (USD par défaut) alors que les packs sont en EUR. La marge réelle dépend du taux de change et des frais Stripe. **Ces prix sont des exemples, pas une recommandation commerciale** : refaites le calcul avec le tarif vérifié, les frais Stripe et la TVA avant tout lancement.

## Réservation et règlement

- Au lancement : les crédits passent de « disponibles » à « réservés » ; le budget du jour est réservé dans la même transaction. Si un plafond serait dépassé, la génération est refusée avant tout appel au fournisseur.
- Réussite : la réservation est consommée ; le coût réel renvoyé par le fournisseur (s'il existe) est enregistré.
- Échec ou annulation : la réservation est libérée et le budget du jour rendu.
- Issue inconnue (`needs_reconciliation`) : rien n'est rendu ni consommé tant que l'issue n'est pas connue.

Chaque mouvement est une ligne du grand livre `credit_ledger` avec une clé unique (`reserve:`, `consume:`, `release:`, `purchase:`, `reversal:`, `admin:`). Les soldes ne peuvent pas devenir négatifs (contraintes SQL).

## Recommandations avant d'activer

- Commencez avec un budget journalier faible (par exemple `DAILY_PROVIDER_BUDGET_MINOR=500`, soit 5 USD) et `MAX_GENERATION_COST_MINOR=200`.
- Configurez une alerte de facturation et une limite de dépense côté Hedra si l'offre le permet.
- Faites un premier essai de 3 à 5 secondes en 540p, comparez le coût réel (`provider_cost_minor`) à l'estimation, puis ajustez.
- `SIGNUP_BONUS_CREDITS` reste à 0 tant que l'abus (comptes multiples) n'est pas maîtrisé.
