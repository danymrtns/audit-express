/*
 * Audit Express — moteur d'analyse.
 * Fonctions pures, sans dépendance : elles tournent dans le navigateur et dans Node (tests).
 *
 * Chaîne de traitement :
 *   fichier -> tableau de lignes -> détection de l'en-tête et des colonnes
 *           -> agrégation par campagne -> indicateurs -> constats classés par gravité
 */
const AuditExpress = (() => {
  // Seuils des règles de détection. Regroupés ici pour être faciles à expliquer et à ajuster.
  const SEUILS = {
    ecartBudgetConversions: 0.10, // un levier pèse 10 points de plus en budget qu'en conversions
    ecartBudgetFort: 0.15,
    roasBon: 1.25,                // ROAS supérieur à 1,25 x la moyenne du compte
    cpaBon: 0.8,                  // ou CPA inférieur à 0,8 x la moyenne (si pas de chiffre d'affaires)
    partImprFaible: 0.6,          // moins de 60 % de part d'impressions
    partImprCible: 0.8,
    rendementMarginal: 0.7,       // hypothèse : le budget ajouté rapporte 70 % du ROAS actuel
    cpaEleve: 1.5,                // CPA supérieur à 1,5 x la moyenne
    poidsMinimum: 0.05,           // on ignore les campagnes sous 5 % du budget
    poidsFort: 0.10,
    poidsSansConversion: 0.02,
    ctrFort: 1.3,                 // CTR 1,3 x celui des autres campagnes du levier
    cvrFaible: 0.6,               // taux de conversion sous 0,6 x celui des autres
    ctrFaible: 0.5,
    clicsMinimum: 100,
    ecartMarque: 1.15,
  };

  const CHAMPS = [
    { id: 'levier', libelle: 'Levier / canal' },
    { id: 'campagne', libelle: 'Campagne' },
    { id: 'impressions', libelle: 'Impressions' },
    { id: 'clics', libelle: 'Clics' },
    { id: 'cout', libelle: 'Coût', requis: true },
    { id: 'conversions', libelle: 'Conversions', requis: true },
    { id: 'ca', libelle: "Chiffre d'affaires" },
    { id: 'partImpr', libelle: "Part d'impressions" },
  ];

  // Ordre important : les colonnes les plus spécifiques sont attribuées en premier
  // (« valeur de conversion » avant « conversions », « part d'impressions » avant « impressions »).
  const SYNONYMES = [
    ['partImpr', ['partdimpressions', 'partdimpression', 'partimpr', 'impressionshare', 'tauxdimpressions', 'searchimprshare']],
    ['ca', ['chiffredaffaires', 'valeurdeconversion', 'valeurdeconv', 'valeurconv', 'conversionvalue', 'convvalue', 'revenue', 'revenus', 'revenu', 'ca', 'valeur']],
    ['cout', ['cout', 'cost', 'depenses', 'depense', 'spend', 'montantdepense', 'budgetdepense', 'investissement', 'budget']],
    ['conversions', ['conversions', 'conversion', 'conv', 'commandes', 'orders', 'achats', 'purchases', 'leads', 'transactions', 'ventes', 'resultats']],
    ['impressions', ['impressions', 'impression', 'impr']],
    ['clics', ['clics', 'clicks', 'clic', 'click']],
    ['levier', ['levier', 'canal', 'channel', 'source', 'reseau', 'network', 'plateforme', 'platform', 'media']],
    ['campagne', ['campagne', 'campaign', 'nomdelacampagne', 'campaignname']],
  ];
  // Colonnes déjà calculées dans l'export (CPC, taux...) : on ne les prend pas pour des volumes.
  const MOTS_DERIVES = ['par', 'per', 'taux', 'rate', 'moyen', 'moy', 'avg', 'cpc', 'cpa', 'ctr', 'roas', 'cvr', 'cpm'];

  const motsDe = (texte) => String(texte ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean);

  /** Lit un nombre au format français ou anglais : « 1 234,56 € », « 38 % », « 1,234.5 ». */
  function lireNombre(valeur) {
    if (typeof valeur === 'number') return valeur;
    if (valeur === null || valeur === undefined) return NaN;
    let s = String(valeur).replace(/[\s  €$£%<>]/g, '');
    if (s === '' || s === '-' || s === '--') return NaN;
    const virgule = s.lastIndexOf(',');
    const point = s.lastIndexOf('.');
    if (virgule !== -1 && point !== -1) {
      // Les deux séparateurs sont présents : le dernier est la décimale.
      s = virgule > point ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (virgule !== -1) {
      // « 1,234,567 » = milliers ; « 12,5 » = décimale.
      s = /^-?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Découpe un CSV (séparateur ; , ou tabulation détecté automatiquement, guillemets gérés). */
  function lireCSV(texte) {
    texte = texte.replace(/^﻿/, '');
    const premiereLigne = texte.split(/\r?\n/).find((l) => l.trim() !== '') || '';
    const separateur = [';', '\t', ','].reduce((meilleur, s) =>
      premiereLigne.split(s).length > premiereLigne.split(meilleur).length ? s : meilleur, ';');
    const lignes = [];
    let ligne = [], cellule = '', entreGuillemets = false;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (entreGuillemets) {
        if (c === '"' && texte[i + 1] === '"') { cellule += '"'; i++; }
        else if (c === '"') entreGuillemets = false;
        else cellule += c;
      } else if (c === '"') entreGuillemets = true;
      else if (c === separateur) { ligne.push(cellule); cellule = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texte[i + 1] === '\n') i++;
        ligne.push(cellule); lignes.push(ligne); ligne = []; cellule = '';
      } else cellule += c;
    }
    if (cellule !== '' || ligne.length) { ligne.push(cellule); lignes.push(ligne); }
    return lignes.filter((l) => l.some((c) => String(c).trim() !== ''));
  }

  /** Associe chaque champ attendu à une colonne de l'en-tête. Renvoie { champ: index ou -1 }. */
  function detecterColonnes(entete) {
    const colonnes = entete.map((titre) => {
      const mots = motsDe(titre);
      return { colle: mots.join(''), derive: mots.some((m) => MOTS_DERIVES.includes(m)) };
    });
    const correspondance = {};
    const prises = new Set();
    for (const [champ, synonymes] of SYNONYMES) {
      const estMesure = champ !== 'levier' && champ !== 'campagne' && champ !== 'partImpr';
      const candidates = colonnes
        .map((c, i) => ({ ...c, i }))
        .filter((c) => !prises.has(c.i) && c.colle && !(estMesure && c.derive));
      let trouve = -1;
      for (const test of [(c, s) => c === s, (c, s) => s.length > 2 && c.startsWith(s), (c, s) => s.length > 3 && c.includes(s)]) {
        for (const s of synonymes) {
          const c = candidates.find((x) => test(x.colle, s));
          if (c) { trouve = c.i; break; }
        }
        if (trouve !== -1) break;
      }
      correspondance[champ] = trouve;
      if (trouve !== -1) prises.add(trouve);
    }
    return correspondance;
  }

  /** Les exports commencent souvent par des lignes de titre : on cherche la vraie ligne d'en-tête. */
  function trouverEntete(table) {
    let meilleure = 0, meilleurScore = -1;
    table.slice(0, 15).forEach((ligne, i) => {
      const score = Object.values(detecterColonnes(ligne)).filter((v) => v !== -1).length;
      if (score > meilleurScore) { meilleurScore = score; meilleure = i; }
    });
    return meilleure;
  }

  /** Transforme le tableau brut en lignes typées, selon la correspondance des colonnes. */
  function extraire(table, indexEntete, correspondance) {
    const lire = (ligne, champ) => (correspondance[champ] >= 0 ? ligne[correspondance[champ]] : undefined);
    const lignes = [];
    for (const ligne of table.slice(indexEntete + 1)) {
      const levier = String(lire(ligne, 'levier') ?? '').trim();
      const campagne = String(lire(ligne, 'campagne') ?? '').trim();
      // Les lignes « Total » des exports feraient compter les chiffres deux fois.
      // Le mot peut se trouver dans n'importe quelle colonne (par exemple celle du mois).
      if (ligne.some((c) => typeof c === 'string' && /^\s*(total|sous-total|grand total)\b/i.test(c))) continue;
      // Une ligne sans nom, alors que le fichier a des colonnes de noms, est aussi un récapitulatif.
      const aDesNoms = correspondance.levier >= 0 || correspondance.campagne >= 0;
      if (aDesNoms && !levier && !campagne) continue;
      const cout = lireNombre(lire(ligne, 'cout'));
      const conversions = lireNombre(lire(ligne, 'conversions'));
      if (Number.isNaN(cout) && Number.isNaN(conversions)) continue;
      let partImpr = lireNombre(lire(ligne, 'partImpr'));
      if (partImpr > 1) partImpr /= 100;
      lignes.push({
        levier: levier || 'Tous leviers',
        campagne: campagne || levier || 'Sans nom',
        impressions: lireNombre(lire(ligne, 'impressions')),
        clics: lireNombre(lire(ligne, 'clics')),
        cout, conversions,
        ca: lireNombre(lire(ligne, 'ca')),
        partImpr,
      });
    }
    return lignes;
  }

  const div = (a, b) => (b > 0 && Number.isFinite(a) ? a / b : NaN);

  function nouveauCumul(etiquettes) {
    return { ...etiquettes, impressions: 0, clics: 0, cout: 0, conversions: 0, ca: 0, imprEligibles: 0, imprAvecPart: 0 };
  }
  function cumuler(cumul, l) {
    for (const k of ['impressions', 'clics', 'cout', 'conversions', 'ca']) cumul[k] += l[k] || 0;
    // Part d'impressions : moyenne pondérée, via les impressions « possibles » (obtenues / part).
    if (l.imprEligibles !== undefined) {
      cumul.imprEligibles += l.imprEligibles; cumul.imprAvecPart += l.imprAvecPart;
    } else if (l.partImpr > 0 && l.impressions > 0) {
      cumul.imprEligibles += l.impressions / l.partImpr; cumul.imprAvecPart += l.impressions;
    }
  }
  function indicateurs(c, total) {
    return {
      ...c,
      ctr: div(c.clics, c.impressions),
      cpc: div(c.cout, c.clics),
      cvr: div(c.conversions, c.clics),
      cpa: div(c.cout, c.conversions),
      roas: div(c.ca, c.cout),
      panier: div(c.ca, c.conversions),
      partImpr: div(c.imprAvecPart, c.imprEligibles),
      partBudget: total ? div(c.cout, total.cout) : 1,
      partConversions: total ? div(c.conversions, total.conversions) : 1,
    };
  }
  const somme = (elements, etiquettes = {}) => {
    const c = nouveauCumul(etiquettes);
    elements.forEach((e) => cumuler(c, e));
    return c;
  };

  const pct = (x) => `${(x * 100).toFixed(0)} %`;
  const eur = (x) => `${Math.round(x).toLocaleString('fr-FR')} €`;
  const fois = (x) => x.toFixed(1).replace('.', ',');
  const pctFin = (x) => `${(x * 100).toFixed(2).replace('.', ',')} %`;

  /** Analyse complète : agrégats, indicateurs et constats. */
  function analyser(lignes) {
    const parCampagne = new Map();
    for (const l of lignes) {
      const cle = `${l.levier}\u0000${l.campagne}`;
      if (!parCampagne.has(cle)) parCampagne.set(cle, nouveauCumul({ levier: l.levier, campagne: l.campagne }));
      cumuler(parCampagne.get(cle), l);
    }
    const brutes = [...parCampagne.values()];
    const totalBrut = somme(brutes);
    const total = indicateurs(totalBrut, null);
    const campagnes = brutes.map((c) => ({ ...indicateurs(c, totalBrut), estMarque: /\b(marque|brand|branded)\b/i.test(c.campagne) }))
      .sort((a, b) => b.cout - a.cout);
    const nomsLeviers = [...new Set(brutes.map((c) => c.levier))];
    const leviers = nomsLeviers
      .map((nom) => indicateurs(somme(brutes.filter((c) => c.levier === nom), { levier: nom }), totalBrut))
      .sort((a, b) => b.cout - a.cout);

    const aCA = total.ca > 0;
    const constats = [];
    const ajouter = (c) => constats.push(c);

    // Règle 1 — un levier consomme bien plus de budget qu'il n'apporte de conversions.
    if (leviers.length > 1) {
      for (const l of leviers) {
        const ecart = l.partBudget - l.partConversions;
        if (ecart >= SEUILS.ecartBudgetConversions) {
          ajouter({
            gravite: ecart >= SEUILS.ecartBudgetFort ? 'haute' : 'moyenne', poids: l.cout, cible: l.levier,
            titre: `${l.levier} : ${pct(l.partBudget)} du budget, ${pct(l.partConversions)} des conversions`,
            detail: `Son CPA est de ${eur(l.cpa)}, contre ${eur(total.cpa)} en moyenne sur le compte.`,
            reco: `Réduire ou restructurer ${l.levier}, et réallouer une partie du budget vers les campagnes les plus rentables.`,
          });
        }
      }
    }

    for (const c of campagnes) {
      // Les campagnes de marque ont des taux hors norme : on les exclut des comparaisons.
      const autres = campagnes.filter((x) => x.levier === c.levier && x !== c && !x.estMarque);
      const reste = autres.length ? indicateurs(somme(autres), totalBrut) : null;

      // Règle 2 — campagne rentable mais bridée (faible part d'impressions).
      const rentable = aCA ? c.roas >= SEUILS.roasBon * total.roas : c.cpa <= SEUILS.cpaBon * total.cpa;
      if (rentable && c.partImpr < SEUILS.partImprFaible && !c.estMarque) {
        const budgetEnPlus = c.cout * (SEUILS.partImprCible / c.partImpr - 1);
        const gain = aCA
          ? `environ ${eur(budgetEnPlus * c.roas * SEUILS.rendementMarginal)} de chiffre d'affaires`
          : `environ ${Math.round((budgetEnPlus / c.cpa) * SEUILS.rendementMarginal)} conversions`;
        ajouter({
          gravite: 'haute', poids: c.cout, cible: c.campagne,
          titre: `« ${c.campagne} » est rentable mais sous-investie`,
          detail: (aCA ? `ROAS de ${fois(c.roas)} contre ${fois(total.roas)} en moyenne` : `CPA de ${eur(c.cpa)} contre ${eur(total.cpa)} en moyenne`)
            + `, avec seulement ${pct(c.partImpr)} de part d'impressions.`,
          reco: `Augmenter son budget ou ses enchères pour viser ${pct(SEUILS.partImprCible)} de part d'impressions. `
            + `Ordre de grandeur : +${eur(budgetEnPlus)} de budget pour ${gain} en plus `
            + `(hypothèse : le budget ajouté rapporte ${pct(SEUILS.rendementMarginal)} du rendement actuel).`,
        });
      }

      // Règle 3 — campagne coûteuse : CPA très au-dessus de la moyenne.
      if (c.conversions > 0 && c.cpa >= SEUILS.cpaEleve * total.cpa && c.partBudget >= SEUILS.poidsMinimum) {
        ajouter({
          gravite: c.partBudget >= SEUILS.poidsFort ? 'haute' : 'moyenne', poids: c.cout, cible: c.campagne,
          titre: `« ${c.campagne} » : CPA de ${eur(c.cpa)}, soit ${fois(c.cpa / total.cpa)} fois la moyenne`,
          detail: `Elle pèse ${pct(c.partBudget)} du budget pour ${pct(c.partConversions)} des conversions.`,
          reco: 'Revoir le ciblage et les mots-clés, plafonner le budget, puis couper si le CPA ne baisse pas.',
        });
      }

      // Règle 4 — dépense sans aucune conversion.
      if (c.conversions === 0 && c.partBudget >= SEUILS.poidsSansConversion) {
        ajouter({
          gravite: 'moyenne', poids: c.cout, cible: c.campagne,
          titre: `« ${c.campagne} » : ${eur(c.cout)} dépensés sans conversion`,
          detail: `Soit ${pct(c.partBudget)} du budget. À vérifier : le suivi des conversions est-il bien en place ?`,
          reco: "Contrôler le suivi des conversions. S'il fonctionne, mettre la campagne en pause ou la repenser avec un objectif clair.",
        });
      }

      if (reste && !c.estMarque && c.conversions > 0 && c.clics >= SEUILS.clicsMinimum) {
        // Règle 5 — l'annonce attire, mais la page ne convertit pas.
        if (c.ctr >= SEUILS.ctrFort * reste.ctr && c.cvr <= SEUILS.cvrFaible * reste.cvr) {
          ajouter({
            gravite: 'moyenne', poids: c.cout, cible: c.campagne,
            titre: `« ${c.campagne} » attire les clics mais convertit peu`,
            detail: `CTR de ${pctFin(c.ctr)} (autres campagnes ${c.levier} : ${pctFin(reste.ctr)}), `
              + `mais taux de conversion de ${pctFin(c.cvr)} (autres : ${pctFin(reste.cvr)}).`,
            reco: "Aligner la promesse de l'annonce et la page d'arrivée, et vérifier la qualité de l'audience ciblée.",
          });
        }
        // Règle 6 — annonces peu attractives sur une campagne qui pèse lourd en diffusion.
        const leviersImpr = leviers.find((l) => l.levier === c.levier).impressions;
        if (c.ctr <= SEUILS.ctrFaible * reste.ctr && div(c.impressions, leviersImpr) >= 0.15) {
          ajouter({
            gravite: 'info', poids: c.cout, cible: c.campagne,
            titre: `« ${c.campagne} » : CTR faible (${pctFin(c.ctr)})`,
            detail: `Les autres campagnes ${c.levier} sont à ${pctFin(reste.ctr)}.`,
            reco: 'Tester de nouvelles créations et resserrer le ciblage ou les emplacements.',
          });
        }
      }
    }

    // Règle 7 — les campagnes de marque flattent la rentabilité globale.
    let marque = null;
    const campagnesMarque = campagnes.filter((c) => c.estMarque);
    if (aCA && campagnesMarque.length && campagnesMarque.length < campagnes.length) {
      const sans = indicateurs(somme(campagnes.filter((c) => !c.estMarque)), totalBrut);
      marque = { roasAvec: total.roas, roasSans: sans.roas, cpaSans: sans.cpa };
      if (total.roas >= SEUILS.ecartMarque * sans.roas) {
        ajouter({
          gravite: 'moyenne', poids: somme(campagnesMarque).cout, cible: 'Marque',
          titre: `Hors marque, le ROAS tombe de ${fois(total.roas)} à ${fois(sans.roas)}`,
          detail: 'Les campagnes sur le nom de la marque captent des clients qui seraient souvent venus de toute façon.',
          reco: 'Piloter la performance hors marque, et suivre la marque à part.',
        });
      }
    }

    const ordre = { haute: 0, moyenne: 1, info: 2 };
    constats.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || b.poids - a.poids);
    return { total, leviers, campagnes, constats, aCA, aPartImpr: total.imprEligibles > 0, marque };
  }

  return { CHAMPS, SEUILS, lireNombre, lireCSV, detecterColonnes, trouverEntete, extraire, analyser };
})();

if (typeof module !== 'undefined') module.exports = AuditExpress;
