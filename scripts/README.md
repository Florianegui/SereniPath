# Scripts de scraping - Données Anxiété France

## 📋 Description

Scripts pour collecter automatiquement des données sur l'anxiété en France depuis diverses sources publiques.

## 🚀 Utilisation

### Scraping des données d'anxiété

```bash
npm run scrape-anxiety
```

ou directement :

```bash
node scripts/scrape-anxiety-data.js
```

## 📁 Structure des données

Les données sont sauvegardées dans `data/anxiety-stats/anxiety-data.json` :

```json
{
  "scrapedAt": "2025-02-06T...",
  "sources": {
    "dataGouv": { ... },
    "insee": { ... },
    "santePublique": { ... },
    "transports": { ... }
  }
}
```

## 🔧 Configuration

### Sources disponibles

1. **data.gouv.fr** - Datasets ouverts sur la santé mentale
2. **INSEE** - Données démographiques et densité
3. **Santé Publique France** - Statistiques santé mentale
4. **Île-de-France Mobilités** - Données transports

### Notes importantes

- Certains sites peuvent avoir des protections anti-scraping
- Pour les données INSEE, obtenir une clé API officielle : https://api.insee.fr/
- Respecter les conditions d'utilisation de chaque source
- Ne pas surcharger les serveurs (délais entre requêtes)

## 📊 Utilisation des données

Les données collectées peuvent être utilisées pour :

- Mettre à jour le document `docs/ANXIETE-FRANCE.md`
- Alimenter une base de données locale
- Générer des visualisations
- Améliorer les recommandations de SereniPath

## 🔄 Automatisation

Pour automatiser le scraping (ex: mensuel), utiliser un cron job ou un scheduler :

```bash
# Exemple cron (1er de chaque mois à 2h du matin)
0 2 1 * * cd /path/to/SereniPathh && npm run scrape-anxiety
```

## ⚠️ Limitations

- Certains sites nécessitent une authentification
- Les données peuvent être protégées par des CAPTCHA
- Respecter les robots.txt de chaque site
- Certaines données peuvent nécessiter un accès manuel

## 📝 Logs

Le script affiche les logs dans la console :
- ✅ Succès pour chaque source
- ❌ Erreurs avec messages détaillés
- 📊 Statistiques collectées
