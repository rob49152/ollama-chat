// config/config-manager.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Config file path
const CONFIG_FILE_PATH = path.join(__dirname, '..', 'config.json');

// Default configuration using environment variables
let config = {
  ollamaApiUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434/api',
  defaultModel: '',  // No default model - will be loaded from file or selected by user
  temperature: 0.7,
  maxTokens: 2000,
  contextMessages: 4
};

/**
 * Initialize configuration from file or create default
 */
function initConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      loadConfigFromFile();
    } else {
      autoSelectDefaultModel();
    }
  } catch (error) {
    console.error('Error handling configuration file:', error);
  }
}

/**
 * Load configuration from file
 */
function loadConfigFromFile() {
  try {
    const configFile = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    const fileConfig = JSON.parse(configFile);

    // Merge with environment variables (environment takes precedence for API URL)
    config = {
      ...fileConfig,
      ollamaApiUrl: process.env.OLLAMA_API_URL || fileConfig.ollamaApiUrl
    };

    console.log('Configuration loaded from file:');
    console.log('- Using model:', config.defaultModel || 'No model specified');
    console.log('- API URL:', config.ollamaApiUrl);
  } catch (error) {
    console.error('Error loading config from file:', error);
  }
}

/**
 * Auto-select a default model from available models
 */
function autoSelectDefaultModel() {
  // Try to get available models to suggest a default using promises instead of await
  axios.get(`${config.ollamaApiUrl}/tags`)
    .then(modelResponse => {
      const availableModels = modelResponse.data.models || [];

      if (availableModels.length > 0) {
        // Use the first available model as default
        config.defaultModel = availableModels[0].name;
        console.log(`No config file found. Auto-selected model: ${config.defaultModel}`);

        // Save updated config
        saveConfig(config);
      } else {
        console.log('No models found on Ollama server. User will need to configure.');
        // Save default config anyway
        saveConfig(config);
      }
    })
    .catch(modelError => {
      console.error('Could not fetch models from Ollama:', modelError.message);
      // Save default config anyway
      saveConfig(config);
    });

  console.log('Initial configuration saved to file');
}

/**
 * Save configuration to file
 * @param {Object} configToSave - Configuration object to save
 */
function saveConfig(configToSave) {
  try {
    // Ensure the API URL from environment is preserved
    const mergedConfig = {
      ...configToSave,
      ollamaApiUrl: process.env.OLLAMA_API_URL || configToSave.ollamaApiUrl
    };

    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(mergedConfig, null, 2));
    config = mergedConfig;
  } catch (error) {
    console.error('Error saving config to file:', error);
  }
}

/**
 * Update configuration
 * @param {Object} updates - Configuration updates
 * @returns {Object} Updated configuration
 */
function updateConfig(updates) {
  const oldModel = config.defaultModel;

  // Merge updates, preserving environment variables
  config = {
    ...config,
    ...updates,
    ollamaApiUrl: process.env.OLLAMA_API_URL || updates.ollamaApiUrl || config.ollamaApiUrl
  };

  // Log configuration changes for debugging
  console.log('Configuration updated:');
  console.log('- Old model:', oldModel);
  console.log('- New model:', config.defaultModel);
  console.log('- API URL:', config.ollamaApiUrl);

  // Save to file
  saveConfig(config);

  return config;
}

/**
 * Get current configuration
 * @returns {Object} Current configuration
 */
function getConfig() {
  return config;
}

/**
 * Read config directly from file
 * @returns {Object} Configuration from file
 */
function getConfigFromFile() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));

      // Merge with environment variables
      return {
        ...fileConfig,
        ollamaApiUrl: process.env.OLLAMA_API_URL || fileConfig.ollamaApiUrl
      };
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }
  return {};
}

module.exports = {
  initConfig,
  getConfig,
  updateConfig,
  saveConfig,
  getConfigFromFile,
  CONFIG_FILE_PATH
};