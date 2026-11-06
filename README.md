# EpiKodi

Centre multimedia desktop (type Kodi) : lecture et organisation de videos,
musique, podcasts et medias numeriques en local et sur le reseau.

Projet Epitech - MVP sur ~5 jours-homme. Voir [`EPIKODI_ISSUES.md`](../EPIKODI_ISSUES.md)
pour le backlog detaille.

## Stack

- **Electron** + **React** (Vite) pour l'interface
- **TypeScript** partout (main, renderer, shared)
- **FFmpeg / ffprobe** pour le traitement multimedia (detection de codec, transcodage, metadonnees)
- **SQLite** (better-sqlite3) pour la bibliotheque (sources, medias, metadonnees, cache TMDB)
- **TMDB** pour l'enrichissement des fiches films (affiche, synopsis, annee, note)

## Fonctionnalites

- **Lecteur** video/audio : controles, raccourcis clavier (Espace, fleches, M, F),
  detection du format avec ffprobe et conversion MP4 via FFmpeg si Chromium
  ne sait pas lire le fichier
- **Sources** : dossiers locaux ou partages reseau montes (CIFS/NFS/SSHFS/GVFS,
  chemins UNC sous Windows), scan recursif asynchrone avec timeouts, statut
  du dernier scan, rescan, navigation dans l'arborescence
- **Indexation** : apres le scan, ffprobe extrait duree, codecs, resolution et
  tags audio (titre, artiste, album, piste, genre, annee), puis FFmpeg genere une
  vignette par video (image a 10 % de la duree, affichee sans affiche TMDB) ;
  seuls les fichiers nouveaux ou modifies sont re-analyses
- **Bibliotheque** : sections Films / Musique / Podcasts (un audio est un podcast
  s'il a le genre "Podcast" ou s'il est dans un dossier "podcast"), grille ou
  liste, recherche (sans accents) et tri
- **Fiche media** : affiche et fond TMDB, synopsis, infos techniques, correction
  manuelle de la correspondance TMDB
- **Decouvrir** : films a voir selon TMDB (tendances, au cinema, a venir,
  populaires, mieux notes), dans la bibliotheque ou non, avec synopsis, date de
  sortie, note, genres, duree, realisation et casting ; un film deja possede
  peut etre lu depuis sa fiche
- **Themes** : Systeme / Clair / Sombre / Cinema / Metro
  (`renderer/src/theme/themes.ts`, un theme = un jeu de variables CSS) ; Metro a
  une animation d'activation et un bouton pour passer aux Dark Ones et a la Ligne
  Rouge, chacun avec la sienne (images optionnelles, voir
  `renderer/public/metro/README.md`)

## Structure du projet

```
Epikodi/
├─ main/        # Processus principal Electron (fenetre, IPC, acces disque)
├─ renderer/    # Application React (Vite) affichee dans la fenetre
├─ shared/      # Types et contrats partages entre main et renderer
└─ dist/        # Sortie de build (main) - genere, non versionne
```

Communication renderer <-> main via IPC type (`contextBridge` dans
`main/preload.ts`), sans activer `nodeIntegration` dans le renderer.

## Prerequis

- Node.js >= 20
- npm >= 10
- FFmpeg (fournit `ffprobe` et `ffmpeg`), accessible dans le `PATH` -
  detecte le format/codec des fichiers choisis (Issue 2.3) et sert de
  fallback de transcodage vers MP4 H.264/AAC quand la lecture directe n'est
  pas possible (Issue 2.4). Deja installe dans l'image Docker. En local :
  `apt install ffmpeg` / `brew install ffmpeg` / binaires Windows sur
  ffmpeg.org. Chemins custom possibles via les variables d'env
  `FFPROBE_PATH` / `FFMPEG_PATH`.
- Outils de compilation natifs (`python3`, un compilateur C/C++) - requis par
  `better-sqlite3` si aucun binaire precompile n'est disponible pour ta
  plateforme/version de Node. Deja installes dans l'image Docker
  (`build-essential`, `python3`). En local : `apt install build-essential
  python3` / Xcode Command Line Tools sur macOS / "Desktop development with
  C++" sur Windows.

## Installation

```bash
npm install
```

### Cle TMDB (optionnelle)

Sans cle, tout fonctionne sauf l'enrichissement des films et la section
Decouvrir. Pour les activer :

1. creer un compte sur [themoviedb.org](https://www.themoviedb.org/) puis une
   cle d'API dans *Parametres > API* ;
2. `cp .env.example .env` et renseigner `TMDB_API_KEY` (cle v3) **ou**
   `TMDB_ACCESS_TOKEN` (jeton v4) ; `TMDB_LANGUAGE` (defaut `fr-FR`) regle la
   langue des titres et synopsis ;
3. relancer l'app puis **Rescanner** les sources : les films pas encore
   recherches sont envoyes a TMDB.

Le titre et l'annee sont deduits du nom de fichier (`Inception.2010.1080p.mkv`
→ *Inception*, 2010). Un film n'est associe que si le titre correspond
vraiment : les videos perso restent sans fiche. Les reponses et les images
sont mises en cache (base SQLite + dossier `tmdb/` dans les donnees de l'app),
donc un rescan ne refait pas les requetes. Si un film est mal reconnu, ouvrir
sa fiche et utiliser **Corriger la fiche TMDB**.

(installe les dependances racine + celles du workspace `renderer`, puis
recompile `better-sqlite3` pour l'ABI d'Electron via le script `postinstall`)

## Developpement

```bash
npm run dev
```

Lance en parallele : le serveur Vite (renderer), la compilation watch du
`main` (TypeScript) et Electron, qui attend que les deux soient prets.

## Build

```bash
npm run build
```

Compile `main/` (TypeScript -> `dist/main`) et build `renderer/` (Vite ->
`renderer/dist`).

```bash
npm start
```

Lance Electron sur le build compile (`dist/main/index.js`).

## Qualite de code

```bash
npm run lint          # oxlint (main, shared) + lint du renderer
npm run format        # prettier --write
npm run format:check  # prettier --check (utilise par la CI)
```

La CI GitHub Actions (`.github/workflows/ci.yml`) lance `format:check`, `lint`
et `build` sur chaque push et pull request.

## Lancer avec Docker

Electron est une appli GUI : le conteneur tourne sur un ecran virtuel (Xvfb)
et l'expose dans le navigateur via noVNC, donc aucun serveur X requis sur la
machine hote (fonctionne pareil sous Linux/macOS/Windows).

```bash
docker compose up --build
```

Puis ouvrir **http://localhost:6080** (redirige automatiquement vers le
viewer noVNC) pour voir et utiliser la fenetre EpiKodi comme en local.

- Le code source est monte en volume : `npm run dev` tourne a l'interieur
  (Vite + tsc watch + Electron), donc le hot-reload fonctionne normalement
  en editant les fichiers sur l'hote.
- `node_modules` est gere dans un volume Docker a part (pas celui de l'hote),
  pour rester coherent avec l'OS/l'archi du conteneur.
- `docker compose down` pour arreter, `docker compose up --build` pour
  reconstruire apres un changement de `package.json` ou du `Dockerfile`.

**A maintenir a jour au fil du backlog** : `Dockerfile` installe deja
FFmpeg (Issue 2.3/2.4) et les outils de build pour `better-sqlite3`
(Issue 3.1). Si une prochaine issue ajoute une dependance systeme (ex. un
paquet `apt` pour un lecteur de sous-titres, un driver reseau, etc.),
l'ajouter dans `Dockerfile` et relancer `docker compose up --build`.
