# Stockr — Gestion de dépôt

## Installation

```bash
npm install
npm run dev
```

## Configuration

Le fichier `.env` contient déjà les clés Supabase.
Remplace `REMPLACE_PAR_TA_NOUVELLE_CLE` par ta nouvelle clé Anthropic
une fois générée sur console.anthropic.com.

## Build pour GitHub Pages (APK via PWABuilder)

```bash
npm run build
```

Le dossier `dist/` est prêt à être déployé sur GitHub Pages.

### Déploiement GitHub Pages

1. Crée un repo GitHub (ex: `stockr`)
2. Push le code
3. Va dans Settings → Pages → Source → GitHub Actions
4. Crée `.github/workflows/deploy.yml` :

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_ANTHROPIC_API_KEY: ${{ secrets.VITE_ANTHROPIC_API_KEY }}
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

5. Ajoute les 3 secrets dans Settings → Secrets → Actions
6. Une fois déployé, va sur **PWABuilder.com** avec l'URL GitHub Pages → génère l'APK

### Installer l'APK sur Android

1. Télécharge le `.apk` depuis PWABuilder
2. Active "Sources inconnues" sur les téléphones
3. Installe le fichier → icône Stockr sur l'écran d'accueil

## Premier admin

Après inscription du premier utilisateur, mets-le admin via Supabase :
Table Editor → profiles → change `role` = `admin` pour ce user.
Ensuite l'admin peut gérer les rôles depuis l'app.

## Fonctionnalités

- **Dépôt** : grille visuelle 12×8, étagères, sections, produits, QR codes imprimables
- **Calcul W** : catalogue projecteurs, calcul circuit, lecture fiche PDF/photo (IA)
- **Auth** : inscription/connexion, 3 rôles Admin/Éditeur/Lecteur
- **Sync temps réel** via Supabase Realtime
- **PWA** installable comme APK Android
