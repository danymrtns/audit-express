/* Audit Express — interface. Le calcul est dans analyse.js ; ici on lit le fichier et on affiche. */
(() => {
  const A = AuditExpress;
  const $ = (id) => document.getElementById(id);

  // Client fictif, copie de exemples/maison-verte.csv, pour que l'exemple marche sans connexion.
  const EXEMPLE = `Levier;Campagne;Impressions;Clics;Coût;Conversions;Chiffre d'affaires;Part d'impressions
SEA;Marque - Maison Verte;85 000;12 750;3 800 €;890;62 300 €;92 %
SEA;Générique - Plantes d'intérieur;210 000;8 400;7 900 €;378;27 200 €;38 %
SEA;Shopping - Best-sellers;460 000;9 200;8 300 €;331;22 500 €;71 %
SEA;Générique - Décoration large;390 000;7 800;9 400 €;109;7 100 €;64 %
Social Ads;Prospection - Vidéo inspiration;1 450 000;26 100;11 200 €;118;7 400 €;
Social Ads;Retargeting - Visiteurs 30 j;320 000;4 800;3 900 €;202;13 900 €;
Social Ads;Lookalike - Acheteurs;610 000;6 100;5 600 €;128;8 600 €;
Display;Notoriété - Programmatique;3 900 000;7 800;12 500 €;47;2 900 €;
Display;Retargeting - Bannières;540 000;2 700;2 300 €;71;4 700 €;
Display;Test - YouTube;720 000;2 900;1 900 €;0;0 €;`;

  const etat = { table: null, entete: 0, colonnes: null, nom: '', resultat: null };

  // ---------- Formats ----------
  const vide = '–';
  const ok = (x) => Number.isFinite(x);
  const f = {
    entier: (x) => (ok(x) ? Math.round(x).toLocaleString('fr-FR') : vide),
    euro: (x) => (ok(x) ? `${x.toLocaleString('fr-FR', { maximumFractionDigits: x < 100 ? 2 : 0 })} €` : vide),
    pct: (x, d = 1) => (ok(x) ? `${(x * 100).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %` : vide),
    fois: (x) => (ok(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : vide),
  };
  const echapper = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Lecture du fichier ----------
  async function lireFichier(fichier) {
    const estExcel = /\.xlsx?$/i.test(fichier.name);
    if (estExcel) {
      if (typeof XLSX === 'undefined') throw new Error("La lecture d'Excel n'est pas disponible. Enregistrez le fichier en CSV.");
      const classeur = XLSX.read(await fichier.arrayBuffer());
      const feuille = classeur.Sheets[classeur.SheetNames[0]];
      return XLSX.utils.sheet_to_json(feuille, { header: 1, defval: '' })
        .filter((l) => l.some((c) => String(c).trim() !== ''));
    }
    return A.lireCSV(await fichier.text());
  }

  function charger(table, nom) {
    $('erreur').hidden = true;
    if (!table || table.length < 2) return signalerErreur('Ce fichier ne contient pas de lignes de données.');
    etat.table = table;
    etat.nom = nom;
    etat.entete = A.trouverEntete(table);
    etat.colonnes = A.detecterColonnes(table[etat.entete]);
    afficherChoixColonnes();
    lancerAnalyse();
  }

  function signalerErreur(message) {
    $('erreur').textContent = message;
    $('erreur').hidden = false;
    $('resultat').hidden = true;
  }

  // ---------- Association des colonnes ----------
  function afficherChoixColonnes() {
    const entete = etat.table[etat.entete];
    $('choixColonnes').innerHTML = A.CHAMPS.map((champ) => `
      <label>${champ.libelle}${champ.requis ? ' *' : ''}
        <select data-champ="${champ.id}">
          <option value="-1">— aucune —</option>
          ${entete.map((titre, i) => `<option value="${i}" ${etat.colonnes[champ.id] === i ? 'selected' : ''}>${echapper(titre || `Colonne ${i + 1}`)}</option>`).join('')}
        </select>
      </label>`).join('');
    $('colonnes').hidden = false;
  }

  function lancerAnalyse() {
    const manquants = A.CHAMPS.filter((c) => c.requis && etat.colonnes[c.id] < 0).map((c) => c.libelle);
    const reconnus = A.CHAMPS.filter((c) => etat.colonnes[c.id] >= 0).length;
    $('resumeColonnes').textContent = `(${reconnus} sur ${A.CHAMPS.length})`;
    if (manquants.length) {
      $('colonnes').open = true;
      return signalerErreur(`Colonne non reconnue : ${manquants.join(', ')}. Indiquez-la ci-dessous.`);
    }
    const lignes = A.extraire(etat.table, etat.entete, etat.colonnes);
    if (!lignes.length) return signalerErreur('Aucune ligne exploitable avec ces colonnes.');
    $('erreur').hidden = true;
    etat.resultat = A.analyser(lignes);
    afficherResultat();
  }

  // ---------- Affichage ----------
  function afficherResultat() {
    const r = etat.resultat;
    const t = r.total;
    $('nomFichier').textContent = `— ${etat.nom}, ${r.campagnes.length} campagnes`;
    $('depot').classList.add('compact');

    const tuiles = [
      ['Budget dépensé', f.euro(t.cout)],
      ['Conversions', f.entier(t.conversions)],
      ['CPA moyen', f.euro(t.cpa), 'coût par conversion'],
    ];
    if (r.aCA) {
      tuiles.push(["Chiffre d'affaires", f.euro(t.ca)], ['ROAS', f.fois(t.roas), "CA pour 1 € dépensé"]);
      if (r.marque) tuiles.push(['ROAS hors marque', f.fois(r.marque.roasSans), 'sans les campagnes de marque']);
    } else {
      tuiles.push(['Taux de conversion', f.pct(t.cvr, 2)]);
    }
    $('tuiles').innerHTML = tuiles.map(([libelle, valeur, note]) => `
      <div class="tuile"><div class="libelle">${libelle}</div><div class="valeur">${valeur}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`).join('');

    const noms = { haute: 'Priorité haute', moyenne: 'Priorité moyenne', info: 'À surveiller' };
    $('constats').innerHTML = r.constats.length
      ? r.constats.map((c) => `
        <li class="constat ${c.gravite}">
          <h3><span class="etiquette">${noms[c.gravite]}</span>${echapper(c.titre)}</h3>
          <p>${echapper(c.detail)}</p>
          <p class="reco"><strong>Piste :</strong> ${echapper(c.reco)}</p>
        </li>`).join('')
      : '<li class="aucun">Aucune anomalie détectée par les règles. Le compte est homogène, ou les données sont trop agrégées.</li>';

    $('graphLeviers').innerHTML = graphiqueLeviers(r.leviers);
    $('titreGraphCampagnes').textContent = r.aCA ? 'ROAS par campagne' : 'CPA par campagne';
    $('graphCampagnes').innerHTML = graphiqueCampagnes(r);

    $('tableLeviers').innerHTML = tableau(r, r.leviers, 'levier');
    $('tableCampagnes').innerHTML = tableau(r, r.campagnes, 'campagne');
    $('resultat').hidden = false;
  }

  function tableau(r, lignes, type) {
    const t = r.total;
    const colonnes = [
      ['Budget', (l) => f.euro(l.cout)],
      ['Part budget', (l) => f.pct(l.partBudget, 0)],
      ['Impressions', (l) => f.entier(l.impressions)],
      ['Clics', (l) => f.entier(l.clics)],
      ['CTR', (l) => f.pct(l.ctr, 2)],
      ['CPC', (l) => f.euro(l.cpc)],
      ['Conv.', (l) => f.entier(l.conversions)],
      ['Taux conv.', (l) => f.pct(l.cvr, 2)],
      ['CPA', (l) => f.euro(l.cpa), (l) => (l.cpa >= A.SEUILS.cpaEleve * t.cpa ? 'alerte' : l.cpa <= A.SEUILS.cpaBon * t.cpa ? 'bon' : '')],
    ];
    if (r.aCA) {
      colonnes.push(['CA', (l) => f.euro(l.ca)]);
      colonnes.push(['ROAS', (l) => f.fois(l.roas), (l) => (l.roas >= A.SEUILS.roasBon * t.roas ? 'bon' : l.roas <= t.roas / A.SEUILS.cpaEleve ? 'alerte' : '')]);
    }
    if (r.aPartImpr) colonnes.push(["Part d'impr.", (l) => f.pct(l.partImpr, 0)]);

    const ligneHtml = (l, nom, classe = '') => `<tr class="${classe}"><td>${echapper(nom)}</td>${type === 'campagne' ? `<td class="texte">${echapper(l.levier || '')}</td>` : ''}${
      colonnes.map(([, valeur, etat]) => `<td class="${classe || !etat ? '' : etat(l)}">${valeur(l)}</td>`).join('')}</tr>`;
    return `<thead><tr><th>${type === 'campagne' ? 'Campagne' : 'Levier'}</th>${type === 'campagne' ? '<th class="texte">Levier</th>' : ''}${
      colonnes.map(([titre]) => `<th>${titre}</th>`).join('')}</tr></thead><tbody>${
      lignes.map((l) => ligneHtml(l, l[type])).join('')}${ligneHtml({ ...t, partBudget: 1, levier: '' }, 'Total', 'total')}</tbody>`;
  }

  // ---------- Graphiques (SVG écrit à la main, sans bibliothèque) ----------
  const couper = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  function graphiqueLeviers(leviers) {
    const L = 560, marge = 130, barre = 14, pas = 52;
    const max = Math.max(...leviers.flatMap((l) => [l.partBudget, l.partConversions]).filter(ok), 0.01);
    const echelle = (x) => (ok(x) ? (x / max) * (L - marge - 60) : 0);
    const lignes = leviers.map((l, i) => {
      const y = i * pas + 6;
      return `<text x="${marge - 10}" y="${y + barre + 4}" text-anchor="end">${echapper(couper(l.levier, 18))}</text>
        <rect x="${marge}" y="${y}" width="${echelle(l.partBudget)}" height="${barre}" rx="2" fill="var(--budget)"/>
        <text x="${marge + echelle(l.partBudget) + 6}" y="${y + 11}">${f.pct(l.partBudget, 0)}</text>
        <rect x="${marge}" y="${y + barre + 3}" width="${echelle(l.partConversions)}" height="${barre}" rx="2" fill="var(--conversions)"/>
        <text x="${marge + echelle(l.partConversions) + 6}" y="${y + barre + 14}">${f.pct(l.partConversions, 0)}</text>`;
    }).join('');
    return `<div class="legende"><span><i style="background:var(--budget)"></i>Part du budget</span><span><i style="background:var(--conversions)"></i>Part des conversions</span></div>
      <svg viewBox="0 0 ${L} ${leviers.length * pas}" role="img" aria-label="Part du budget et des conversions par levier">${lignes}</svg>`;
  }

  function graphiqueCampagnes(r) {
    const cle = r.aCA ? 'roas' : 'cpa';
    const format = r.aCA ? f.fois : f.euro;
    const moyenne = r.total[cle];
    // Meilleures campagnes en haut : ROAS décroissant, ou CPA croissant.
    const campagnes = r.campagnes.filter((c) => ok(c[cle])).sort((a, b) => (r.aCA ? b.roas - a.roas : a.cpa - b.cpa)).slice(0, 14);
    if (!campagnes.length) return '<p class="discret">Données insuffisantes.</p>';
    const L = 560, marge = 200, barre = 16, pas = 26, haut = 18;
    const max = Math.max(...campagnes.map((c) => c[cle]), moyenne);
    const echelle = (x) => (x / max) * (L - marge - 60);
    const couleur = (c) => {
      const bon = r.aCA ? c.roas >= A.SEUILS.roasBon * moyenne : c.cpa <= A.SEUILS.cpaBon * moyenne;
      const mauvais = r.aCA ? c.roas <= moyenne / A.SEUILS.cpaEleve : c.cpa >= A.SEUILS.cpaEleve * moyenne;
      return bon ? 'var(--bon)' : mauvais ? 'var(--haute)' : 'var(--budget)';
    };
    const lignes = campagnes.map((c, i) => {
      const y = haut + i * pas;
      return `<text x="${marge - 10}" y="${y + 12}" text-anchor="end">${echapper(couper(c.campagne, 30))}</text>
        <rect x="${marge}" y="${y}" width="${Math.max(echelle(c[cle]), 1)}" height="${barre}" rx="2" fill="${couleur(c)}"/>
        <text x="${marge + echelle(c[cle]) + 6}" y="${y + 12}">${format(c[cle])}</text>`;
    }).join('');
    const xMoyenne = marge + echelle(moyenne);
    const hauteur = haut + campagnes.length * pas;
    return `<div class="legende"><span><i style="background:var(--bon)"></i>Au-dessus de la moyenne</span><span><i style="background:var(--haute)"></i>Nettement en dessous</span><span>Pointillé : moyenne du compte (${format(moyenne)})</span></div>
      <svg viewBox="0 0 ${L} ${hauteur}" role="img" aria-label="${r.aCA ? 'ROAS' : 'CPA'} par campagne">${lignes}
        <line class="repere" x1="${xMoyenne}" x2="${xMoyenne}" y1="${haut - 6}" y2="${hauteur}"/></svg>`;
  }

  // ---------- Exports texte ----------
  function synthese() {
    const r = etat.resultat, t = r.total;
    const lignes = [
      `AUDIT EXPRESS — ${etat.nom}`,
      `Budget : ${f.euro(t.cout)} | Conversions : ${f.entier(t.conversions)} | CPA : ${f.euro(t.cpa)}`
        + (r.aCA ? ` | CA : ${f.euro(t.ca)} | ROAS : ${f.fois(t.roas)}` : '')
        + (r.marque ? ` | ROAS hors marque : ${f.fois(r.marque.roasSans)}` : ''),
      '',
      'PAR LEVIER',
      ...r.leviers.map((l) => `- ${l.levier} : ${f.pct(l.partBudget, 0)} du budget, ${f.pct(l.partConversions, 0)} des conversions, CPA ${f.euro(l.cpa)}${r.aCA ? `, ROAS ${f.fois(l.roas)}` : ''}`),
      '',
      'CONSTATS',
      ...r.constats.map((c, i) => `${i + 1}. [${c.gravite}] ${c.titre}\n   ${c.detail}\n   Piste : ${c.reco}`),
    ];
    return lignes.join('\n');
  }

  function briefIA() {
    const r = etat.resultat;
    const detail = r.campagnes.map((c) => `- ${c.levier} / ${c.campagne} : budget ${f.euro(c.cout)}, clics ${f.entier(c.clics)}, CTR ${f.pct(c.ctr, 2)}, conv. ${f.entier(c.conversions)}, taux conv. ${f.pct(c.cvr, 2)}, CPA ${f.euro(c.cpa)}${r.aCA ? `, ROAS ${f.fois(c.roas)}` : ''}${ok(c.partImpr) ? `, part d'impr. ${f.pct(c.partImpr, 0)}` : ''}`);
    return [
      'Tu es consultant senior en acquisition digitale (SEA, Social Ads, Display, SEO).',
      "Voici l'audit chiffré d'un compte client. Les indicateurs ont été calculés par un outil à règles fixes : considère-les comme exacts.",
      '',
      synthese(),
      '',
      'DÉTAIL PAR CAMPAGNE',
      ...detail,
      '',
      'Ta mission, dans cet ordre :',
      '1. Critique ces constats : lesquels sont solides, lesquels peuvent avoir une autre explication (saisonnalité, attribution, rôle de notoriété, suivi des conversions) ?',
      "2. Liste les informations qui manquent pour trancher, et les questions à poser au client.",
      '3. Propose 3 recommandations classées par priorité, chacune avec le résultat attendu et l\'indicateur à suivre.',
      '4. Joue le directeur marketing sceptique : donne les 3 objections les plus probables à ces recommandations.',
      "Ne recalcule aucun chiffre et n'en invente aucun. Si une donnée manque, dis-le.",
    ].join('\n');
  }

  async function copier(texte, message) {
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      // Secours pour les pages ouvertes en file:// sur certains navigateurs.
      const zone = Object.assign(document.createElement('textarea'), { value: texte });
      document.body.append(zone); zone.select(); document.execCommand('copy'); zone.remove();
    }
    const bulle = $('bulle');
    bulle.textContent = message; bulle.hidden = false;
    clearTimeout(copier.minuteur);
    copier.minuteur = setTimeout(() => { bulle.hidden = true; }, 2200);
  }

  // ---------- Événements ----------
  async function recevoir(fichier) {
    if (!fichier) return;
    try { charger(await lireFichier(fichier), fichier.name); }
    catch (e) { signalerErreur(`Lecture impossible : ${e.message}`); }
  }
  $('fichier').addEventListener('change', (e) => { recevoir(e.target.files[0]); e.target.value = ''; });
  $('exemple').addEventListener('click', () => charger(A.lireCSV(EXEMPLE), 'Maison Verte (client fictif)'));
  $('choixColonnes').addEventListener('change', (e) => {
    if (!e.target.dataset.champ) return;
    etat.colonnes[e.target.dataset.champ] = Number(e.target.value);
    lancerAnalyse();
  });
  $('copierSynthese').addEventListener('click', () => copier(synthese(), 'Synthèse copiée'));
  $('copierBrief').addEventListener('click', () => copier(briefIA(), "Brief copié : collez-le dans l'IA"));
  $('imprimer').addEventListener('click', () => window.print());

  const depot = $('depot');
  ['dragenter', 'dragover'].forEach((ev) => depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.add('survol'); }));
  ['dragleave', 'drop'].forEach((ev) => depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.remove('survol'); }));
  depot.addEventListener('drop', (e) => recevoir(e.dataTransfer.files[0]));
  // Un fichier lâché à côté de la zone ne doit pas remplacer la page.
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));
})();
