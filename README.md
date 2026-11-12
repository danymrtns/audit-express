# Audit Express

Un outil d'audit de campagnes d'acquisition digitale. On y dépose un export de campagnes (Excel ou CSV), et il produit en quelques secondes un diagnostic chiffré : indicateurs par levier et par campagne, anomalies classées par priorité, graphiques et pistes de recommandation.

**Démo en ligne : https://danymrtns.github.io/audit-express/** (bouton « Charger l'exemple » pour tester avec un client fictif).

## Pourquoi cet outil

Dans un audit de compte, la première heure sert surtout à calculer : CPA, ROAS, parts de budget, comparaisons entre campagnes. Audit Express fait ce travail tout de suite, pour garder le temps humain pour ce qui compte : comprendre les causes et construire la recommandation.

- **Rien à installer.** C'est une page web. Elle fonctionne aussi sans connexion, en ouvrant `index.html`.
- **Confidentiel.** Tout est calculé dans le navigateur. Aucune donnée n'est envoyée à un serveur.
- **Vérifiable.** Les constats viennent de règles fixes et lisibles, pas d'une IA. Chaque chiffre affiché peut être recalculé à la main.

## Ce qu'il détecte

| Constat | Règle |
| --- | --- |
| Levier surinvesti | Sa part du budget dépasse sa part des conversions d'au moins 10 points |
| Campagne rentable mais bridée | ROAS supérieur à 1,25 fois la moyenne et part d'impressions sous 60 % |
| Campagne coûteuse | CPA supérieur à 1,5 fois la moyenne, pour au moins 5 % du budget |
| Dépense sans conversion | Au moins 2 % du budget, zéro conversion |
| L'annonce attire, la page ne convertit pas | CTR élevé et taux de conversion faible par rapport aux autres campagnes du levier |
| Annonces peu attractives | CTR inférieur à la moitié de celui des autres campagnes du levier |
| Rentabilité flattée par la marque | Le ROAS baisse d'au moins 15 % une fois les campagnes de marque retirées |

Les seuils sont regroupés en haut de [`analyse.js`](analyse.js) et se modifient en une ligne.

Pour une campagne rentable mais bridée, l'outil donne un ordre de grandeur du gain possible. Il repose sur une hypothèse affichée avec le chiffre : le budget ajouté rapporte 70 % du rendement actuel.

## Format du fichier

Une ligne par campagne (ou par campagne et par période : les lignes sont additionnées). Les colonnes sont reconnues automatiquement, en français ou en anglais, et se corrigent à la main si besoin.

| Colonne | Obligatoire | Exemples de titres reconnus |
| --- | --- | --- |
| Coût | oui | Coût, Cost, Dépense, Spend |
| Conversions | oui | Conversions, Commandes, Leads |
| Campagne | non | Campagne, Campaign |
| Levier | non | Levier, Canal, Channel, Source |
| Impressions | non | Impressions, Impr. |
| Clics | non | Clics, Clicks |
| Chiffre d'affaires | non | CA, Valeur de conversion, Conv. value, Revenue |
| Part d'impressions | non | Part d'impressions, Search impr. share |

Les lignes de titre en haut des exports et les lignes « Total » sont ignorées. Les colonnes déjà calculées (CTR, CPC, coût par conversion) aussi : l'outil recalcule tout à partir des volumes.

Un fichier d'exemple est fourni : [`exemples/maison-verte.csv`](exemples/maison-verte.csv) (client fictif).

## L'IA dans la boucle

Le bouton **« Copier le brief pour l'IA »** prépare un message complet pour un assistant (Claude, Gemini, ChatGPT) : les chiffres déjà calculés, les constats, et une mission en quatre temps — critiquer les constats, lister les informations manquantes, proposer des recommandations, puis jouer le client sceptique.

Le partage des rôles est volontaire :
- **les calculs** sont faits par des règles fixes, donc exacts et reproductibles ;
- **l'IA** sert à prendre du recul et à challenger l'analyse, sans recalculer ni inventer de chiffres ;
- **la recommandation finale** reste celle du consultant.

Avant de coller les données d'un vrai client dans un outil d'IA, vérifier ce qu'autorise le contrat de confidentialité.

## Limites

- L'outil ne voit que ce qui est dans le fichier : pas de saisonnalité, pas de marge, pas de parcours entre leviers.
- Une campagne de notoriété aura toujours un mauvais CPA. Ce n'est pas forcément une erreur : c'est une question à poser au client.
- Les campagnes de marque sont repérées par leur nom (« marque », « brand »).
- Les constats sont un point de départ pour l'analyse, pas une conclusion.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `analyse.js` | Moteur : lecture des nombres et du CSV, détection des colonnes, indicateurs, règles |
| `app.js` | Interface : lecture du fichier, affichage, graphiques, copies |
| `index.html`, `style.css` | Page et mise en forme (thème clair et sombre) |
| `test.js` | Tests du moteur : `node test.js` |
| `serveur-local.js` | Serveur de test facultatif : `node serveur-local.js` |
| `vendor/xlsx.full.min.js` | [SheetJS](https://sheetjs.com) (licence Apache 2.0), pour lire les fichiers Excel |

## Comment il a été fait

Conçu et cadré par moi, codé avec Claude (Anthropic) : j'ai défini le besoin, les règles métier et les seuils, puis relu et testé le résultat.
