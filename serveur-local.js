// Petit serveur de fichiers pour tester en local : `node serveur-local.js` puis http://localhost:4173
// (facultatif : ouvrir index.html directement dans le navigateur fonctionne aussi).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT) || 4173;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

http.createServer((req, res) => {
  const demande = decodeURIComponent(req.url.split('?')[0]);
  const chemin = path.join(__dirname, demande === '/' ? 'index.html' : demande);
  // On ne sert que les fichiers du dossier du projet.
  if (!chemin.startsWith(__dirname)) { res.writeHead(403).end(); return; }
  fs.readFile(chemin, (err, contenu) => {
    if (err) { res.writeHead(404).end('Introuvable'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(chemin)] || 'application/octet-stream' }).end(contenu);
  });
}).listen(port, () => console.log(`http://localhost:${port}`));
