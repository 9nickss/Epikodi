# EpiKodi

Centre multimedia desktop (type Kodi) : lecture et organisation de videos,
musique, podcasts et medias numeriques en local et sur le reseau.

Projet Epitech - MVP sur ~5 jours-homme. Voir [`EPIKODI_ISSUES.md`](../EPIKODI_ISSUES.md)
pour le backlog detaille.

## Stack

- **Electron** + **React** (Vite) pour l'interface
- **TypeScript** partout (main, renderer, shared)
- **FFmpeg / ffprobe** pour le traitement multimedia (a venir, Issue 2/3)
- **SQLite** (better-sqlite3) pour les metadonnees (a venir, Issue 3)
- **TMDB** pour l'enrichissement des fiches films (a venir, Issue 5)

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

## Installation

```bash
npm install
```

(installe les dependances racine + celles du workspace `renderer`)

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
npm run lint     # oxlint (main, shared) + lint du renderer
npm run format   # prettier --write
```

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
