// Analyse un cas (le JSON extrait d'un document) avec le même moteur que la page, et affiche
// le résultat en texte : `node analyser-cas.js cas/cas-en-cours.json`
// Sert à la commande /audit-cas : Claude cite ces chiffres au lieu de les calculer lui-même.
const fs = require('node:fs');
const A = require('./analyse.js');

const chemin = process.argv[2];
if (!chemin) { console.error('Usage : node analyser-cas.js <fichier.json>'); process.exit(1); }

let cas;
try { cas = JSON.parse(fs.readFileSync(chemin, 'utf8')); }
catch (e) { console.error(`JSON illisible : ${e.message}`); process.exit(1); }
if (!Array.isArray(cas.donnees)) { console.error('Le cas doit contenir un tableau « donnees ».'); process.exit(1); }

const { lignes, contexte, reglages } = A.lireCas(cas);
if (!lignes.length) { console.error('Aucune ligne chiffrée dans « donnees ».'); process.exit(1); }
const r = A.analyser(lignes, reglages);

const ok = Number.isFinite;
const nombre = (x, d = 0) => (ok(x) ? x.toLocaleString('fr-FR', { maximumFractionDigits: d }) : 'inconnu');
const pct = (x) => (ok(x) ? `${(x * 100).toFixed(0)} %` : 'inconnu');
const t = r.total;

console.log(`CAS : ${contexte.client || '(client non nommé)'} — ${lignes.length} ligne(s) lue(s), ${r.campagnes.length} campagne(s), ${r.leviers.length} levier(s)`);
console.log(`Réglages : objectif CPA ${reglages.objectifCPA ?? 'aucun'}, objectif ROAS ${reglages.objectifROAS ?? 'aucun'}, panier moyen ${reglages.panier ?? 'aucun'}`);
console.log('\nTOTAUX (à comparer avec ceux du document)');
console.log(`  Coût ${nombre(t.cout)} € | Conversions ${nombre(t.conversions)} | Clics ${nombre(t.clics)} | Impressions ${nombre(t.impressions)}`);
console.log(`  CPA ${nombre(t.cpa, 2)} € | ${r.caEstime ? 'CA estimé' : 'CA'} ${nombre(t.ca)} € | ${r.caEstime ? 'ROAS estimé' : 'ROAS'} ${nombre(t.roas, 2)}`);

console.log('\nPAR LEVIER');
for (const l of r.leviers) console.log(`  ${l.levier} : coût ${nombre(l.cout)} € (${pct(l.partBudget)}), conversions ${nombre(l.conversions)} (${pct(l.partConversions)}), CPA ${nombre(l.cpa, 2)} €`);

console.log('\nCONSTATS');
if (!r.constats.length) console.log('  Aucune anomalie détectée par les règles.');
r.constats.forEach((c, i) => console.log(`  ${i + 1}. [${c.gravite}] ${c.titre}\n     ${c.detail}\n     Piste : ${c.reco}`));

if (r.hypotheses.length) { console.log('\nHYPOTHÈSES ET VALEURS RECALCULÉES'); r.hypotheses.forEach((h) => console.log(`  - ${h}`)); }
if (r.limites.length) {
  console.log("\nCE QU'ON NE PEUT PAS CONCLURE");
  r.limites.forEach((l) => console.log(`  - ${l.manque}. ${l.consequence}${l.question ? ` À demander : ${l.question}` : ''}`));
}
