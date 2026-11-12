// Tests du moteur d'analyse : `node test.js`
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('./analyse.js');

const proche = (a, b, tolerance = 0.001) => assert.ok(Math.abs(a - b) < tolerance, `${a} différent de ${b}`);
// toLocaleString insère des espaces insécables : on les normalise pour comparer.
const titresDe = (r) => r.constats.map((c) => c.titre.replace(/[  ]/g, ' '));
const verifier = (titres) => (texte) => assert.ok(titres.some((t) => t.includes(texte)), `constat manquant : ${texte}\n  ${titres.join('\n  ')}`);

// ---------- Lecture des nombres ----------
assert.strictEqual(A.lireNombre('1 234,56 €'), 1234.56);
assert.strictEqual(A.lireNombre('38 %'), 38);
assert.strictEqual(A.lireNombre('1,234.5'), 1234.5);
assert.strictEqual(A.lireNombre('1.234,5'), 1234.5);
assert.strictEqual(A.lireNombre('< 10 %'), 10);
assert.ok(Number.isNaN(A.lireNombre('')));
assert.ok(Number.isNaN(A.lireNombre('n.c.')));
assert.ok(Number.isNaN(A.lireNombre(null)));
assert.strictEqual(A.lireTaux('38 %'), 0.38);
assert.strictEqual(A.lireTaux('0,5 %'), 0.005);
assert.strictEqual(A.lireTaux(0.38), 0.38);
assert.strictEqual(A.lireTaux(38), 0.38);

// ---------- Détection des colonnes : volumes et indicateurs déjà calculés ----------
const col = A.detecterColonnes(['Campaign', 'Impr.', 'Clicks', 'CTR', 'Avg. CPC', 'Cost', 'Conversions', 'Cost / conv.', 'Conv. value', 'Search impr. share']);
assert.deepStrictEqual(col, {
  partImpr: 9, roas: -1, cpa: 7, cpc: 4, cvr: -1, ctr: 3, ca: 8, cout: 5, conversions: 6, impressions: 1, clics: 2,
  periode: -1, levier: -1, campagne: 0,
});
const colFr = A.detecterColonnes(['Mois', 'Canal', 'Nom de la campagne', 'Dépense', 'Coût par commande', 'Commandes', 'Taux de conversion', 'Valeur de conversion']);
assert.deepStrictEqual([colFr.periode, colFr.levier, colFr.campagne, colFr.cout, colFr.cpa, colFr.conversions, colFr.cvr, colFr.ca], [0, 1, 2, 3, 4, 5, 6, 7]);

// ---------- Jeu d'exemple complet ----------
{
  const table = A.lireCSV(fs.readFileSync(path.join(__dirname, 'exemples', 'maison-verte.csv'), 'utf8'));
  const entete = A.trouverEntete(table);
  assert.strictEqual(entete, 0);
  const r = A.analyser(A.extraire(table, entete, A.detecterColonnes(table[entete])));
  assert.strictEqual(r.total.cout, 66800);
  assert.strictEqual(r.total.conversions, 2274);
  assert.strictEqual(r.total.ca, 156600);
  assert.strictEqual(r.campagnes.length, 10);
  assert.strictEqual(r.leviers.length, 3);
  proche(r.total.roas, 2.344);
  proche(r.marque.roasSans, 1.497);
  const contient = verifier(titresDe(r));
  contient("Plantes d'intérieur » est rentable mais sous-investie");
  contient('Display : 25 % du budget, 5 % des conversions');
  contient('Décoration large » : CPA');
  contient('Vidéo inspiration » attire les clics mais convertit peu');
  contient('YouTube » : 1 900 € dépensés sans conversion');
  contient('Hors marque, le ROAS tombe de 2,3 à 1,5');
  // La campagne de marque ne doit pas être signalée comme « sous-investie ».
  assert.ok(!titresDe(r).some((t) => t.includes('Marque - Maison Verte » est rentable')));
  assert.strictEqual(r.hypotheses.length, 0);
  console.log(`OK — exemple complet : ${r.constats.length} constats, ${r.limites.length} limites`);
}

// ---------- Ligne « Total » dans une colonne non reconnue, et évolution entre périodes ----------
{
  const table = [
    ['Semestre', 'Canal', 'Campagne', 'Dépense', 'Clics', 'Commandes'],
    ['S1', 'SEA', 'A', 1000, 1000, 50],
    ['S2', 'SEA', 'A', 1000, 1000, 30],
    ['Total', '', '', 2000, 2000, 80],
  ];
  const colonnes = A.detecterColonnes(table[0]);
  colonnes.periode = 0; // « Semestre » n'est pas reconnu : association faite à la main, comme dans l'interface.
  const r = A.analyser(A.extraire(table, 0, colonnes));
  assert.strictEqual(r.total.cout, 2000);
  assert.strictEqual(r.campagnes.length, 1);
  assert.strictEqual(r.evolution.periodes.length, 2);
  verifier(titresDe(r))('Conversions : −40 % entre S1 et S2');
  assert.ok(r.constats[0].detail.includes('du taux de conversion'));
  console.log('OK — ligne Total ignorée, baisse attribuée au taux de conversion');
}

