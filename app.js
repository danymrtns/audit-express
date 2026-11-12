/* Audit Express — interface. Le calcul est dans analyse.js ; ici on lit les données et on affiche. */
(() => {
  const A = AuditExpress;
  const $ = (id) => document.getElementById(id);

  // Le prompt donné à l'IA avec le PDF du cas. Sa réponse est collée dans l'outil.
  const PROMPT_EXTRACTION = `Tu es analyste en acquisition digitale. Je te joins un cas client (PDF ou texte).
Range ses informations dans le format JSON ci-dessous. Réponds UNIQUEMENT avec ce bloc JSON, sans commentaire.

Règles :
- N'invente et ne calcule aucun chiffre : recopie ceux du document. Si une donnée est absente, mets null.
- "donnees" : une entrée par ligne du tableau le plus détaillé du document (par campagne et par période si possible, sinon par levier). N'ajoute pas les lignes de total.
- Si le document donne un indicateur (CPA, CPC, CTR, taux de conversion, ROAS) à la place d'un volume, recopie l'indicateur et laisse le volume à null : l'outil fera le calcul.
- Montants en euros sans symbole, nombres avec un point décimal. Taux en fraction : 0.38 pour 38 %, 0.021 pour 2,1 %.
- "objectifCPA", "objectifROAS", "panierMoyen", "budget" : seulement si le document les donne.
- "faitsCles" : les chiffres et faits importants donnés dans le texte, hors tableau (5 au maximum, une phrase chacun).
- "informationsManquantes" : ce que le document ne dit pas et qu'un consultant demanderait au client.

{
  "client": "",
  "secteur": "",
  "periode": "",
  "objectif": "",
  "contexte": "",
  "contraintes": [""],
  "objectifCPA": null,
  "objectifROAS": null,
  "panierMoyen": null,
  "budget": null,
  "donnees": [
    { "periode": null, "levier": "", "campagne": "", "impressions": null, "clics": null, "cout": null, "conversions": null, "ca": null, "partImpr": null, "ctr": null, "cpc": null, "cvr": null, "cpa": null, "roas": null }
  ],
  "faitsCles": [""],
  "informationsManquantes": [""]
}`;

  const etat = { source: null, table: null, entete: 0, colonnes: null, lignes: null, contexte: null, nom: '', resultat: null };

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
  const liste = (elements) => `<ul>${elements.map((e) => `<li>${echapper(e)}</li>`).join('')}</ul>`;

  // ---------- Entrée 1 : un fichier ----------
  async function recevoir(fichier) {
    if (!fichier) return;
    try {
      if (/\.pdf$/i.test(fichier.name)) {
        ouvrirPanneauCas('Un PDF se lit en passant par une IA : suivez les deux étapes ci-dessous.');
      } else if (/\.json$/i.test(fichier.name)) {
        chargerTexte(await fichier.text(), fichier.name);
      } else if (/\.xlsx?$/i.test(fichier.name)) {
        if (typeof XLSX === 'undefined') throw new Error("La lecture d'Excel n'est pas disponible. Enregistrez le fichier en CSV.");
        const classeur = XLSX.read(await fichier.arrayBuffer());
        const feuille = classeur.Sheets[classeur.SheetNames[0]];
        chargerTable(XLSX.utils.sheet_to_json(feuille, { header: 1, defval: '' })
          .filter((l) => l.some((c) => String(c).trim() !== '')), fichier.name);
      } else {
        chargerTexte(await fichier.text(), fichier.name);
      }
    } catch (e) { signalerErreur(`Lecture impossible : ${e.message}`); }
  }

  function chargerTable(table, nom) {
    if (!table || table.length < 2) return signalerErreur('Ce fichier ne contient pas de lignes de données.');
    Object.assign(etat, { source: 'table', table, nom, contexte: null });
    etat.entete = A.trouverEntete(table);
    etat.colonnes = A.detecterColonnes(table[etat.entete]);
    remplirReglages({});
    afficherChoixColonnes();
    lancerAnalyse();
  }

  // ---------- Entrée 2 : un cas extrait par l'IA (JSON), ou un tableau collé ----------
  /** Renvoie l'objet JSON contenu dans un texte (même entouré de ```json ou de phrases), ou null. */
  function trouverJSON(texte) {
    const debut = texte.indexOf('{'), fin = texte.lastIndexOf('}');
    if (debut === -1 || fin <= debut) return null;
    try { return JSON.parse(texte.slice(debut, fin + 1)); } catch { return null; }
  }

  /** Charge un texte : réponse de l'IA ou tableau. Renvoie un message d'erreur, ou null si tout va bien. */
  function chargerTexte(texte, nom) {
    const cas = trouverJSON(texte);
    if (cas && Array.isArray(cas.donnees)) {
      const { lignes, contexte, reglages } = A.lireCas(cas);
      if (!lignes.length) return "Le cas ne contient aucune donnée chiffrée dans « donnees ».";
      Object.assign(etat, { source: 'cas', lignes, contexte, table: null, nom: contexte.client || nom });
      remplirReglages(reglages);
      $('colonnes').hidden = true;
      lancerAnalyse();
      return null;
    }
    if (texte.includes('{') && !cas) return "Le texte ressemble à du JSON mais n'est pas valide. Redemandez à l'IA un JSON complet.";
    const table = A.lireCSV(texte);
    if (table.length < 2 || table[0].length < 2) return "Rien d'exploitable : collez la réponse JSON de l'IA, ou un tableau avec une ligne de titres.";
    chargerTable(table, nom);
    return null;
  }

  function ouvrirPanneauCas(message) {
    $('panneauCas').hidden = false;
    $('erreurCas').textContent = message || '';
    $('erreurCas').hidden = !message;
    $('collage').focus();
  }

  function signalerErreur(message) {
    $('erreur').textContent = message;
    $('erreur').hidden = false;
    $('resultat').hidden = true;
  }

  // ---------- Réglages : objectifs et hypothèse de panier ----------
  const CHAMPS_REGLAGES = ['objectifCPA', 'objectifROAS', 'panier'];
  function remplirReglages(reglages) {
    for (const id of CHAMPS_REGLAGES) $(id).value = reglages[id] ?? '';
  }
  function lireReglages() {
    const r = {};
    for (const id of CHAMPS_REGLAGES) { const n = parseFloat($(id).value); r[id] = n > 0 ? n : null; }
    return r;
  }

  // ---------- Association des colonnes (fichiers) ----------
  function afficherChoixColonnes() {
    const entete = etat.table[etat.entete];
    $('choixColonnes').innerHTML = A.CHAMPS.map((champ) => `
      <label>${champ.libelle}
        <select data-champ="${champ.id}">
          <option value="-1">— aucune —</option>
          ${entete.map((titre, i) => `<option value="${i}" ${etat.colonnes[champ.id] === i ? 'selected' : ''}>${echapper(titre || `Colonne ${i + 1}`)}</option>`).join('')}
        </select>
      </label>`).join('');
    $('colonnes').hidden = false;
  }

  function lancerAnalyse() {
    if (!etat.source) return;
    let lignes = etat.lignes;
    if (etat.source === 'table') {
      const reconnus = A.CHAMPS.filter((c) => etat.colonnes[c.id] >= 0).length;
      $('resumeColonnes').textContent = `(${reconnus} sur ${A.CHAMPS.length})`;
      lignes = A.extraire(etat.table, etat.entete, etat.colonnes);
      if (!lignes.length) {
        $('colonnes').open = true;
        return signalerErreur('Aucune donnée chiffrée reconnue. Indiquez ci-dessous au moins une colonne : coût, conversions, clics ou impressions.');
      }
    }
    $('erreur').hidden = true;
    etat.resultat = A.analyser(lignes, lireReglages());
    afficherResultat();
  }

  // ---------- Affichage ----------
  function afficherResultat() {
    const r = etat.resultat, t = r.total, d = r.dispo;
    const nb = r.parLevierSeulement ? `${r.leviers.length} levier${r.leviers.length > 1 ? 's' : ''}` : `${r.campagnes.length} campagne${r.campagnes.length > 1 ? 's' : ''}`;
    $('nomFichier').textContent = `— ${etat.nom}, ${nb}`;
    $('depot').classList.add('compact');
    $('champPanier').hidden = r.aCA && !r.caEstime; // inutile quand le chiffre d'affaires est fourni

    afficherContexte();

    const g = r.reglages;
    const tuiles = [];
    if (d.cout) tuiles.push(['Budget dépensé', f.euro(t.cout)]);
    if (d.conversions) tuiles.push(['Conversions', f.entier(t.conversions)]);
    if (ok(t.cpa)) tuiles.push(['CPA moyen', f.euro(t.cpa), g.objectifCPA ? `objectif : ${f.euro(g.objectifCPA)}` : 'coût par conversion']);
    if (r.aCA) {
      tuiles.push([r.caEstime ? "Chiffre d'affaires estimé" : "Chiffre d'affaires", f.euro(t.ca), r.caEstime ? `panier supposé : ${f.euro(g.panier)}` : '']);
      if (ok(t.roas)) tuiles.push([r.caEstime ? 'ROAS estimé' : 'ROAS', f.fois(t.roas), g.objectifROAS ? `objectif : ${f.fois(g.objectifROAS)}` : 'CA pour 1 € dépensé']);
      if (r.marque && ok(r.marque.roasSans)) tuiles.push([r.caEstime ? 'ROAS estimé hors marque' : 'ROAS hors marque', f.fois(r.marque.roasSans), 'sans les campagnes de marque']);
    } else if (r.marque && ok(r.marque.cpaSans)) {
      tuiles.push(['CPA hors marque', f.euro(r.marque.cpaSans), 'sans les campagnes de marque']);
    }
    if (!d.conversions) {
      if (d.clics) tuiles.push(['Clics', f.entier(t.clics)]);
      if (ok(t.cpc)) tuiles.push(['CPC moyen', f.euro(t.cpc)]);
      if (ok(t.ctr)) tuiles.push(['CTR', f.pct(t.ctr, 2)]);
    } else if (!r.aCA && ok(t.cvr)) {
      tuiles.push(['Taux de conversion', f.pct(t.cvr, 2)]);
    }
    $('tuiles').innerHTML = tuiles.map(([libelle, valeur, note]) => `
      <div class="tuile"><div class="libelle">${libelle}</div><div class="valeur">${valeur}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`).join('');

    const noms = { haute: 'Priorité haute', moyenne: 'Priorité moyenne', info: 'À noter' };
    $('constats').innerHTML = r.constats.length
      ? r.constats.map((c) => `
        <li class="constat ${c.gravite}">
          <h3><span class="etiquette">${noms[c.gravite]}</span>${echapper(c.titre)}</h3>
          <p>${echapper(c.detail)}</p>
          <p class="reco"><strong>Piste :</strong> ${echapper(c.reco)}</p>
        </li>`).join('')
      : '<li class="aucun">Aucune anomalie détectée par les règles avec les données fournies. Regardez ci-dessous ce qui manque pour aller plus loin.</li>';

    afficherLimites();

    const montrerLeviers = r.leviers.length > 1 && d.cout && d.conversions;
    $('carteLeviers').hidden = !montrerLeviers;
    if (montrerLeviers) $('graphLeviers').innerHTML = graphiqueLeviers(r.leviers);
    const mesure = r.aCA && ok(t.roas) ? 'roas' : ok(t.cpa) ? 'cpa' : ok(t.cpc) ? 'cpc' : null;
    const montrerCampagnes = mesure && r.campagnes.length > 1;
    $('carteCampagnes').hidden = !montrerCampagnes;
    if (montrerCampagnes) {
      const titres = { roas: r.caEstime ? 'ROAS estimé' : 'ROAS', cpa: 'CPA', cpc: 'CPC' };
      $('titreGraphCampagnes').textContent = `${titres[mesure]} par ${r.parLevierSeulement ? 'levier' : 'campagne'}`;
      $('graphCampagnes').innerHTML = graphiqueCampagnes(r, mesure);
    }
    $('blocGraphiques').hidden = !montrerLeviers && !montrerCampagnes;

    $('blocEvolution').hidden = !r.evolution;
    if (r.evolution) $('tableEvolution').innerHTML = tableau(r, r.evolution.periodes, 'periode');
    $('tableLeviers').innerHTML = tableau(r, r.leviers, 'levier');
    $('blocCampagnes').hidden = r.parLevierSeulement;
    if (!r.parLevierSeulement) $('tableCampagnes').innerHTML = tableau(r, r.campagnes, 'campagne');
    $('resultat').hidden = false;
  }

  function afficherContexte() {
    const c = etat.contexte;
    $('blocContexte').hidden = !c;
    if (!c) return;
    const sousTitre = [c.secteur, c.periode, c.budget ? `budget : ${f.euro(c.budget)}` : ''].filter(Boolean).join(' · ');
    const bloc = (titre, elements) => (elements.length ? `<div><h4>${titre}</h4>${liste(elements)}</div>` : '');
    $('contexte').innerHTML = `
      <div><h3>${echapper(c.client || 'Client')}</h3>${sousTitre ? `<p class="discret">${echapper(sousTitre)}</p>` : ''}</div>
      ${c.objectif ? `<p class="objectif"><strong>Objectif :</strong> ${echapper(c.objectif)}</p>` : ''}
      ${c.contexte ? `<p>${echapper(c.contexte)}</p>` : ''}
      <div class="colonnes">${bloc('Contraintes', c.contraintes)}${bloc('Faits clés du document', c.faitsCles)}</div>`;
  }

  function afficherLimites() {
    const r = etat.resultat;
    const duDocument = etat.contexte ? etat.contexte.informationsManquantes : [];
    const blocs = [];
    if (r.hypotheses.length) blocs.push(`<div><h4>Hypothèses et valeurs recalculées</h4>${liste(r.hypotheses)}</div>`);
    if (r.limites.length) {
      blocs.push(`<div><h4>Ce qu'on ne peut pas conclure</h4><ul>${r.limites.map((l) => `
        <li><strong>${echapper(l.manque)}.</strong> ${echapper(l.consequence)}${l.question ? ` <span class="question">À demander : ${echapper(l.question)}</span>` : ''}</li>`).join('')}</ul></div>`);
    }
    if (duDocument.length) blocs.push(`<div><h4>Absent du document, selon l'IA</h4>${liste(duDocument)}</div>`);
    $('blocLimites').hidden = !blocs.length;
    $('limites').innerHTML = blocs.join('');
  }

  function tableau(r, lignes, type) {
    const t = r.total, d = r.dispo;
    const etatCPA = (l) => (l.cpa >= A.SEUILS.cpaEleve * t.cpa ? 'alerte' : l.cpa <= A.SEUILS.cpaBon * t.cpa ? 'bon' : '');
    const etatROAS = (l) => (l.roas >= A.SEUILS.roasBon * t.roas ? 'bon' : l.roas <= t.roas / A.SEUILS.cpaEleve ? 'alerte' : '');
    // Seules les colonnes qui ont des données sont affichées.
    const colonnes = [
      d.cout && ['Budget', (l) => f.euro(l.cout)],
      d.cout && type !== 'periode' && ['Part budget', (l) => f.pct(l.partBudget, 0)],
      d.impressions && ['Impressions', (l) => f.entier(l.impressions)],
      d.clics && ['Clics', (l) => f.entier(l.clics)],
      ok(t.ctr) && ['CTR', (l) => f.pct(l.ctr, 2)],
      ok(t.cpc) && ['CPC', (l) => f.euro(l.cpc)],
      d.conversions && ['Conv.', (l) => f.entier(l.conversions)],
      ok(t.cvr) && ['Taux conv.', (l) => f.pct(l.cvr, 2)],
      ok(t.cpa) && ['CPA', (l) => f.euro(l.cpa), type !== 'periode' && etatCPA],
      r.aCA && [r.caEstime ? 'CA estimé' : 'CA', (l) => f.euro(l.ca)],
      r.aCA && ok(t.roas) && [r.caEstime ? 'ROAS estimé' : 'ROAS', (l) => f.fois(l.roas), type !== 'periode' && etatROAS],
      d.partImpr && type !== 'periode' && ["Part d'impr.", (l) => f.pct(l.partImpr, 0)],
    ].filter(Boolean);
    const avecLevier = type === 'campagne';
    const titre = { campagne: 'Campagne', levier: 'Levier', periode: 'Période' }[type];
    const ligneHtml = (l, nom, classe = '') => `<tr class="${classe}"><td>${echapper(nom)}</td>${avecLevier ? `<td class="texte">${echapper(l.levier || '')}</td>` : ''}${
      colonnes.map(([, valeur, couleur]) => `<td class="${classe || !couleur ? '' : couleur(l)}">${valeur(l)}</td>`).join('')}</tr>`;
    return `<thead><tr><th>${titre}</th>${avecLevier ? '<th class="texte">Levier</th>' : ''}${
      colonnes.map(([nom]) => `<th>${nom}</th>`).join('')}</tr></thead><tbody>${
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
        <text x="${marge + echelle(l.partConversions) + 6}" y="${y + barre + 14}">${ok(l.partConversions) ? f.pct(l.partConversions, 0) : 'inconnu'}</text>`;
    }).join('');
    return `<div class="legende"><span><i style="background:var(--budget)"></i>Part du budget</span><span><i style="background:var(--conversions)"></i>Part des conversions</span></div>
      <svg viewBox="0 0 ${L} ${leviers.length * pas}" role="img" aria-label="Part du budget et des conversions par levier">${lignes}</svg>`;
  }

  function graphiqueCampagnes(r, cle) {
    const plusEstMieux = cle === 'roas';
    const format = cle === 'roas' ? f.fois : f.euro;
    const moyenne = r.total[cle];
    // Meilleures campagnes en haut.
    const campagnes = r.campagnes.filter((c) => ok(c[cle])).sort((a, b) => (plusEstMieux ? b[cle] - a[cle] : a[cle] - b[cle])).slice(0, 14);
    const inconnues = r.campagnes.length - r.campagnes.filter((c) => ok(c[cle])).length;
    if (!campagnes.length) return '<p class="discret">Données insuffisantes.</p>';
    const L = 560, marge = 200, barre = 16, pas = 26, haut = 18;
    const max = Math.max(...campagnes.map((c) => c[cle]), moyenne);
    const echelle = (x) => (x / max) * (L - marge - 60);
    const couleur = (c) => {
      const rapport = plusEstMieux ? c[cle] / moyenne : moyenne / c[cle];
      return rapport >= A.SEUILS.roasBon ? 'var(--bon)' : rapport <= 1 / A.SEUILS.cpaEleve ? 'var(--haute)' : 'var(--budget)';
    };
    const lignes = campagnes.map((c, i) => {
      const y = haut + i * pas;
      return `<text x="${marge - 10}" y="${y + 12}" text-anchor="end">${echapper(couper(c.campagne, 30))}</text>
        <rect x="${marge}" y="${y}" width="${Math.max(echelle(c[cle]), 1)}" height="${barre}" rx="2" fill="${couleur(c)}"/>
        <text x="${marge + echelle(c[cle]) + 6}" y="${y + 12}">${format(c[cle])}</text>`;
    }).join('');
    const xMoyenne = marge + echelle(moyenne);
    const hauteur = haut + campagnes.length * pas;
    return `<div class="legende"><span><i style="background:var(--bon)"></i>Nettement meilleur que la moyenne</span><span><i style="background:var(--haute)"></i>Nettement moins bon</span><span>Pointillé : moyenne (${format(moyenne)})</span>${
      inconnues ? `<span>${inconnues} non calculable${inconnues > 1 ? 's' : ''}, faute de données</span>` : ''}</div>
      <svg viewBox="0 0 ${L} ${hauteur}" role="img" aria-label="Comparaison des campagnes">${lignes}
        <line class="repere" x1="${xMoyenne}" x2="${xMoyenne}" y1="${haut - 6}" y2="${hauteur}"/></svg>`;
  }

  // ---------- Exports texte ----------
  function synthese() {
    const r = etat.resultat, t = r.total, c = etat.contexte;
    const chiffres = [
      ok(t.cout) && `Budget : ${f.euro(t.cout)}`,
      ok(t.conversions) && `Conversions : ${f.entier(t.conversions)}`,
      ok(t.cpa) && `CPA : ${f.euro(t.cpa)}${r.reglages.objectifCPA ? ` (objectif ${f.euro(r.reglages.objectifCPA)})` : ''}`,
      r.aCA && `${r.caEstime ? 'CA estimé' : 'CA'} : ${f.euro(t.ca)}`,
      r.aCA && ok(t.roas) && `${r.caEstime ? 'ROAS estimé' : 'ROAS'} : ${f.fois(t.roas)}${r.reglages.objectifROAS ? ` (objectif ${f.fois(r.reglages.objectifROAS)})` : ''}`,
      r.marque && ok(r.marque.roasSans) && `ROAS hors marque : ${f.fois(r.marque.roasSans)}`,
    ].filter(Boolean).join(' | ');
    const levier = (l) => `- ${l.levier} : ${[
      ok(l.partBudget) && `${f.pct(l.partBudget, 0)} du budget`,
      ok(l.partConversions) && `${f.pct(l.partConversions, 0)} des conversions`,
      ok(l.cpa) && `CPA ${f.euro(l.cpa)}`,
      r.aCA && ok(l.roas) && `ROAS ${f.fois(l.roas)}`].filter(Boolean).join(', ')}`;
    return [
      `AUDIT EXPRESS — ${etat.nom}`,
      ...(c ? [
        c.objectif && `Objectif du client : ${c.objectif}`,
        c.contexte && `Contexte : ${c.contexte}`,
        c.contraintes.length && `Contraintes : ${c.contraintes.join(' ; ')}`,
        c.faitsCles.length && `Faits clés : ${c.faitsCles.join(' ')}`,
      ].filter(Boolean) : []),
      chiffres,
      '',
      'PAR LEVIER',
      ...r.leviers.map(levier),
      '',
      'CONSTATS',
      ...(r.constats.length ? r.constats.map((x, i) => `${i + 1}. [${x.gravite}] ${x.titre}\n   ${x.detail}\n   Piste : ${x.reco}`) : ['Aucune anomalie détectée par les règles.']),
      ...(r.hypotheses.length ? ['', 'HYPOTHÈSES ET VALEURS RECALCULÉES', ...r.hypotheses.map((h) => `- ${h}`)] : []),
      ...(r.limites.length ? ['', "CE QU'ON NE PEUT PAS CONCLURE", ...r.limites.map((l) => `- ${l.manque}. ${l.consequence}${l.question ? ` À demander : ${l.question}` : ''}`)] : []),
      ...(c && c.informationsManquantes.length ? ['', 'ABSENT DU DOCUMENT', ...c.informationsManquantes.map((x) => `- ${x}`)] : []),
    ].join('\n');
  }

  function briefIA() {
    const r = etat.resultat;
    const detail = r.campagnes.map((c) => `- ${c.levier} / ${c.campagne} : ${[
      ok(c.cout) && `budget ${f.euro(c.cout)}`,
      ok(c.clics) && `clics ${f.entier(c.clics)}`,
      ok(c.ctr) && `CTR ${f.pct(c.ctr, 2)}`,
      ok(c.conversions) && `conv. ${f.entier(c.conversions)}`,
      ok(c.cvr) && `taux conv. ${f.pct(c.cvr, 2)}`,
      ok(c.cpa) && `CPA ${f.euro(c.cpa)}`,
      r.aCA && ok(c.roas) && `${r.caEstime ? 'ROAS estimé' : 'ROAS'} ${f.fois(c.roas)}`,
      ok(c.partImpr) && `part d'impr. ${f.pct(c.partImpr, 0)}`].filter(Boolean).join(', ')}`);
    return [
      'Tu es consultant senior en acquisition digitale (SEA, Social Ads, Display, SEO).',
      "Voici l'audit chiffré d'un compte client. Les indicateurs ont été calculés par un outil à règles fixes : considère-les comme exacts. Les données sont incomplètes : les hypothèses et les limites sont listées, tiens-en compte.",
      '',
      synthese(),
      '',
      'DÉTAIL PAR CAMPAGNE (une donnée absente est inconnue, pas nulle)',
      ...detail,
      '',
      'Ta mission, dans cet ordre :',
      '1. Critique ces constats : lesquels sont solides malgré les données manquantes, lesquels reposent sur une hypothèse, lesquels peuvent avoir une autre explication (saisonnalité, attribution, rôle de notoriété, suivi des conversions) ?',
      "2. Classe les questions à poser au client : d'abord celles dont la réponse changerait la recommandation.",
      "3. Propose 3 recommandations classées par priorité, compatibles avec l'objectif et les contraintes du client. Pour chacune : le résultat attendu, l'indicateur à suivre, et ce qui la remettrait en cause.",
      '4. Joue le directeur marketing sceptique : donne les 3 objections les plus probables.',
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
    copier.afficher(message);
  }
  /** Affiche un court message en bas de l'écran. */
  copier.afficher = (message) => {
    const bulle = $('bulle');
    bulle.textContent = message; bulle.hidden = false;
    clearTimeout(copier.minuteur);
    copier.minuteur = setTimeout(() => { bulle.hidden = true; }, 2200);
  };

  // ---------- Événements ----------
  $('fichier').addEventListener('change', (e) => { recevoir(e.target.files[0]); e.target.value = ''; });
  $('exemple').addEventListener('click', () => chargerTable(A.lireCSV(EXEMPLES.exportComplet), 'Maison Verte (client fictif)'));
  $('exempleCas').addEventListener('click', () => chargerTexte(JSON.stringify(EXEMPLES.casIncomplet), 'Atelier Brume'));
  $('ouvrirCas').addEventListener('click', () => ouvrirPanneauCas());
  $('fermerCas').addEventListener('click', () => { $('panneauCas').hidden = true; });
  $('copierPrompt').addEventListener('click', () => copier(PROMPT_EXTRACTION, 'Prompt copié : donnez-le à votre IA avec le PDF'));
  $('analyserCollage').addEventListener('click', () => {
    const texte = $('collage').value.trim();
    const erreur = texte ? chargerTexte(texte, 'Données collées') : "Collez d'abord la réponse de l'IA.";
    $('erreurCas').textContent = erreur || '';
    $('erreurCas').hidden = !erreur;
    if (!erreur) { $('panneauCas').hidden = true; $('resultat').scrollIntoView({ behavior: 'smooth' }); }
  });
  $('choixColonnes').addEventListener('change', (e) => {
    if (!e.target.dataset.champ) return;
    etat.colonnes[e.target.dataset.champ] = Number(e.target.value);
    lancerAnalyse();
  });
  CHAMPS_REGLAGES.forEach((id) => $(id).addEventListener('change', lancerAnalyse));
  $('copierSynthese').addEventListener('click', () => copier(synthese(), 'Synthèse copiée'));
  $('copierBrief').addEventListener('click', () => copier(briefIA(), "Brief copié : collez-le dans l'IA"));
  $('imprimer').addEventListener('click', () => window.print());

  const depot = $('depot');
  ['dragenter', 'dragover'].forEach((ev) => depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.add('survol'); }));
  ['dragleave', 'drop'].forEach((ev) => depot.addEventListener(ev, (e) => { e.preventDefault(); depot.classList.remove('survol'); }));
  depot.addEventListener('drop', (e) => recevoir(e.dataTransfer.files[0]));
  // Un fichier lâché à côté de la zone ne doit pas remplacer la page.
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

  // ---------- Lien avec Claude, en local uniquement ----------
  // La commande /audit-cas fait lire un PDF à Claude, qui écrit cas/<nom>.json puis ouvre
  // cette page avec ?cas=<nom>. Le dossier cas/ n'est jamais publié : rien de tel en ligne.
  const nomCas = new URLSearchParams(location.search).get('cas');
  const enLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (nomCas && enLocal && /^[\w-]+$/.test(nomCas)) {
    fetch(`cas/${nomCas}.json`, { cache: 'no-store' })
      .then((reponse) => (reponse.ok ? reponse.text() : Promise.reject(new Error('introuvable'))))
      .then((texte) => {
        const erreur = chargerTexte(texte, nomCas);
        if (erreur) signalerErreur(erreur);
        else copier.afficher('Cas préparé par Claude chargé');
      })
      .catch(() => signalerErreur(`Le cas « ${nomCas} » est introuvable dans le dossier cas/.`));
  }

  // Accès pour les tests et le débogage.
  window.AuditExpressApp = { chargerTexte, synthese, briefIA, PROMPT_EXTRACTION };
})();
