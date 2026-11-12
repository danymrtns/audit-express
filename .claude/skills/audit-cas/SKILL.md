---
name: audit-cas
description: Lit un cas client d'acquisition digitale (PDF, image, texte ou tableau), en extrait le contexte et les chiffres, contrôle l'extraction, puis ouvre Audit Express avec le diagnostic déjà chargé. À utiliser quand l'utilisateur donne un cas client ou un brief à auditer, ou tape /audit-cas.
---

# Auditer un cas client avec Audit Express

Tu fais le lien entre un document et l'outil Audit Express de ce dépôt. Le partage des rôles est strict :

- **toi** : lire le document, ranger ses informations, contrôler l'extraction ;
- **l'outil** : tous les calculs, avec ses règles fixes (`analyse.js`) ;
- **l'utilisateur** : le raisonnement et la recommandation.

Tu ne calcules aucun indicateur toi-même et tu n'inventes aucun chiffre. Tout chiffre que tu cites vient soit du document, soit de la sortie de l'outil.

Toutes les commandes se lancent depuis le dossier qui contient `analyse.js` (la racine de ce dépôt). Réponds à l'utilisateur en français.

## 1. Trouver le document

Dans cet ordre : le chemin donné en argument, sinon le fichier joint au message, sinon le fichier le plus récent du dossier `cas/` (hors `.json`). S'il n'y a rien, demande le document et arrête-toi.

Lis-le en entier, y compris les tableaux, les notes de bas de tableau et les encadrés. Pour un PDF long, lis toutes les pages.

## 2. Extraire

Le format JSON et ses règles sont ceux de la constante `PROMPT_EXTRACTION` dans `app.js` : lis-la et suis-la à la lettre. C'est la source unique, ne la recopie pas de mémoire.

Rappels qui comptent le plus :

- une donnée absente du document vaut `null`, jamais `0` et jamais une estimation ;
- si le document donne un indicateur (CPA, CPC, CTR, taux de conversion, ROAS) à la place d'un volume, recopie l'indicateur et laisse le volume à `null` : l'outil fera le calcul et l'affichera comme une valeur recalculée ;
- les taux sont des fractions (`0.38` pour 38 %) ;
- pas de ligne de total dans `donnees` ;
- `objectifCPA`, `objectifROAS`, `panierMoyen`, `budget` uniquement s'ils sont écrits dans le document.

Écris le résultat dans `cas/cas-en-cours.json` (crée le dossier `cas/` s'il manque). Ce dossier est ignoré par Git : les données d'un client ne doivent jamais être envoyées sur GitHub. Ne les ajoute pas à un commit.

## 3. Contrôler l'extraction

Lance :

```bash
node analyser-cas.js cas/cas-en-cours.json
```

Puis vérifie, document sous les yeux :

1. le nombre de lignes lues est celui du tableau du document ;
2. chaque total affiché par l'outil correspond au total du document, quand le document en donne un ;
3. trois lignes prises au hasard, relues chiffre par chiffre ;
4. les objectifs et le panier moyen sont bien ceux du texte.

En cas d'écart, corrige le JSON et relance. Si un chiffre du document est illisible ou ambigu, ne tranche pas seul : mets `null` et signale-le.

## 4. Ouvrir l'outil

Démarre le serveur local `audit-express` avec le panneau navigateur (configuration dans `.claude/launch.json`), puis ouvre la page avec le paramètre `?cas=cas-en-cours`, par exemple `http://localhost:4173/?cas=cas-en-cours`. Utilise le port que le panneau t'indique s'il diffère.

Vérifie que la page affiche bien le nom du client et les mêmes totaux que la commande de l'étape 3.

Si le panneau navigateur n'est pas disponible, lance `node serveur-local.js` en arrière-plan et donne l'adresse à l'utilisateur.

## 5. Rendre compte

Un message court, dans cet ordre :

1. **Ce qui a été lu** : client, objectif, nombre de lignes, et le résultat du contrôle (ce qui a été vérifié, les écarts corrigés, les chiffres ambigus).
2. **Hypothèses et valeurs recalculées**, telles que l'outil les liste.
3. **Les trois premiers constats**, recopiés de la sortie de l'outil.
4. **Ce qui manque** : les limites listées par l'outil, plus les faits du texte que l'outil ne traite pas (par exemple une baisse du taux de conversion du site mentionnée dans le brief).

Arrête-toi là. Ne rédige ni diagnostic final ni recommandation tant que l'utilisateur ne le demande pas : c'est son travail, et c'est ce sur quoi il est évalué. S'il le demande, propose de challenger son raisonnement plutôt que de le remplacer.