// ---------- Reconstruction des valeurs absentes ----------
{
  const l = A.preparerLigne({ levier: 'Meta Ads', campagne: 'Prospection', cout: '26 500 €', clics: 61000, cpa: '118 €' });
  assert.strictEqual(l.conversions, 225); // 26 500 ÷ 118
  assert.deepStrictEqual(l.recalcules, ['conversions = coût ÷ CPA']);
  const m = A.preparerLigne({ campagne: 'X', impressions: 100000, ctr: '2 %', cpc: 0.5, cvr: 0.04, roas: '400 %' });
  assert.deepStrictEqual([m.clics, m.cout, m.conversions, m.ca], [2000, 1000, 80, 4000]);
  assert.strictEqual(A.preparerLigne({ campagne: 'Vide', cpa: 12 }), null);
  console.log('OK — valeurs retrouvées à partir des indicateurs');
}

// ---------- Cas extrait d'un PDF : données incomplètes ----------
{
  const cas = JSON.parse(fs.readFileSync(path.join(__dirname, 'exemples', 'cas-atelier-brume.json'), 'utf8'));
  const { lignes, contexte, reglages } = A.lireCas(cas);
  assert.strictEqual(lignes.length, 8);
  assert.strictEqual(contexte.client, 'Atelier Brume');
  assert.deepStrictEqual(reglages, { objectifCPA: 30, objectifROAS: null, panier: 62 });

  const r = A.analyser(lignes, reglages);
  assert.strictEqual(r.total.cout, 120000);
  assert.strictEqual(r.total.conversions, 3674); // dont 649 retrouvées pour Meta Ads
  proche(r.total.cpa, 32.66, 0.01);
  assert.ok(r.caEstime);
  proche(r.total.roas, 62 / (120000 / 3674), 0.001);
  // Display n'a pas de clics, l'affiliation n'a que coût et commandes : inconnu, et non zéro.
  const display = r.campagnes.find((c) => c.levier === 'Display');
  assert.ok(Number.isNaN(display.clics) && Number.isNaN(display.cvr));
  proche(display.cpa, 22400 / 95, 0.01);

  const contient = verifier(titresDe(r));
  contient('CPA moyen de 33 € pour un objectif de 30 € (+9 %)');
  contient('Bougies parfumées » est rentable mais sous-investie');
  contient('Display : 19 % du budget, 3 % des conversions');
  contient('Hors marque, le ROAS estimé tombe de 1,9 à 1,4');
  assert.ok(r.hypotheses.some((h) => h.includes('conversions = coût ÷ CPA')));
  assert.ok(r.hypotheses.some((h) => h.includes('panier moyen de 62 €')));
  const manques = r.limites.map((x) => x.manque);
  assert.ok(manques.includes('Une seule période'));
  assert.ok(manques.some((x) => x.startsWith('Données partielles')));
  assert.ok(!manques.includes('Aucun objectif chiffré'));

  // Sans le panier moyen : pas de ROAS, et la limite est signalée.
  const sansPanier = A.analyser(lignes, { objectifCPA: 30 });
  assert.ok(Number.isNaN(sansPanier.total.roas));
  assert.ok(sansPanier.limites.some((x) => x.manque === "Pas de chiffre d'affaires"));
  verifier(titresDe(sansPanier))('Hors marque, le CPA monte de 33 € à 45 €');
  console.log(`OK — cas incomplet : ${r.constats.length} constats, ${r.limites.length} limites, ${r.hypotheses.length} hypothèses`);
  r.constats.forEach((c) => console.log(`   [${c.gravite}] ${c.titre.replace(/[  ]/g, ' ')}`));
  r.limites.forEach((x) => console.log(`   (limite) ${x.manque}`));
}

// ---------- Très peu de données : rien ne doit planter, et rien ne doit être inventé ----------
{
  // Coût et clics seulement : pas de conversions.
  const r = A.analyser([
    A.preparerLigne({ levier: 'SEA', campagne: 'A', cout: 1000, clics: 2000 }),
    A.preparerLigne({ levier: 'SEA', campagne: 'B', cout: 1000, clics: 400 }),
  ]);
  assert.ok(Number.isNaN(r.total.conversions) && Number.isNaN(r.total.cpa));
  assert.ok(!titresDe(r).some((t) => t.includes('sans conversion')), 'une conversion absente ne vaut pas zéro');
  verifier(titresDe(r))('« B » : CPC de 2,50 €');
  assert.ok(r.limites.some((x) => x.manque === 'Aucune conversion'));

  // Une seule ligne, par levier.
  const seul = A.analyser([A.preparerLigne({ levier: 'SEA', cout: 5000, conversions: 100 })], { objectifCPA: 40 });
  assert.strictEqual(seul.total.cpa, 50);
  verifier(titresDe(seul))('CPA moyen de 50 € pour un objectif de 40 € (+25 %)');
  assert.ok(seul.limites.some((x) => x.manque === 'Une seule ligne de données'));

  // Conversions connues pour une campagne seulement : le CPA moyen ignore l'autre.
  const partiel = A.analyser([
    A.preparerLigne({ levier: 'SEA', campagne: 'A', cout: 1000, conversions: 50 }),
    A.preparerLigne({ levier: 'SEA', campagne: 'B', cout: 9000 }),
  ]);
  assert.strictEqual(partiel.total.cpa, 20);
  assert.ok(partiel.limites.some((x) => x.manque.startsWith('Conversions inconnues pour 1 campagne sur 2')));
  console.log('OK — données minimales : aucune valeur inventée');
}
