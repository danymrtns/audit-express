// Regroupe les fichiers du dossier exemples/ dans exemples/exemples.js, pour que les boutons
// « Exemple » marchent sans connexion et sans serveur : `node construire-exemples.js`
const fs = require('node:fs');
const path = require('node:path');
const lire = (nom) => fs.readFileSync(path.join(__dirname, 'exemples', nom), 'utf8');
const contenu = `// Fichier généré par construire-exemples.js — ne pas modifier à la main.
const EXEMPLES = {
  exportComplet: ${JSON.stringify(lire('maison-verte.csv'))},
  casIncomplet: ${JSON.stringify(JSON.parse(lire('cas-atelier-brume.json')), null, 2).replace(/\n/g, '\n  ')},
};
`;
fs.writeFileSync(path.join(__dirname, 'exemples', 'exemples.js'), contenu);
console.log('exemples/exemples.js écrit');
