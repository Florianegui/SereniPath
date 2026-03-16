/**
 * Analyse de sentiment sur texte (FR/EN).
 * Utilisé pour Twitter, avis Google, forums.
 */
const Sentiment = require('sentiment');

const sentiment = new Sentiment();

// Vocabulaire français courant pour améliorer le score (sentiment utilise AFINN anglais par défaut)
const frenchPositive = [
  'bien', 'bon', 'super', 'excellent', 'génial', 'parfait', 'calme', 'serein', 'agréable',
  'accueillant', 'propre', 'sûr', 'tranquille', 'recommandé', 'top', 'sympa', 'cool'
];
const frenchNegative = [
  'mal', 'mauvais', 'nul', 'dangereux', 'bruyant', 'sale', 'bondé', 'stressant', 'éviter',
  'déconseillé', 'agressif', 'anxiété', 'peur', 'problème', 'incident', 'agression'
];

/**
 * Analyse le sentiment d'un texte.
 * @param {string} text - Texte à analyser
 * @returns {{ score: number, label: string, comparative: number, keywords: string[] }}
 */
function analyzeText(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, label: 'neutre', comparative: 0, keywords: [] };
  }
  const trimmed = text.trim();
  if (!trimmed.length) return { score: 0, label: 'neutre', comparative: 0, keywords: [] };

  const result = sentiment.analyze(trimmed);
  let score = result.comparative !== undefined ? Math.round(result.comparative * 10) : result.score || 0;
  const tokens = (result.tokens || []).filter(t => t.length > 2);

  // Ajustement pour mots français
  const lower = trimmed.toLowerCase();
  for (const w of frenchPositive) {
    if (lower.includes(w)) score += 1;
  }
  for (const w of frenchNegative) {
    if (lower.includes(w)) score -= 1;
  }

  score = Math.max(-10, Math.min(10, score));
  let label = 'neutre';
  if (score > 2) label = 'positif';
  else if (score < -2) label = 'négatif';

  // Mots significatifs (positifs/négatifs ou longs)
  const keywords = [...new Set(
    (result.positive || []).concat(result.negative || [])
      .concat(tokens.filter(t => t.length > 4).slice(0, 5))
  )].slice(0, 10);

  return {
    score,
    label,
    comparative: result.comparative || 0,
    keywords
  };
}

/**
 * Agrège le sentiment de plusieurs textes (ex: plusieurs avis).
 */
function aggregateSentiment(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { score: 0, label: 'neutre', count: 0, samples: [] };
  }
  const results = texts.map(t => analyzeText(t));
  const sum = results.reduce((acc, r) => acc + r.score, 0);
  const avg = sum / results.length;
  let label = 'neutre';
  if (avg > 0.5) label = 'positif';
  else if (avg < -0.5) label = 'négatif';

  return {
    score: Math.round(avg * 10) / 10,
    label,
    count: results.length,
    samples: results.slice(0, 5).map(r => ({ score: r.score, label: r.label, keywords: r.keywords }))
  };
}

module.exports = {
  analyzeText,
  aggregateSentiment
};
