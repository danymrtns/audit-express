# Audit Express

Un outil d'audit de campagnes d'acquisition digitale. On lui donne un export de campagnes (Excel ou CSV) ou un cas client en PDF, et il produit en quelques secondes un diagnostic chiffré : indicateurs par levier et par campagne, anomalies classées par priorité, pistes de recommandation, et la liste de ce que les données ne permettent pas de conclure.

**Démo en ligne : https://danymrtns.github.io/audit-express/** — deux exemples sont intégrés : un export complet, et un cas client incomplet.

## Pourquoi cet outil

Dans un audit de compte, la première heure sert surtout à calculer : CPA, ROAS, parts de budget, comparaisons entre campagnes. Audit Express fait ce travail tout de suite, pour garder le temps humain pour ce qui compte : comprendre les causes et construire la recommandation.

- **Rien à installer.** C'est une page web. Elle fonctionne aussi sans connexion, en ouvrant `index.html`.
- **Confidentiel.** Tout est calculé dans le navigateur. Aucune donnée n'est envoyée à un serveur.
- **Vérifiable.** Les constats viennent de règles fixes et lisibles, pas d'une IA. Chaque chiffre affiché peut être recalculé à la main.
- **Honnête sur ses limites.** Une donnée absente reste inconnue : elle n'est jamais remplacée par zéro ni inventée.

## Trois façons de l'alimenter

### 1. Un export Excel ou CSV

Une ligne par campagne (ou par campagne et par période : les lignes sont additionnées). Les colonnes sont reconnues automatiquement, en français ou en anglais, et se corrigent à la main si besoin. Aucune colonne n'est obligatoire : il suffit d'un coût, de conversions, de clics ou d'impressions.

| Colonne | Exemples de titres reconnus |
| --- | --- |
| Période | Mois, Période, Trimestre, Date |
| Levier | Levier, Canal, Channel, Source |
| Campagne | Campagne, Campaign |
| Impressions, clics | Impressions, Impr., Clics, Clicks |
| Coût | Coût, Cost, Dépense, Spend |
| Conversions | Conversions, Commandes, Leads |
| Chiffre d'affaires | CA, Valeur de conversion, Conv. value, Revenue |
| Part d'impressions | Part d'impressions, Search impr. share |
| Indicateurs déjà calculés | CTR, CPC, Taux de conversion, CPA / Coût par commande, ROAS |

Les lignes de titre en haut des exports et les lignes « Total » sont ignorées.

### 2. Un cas client en PDF, en passant par l'IA

Un cas client mêle du texte (contexte, objectif, contraintes) et des chiffres dispersés. Une page web ne sait pas comprendre ce texte ; une IA, si. Le parcours tient en deux étapes :

1. Bouton **« Importer un cas »**, puis **« Copier le prompt d'extraction »**. On donne ce prompt et le PDF à une IA (Claude, Gemini, ChatGPT). Elle range les informations dans un format JSON précis, sans rien calculer ni inventer : ce qui manque est laissé vide.
2. On colle sa réponse dans l'outil, qui affiche le contexte du cas, puis fait tous les calculs.

Un tableau copié depuis Excel peut aussi être collé directement au même endroit.

