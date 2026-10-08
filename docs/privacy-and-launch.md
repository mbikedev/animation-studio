# Confidentialité et lancement

> **BROUILLON À FAIRE VALIDER.** Ce document et la page `/privacy` de l'application sont des points de départ rédigés sans avis juridique. Ils ne sont **pas** certifiés conformes au RGPD ni à aucune autre réglementation. Faites-les relire par un professionnel avant tout lancement public.

## Données traitées

| Donnée | Finalité | Où | Durée proposée (à valider) |
| --- | --- | --- | --- |
| E-mail, mot de passe (haché par Supabase) | Compte | Supabase Auth | Jusqu'à suppression du compte |
| Images de personnage | Génération | Stockage privé + transmis au moteur vidéo | Jusqu'à suppression par l'utilisateur ou du compte |
| Audios, textes de voix | Génération | Stockage privé + transmis au moteur vidéo / de voix | Idem |
| Vidéos produites | Livraison | Stockage privé | Idem |
| Crédits, achats | Facturation | Postgres ; paiement chez Stripe | Obligations comptables (à préciser) |
| Journaux techniques | Sécurité, débogage | Hébergeur | Courte (par exemple 30 jours) |

Les métadonnées EXIF (dont la géolocalisation) sont supprimées des images à l'import.

## Sous-traitants à mentionner

- Supabase (base de données, authentification, stockage) ;
- Hedra (génération vidéo) — vérifier sa politique de conservation et d'usage des fichiers envoyés, et la localisation des traitements (transferts hors UE) ;
- ElevenLabs (voix, si activée) ;
- Stripe (paiement) ;
- Trigger.dev (exécution des tâches) ;
- l'hébergeur de l'application (Vercel ou autre).

## Points sensibles propres au produit

- **Image et voix de personnes réelles.** Une image de visage et une voix sont des données personnelles, parfois sensibles. Les conditions d'utilisation doivent exiger que l'utilisateur dispose des droits et du consentement des personnes représentées, interdire l'usurpation d'identité, les contenus trompeurs (deepfakes non signalés), sexuels non consentis, haineux ou visant des mineurs.
- **Transparence.** Envisager un marquage des vidéos générées comme contenu de synthèse (exigences de transparence de l'AI Act européen pour les contenus générés ou manipulés).
- **Signalement.** Prévoir une adresse de signalement d'abus et une procédure de retrait.
- **Mineurs.** Fixer un âge minimal et le faire accepter à l'inscription.

## Checklist avant lancement public

- [ ] Mentions légales (éditeur, numéro d'entreprise, contact).
- [ ] Politique de confidentialité validée (remplace la page `/privacy` actuelle).
- [ ] Conditions générales d'utilisation et de vente validées (crédits non remboursables ou non, droit de rétractation pour contenu numérique, TVA).
- [ ] Politique d'usage acceptable et procédure de signalement.
- [ ] Bannière cookies si des traceurs non essentiels sont ajoutés (aucun en V1 : cookies de session uniquement).
- [ ] Contrats de sous-traitance (DPA) avec les fournisseurs.
- [ ] Prix des packs recalculés (tarif vérifié, frais Stripe, TVA, change).
- [ ] Test complet en mode live avec Stripe test, puis un essai réel court et budgété.
- [ ] Sauvegardes, alertes de facturation et surveillance actives.
- [ ] Décision explicite du propriétaire pour : la mise en ligne publique, puis séparément l'activation des paiements réels.
