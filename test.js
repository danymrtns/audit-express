// Tests du moteur d'analyse : `node test.js`
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('./analyse.js');

// Lecture des nombres
assert.strictEqual(A.lireNombre('1 234,56 €'), 1234.56);
assert.strictEqual(A.lireNombre('38 %'), 38);
assert.strictEqual(A.lireNombre('1,234.5'), 1234.5);
assert.strictEqual(A.lireNombre('1.234,5'), 1234.5);
assert.strictEqual(A.lireNombre('< 10 %'), 10);
assert.ok(Number.isNaN(A.lireNombre('')));

// Détection des colonnes, y compris les colonnes pièges déjà calculées
const col = A.detecterColonnes(['Campaign', 'Impr.', 'Clicks', 'CTR', 'Avg. CPC', 'Cost', 'Conversions', 'Cost / conv.', 'Conv. value', 'Search impr. share']);
assert.deepStrictEqual(col, { partImpr: 9, ca: 8, cout: 5, conversions: 6, impressions: 1, clics: 2, levier: -1, campagne: 0 });

// Jeu d'exemple complet
const table = A.lireCSV(fs.readFileSync(path.join(__dirname, 'exemples', 'maison-verte.csv'), 'utf8'));
const entete = A.trouverEntete(table);
assert.strictEqual(entete, 0);
const r = A.analyser(A.extraire(table, entete, A.detecterColonnes(table[entete])));

assert.strictEqual(r.total.cout, 66800);
assert.strictEqual(r.total.conversions, 2274);
assert.strictEqual(r.total.ca, 156600);
assert.strictEqual(r.campagnes.length, 10);
assert.strictEqual(r.leviers.length, 3);
assert.ok(Math.abs(r.total.roas - 2.344) < 0.001);
assert.ok(Math.abs(r.marque.roasSans - 1.497) < 0.001);

// toLocaleString insère des espaces insécables : on les normalise pour comparer.
const titres = r.constats.map((c) => c.titre.replace(/[  ]/g, ' '));
const contient = (texte) => assert.ok(titres.some((t) => t.includes(texte)), `constat manquant : ${texte}`);
contient("Plantes d'intérieur » est rentable mais sous-investie");
contient('Display : 25 % du budget, 5 % des conversions');
contient('Décoration large » : CPA');
contient('Vidéo inspiration » attire les clics mais convertit peu');
contient('YouTube » : 1 900 € dépensés sans conversion');
contient('Hors marque, le ROAS tombe de 2,3 à 1,5');
// La campagne de marque ne doit pas être signalée comme « sous-investie ».
assert.ok(!titres.some((t) => t.includes('Marque - Maison Verte » est rentable')));

console.log(`OK — ${r.constats.length} constats`);
r.constats.forEach((c) => console.log(` [${c.gravite}] ${c.titre}`));