Exemple fourni : [`exemples/cas-atelier-brume.pdf`](exemples/cas-atelier-brume.pdf) (le cas) et [`exemples/cas-atelier-brume.json`](exemples/cas-atelier-brume.json) (l'extraction attendue).

### 3. En local, relié à Claude Code

Sur un ordinateur où le dépôt est ouvert dans Claude Code, la commande **`/audit-cas`** enchaîne les deux étapes ci-dessus sans copier-coller. On dépose le document dans la conversation (ou dans le dossier `cas/`), et Claude :

1. lit le document et écrit l'extraction dans `cas/cas-en-cours.json` ;
2. contrôle l'extraction : nombre de lignes, totaux, lignes relues au hasard ;
3. lance le moteur de calcul (`node analyser-cas.js`) et ouvre la page avec le diagnostic chargé (`http://localhost:4173/?cas=cas-en-cours`) ;
4. rend compte de ce qui a été lu, des hypothèses et de ce qui manque — sans rédiger la recommandation à la place du consultant.

Le partage des rôles ne change pas : Claude lit, l'outil calcule. Les instructions suivies par Claude sont dans [`.claude/skills/audit-cas/SKILL.md`](.claude/skills/audit-cas/SKILL.md).

Ce mode n'existe qu'en local. Le dossier `cas/` est ignoré par Git : les données d'un client ne sont jamais envoyées sur GitHub, et la page en ligne ne peut charger aucun cas de cette façon.

## Faire avec ce qu'on a

Les données d'un cas sont rarement complètes. L'outil s'adapte de quatre façons.

**Il retrouve ce qui peut l'être.** Si le document donne un indicateur à la place d'un volume, le volume est recalculé et la formule est affichée :

| Donnée absente | Retrouvée à partir de |
| --- | --- |
| Conversions | coût ÷ CPA, ou clics × taux de conversion |
| Clics | impressions × CTR, coût ÷ CPC, ou conversions ÷ taux de conversion |
| Coût | clics × CPC, conversions × CPA, ou chiffre d'affaires ÷ ROAS |
| Chiffre d'affaires | coût × ROAS |
| Impressions | clics ÷ CTR |

**Il accepte des hypothèses, affichées comme telles.** Trois champs facultatifs :
- un **objectif de CPA** ou de **ROAS** : les campagnes sont alors jugées par rapport à la cible du client, pas seulement par rapport à la moyenne du compte ;
- un **panier moyen supposé** : quand le chiffre d'affaires manque, il sert à estimer la rentabilité. Tout ce qui en découle est étiqueté « estimé ».

**Il adapte l'analyse aux données présentes.** Sans chiffre d'affaires, il raisonne en CPA. Sans conversions, il se limite au coût du trafic. Avec des données par levier seulement, il compare les leviers. Si une campagne n'a pas de conversions renseignées, elle sort des comparaisons au lieu de fausser les moyennes.

**Il dit ce qu'on ne peut pas conclure.** La section « Ce que les données ne disent pas » liste chaque manque, sa conséquence sur l'analyse, et la question à poser au client.

## Ce qu'il détecte

| Constat | Règle |
| --- | --- |
| Écart avec l'objectif | CPA ou ROAS global éloigné de plus de 5 % de la cible du client |
| Levier surinvesti | Sa part du budget dépasse sa part des conversions d'au moins 10 points |
| Campagne rentable mais bridée | ROAS supérieur à 1,25 fois la moyenne (ou CPA inférieur à 0,8 fois) et part d'impressions sous 60 % |
| Campagne coûteuse | CPA supérieur à 1,5 fois la moyenne, pour au moins 5 % du budget |
| Dépense sans conversion | Au moins 2 % du budget, zéro conversion connue |
| L'annonce attire, la page ne convertit pas | CTR élevé et taux de conversion faible par rapport aux autres campagnes du levier |
| Annonces peu attractives | CTR inférieur à la moitié de celui des autres campagnes du levier |
| Performance flattée par la marque | Le ROAS baisse (ou le CPA monte) d'au moins 15 % une fois les campagnes de marque retirées |
| Trafic cher | Sans conversions : CPC supérieur à 1,5 fois la moyenne |
| Évolution entre périodes | Variation d'au moins 10 %, attribuée au trafic, au taux de conversion ou au panier moyen |

Les seuils sont regroupés en haut de [`analyse.js`](analyse.js) et se modifient en une ligne.

Pour une campagne rentable mais bridée, l'outil donne un ordre de grandeur du gain possible. Il repose sur une hypothèse affichée avec le chiffre : le budget ajouté rapporte 70 % du rendement actuel.

## L'IA dans la boucle

L'IA intervient à deux moments, jamais pour calculer :

- **avant**, pour lire un document et en ranger les informations (prompt d'extraction) ;
- **après**, pour prendre du recul : le bouton **« Copier le brief pour l'IA »** prépare un message avec le contexte, les chiffres calculés, les hypothèses et les limites, et une mission en quatre temps — critiquer les constats, classer les questions à poser au client, proposer des recommandations, puis jouer le client sceptique.

Entre les deux, **les calculs** sont faits par des règles fixes, donc exacts et reproductibles. **La recommandation finale** reste celle du consultant.

Il faut relire l'extraction de l'IA avant de s'y fier : comparer deux ou trois chiffres avec le document suffit à repérer une erreur de lecture. Et avant de donner les données d'un vrai client à un outil d'IA, vérifier ce qu'autorise le contrat de confidentialité.

## Limites

- L'outil ne voit que ce qu'on lui donne : pas de marge, pas de parcours entre leviers, pas d'attribution.
- Une campagne de notoriété aura toujours un mauvais CPA. Ce n'est pas forcément une erreur : c'est une question à poser au client.
- Les campagnes de marque sont repérées par leur nom (« marque », « brand »).
- Un panier moyen supposé est le même pour toutes les campagnes : le ROAS estimé ne fait alors que traduire le CPA.
- Les constats sont un point de départ pour l'analyse, pas une conclusion.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `analyse.js` | Moteur : lecture des nombres, détection des colonnes, reconstruction, indicateurs, règles, limites |
| `app.js` | Interface : lecture des fichiers et des cas, affichage, graphiques, prompts |
| `index.html`, `style.css` | Page et mise en forme (thème clair et sombre) |
| `test.js` | Tests du moteur : `node test.js` |
| `exemples/` | Jeux d'essai : export complet (CSV, Excel), cas incomplet (PDF, JSON) |
| `construire-exemples.js` | Regroupe les exemples dans `exemples/exemples.js` pour les boutons de la page |
| `serveur-local.js` | Serveur local : `node serveur-local.js`, puis http://localhost:4173 |
| `analyser-cas.js` | Le moteur en ligne de commande : `node analyser-cas.js cas/cas-en-cours.json` |
| `.claude/skills/audit-cas/` | La commande `/audit-cas` pour Claude Code |
| `cas/` | Documents et cas en cours, jamais publiés |
| `vendor/xlsx.full.min.js` | [SheetJS](https://sheetjs.com) (licence Apache 2.0), pour lire les fichiers Excel |

## Comment il a été fait

Conçu et cadré par moi, codé avec Claude (Anthropic) : j'ai défini le besoin, les règles métier et les seuils, puis relu et testé le résultat.
