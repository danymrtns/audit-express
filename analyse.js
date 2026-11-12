/*
 * Audit Express — moteur d'analyse.
 * Fonctions pures, sans dépendance : elles tournent dans le navigateur et dans Node (tests).
 *
 * Chaîne de traitement :
 *   fichier ou cas extrait d'un PDF -> lignes typées
 *     -> reconstruction des valeurs absentes (quand un indicateur permet de les retrouver)
 *     -> agrégation par campagne et par levier -> indicateurs
 *     -> constats classés par gravité + limites de l'analyse (ce qu'on ne peut pas conclure)
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
    cpcEleve: 1.5,
    poidsMinimum: 0.05,           // on ignore les campagnes sous 5 % du budget
    poidsFort: 0.10,
    poidsSansConversion: 0.02,
    ctrFort: 1.3,                 // CTR 1,3 x celui des autres campagnes du levier
    cvrFaible: 0.6,               // taux de conversion sous 0,6 x celui des autres
    ctrFaible: 0.5,
    clicsMinimum: 100,
    ecartMarque: 1.15,
    ecartObjectif: 0.05,          // tolérance de 5 % autour de l'objectif du client
    variationNotable: 0.10,       // évolution de 10 % ou plus entre deux périodes
  };

  const CHAMPS = [
    { id: 'periode', libelle: 'Période (mois, trimestre)' },
    { id: 'levier', libelle: 'Levier / canal' },
    { id: 'campagne', libelle: 'Campagne' },
    { id: 'impressions', libelle: 'Impressions' },
    { id: 'clics', libelle: 'Clics' },
    { id: 'cout', libelle: 'Coût' },
    { id: 'conversions', libelle: 'Conversions' },
    { id: 'ca', libelle: "Chiffre d'affaires" },
    { id: 'partImpr', libelle: "Part d'impressions" },
    { id: 'ctr', libelle: 'CTR (déjà calculé)' },
    { id: 'cpc', libelle: 'CPC (déjà calculé)' },
    { id: 'cvr', libelle: 'Taux de conversion (déjà calculé)' },
    { id: 'cpa', libelle: 'CPA (déjà calculé)' },
    { id: 'roas', libelle: 'ROAS (déjà calculé)' },
  ];

  const MESURES = ['impressions', 'clics', 'cout', 'conversions', 'ca'];
  // Chaque indicateur est un rapport entre deux mesures : [numérateur, dénominateur].
  const RATIOS = {
    ctr: ['clics', 'impressions'],
    cpc: ['cout', 'clics'],
    cvr: ['conversions', 'clics'],
    cpa: ['cout', 'conversions'],
    roas: ['ca', 'cout'],
    panier: ['ca', 'conversions'],
  };

  // Ordre important : les colonnes les plus spécifiques sont attribuées en premier
  // (« coût par conversion » avant « coût », « part d'impressions » avant « impressions »).
  const SYNONYMES = [
    ['partImpr', ['partdimpressions', 'partdimpression', 'partimpr', 'impressionshare', 'tauxdimpressions', 'searchimprshare']],
    ['roas', ['roas', 'retoursurdepensespublicitaires', 'valeurdeconvcout', 'convvaluecost']],
    ['cpa', ['cpa', 'cpl', 'coutparconversion', 'coutparconv', 'coutconv', 'costconv', 'costperconversion', 'coutparcommande', 'coutparacquisition', 'coutparlead', 'coutparresultat', 'costperresult']],
    ['cpc', ['cpc', 'avgcpc', 'coutparclic', 'costperclick']],
    ['cvr', ['tauxdeconversion', 'tauxdeconv', 'tauxconv', 'txconv', 'convrate', 'conversionrate', 'cvr']],
    ['ctr', ['ctr', 'tauxdeclics', 'tauxdeclic', 'clickthroughrate']],
    ['ca', ['chiffredaffaires', 'valeurdeconversion', 'valeurdeconv', 'valeurconv', 'conversionvalue', 'convvalue', 'revenue', 'revenus', 'revenu', 'ca', 'valeur']],
    ['cout', ['cout', 'cost', 'depenses', 'depense', 'spend', 'montantdepense', 'budgetdepense', 'investissement', 'budget']],
    ['conversions', ['conversions', 'conversion', 'conv', 'commandes', 'orders', 'achats', 'purchases', 'leads', 'transactions', 'ventes', 'resultats']],
    ['impressions', ['impressions', 'impression', 'impr']],
    ['clics', ['clics', 'clicks', 'clic', 'click']],
    ['periode', ['periode', 'mois', 'month', 'date', 'semaine', 'week', 'trimestre', 'quarter', 'annee', 'year']],
    ['levier', ['levier', 'canal', 'channel', 'source', 'reseau', 'network', 'plateforme', 'platform', 'media']],
    ['campagne', ['campagne', 'campaign', 'nomdelacampagne', 'campaignname']],
  ];
  // Un titre qui contient un de ces mots désigne un indicateur calculé, pas un volume.
  const MOTS_DERIVES = ['par', 'per', 'taux', 'rate', 'moyen', 'moy', 'avg', 'cpc', 'cpa', 'ctr', 'roas', 'cvr', 'cpm'];
  const VOLUMES = ['ca', 'cout', 'conversions', 'impressions', 'clics'];

  const fini = Number.isFinite;
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
    if (s === '' || !/\d/.test(s)) return NaN;
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
    return fini(n) ? n : NaN;
  }

  /** Lit un taux et le ramène en fraction : « 38 % » -> 0,38 ; 38 -> 0,38 ; 0,38 -> 0,38. */
  function lireTaux(valeur) {
    const n = lireNombre(valeur);
    if (!fini(n)) return NaN;
    const enPourcent = typeof valeur === 'string' && valeur.includes('%');
    return enPourcent || n > 1 ? n / 100 : n;
  }

  /** Découpe un CSV (séparateur ; , ou tabulation détecté automatiquement, guillemets gérés). */
  function lireCSV(texte) {
    texte = texte.replace(/^﻿/, '');
    const premiereLigne = texte.split(/\r?\n/).find((l) => l.trim() !== '') || '';
    const separateur = ['\t', ';', ','].reduce((meilleur, s) =>
      premiereLigne.split(s).length > premiereLigne.split(meilleur).length ? s : meilleur, '\t');
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
      const candidates = colonnes
        .map((c, i) => ({ ...c, i }))
        .filter((c) => !prises.has(c.i) && c.colle && !(VOLUMES.includes(champ) && c.derive));
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

  // Comment retrouver une valeur absente : [cible, a, b, calcul, formule affichée, arrondi à l'unité].
  const RECONSTRUCTIONS = [
    ['clics', 'impressions', 'ctr', (a, b) => a * b, 'clics = impressions × CTR', true],
    ['clics', 'cout', 'cpc', (a, b) => a / b, 'clics = coût ÷ CPC', true],
    ['conversions', 'cout', 'cpa', (a, b) => a / b, 'conversions = coût ÷ CPA', true],
    ['conversions', 'clics', 'cvr', (a, b) => a * b, 'conversions = clics × taux de conversion', true],
    ['clics', 'conversions', 'cvr', (a, b) => a / b, 'clics = conversions ÷ taux de conversion', true],
    ['impressions', 'clics', 'ctr', (a, b) => a / b, 'impressions = clics ÷ CTR', true],
    ['cout', 'clics', 'cpc', (a, b) => a * b, 'coût = clics × CPC', false],
    ['cout', 'conversions', 'cpa', (a, b) => a * b, 'coût = conversions × CPA', false],
    ['ca', 'cout', 'roas', (a, b) => a * b, "chiffre d'affaires = coût × ROAS", false],
    ['cout', 'ca', 'roas', (a, b) => a / b, "coût = chiffre d'affaires ÷ ROAS", false],
  ];

  /** Complète les volumes absents d'une ligne. Renvoie la liste des formules utilisées. */
  function completer(l) {
    const formules = [];
    // Plusieurs passes : une valeur retrouvée peut en débloquer une autre.
    for (let passe = 0; passe < 3; passe++) {
      for (const [cible, a, b, calcul, formule, entier] of RECONSTRUCTIONS) {
        if (fini(l[cible]) || !fini(l[a]) || !fini(l[b])) continue;
        const v = calcul(l[a], l[b]);
        if (!fini(v) || v < 0) continue;
        l[cible] = entier ? Math.round(v) : Math.round(v * 100) / 100;
        formules.push(formule);
      }
    }
    return formules;
  }

  /** Transforme une ligne brute (textes ou nombres) en ligne typée. Renvoie null si elle est vide. */
  function preparerLigne(brut) {
    const texte = (v) => String(v ?? '').trim();
    const l = { periode: texte(brut.periode), levier: texte(brut.levier), campagne: texte(brut.campagne) };
    for (const k of MESURES) l[k] = lireNombre(brut[k]);
    for (const k of ['partImpr', 'ctr', 'cvr']) l[k] = lireTaux(brut[k]);
    l.cpc = lireNombre(brut.cpc);
    l.cpa = lireNombre(brut.cpa);
    l.roas = typeof brut.roas === 'string' && brut.roas.includes('%') ? lireNombre(brut.roas) / 100 : lireNombre(brut.roas);
    l.recalcules = completer(l);
    if (!MESURES.some((k) => fini(l[k]))) return null;
    l.campagne = l.campagne || l.levier || 'Ensemble du compte';
    l.levier = l.levier || 'Tous leviers';
    return l;
  }

  /** Transforme le tableau brut d'un fichier en lignes typées, selon la correspondance des colonnes. */
  function extraire(table, indexEntete, correspondance) {
    const aDesNoms = correspondance.levier >= 0 || correspondance.campagne >= 0;
    const lignes = [];
    for (const ligne of table.slice(indexEntete + 1)) {
      // Les lignes « Total » des exports feraient compter les chiffres deux fois.
      // Le mot peut se trouver dans n'importe quelle colonne (par exemple celle du mois).
      if (ligne.some((c) => typeof c === 'string' && /^\s*(total|sous-total|grand total)\b/i.test(c))) continue;
      const brut = {};
      for (const { id } of CHAMPS) brut[id] = correspondance[id] >= 0 ? ligne[correspondance[id]] : undefined;
      // Une ligne sans nom, alors que le fichier a des colonnes de noms, est aussi un récapitulatif.
      if (aDesNoms && !String(brut.levier ?? '').trim() && !String(brut.campagne ?? '').trim()) continue;
      const l = preparerLigne(brut);
      if (l) lignes.push(l);
    }
    return lignes;
  }

  /**
   * Transforme un cas extrait d'un document (le JSON rendu par l'IA) en lignes, contexte et réglages.
   * Les chiffres absents du document arrivent à null : ils restent inconnus, on ne les invente pas.
   */
  function lireCas(cas) {
    const liste = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
    const texte = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const lignes = (Array.isArray(cas.donnees) ? cas.donnees : [])
      .filter((d) => d && !/^\s*total\b/i.test(`${d.campagne ?? ''}`) && !/^\s*total\b/i.test(`${d.levier ?? ''}`))
      .map(preparerLigne).filter(Boolean);
    const nombre = (v) => { const n = lireNombre(v); return fini(n) && n > 0 ? n : null; };
    return {
      lignes,
      contexte: {
        client: texte(cas.client), secteur: texte(cas.secteur), periode: texte(cas.periode),
        objectif: texte(cas.objectif), contexte: texte(cas.contexte), budget: nombre(cas.budget),
        contraintes: liste(cas.contraintes), faitsCles: liste(cas.faitsCles),
        informationsManquantes: liste(cas.informationsManquantes),
      },
      reglages: { objectifCPA: nombre(cas.objectifCPA), objectifROAS: nombre(cas.objectifROAS), panier: nombre(cas.panierMoyen) },
    };
  }

  // ---------- Agrégation ----------
  const div = (a, b) => (b > 0 && fini(a) ? a / b : NaN);

  function nouveauCumul(etiquettes = {}) {
    const c = { ...etiquettes, imprEligibles: 0, imprAvecPart: 0, connus: {}, paires: {} };
    for (const k of MESURES) { c[k] = 0; c.connus[k] = 0; }
    for (const r of Object.keys(RATIOS)) c.paires[r] = [0, 0];
    return c;
  }
  function ajouterLigne(c, l) {
    for (const k of MESURES) if (fini(l[k])) { c[k] += l[k]; c.connus[k]++; }
    // Un rapport n'est calculé que sur les lignes où ses deux termes sont connus :
    // une campagne sans conversions renseignées ne fausse pas le CPA des autres.
    for (const [r, [num, den]] of Object.entries(RATIOS)) {
      if (fini(l[num]) && fini(l[den])) { c.paires[r][0] += l[num]; c.paires[r][1] += l[den]; }
    }
    // Part d'impressions : moyenne pondérée, via les impressions « possibles » (obtenues / part).
    if (l.partImpr > 0 && l.impressions > 0) { c.imprEligibles += l.impressions / l.partImpr; c.imprAvecPart += l.impressions; }
  }
  function ajouterCumul(c, x) {
    for (const k of MESURES) { c[k] += x[k]; c.connus[k] += x.connus[k]; }
    for (const r of Object.keys(RATIOS)) { c.paires[r][0] += x.paires[r][0]; c.paires[r][1] += x.paires[r][1]; }
    c.imprEligibles += x.imprEligibles; c.imprAvecPart += x.imprAvecPart;
  }
  const sommeLignes = (lignes, etiquettes) => { const c = nouveauCumul(etiquettes); lignes.forEach((l) => ajouterLigne(c, l)); return c; };
  const sommeCumuls = (cumuls, etiquettes) => { const c = nouveauCumul(etiquettes); cumuls.forEach((x) => ajouterCumul(c, x)); return c; };

  /** Indicateurs d'un cumul. Une mesure jamais renseignée vaut NaN (inconnue), pas zéro. */
  function indicateurs(c, total) {
    const r = { brut: c };
    for (const k of ['periode', 'levier', 'campagne']) if (c[k] !== undefined) r[k] = c[k];
    for (const k of MESURES) r[k] = c.connus[k] > 0 ? c[k] : NaN;
    for (const k of Object.keys(RATIOS)) r[k] = div(c.paires[k][0], c.paires[k][1]);
    r.partImpr = div(c.imprAvecPart, c.imprEligibles);
    r.partBudget = total ? div(r.cout, total.cout) : 1;
    r.partConversions = total ? div(r.conversions, total.conversions) : 1;
    return r;
  }

  // ---------- Formats des textes ----------
  const pct = (x) => `${(x * 100).toFixed(0)} %`;
  const eur = (x) => `${Math.round(x).toLocaleString('fr-FR')} €`;
  const fois = (x) => x.toFixed(1).replace('.', ',');
  const pctFin = (x) => `${(x * 100).toFixed(2).replace('.', ',')} %`;
  const evol = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)} %`;
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

  /**
   * Analyse complète : agrégats, indicateurs, constats et limites.
   * reglages : { objectifCPA, objectifROAS, panier } — tous facultatifs.
   */
  function analyser(lignesRecues, reglages = {}) {
    const { objectifCPA, objectifROAS, panier } = reglages;
    let lignes = lignesRecues;

    // Sans chiffre d'affaires, un panier moyen supposé permet d'estimer la rentabilité.
    const caReel = lignes.some((l) => fini(l.ca));
    const caEstime = !caReel && panier > 0 && lignes.some((l) => fini(l.conversions));
    if (caEstime) lignes = lignes.map((l) => (fini(l.conversions) ? { ...l, ca: l.conversions * panier } : l));

    const parCampagne = new Map();
    for (const l of lignes) {
      const cle = `${l.levier}\u0000${l.campagne}`;
      if (!parCampagne.has(cle)) parCampagne.set(cle, nouveauCumul({ levier: l.levier, campagne: l.campagne }));
      ajouterLigne(parCampagne.get(cle), l);
    }
    const brutes = [...parCampagne.values()];
    const total = indicateurs(sommeCumuls(brutes), null);
    const dispo = {};
    for (const k of MESURES) dispo[k] = total.brut.connus[k] > 0;
    dispo.partImpr = total.brut.imprEligibles > 0;

    const tri = (a, b) => (dispo.cout ? b.cout - a.cout : (b.conversions || b.clics || 0) - (a.conversions || a.clics || 0));
    const campagnes = brutes
      .map((c) => ({ ...indicateurs(c, total), estMarque: /\b(marque|brand|branded)\b/i.test(c.campagne) }))
      .sort(tri);
    const leviers = [...new Set(brutes.map((c) => c.levier))]
      .map((nom) => indicateurs(sommeCumuls(brutes.filter((c) => c.levier === nom), { levier: nom }), total))
      .sort(tri);
    // Données fournies par levier uniquement : chaque « campagne » est en fait un levier.
    const parLevierSeulement = campagnes.every((c) => c.campagne === c.levier);

    const aCA = dispo.ca;
    const nomRoas = caEstime ? 'ROAS estimé' : 'ROAS';
    const constats = [];
    const ajouter = (c) => constats.push(c);

    // Règle 0 — écart avec l'objectif fixé par le client.
    const campagnesComparables = campagnes.filter((c) => fini(c.cpa) || fini(c.roas));
    if (objectifCPA > 0 && fini(total.cpa)) {
      const ecart = total.cpa / objectifCPA - 1;
      const auDessus = campagnes.filter((c) => c.cpa > objectifCPA);
      const poids = div(auDessus.reduce((s, c) => s + (c.cout || 0), 0), total.cout);
      if (ecart > SEUILS.ecartObjectif) {
        ajouter({
          gravite: 'haute', poids: Infinity, cible: 'Objectif',
          titre: `CPA moyen de ${eur(total.cpa)} pour un objectif de ${eur(objectifCPA)} (${evol(ecart)})`,
          detail: `${pluriel(auDessus.length, 'campagne')} sur ${campagnesComparables.length} dépasse${auDessus.length > 1 ? 'nt' : ''} l'objectif`
            + (fini(poids) ? ` et pèse${auDessus.length > 1 ? 'nt' : ''} ${pct(poids)} du budget.` : '.'),
          reco: "Traiter d'abord les campagnes au-dessus de l'objectif qui ont les plus gros budgets, et réallouer vers celles qui sont en dessous.",
        });
      } else {
        ajouter({
          gravite: 'info', poids: Infinity, cible: 'Objectif',
          titre: `Objectif de CPA tenu : ${eur(total.cpa)} pour ${eur(objectifCPA)} visés`,
          detail: auDessus.length ? `${pluriel(auDessus.length, 'campagne')} reste${auDessus.length > 1 ? 'nt' : ''} au-dessus de l'objectif.` : "Toutes les campagnes sont sous l'objectif.",
          reco: "Chercher du volume supplémentaire sur les campagnes les plus rentables, tant que le CPA reste sous l'objectif.",
        });
      }
    }
    if (objectifROAS > 0 && fini(total.roas)) {
      const ecart = total.roas / objectifROAS - 1;
      const enDessous = campagnes.filter((c) => c.roas < objectifROAS);
      if (ecart < -SEUILS.ecartObjectif) {
        ajouter({
          gravite: 'haute', poids: Infinity, cible: 'Objectif',
          titre: `${nomRoas} de ${fois(total.roas)} pour un objectif de ${fois(objectifROAS)} (${evol(ecart)})`,
          detail: `${pluriel(enDessous.length, 'campagne')} sur ${campagnesComparables.length} ${enDessous.length > 1 ? 'sont' : 'est'} sous l'objectif.`,
          reco: "Traiter d'abord les campagnes sous l'objectif qui ont les plus gros budgets, et réallouer vers celles qui le dépassent.",
        });
      } else {
        ajouter({
          gravite: 'info', poids: Infinity, cible: 'Objectif',
          titre: `Objectif de ROAS tenu : ${fois(total.roas)} pour ${fois(objectifROAS)} visés`,
          detail: enDessous.length ? `${pluriel(enDessous.length, 'campagne')} reste${enDessous.length > 1 ? 'nt' : ''} sous l'objectif.` : "Toutes les campagnes atteignent l'objectif.",
          reco: 'Chercher du volume supplémentaire sur les campagnes les plus rentables.',
        });
      }
    }

    // Règle 1 — un levier consomme bien plus de budget qu'il n'apporte de conversions.
    const leviersSurinvestis = new Set();
    if (leviers.length > 1) {
      for (const l of leviers) {
        const ecart = l.partBudget - l.partConversions;
        if (ecart >= SEUILS.ecartBudgetConversions) {
          leviersSurinvestis.add(l.levier);
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
      const reste = autres.length ? indicateurs(sommeCumuls(autres.map((x) => x.brut)), total) : null;

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
          detail: (aCA ? `${nomRoas} de ${fois(c.roas)} contre ${fois(total.roas)} en moyenne` : `CPA de ${eur(c.cpa)} contre ${eur(total.cpa)} en moyenne`)
            + `, avec seulement ${pct(c.partImpr)} de part d'impressions.`,
          reco: `Augmenter son budget ou ses enchères pour viser ${pct(SEUILS.partImprCible)} de part d'impressions. `
            + `Ordre de grandeur : +${eur(budgetEnPlus)} de budget pour ${gain} en plus `
            + `(hypothèse : le budget ajouté rapporte ${pct(SEUILS.rendementMarginal)} du rendement actuel).`,
        });
      }

      // Règle 3 — campagne coûteuse : CPA très au-dessus de la moyenne.
      // (Ignorée si la ligne est un levier déjà signalé par la règle 1.)
      const dejaSignale = c.campagne === c.levier && leviersSurinvestis.has(c.levier);
      if (!dejaSignale && c.conversions > 0 && c.cpa >= SEUILS.cpaEleve * total.cpa && c.partBudget >= SEUILS.poidsMinimum) {
        ajouter({
          gravite: c.partBudget >= SEUILS.poidsFort ? 'haute' : 'moyenne', poids: c.cout, cible: c.campagne,
          titre: `« ${c.campagne} » : CPA de ${eur(c.cpa)}, soit ${fois(c.cpa / total.cpa)} fois la moyenne`,
          detail: `Elle pèse ${pct(c.partBudget)} du budget pour ${pct(c.partConversions)} des conversions.`,
          reco: 'Revoir le ciblage et les mots-clés, plafonner le budget, puis couper si le CPA ne baisse pas.',
        });
      }

      // Règle 4 — dépense sans aucune conversion (zéro connu, et non donnée absente).
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
        const imprLevier = leviers.find((l) => l.levier === c.levier).impressions;
        if (c.ctr <= SEUILS.ctrFaible * reste.ctr && div(c.impressions, imprLevier) >= 0.15) {
          ajouter({
            gravite: 'info', poids: c.cout, cible: c.campagne,
            titre: `« ${c.campagne} » : CTR faible (${pctFin(c.ctr)})`,
            detail: `Les autres campagnes ${c.levier} sont à ${pctFin(reste.ctr)}.`,
            reco: 'Tester de nouvelles créations et resserrer le ciblage ou les emplacements.',
          });
        }
      }

      // Règle 8 — sans conversions, il reste le coût du trafic.
      if (!dispo.conversions && c.cpc >= SEUILS.cpcEleve * total.cpc && c.partBudget >= SEUILS.poidsMinimum) {
        ajouter({
          gravite: 'moyenne', poids: c.cout, cible: c.campagne,
          titre: `« ${c.campagne} » : CPC de ${c.cpc.toFixed(2).replace('.', ',')} €, soit ${fois(c.cpc / total.cpc)} fois la moyenne`,
          detail: `Elle pèse ${pct(c.partBudget)} du budget. Sans conversions, on ne peut pas dire si ce trafic plus cher est aussi plus rentable.`,
          reco: 'Obtenir les conversions de cette campagne avant de trancher.',
        });
      }
    }

    // Règle 7 — les campagnes de marque flattent la performance globale.
    let marque = null;
    const campagnesMarque = campagnes.filter((c) => c.estMarque);
    if (campagnesMarque.length && campagnesMarque.length < campagnes.length) {
      const sans = indicateurs(sommeCumuls(campagnes.filter((c) => !c.estMarque).map((c) => c.brut)), total);
      const poidsMarque = campagnesMarque.reduce((s, c) => s + (c.cout || 0), 0);
      marque = { roasSans: sans.roas, cpaSans: sans.cpa };
      const explication = 'Les campagnes sur le nom de la marque captent des clients qui seraient souvent venus de toute façon.';
      const reco = 'Piloter la performance hors marque, et suivre la marque à part.';
      if (aCA && total.roas >= SEUILS.ecartMarque * sans.roas) {
        ajouter({ gravite: 'moyenne', poids: poidsMarque, cible: 'Marque', titre: `Hors marque, le ${nomRoas} tombe de ${fois(total.roas)} à ${fois(sans.roas)}`, detail: explication, reco });
      } else if (!aCA && sans.cpa >= SEUILS.ecartMarque * total.cpa) {
        ajouter({ gravite: 'moyenne', poids: poidsMarque, cible: 'Marque', titre: `Hors marque, le CPA monte de ${eur(total.cpa)} à ${eur(sans.cpa)}`, detail: explication, reco });
      }
    }

    // Évolution entre périodes : on décompose la variation (trafic, taux de conversion, panier).
    let evolution = null;
    const nomsPeriodes = [...new Set(lignes.map((l) => l.periode).filter(Boolean))];
    if (nomsPeriodes.length >= 2) {
      const periodes = nomsPeriodes.map((nom) => indicateurs(sommeLignes(lignes.filter((l) => l.periode === nom), { periode: nom }), null));
      evolution = { periodes };
      const debut = periodes[0], fin = periodes[periodes.length - 1];
      const variation = (k) => (debut[k] > 0 && fini(fin[k]) ? fin[k] / debut[k] - 1 : NaN);
      const cle = aCA ? 'ca' : dispo.conversions ? 'conversions' : null;
      const v = cle ? variation(cle) : NaN;
      if (Math.abs(v) >= SEUILS.variationNotable) {
        const facteurs = [['clics', 'du trafic'], ['cvr', 'du taux de conversion'], ...(caReel ? [['panier', 'du panier moyen']] : [])]
          .map(([k, nom]) => ({ k, nom, v: variation(k) })).filter((f) => fini(f.v));
        const memeSens = facteurs.filter((f) => Math.sign(f.v) === Math.sign(v));
        const principal = (memeSens.length ? memeSens : facteurs).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))[0];
        const nomCle = cle === 'ca' ? "Chiffre d'affaires" : 'Conversions';
        const details = [
          fini(variation('cout')) && `budget ${evol(variation('cout'))}`,
          fini(variation('clics')) && `clics ${evol(variation('clics'))}`,
          fini(variation('cvr')) && `taux de conversion ${evol(variation('cvr'))}`,
          caReel && fini(variation('panier')) && `panier moyen ${evol(variation('panier'))}`,
          fini(variation('cpa')) && `CPA ${evol(variation('cpa'))}`,
        ].filter(Boolean).join(', ');
        const recos = {
          clics: v < 0 ? 'La baisse vient du trafic : vérifier les budgets, les enchères et la part d\'impressions.'
            : 'La hausse vient du trafic acheté : vérifier qu\'elle ne dégrade pas le CPA.',
          cvr: v < 0 ? 'La baisse vient du taux de conversion : regarder le site (parcours, prix, stock, suivi des conversions) avant de toucher aux campagnes.'
            : 'La hausse vient du taux de conversion : identifier ce qui a changé sur le site ou dans le ciblage pour le reproduire.',
          panier: v < 0 ? 'La baisse vient du panier moyen : regarder l\'offre, les promotions et les produits mis en avant.'
            : 'La hausse vient du panier moyen : identifier les produits ou offres qui tirent la valeur.',
        };
        ajouter({
          gravite: v < 0 ? 'haute' : 'info', poids: Infinity, cible: 'Évolution',
          titre: `${nomCle} : ${evol(v)} entre ${debut.periode} et ${fin.periode}`,
          detail: `Sur la même période : ${details}.` + (principal ? ` La variation vient surtout ${principal.nom}.` : ''),
          reco: principal ? recos[principal.k] : 'Obtenir les clics par période pour comprendre d\'où vient la variation.',
        });
      }
    }

    const ordre = { haute: 0, moyenne: 1, info: 2 };
    constats.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || b.poids - a.poids);

    // ---------- Limites : ce que les données ne permettent pas de conclure ----------
    const limites = [];
    const limite = (manque, consequence, question) => limites.push({ manque, consequence, question });
    const n = campagnes.length;
    const sans = (k) => campagnes.filter((c) => !(c.brut.connus[k] > 0));
    const nommer = (liste) => liste.slice(0, 3).map((c) => `« ${c.campagne} »`).join(', ') + (liste.length > 3 ? '…' : '');

    if (!dispo.cout) limite('Aucun coût', "Ni CPA, ni CPC, ni ROAS : l'analyse se limite aux volumes.", 'Quel budget a été dépensé par campagne ?');
    if (!dispo.conversions) limite('Aucune conversion', "Impossible de juger l'efficacité : l'analyse se limite au trafic (CTR, CPC).", 'Combien de conversions par campagne, et comment sont-elles mesurées ?');
    if (!aCA) limite("Pas de chiffre d'affaires", 'La rentabilité (ROAS) ne peut pas être calculée : un CPA bas peut cacher de petits paniers.', "Quel est le chiffre d'affaires par campagne, ou au moins le panier moyen ?");
    if (caEstime) limite("Chiffre d'affaires estimé, pas mesuré", 'Le ROAS estimé ne fait que traduire le CPA : les paniers réels peuvent varier fortement d\'une campagne à l\'autre.', "Quel est le chiffre d'affaires réel par campagne ?");
    if (!dispo.partImpr) limite("Pas de part d'impressions", 'Impossible de repérer les campagnes rentables mais bridées par leur budget.', "Quelle est la part d'impressions des campagnes Search ?");
    if (!dispo.impressions) limite("Pas d'impressions", "Le CTR ne peut pas être calculé : on ne peut pas juger l'attractivité des annonces.", 'Combien d\'impressions par campagne ?');
    if (!dispo.clics) limite('Pas de clics', "Ni CPC ni taux de conversion : on ne peut pas distinguer un problème d'annonce d'un problème de site.", 'Combien de clics par campagne ?');
    for (const [k, nom, effet] of [['conversions', 'Conversions', 'CPA'], ['cout', 'Coût', 'CPA et le ROAS']]) {
      const liste = sans(k);
      if (dispo[k] && liste.length) {
        limite(`${nom} inconnu${k === 'conversions' ? 'es' : ''} pour ${pluriel(liste.length, 'campagne')} sur ${n}`,
          `${nommer(liste)} : hors des comparaisons. Le ${effet} moyen${k === 'cout' ? 's' : ''} ${k === 'cout' ? 'sont calculés' : 'est calculé'} sur les autres.`,
          `Peut-on obtenir ${k === 'conversions' ? 'les conversions' : 'le coût'} de ces campagnes ?`);
      }
    }
    const partiels = [['clics', 'clics'], ['impressions', 'impressions']]
      .filter(([k]) => dispo[k] && sans(k).length).map(([k, nom]) => `${nom} (${pluriel(sans(k).length, 'campagne')})`);
    if (partiels.length) limite(`Données partielles : ${partiels.join(', ')}`, 'CTR, CPC ou taux de conversion manquent pour ces campagnes.', null);
    if (leviers.length < 2 && n > 1) limite('Un seul levier', 'Pas de comparaison entre leviers ni de réallocation possible entre eux.', "Quels autres leviers sont actifs (SEO, emailing, affiliation…) et que pèsent-ils ?");
    if (n < 2) limite('Une seule ligne de données', "Aucune comparaison interne possible : seuls les objectifs du client permettent de juger.", 'Peut-on obtenir le détail par levier ou par campagne ?');
    else if (parLevierSeulement) limite('Détail par levier seulement', "On ne voit pas quelles campagnes, à l'intérieur d'un levier, tirent ou plombent la performance.", 'Peut-on obtenir le détail par campagne ?');
    if (!(objectifCPA > 0) && !(objectifROAS > 0)) limite('Aucun objectif chiffré', 'Les campagnes sont comparées à la moyenne du compte, pas à une cible : « au-dessus de la moyenne » ne veut pas dire « rentable ».', 'Quel est le CPA ou le ROAS visé, et quelle est la marge ?');
    if (!evolution) limite('Une seule période', "Ni tendance ni saisonnalité : on ne sait pas si la situation s'améliore ou se dégrade.", "A-t-on l'historique mois par mois et l'année précédente ?");

    // Hypothèses et valeurs reconstruites : à dire clairement au client.
    const hypotheses = [];
    const formules = new Map();
    lignes.forEach((l) => (l.recalcules || []).forEach((f) => formules.set(f, (formules.get(f) || 0) + 1)));
    for (const [formule, nb] of formules) hypotheses.push(`${pluriel(nb, 'valeur')} retrouvée${nb > 1 ? 's' : ''} par le calcul : ${formule}.`);
    if (caEstime) hypotheses.push(`Chiffre d'affaires estimé avec un panier moyen de ${eur(panier)}, supposé identique pour toutes les campagnes.`);

    return {
      total, leviers, campagnes, constats, limites, hypotheses, evolution, marque,
      dispo, aCA, caEstime, parLevierSeulement, aPartImpr: dispo.partImpr,
      reglages: { objectifCPA: objectifCPA || null, objectifROAS: objectifROAS || null, panier: panier || null },
    };
  }

  return { CHAMPS, SEUILS, lireNombre, lireTaux, lireCSV, detecterColonnes, trouverEntete, extraire, preparerLigne, lireCas, analyser };
})();

if (typeof module !== 'undefined') module.exports = AuditExpress;
