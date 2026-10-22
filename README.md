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
