// Utiliser tfjs standard (sans -node) pour compatibilité cross-platform
const tf = require('@tensorflow/tfjs');
const dataPreprocessor = require('./preprocesseurDonnees');
const weatherService = require('./serviceMeteo');
const fs = require('fs');
const path = require('path');

/**
 * Modèle de Machine Learning pour prédire l'anxiété
 * Utilise TensorFlow.js pour l'entraînement et les prédictions
 */
class AnxietyPredictor {
  constructor() {
    this.regressionModel = null;
    this.classificationModel = null;
    this.isTraining = false;
    this.modelPath = path.join(__dirname, '../../models');
    this.ensureModelDirectory();
  }

  ensureModelDirectory() {
    if (!fs.existsSync(this.modelPath)) {
      fs.mkdirSync(this.modelPath, { recursive: true });
    }
  }

  /**
   * Crée le modèle de régression pour prédire le niveau d'anxiété
   */
  createRegressionModel() {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [14], // Nombre de caractéristiques
          units: 64,
          activation: 'relu',
          kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
        }),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({
          units: 32,
          activation: 'relu',
          kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 16,
          activation: 'relu'
        }),
        tf.layers.dense({
          units: 1, // Sortie: niveau d'anxiété (1-5)
          activation: 'sigmoid'
        })
      ]
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });

    return model;
  }

  /**
   * Crée le modèle de classification pour identifier les zones à risque
   */
  createClassificationModel() {
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [10], // Caractéristiques simplifiées pour les zones
          units: 32,
          activation: 'relu'
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 16,
          activation: 'relu'
        }),
        tf.layers.dense({
          units: 3, // 3 classes: safe, moderate, risky
          activation: 'softmax'
        })
      ]
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    return model;
  }

  /**
   * Entraîne le modèle de régression sur les données utilisateur
   */
  async trainRegressionModel(userId, epochs = 50) {
    if (this.isTraining) {
      throw new Error('Model is already training');
    }

    try {
      this.isTraining = true;
      console.log(`Training regression model for user ${userId}...`);

      // Récupérer les données d'entraînement
      const trainingData = await dataPreprocessor.getTrainingData(userId);
      
      if (trainingData.length < 10) {
        console.log('Not enough training data. Using default model.');
        this.regressionModel = this.createRegressionModel();
        return { success: false, message: 'Not enough data', dataPoints: trainingData.length };
      }

      // Séparer les données avec et sans labels
      const labeledData = trainingData.filter(d => d.anxietyLevel !== null);
      const unlabeledData = trainingData.filter(d => d.anxietyLevel === null);

      if (labeledData.length < 5) {
        console.log('Not enough labeled data. Using default model.');
        this.regressionModel = this.createRegressionModel();
        return { success: false, message: 'Not enough labeled data', dataPoints: labeledData.length };
      }

      // Préparer les données d'entraînement
      const features = labeledData.map(d => {
        const normalized = dataPreprocessor.normalizeFeatures(d);
        return [
          normalized.hour,
          normalized.dayOfWeek,
          normalized.isWeekend,
          normalized.isRushHour,
          normalized.distance,
          normalized.densityScore,
          normalized.temperature,
          normalized.humidity,
          normalized.visibility,
          normalized.weatherCode,
          normalized.isRainy,
          normalized.isSnowy,
          normalized.isCloudy,
          normalized.transportMode
        ];
      });

      const labels = labeledData.map(d => (d.anxietyLevel - 1) / 4); // Normaliser entre 0 et 1

      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels, [labels.length, 1]);

      // Créer le modèle
      this.regressionModel = this.createRegressionModel();

      // Entraîner le modèle
      const history = await this.regressionModel.fit(xs, ys, {
        epochs: epochs,
        batchSize: Math.min(32, Math.floor(labeledData.length / 2)),
        validationSplit: 0.2,
        shuffle: true,
        verbose: 1
      });

      // Nettoyer les tenseurs
      xs.dispose();
      ys.dispose();

      // Sauvegarder le modèle
      await this.saveModel(`regression_${userId}`);

      console.log('Regression model trained successfully');

      return {
        success: true,
        epochs: epochs,
        dataPoints: labeledData.length,
        finalLoss: history.history.loss[history.history.loss.length - 1],
        finalMae: history.history.mae ? history.history.mae[history.history.mae.length - 1] : null
      };
    } catch (error) {
      console.error('Error training regression model:', error);
      throw error;
    } finally {
      this.isTraining = false;
    }
  }

  /**
   * Prédit le niveau d'anxiété pour un trajet donné
   */
  async predictAnxiety(userId, routeData) {
    try {
      // Charger le modèle si nécessaire
      if (!this.regressionModel) {
        await this.loadModel(`regression_${userId}`);
      }

      // Si pas de modèle, utiliser un modèle par défaut
      if (!this.regressionModel) {
        this.regressionModel = this.createRegressionModel();
      }

      // Récupérer les données météo
      const weather = await weatherService.getWeather(
        routeData.startLat,
        routeData.startLng
      );

      // Préparer les caractéristiques
      const features = {
        hour: routeData.hour || new Date().getHours(),
        dayOfWeek: routeData.dayOfWeek || new Date().getDay(),
        isWeekend: (routeData.dayOfWeek === 0 || routeData.dayOfWeek === 6) ? 1 : 0,
        isRushHour: ((routeData.hour >= 7 && routeData.hour <= 9) || 
                     (routeData.hour >= 17 && routeData.hour <= 19)) ? 1 : 0,
        distance: routeData.distance || 0,
        densityScore: routeData.densityScore || 50,
        temperature: weather.temperature,
        humidity: weather.humidity,
        visibility: weather.visibility,
        weatherCode: weather.weatherCode,
        isRainy: weather.isRainy ? 1 : 0,
        isSnowy: weather.isSnowy ? 1 : 0,
        isCloudy: weather.isCloudy ? 1 : 0,
        transportMode: routeData.transportMode || 0
      };

      const normalized = dataPreprocessor.normalizeFeatures(features);
      const featureArray = [
        normalized.hour,
        normalized.dayOfWeek,
        normalized.isWeekend,
        normalized.isRushHour,
        normalized.distance,
        normalized.densityScore,
        normalized.temperature,
        normalized.humidity,
        normalized.visibility,
        normalized.weatherCode,
        normalized.isRainy,
        normalized.isSnowy,
        normalized.isCloudy,
        normalized.transportMode
      ];

      const xs = tf.tensor2d([featureArray]);
      const prediction = this.regressionModel.predict(xs);
      const value = await prediction.data();
      xs.dispose();
      prediction.dispose();

      // Dénormaliser (0-1 -> 1-5)
      const anxietyLevel = Math.round((value[0] * 4) + 1);
      const anxietyScore = Math.min(5, Math.max(1, anxietyLevel));

      return {
        anxietyLevel: anxietyScore,
        anxietyMood: dataPreprocessor.numberToMood(anxietyScore),
        confidence: this.calculateConfidence(value[0]),
        factors: this.analyzeFactors(features)
      };
    } catch (error) {
      console.error('Error predicting anxiety:', error);
      // Retourner une prédiction par défaut en cas d'erreur
      return {
        anxietyLevel: 3,
        anxietyMood: 'okay',
        confidence: 0.5,
        factors: []
      };
    }
  }

  /**
   * Identifie les zones à risque (classification)
   */
  async classifyZoneRisk(zoneData) {
    try {
      if (!this.classificationModel) {
        this.classificationModel = this.createClassificationModel();
      }

      const features = [
        zoneData.densityScore / 100,
        zoneData.hour / 23,
        zoneData.dayOfWeek / 6,
        (zoneData.dayOfWeek === 0 || zoneData.dayOfWeek === 6) ? 1 : 0,
        ((zoneData.hour >= 7 && zoneData.hour <= 9) || 
         (zoneData.hour >= 17 && zoneData.hour <= 19)) ? 1 : 0,
        zoneData.temperature / 50,
        zoneData.humidity / 100,
        zoneData.visibility / 20,
        zoneData.weatherCode / 5,
        zoneData.isRainy ? 1 : 0
      ];

      const xs = tf.tensor2d([features]);
      const prediction = this.classificationModel.predict(xs);
      const probabilities = await prediction.data();
      xs.dispose();
      prediction.dispose();

      const classes = ['safe', 'moderate', 'risky'];
      const maxIndex = probabilities.indexOf(Math.max(...probabilities));

      return {
        riskLevel: classes[maxIndex],
        confidence: probabilities[maxIndex],
        probabilities: {
          safe: probabilities[0],
          moderate: probabilities[1],
          risky: probabilities[2]
        }
      };
    } catch (error) {
      console.error('Error classifying zone risk:', error);
      return {
        riskLevel: 'moderate',
        confidence: 0.5,
        probabilities: { safe: 0.33, moderate: 0.34, risky: 0.33 }
      };
    }
  }

  /**
   * Clustering pour détecter des patterns similaires entre utilisateurs
   */
  async clusterUsers(k = 3) {
    try {
      const allData = await dataPreprocessor.getAllUsersTrainingData(1000);
      
      if (allData.length < k * 2) {
        return { clusters: [], message: 'Not enough data for clustering' };
      }

      // K-means simplifié (implémentation basique)
      const features = allData.map(d => [
        d.hour / 23,
        d.dayOfWeek / 6,
        d.distance / 50,
        d.densityScore / 100
      ]);

      // Initialiser les centroïdes aléatoirement
      const centroids = [];
      for (let i = 0; i < k; i++) {
        const randomIndex = Math.floor(Math.random() * features.length);
        centroids.push([...features[randomIndex]]);
      }

      // Itérations K-means
      let clusters = Array(allData.length).fill(0);
      for (let iter = 0; iter < 10; iter++) {
        // Assigner chaque point au centroïde le plus proche
        for (let i = 0; i < features.length; i++) {
          let minDist = Infinity;
          let closestCentroid = 0;
          for (let j = 0; j < centroids.length; j++) {
            const dist = this.euclideanDistance(features[i], centroids[j]);
            if (dist < minDist) {
              minDist = dist;
              closestCentroid = j;
            }
          }
          clusters[i] = closestCentroid;
        }

        // Mettre à jour les centroïdes
        for (let j = 0; j < k; j++) {
          const clusterPoints = features.filter((_, i) => clusters[i] === j);
          if (clusterPoints.length > 0) {
            centroids[j] = clusterPoints[0].map((_, dim) => {
              return clusterPoints.reduce((sum, point) => sum + point[dim], 0) / clusterPoints.length;
            });
          }
        }
      }

      // Analyser les clusters
      const clusterAnalysis = [];
      for (let j = 0; j < k; j++) {
        const clusterUsers = allData.filter((_, i) => clusters[i] === j);
        clusterAnalysis.push({
          clusterId: j,
          size: clusterUsers.length,
          avgDensity: clusterUsers.reduce((sum, d) => sum + d.densityScore, 0) / clusterUsers.length,
          avgHour: clusterUsers.reduce((sum, d) => sum + d.hour, 0) / clusterUsers.length,
          avgDistance: clusterUsers.reduce((sum, d) => sum + d.distance, 0) / clusterUsers.length
        });
      }

      return {
        clusters: clusterAnalysis,
        userAssignments: clusters
      };
    } catch (error) {
      console.error('Error clustering users:', error);
      return { clusters: [], error: error.message };
    }
  }

  euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
  }

  /**
   * Calcule la confiance de la prédiction
   */
  calculateConfidence(predictionValue) {
    // Plus la valeur est proche de 0 ou 1, plus la confiance est élevée
    const distanceFromCenter = Math.abs(predictionValue - 0.5);
    return Math.min(1, distanceFromCenter * 2);
  }

  /**
   * Analyse les facteurs contribuant à l'anxiété
   */
  analyzeFactors(features) {
    const factors = [];
    
    if (features.densityScore > 70) {
      factors.push({ factor: 'densité élevée', impact: 'high' });
    }
    if (features.isRushHour) {
      factors.push({ factor: 'heure de pointe', impact: 'medium' });
    }
    if (features.isRainy || features.isSnowy) {
      factors.push({ factor: 'mauvais temps', impact: 'medium' });
    }
    if (features.visibility < 5) {
      factors.push({ factor: 'visibilité réduite', impact: 'medium' });
    }
    if (features.distance > 10) {
      factors.push({ factor: 'trajet long', impact: 'low' });
    }

    return factors;
  }

  /**
   * Sauvegarde le modèle
   */
  async saveModel(modelName) {
    try {
      const savePath = path.join(this.modelPath, modelName);
      await this.regressionModel.save(`file://${savePath}`);
      console.log(`Model saved to ${savePath}`);
    } catch (error) {
      console.error('Error saving model:', error);
    }
  }

  /**
   * Charge le modèle
   */
  async loadModel(modelName) {
    try {
      const loadPath = path.join(this.modelPath, modelName);
      if (fs.existsSync(loadPath)) {
        this.regressionModel = await tf.loadLayersModel(`file://${loadPath}/model.json`);
        console.log(`Model loaded from ${loadPath}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading model:', error);
      return false;
    }
  }
}

module.exports = new AnxietyPredictor();
