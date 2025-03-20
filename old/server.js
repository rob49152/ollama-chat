// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const axios = require('axios');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import database module
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Config file path
const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');

// Default configuration - empty placeholders
let config = {
  ollamaApiUrl: 'http://localhost:11434/api',
  defaultModel: 'technobyte/Llama-3.3-70B-Abliterated:IQ2_XS',  // No hardcoded default model - will be loaded from file or selected by user
  temperature: 0.7,
  maxTokens: 2000,
  contextMessages: 4  // Default number of previous messages to include
};

// Load configuration if exists
try {
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    const configFile = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    config = JSON.parse(configFile);
    console.log('Configuration loaded from file:');
    console.log('- Using model:', config.defaultModel || 'No model specified');
    console.log('- API URL:', config.ollamaApiUrl);
  } else {
    // Try to get available models to suggest a default using promises instead of await
    axios.get(`${config.ollamaApiUrl}/tags`)
      .then(modelResponse => {
        const availableModels = modelResponse.data.models || [];

        if (availableModels.length > 0) {
          // Use the first available model as default
          config.defaultModel = availableModels[0].name;
          console.log(`No config file found. Auto-selected model: ${config.defaultModel}`);

          // Save updated config
          fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
        } else {
          console.log('No models found on Ollama server. User will need to configure.');
          // Save default config anyway
          fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
        }
      })
      .catch(modelError => {
        console.error('Could not fetch models from Ollama:', modelError.message);
        // Save default config anyway
        fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
      });

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('New client connected');

  // Initialize hashtags storage in the socket
  socket.currentHashtags = [];

  // Send current configuration to client
  socket.emit('configUpdate', config);

  // Test socket connection
  socket.on('testConnection', (data) => {
    console.log('Received test connection from client:', data);
    socket.emit('testResponse', {
      received: true,
      serverTime: new Date().toISOString()
    });
  });

  socket.on('sendMessage', async (message) => {
    // Variable to store message ID for later use with response
    let userMessageId = null;
    let modelToUse = '';

    try {
      // Always get the very latest config directly
      const currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
      const modelName = currentConfig.defaultModel || '';
      const apiUrl = currentConfig.ollamaApiUrl || 'http://localhost:11434/api';
      const temperature = parseFloat(currentConfig.temperature || 0.7);
      const maxTokens = parseInt(currentConfig.maxTokens || 2000, 10);

      // Check if model is empty
      if (!modelName || modelName.trim() === '') {
        // Try to get first available model
        try {
          const modelCheckResponse = await axios.get(`${apiUrl}/tags`);
          const availableModels = modelCheckResponse.data.models || [];
          if (availableModels.length > 0) {
            // Use first available model
            const autoModel = availableModels[0].name;
            console.log(`No model specified, using first available: ${autoModel}`);

            // Update config with this model
            currentConfig.defaultModel = autoModel;
            fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(currentConfig, null, 2));

            // Notify all clients
            io.emit('configUpdate', currentConfig);

            // Continue with this model
            modelToUse = autoModel;
          } else {
            socket.emit('messageResponse', {
              role: 'assistant',
              content: `Error: No model configured and no models found on Ollama server. Please set a model in the settings.`
            });
            return;
          }
        } catch (error) {
          socket.emit('messageResponse', {
            role: 'assistant',
            content: `Error: No model configured. Please set a model in the settings.`
          });
          return;
        }
      } else {
        modelToUse = modelName;
      }

      // Log details for debugging
      console.log('==========================================');
      console.log('SENDING REQUEST TO OLLAMA:');
      console.log(`- Message: ${message.substring(0, 30)}...`);
      console.log(`- Using model: ${modelToUse}`);
      console.log(`- API URL: ${apiUrl}`);
      console.log(`- Full endpoint: ${apiUrl}/generate`);

      // Save user message to database
      try {
        // Get current hashtags for storage with message
        const tagsToSave = socket.currentHashtags || [];
        console.log(`Saving user message with ${tagsToSave.length} tags:`, tagsToSave);

        userMessageId = await db.saveUserMessage(message, tagsToSave);
        console.log(`Saved user message to database with ID: ${userMessageId}`);
      } catch (dbError) {
        console.error('Error saving user message to database:', dbError);
        // Continue execution even if database save fails
      }

      // Check if model exists
      try {
        const modelCheckResponse = await axios.get(`${apiUrl}/tags`);
        const availableModels = modelCheckResponse.data.models || [];
        const modelNames = availableModels.map(m => m.name);

        console.log('- Available models on Ollama server:', modelNames.join(', '));

        if (!modelNames.includes(modelToUse)) {
          console.warn(`⚠️ WARNING: Model "${modelToUse}" not found on Ollama server!`);
          socket.emit('messageResponse', {
            role: 'assistant',
            content: `Error: Model "${modelToUse}" not found on the Ollama server. Available models are: ${modelNames.join(', ')}\n\nTo use this model, run this command in your terminal:\n\nollama pull ${modelToUse}`
          });
          return;
        }
      } catch (modelCheckError) {
        console.error('Error checking available models:', modelCheckError);
        // Continue anyway, as the model might exist even if we can't list models
      }

      // Build request payload with instructions for specific, fine-tuned hashtags
      const requestPayload = {
        model: modelToUse,
        prompt: message + "\n\nAfter your response, include 3-6 very specific single-word hashtags precisely related to the key topics discussed. Focus on technical terms, specific concepts, or domain-specific vocabulary. Avoid generic terms. Format exactly like this: '#HASHTAGS: #term1 #term2 #term3'",
        stream: false,
        temperature: temperature,
        max_tokens: maxTokens
      };

      console.log('***************************');
      console.log('COMPLETE REQUEST PAYLOAD:');
      console.log(JSON.stringify(requestPayload, null, 2));
      console.log('***************************');

      try {
        // Call Ollama API with latest configuration
        console.log(`Step 1: Making request to ${apiUrl}/generate at ${new Date().toISOString()}...`);
        const response = await axios.post(`${apiUrl}/generate`, requestPayload, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 120000 // Increase timeout to 120 seconds (2 minutes)
        });

        console.log(`Step 2: Received response from Ollama API at ${new Date().toISOString()}`);
        console.log('Response status:', response.status);
        console.log('Response headers:', JSON.stringify(response.headers));
        console.log('Response size:', response.data ? JSON.stringify(response.data).length : 'unknown');

        // Process the response
        if (response && response.data && response.data.response) {
          console.log('Step 3: Processing response data...');
          console.log('Response data preview:', response.data.response.substring(0, 100) + '...');
          await processOllamaResponse(response.data.response, socket, userMessageId);
          console.log('Step 4: Response processing complete');
        } else {
          console.error('Response received but data is invalid:', JSON.stringify(response.data));
          socket.emit('messageResponse', {
            role: 'assistant',
            content: 'Error: Received an invalid response from the Ollama server.'
          });
        }
      } catch (callError) {
        console.error('Error during API call to Ollama:', callError);
        if (callError.code === 'ECONNABORTED') {
          console.error('Request timed out - Ollama may still be processing the request');
          socket.emit('messageResponse', {
            role: 'assistant',
            content: 'Error: Request to Ollama timed out. The model might be too slow to respond or overloaded.'
          });
        } else {
          socket.emit('messageResponse', {
            role: 'assistant',
            content: `Error calling Ollama API: ${callError.message}`
          });
        }
      }
    } catch (error) {
      console.error('Error calling Ollama API:', error);

      let errorMessage = 'Error: Could not connect to Ollama server. Make sure it is running.';
      let modelName = 'unknown';

      // Try to extract model name from error message
      if (error.response && error.response.data && error.response.data.error) {
        const errorText = error.response.data.error;
        const modelMatch = errorText.match(/model ['"](.*?)['"] not found/);
        if (modelMatch && modelMatch[1]) {
          modelName = modelMatch[1];
        }
      }

      // Provide more detailed error information
      if (error.response) {
        // The request was made and the server responded with a status code
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);

        if (error.response.status === 404) {
          // Check if it's a model not found error
          const errorDetail = error.response.data && error.response.data.error
            ? error.response.data.error
            : 'Unknown 404 error';

          if (errorDetail.includes('not found') || errorDetail.includes('model')) {
            errorMessage = `Error 404: Model "${modelName}" not found. Please make sure you've pulled this model using 'ollama pull ${modelName}'`;
          } else {
            errorMessage = `Error 404: ${errorDetail}. API endpoint may be incorrect.`;
          }

          // Suggest command to pull model
          console.error(`Try running: ollama pull ${modelName}`);
        } else {
          errorMessage = `Error ${error.response.status}: ${JSON.stringify(error.response.data)}`;
        }
      } else if (error.request) {
        // The request was made but no response was received
        console.error('No response received:', error.request);
        errorMessage = 'No response received from Ollama server. Check if it\'s running and accessible.';
      } else {
        // Something happened in setting up the request
        console.error('Error setting up request:', error.message);
        errorMessage = `Error: ${error.message}`;
      }

      socket.emit('messageResponse', {
        role: 'assistant',
        content: errorMessage
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to chat with Ollama`);

  // Test Ollama connection at startup
  await testOllamaConnection();

  // Log database connection status
  try {
    // Test database connection by running a simple query
    const [rows] = await db.pool.query('SELECT 1 as test');
    console.log('✅ Successfully connected to MySQL database');
  } catch (error) {
    console.error('❌ Failed to connect to MySQL database:', error.message);
    console.log('Make sure your MySQL server is running and .env file is configured correctly');
    console.log('You can set up the database by running: npm run db-setup');
  }
});

// Helper functions for HTML generation
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTags(tagsJson) {
  try {
    const tags = JSON.parse(tagsJson);
    if (Array.isArray(tags)) {
      return tags.map(tag => `<span class="tag-pill">${tag}</span>`).join(' ');
    }
    return tagsJson;
  } catch (e) {
    return tagsJson;
  }
}

// Raw JSON output of database contents for API usage
app.get('/api/debug/database', async (req, res) => {
  try {
    // Get most recent conversations with a higher limit
    const [conversations] = await db.pool.query(`
      SELECT
        um.id AS message_id,
        um.message_content AS user_message,
        um.timestamp AS message_time,
        um.tags AS user_tags,
        or.id AS response_id,
        or.response_content AS ollama_response,
        or.timestamp AS response_time,
        or.tags AS response_tags
      FROM user_messages um
      LEFT JOIN ollama_responses or ON um.id = or.user_message_id
      ORDER BY um.timestamp DESC
      LIMIT 20
    `);

    // Process tags from JSON string
    conversations.forEach(conv => {
      try {
        if (conv.user_tags) {
          conv.user_tags = JSON.parse(conv.user_tags);
        }
        if (conv.response_tags) {
          conv.response_tags = JSON.parse(conv.response_tags);
        }
      } catch (e) {
        // Keep as is if parsing fails
      }
    });

    // Get tag statistics
    const [tags] = await db.pool.query(`
      SELECT tag_name, usage_count, first_used
      FROM tags
      ORDER BY usage_count DESC
    `);

    // Table counts
    const [counts] = await db.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM user_messages) AS userMessages,
        (SELECT COUNT(*) FROM ollama_responses) AS ollamaResponses,
        (SELECT COUNT(*) FROM tags) AS tags
    `);

    res.json({
      success: true,
      counts: counts[0],
      conversations,
      tags
    });

  } catch (error) {
    console.error('Error getting database debug data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

    console.log('Initial configuration saved to file');
  }
} catch (error) {
  console.error('Error handling configuration file:', error);
}

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Process Ollama response and extract hashtags
async function processOllamaResponse(assistantResponse, socket, userMessageId) {
  console.log('Starting to process Ollama response...');
  console.log('Response length:', assistantResponse.length);
  console.log('Response preview:', assistantResponse.substring(0, 500) + (assistantResponse.length > 500 ? '...' : ''));

  try {
    // Parse response to extract hashtags
    let content = assistantResponse;
    let hashtags = [];

    // Try different patterns for hashtags matching
    // First try the exact format we requested
    let hashtagMatch = assistantResponse.match(/#HASHTAGS:\s*([^]*?)(?=$|\n\n)/i);

    // If not found, try a more flexible approach to find any hashtags
    if (!hashtagMatch) {
      // Look for hashtags anywhere in the text (common at the end)
      const allHashtags = assistantResponse.match(/#\w+/g);
      if (allHashtags && allHashtags.length > 0) {
        hashtags = allHashtags;
        console.log('Found hashtags in text:', hashtags);
      } else {
        // Generate specific hashtags from the content
        console.log('No hashtags found, extracting specific entities from content...');

        // Initialize arrays for different types of entities
        const entities = {
          people: [],      // Who
          actions: [],     // What
          locations: [],   // Where
          timeReferences: [], // When
          concepts: []     // Why/How
        };

        // 1. Extract named entities (people, locations, organizations)
        // Look for capitalized words and phrases that aren't at the beginning of sentences
        const sentenceStarts = assistantResponse.match(/\.\s+[A-Z][a-z]+/g) || [];
        const sentenceStartWords = sentenceStarts.map(s => s.trim().split(/\s+/)[0]);

        // Extract potential named entities
        const namedEntityMatches = assistantResponse.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,2}\b/g) || [];

        // Filter out sentence starts and common words
        const commonWords = ["I", "We", "They", "The", "This", "That", "These", "Those", "It", "However", "Finally", "Additionally"];
        const namedEntities = namedEntityMatches.filter(entity =>
          !sentenceStartWords.includes(entity) &&
          !commonWords.includes(entity)
        );

        // Categorize entities
        namedEntities.forEach(entity => {
          // Simple heuristic: single words with certain endings are likely names
          if (entity.match(/\b[A-Z][a-z]*(?:son|sen|man|ez|berg|ton)\b/)) {
            entities.people.push(entity);
          }
          // Locations often have certain patterns
          else if (entity.match(/\b[A-Z][a-z]*(?:ville|town|city|land|ton|burg)\b/) ||
                   entity.match(/\b(?:North|South|East|West|New)\s+[A-Z][a-z]+\b/)) {
            entities.locations.push(entity);
          }
          // Default to people for remaining capitalized entities
          else {
            entities.people.push(entity);
          }
        });

        // 2. Extract action verbs (What)
        const verbPatterns = /\b(?:create|build|develop|implement|analyze|design|optimize|improve|launch|manage|establish|organize|conduct|research|present|investigate|resolve|process|execute|achieve|complete|deliver|maintain|update|configure|deploy|integrate)\b/gi;
        const verbMatches = assistantResponse.match(verbPatterns) || [];
        entities.actions = [...new Set(verbMatches.map(v => v.toLowerCase()))];

        // 3. Extract locations (Where) - additional patterns
        const locationPatterns = /\b(?:at|in|from|to)\s+(?:the\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/g;
        let locationMatch;
        while ((locationMatch = locationPatterns.exec(assistantResponse)) !== null) {
          if (locationMatch[1] && !commonWords.includes(locationMatch[1])) {
            entities.locations.push(locationMatch[1]);
          }
        }

        // 4. Extract time references (When)
        const timePatterns = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow|yesterday|last\s+(?:week|month|year)|next\s+(?:week|month|year)|[12][0-9]{3}|(?:19|20)\d{2})\b/gi;
        const timeMatches = assistantResponse.match(timePatterns) || [];
        entities.timeReferences = [...new Set(timeMatches.map(t => t.toLowerCase()))];

        // 5. Extract technical/domain concepts (Why/How)
        // Look for phrases with technical terms
        const technicalPatterns = /\b(?:algorithm|framework|protocol|system|platform|database|interface|architecture|process|methodology|standard|deployment|infrastructure|configuration|integration|optimization|component|module|function|variable|analysis|design pattern|pipeline|workflow|benchmark|performance|security|encryption|authentication|validation|verification|technology|innovation)\b/gi;
        const technicalMatches = assistantResponse.match(technicalPatterns) || [];
        entities.concepts = [...new Set(technicalMatches.map(c => c.toLowerCase()))];

        // Additional domain-specific terms
        const domainTerms = assistantResponse.match(/\b(?:[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z]{2,}[a-z]*)\b/g) || [];
        entities.concepts = [...entities.concepts, ...domainTerms];

        console.log('Extracted entities:', entities);

        // Combine and prioritize entities for hashtags
        const allExtractedEntities = [
          ...entities.people.slice(0, 2),           // Who
          ...entities.actions.slice(0, 2),          // What
          ...entities.locations.slice(0, 1),        // Where
          ...entities.timeReferences.slice(0, 1),   // When
          ...entities.concepts.slice(0, 3)          // Why/How
        ];

        // If we don't have enough specific entities, fall back to important words
        if (allExtractedEntities.length < 3) {
          // Analyze content for important words (excluding common words)
          const commonWords = ["the", "and", "that", "this", "with", "for", "from", "not", "are", "were", "have", "has", "had", "been", "was", "would", "will", "can", "could", "should", "but", "also"];

          // Break content into sentences to extract words with context
          const sentences = assistantResponse.split(/[.!?]\s+/);
          const words = sentences
            .flatMap(sentence => sentence.split(/\s+/))
            .map(word => word.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ""))
            .filter(word => word.length > 5 && !commonWords.includes(word));

          // Count word frequency
          const wordFrequency = {};
          words.forEach(word => {
            wordFrequency[word] = (wordFrequency[word] || 0) + 1;
          });

          // Sort by frequency and get top words
          const topWords = Object.entries(wordFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5 - allExtractedEntities.length)
            .map(entry => entry[0]);

          allExtractedEntities.push(...topWords);
        }

        // Convert entities to hashtags
        hashtags = [...new Set(allExtractedEntities)]  // Remove duplicates
          .filter(entity => entity && entity.length > 1)  // Skip empty or single-character entities
          .map(entity => {
            // Convert multi-word entities to camelCase
            const words = entity.split(/\s+/);
            if (words.length > 1) {
              const camelCase = words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
              return `#${camelCase}`;
            }
            return `#${entity.toLowerCase()}`;
          })
          .slice(0, 6);  // Maximum 6 hashtags

        console.log('Generated specific hashtags:', hashtags);
      }
    } else {
      // Extract just the hashtags part
      const hashtagText = hashtagMatch[1].trim();
      // Split by spaces and filter only hashtags, prefer single-word tags
      const extractedTags = hashtagText.split(/\s+/)
        .filter(tag => tag.startsWith('#'))
        .map(tag => {
          // Keep only the first word if there are multiple in one tag
          const singleWordTag = '#' + tag.replace('#', '').split(/[^a-zA-Z0-9]/)[0];
          return singleWordTag;
        });

      if (extractedTags.length > 0) {
        hashtags = extractedTags;
        // Remove the hashtags section from the main content
        content = assistantResponse.replace(hashtagMatch[0], '').trim();
        console.log('Extracted hashtags from #HASHTAGS section:', hashtags);
      }
    }

    // Filter out generic hashtags
    const genericTags = [
      '#general', '#info', '#facts', '#topic', '#discussion', '#help',
      '#question', '#answer', '#information', '#example', '#explanation',
      '#summary', '#overview', '#details', '#guide', '#tutorial'
    ];
    hashtags = hashtags.filter(tag => !genericTags.includes(tag.toLowerCase()));

    console.log('Final specific hashtags to send:', hashtags);

    // Save Ollama response to database
    try {
      if (userMessageId) {
        const responseId = await db.saveOllamaResponse(content, userMessageId, hashtags);
        console.log(`Saved Ollama response to database with ID: ${responseId}`);
      } else {
        console.log('No userMessageId available, skipping database save for this response');
      }
    } catch (dbError) {
      console.error('Error saving Ollama response to database:', dbError);
      // Continue execution even if database save fails
    }

    // Store the current hashtags in the socket for next message
    socket.currentHashtags = hashtags;

    // Send response back to client with hashtags
    console.log('Step 3.5: Sending response to client with', hashtags.length, 'hashtags');
    socket.emit('messageResponse', {
      role: 'assistant',
      content: content,
      hashtags: hashtags
    });

    console.log('Step 3.6: Response sent to client');
    return true;
  } catch (processingError) {
    console.error('Error processing Ollama response:', processingError);
    socket.emit('messageResponse', {
      role: 'assistant',
      content: 'Error processing the response from Ollama: ' + processingError.message
    });
    return false;
  }
}

// Test the connection to Ollama at startup
async function testOllamaConnection() {
  try {
    console.log(`Testing initial connection to Ollama server at ${config.ollamaApiUrl}...`);
    const response = await axios.get(`${config.ollamaApiUrl}/tags`);
    console.log('✅ Successfully connected to Ollama server');
    console.log('Available models:', response.data.models.map(model => model.name).join(', '));
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to Ollama server:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error(`Make sure Ollama is running at ${config.ollamaApiUrl.split('/api')[0]}`);
    }
    return false;
  }
}

// Add a test route to check Ollama connectivity
app.get('/test-ollama', async (req, res) => {
  try {
    console.log(`Testing connection to Ollama server at ${config.ollamaApiUrl}...`);
    const response = await axios.get(`${config.ollamaApiUrl}/tags`);
    console.log('Ollama server responded with:', response.status, response.data);
    res.json({
      success: true,
      message: 'Successfully connected to Ollama',
      data: response.data
    });
  } catch (error) {
    console.error('Error testing Ollama connection:', error);
    let errorDetails = {
      message: error.message
    };

    if (error.response) {
      errorDetails.status = error.response.status;
      errorDetails.data = error.response.data;
    } else if (error.request) {
      errorDetails.request = 'Request sent but no response received';
    }

    res.status(500).json({
      success: false,
      message: 'Failed to connect to Ollama',
      error: errorDetails
    });
  }
});

// Add endpoints for configuration
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', express.json(), (req, res) => {
  try {
    // Update config with new values
    const newConfig = req.body;
    const oldModel = config.defaultModel;
    config = { ...config, ...newConfig };

    // Log configuration changes for debugging
    console.log('Configuration updated:');
    console.log('- Old model:', oldModel);
    console.log('- New model:', config.defaultModel);
    console.log('- Full config:', config);

    // Save to file
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));

    // Notify all connected clients about the config change
    io.emit('configUpdate', config);

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      config
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update configuration',
      error: error.message
    });
  }
});

// Add endpoint to get available models
app.get('/api/models', async (req, res) => {
  try {
    const response = await axios.get(`${config.ollamaApiUrl}/tags`);
    const models = response.data.models || [];
    res.json({
      success: true,
      models: models.map(model => ({
        name: model.name,
        size: model.size,
        modified: model.modified
      }))
    });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch models',
      error: error.message
    });
  }
});

// Add endpoint to check if a model is installed
app.get('/api/check-model/:modelName', async (req, res) => {
  try {
    const { modelName } = req.params;

    // Check if model exists
    const response = await axios.get(`${config.ollamaApiUrl}/tags`);
    const models = response.data.models || [];
    const modelExists = models.some(model => model.name === modelName);

    if (modelExists) {
      res.json({
        success: true,
        message: `Model ${modelName} is installed`,
        modelDetails: models.find(model => model.name === modelName)
      });
    } else {
      res.json({
        success: false,
        message: `Model ${modelName} is not installed`,
        availableModels: models.map(m => m.name),
        pullCommand: `ollama pull ${modelName}`
      });
    }
  } catch (error) {
    console.error('Error checking model:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check if model exists',
      error: error.message
    });
  }
});

// Add endpoint to directly override model
app.post('/api/set-model', express.json(), (req, res) => {
  try {
    const { modelName } = req.body;

    if (!modelName) {
      return res.status(400).json({
        success: false,
        message: 'Model name is required'
      });
    }

    // Read the latest config
    let currentConfig = {};
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
      }
    } catch (error) {
      console.error('Error reading config:', error);
      // Continue with empty config
    }

    // Update model
    currentConfig.defaultModel = modelName;

    // Set defaults for missing fields
    if (!currentConfig.ollamaApiUrl) currentConfig.ollamaApiUrl = 'http://localhost:11434/api';
    if (!currentConfig.temperature) currentConfig.temperature = 0.7;
    if (!currentConfig.maxTokens) currentConfig.maxTokens = 2000;

    // Save config
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(currentConfig, null, 2));

    // Update in-memory config
    config = currentConfig;

    // Notify all clients
    io.emit('configUpdate', config);

    console.log(`Model directly set to: ${modelName}`);

    res.json({
      success: true,
      message: `Model set to ${modelName}`,
      config: currentConfig
    });
  } catch (error) {
    console.error('Error setting model:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set model',
      error: error.message
    });
  }
});

// Add a debugging route to check current configuration
app.get('/api/debug', (req, res) => {
  // Read directly from file to get the absolute latest
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }

  res.json({
    inMemoryConfig: config,
    fileConfig: fileConfig,
    configFile: fs.existsSync(CONFIG_FILE_PATH) ? 'exists' : 'not found',
    configPath: CONFIG_FILE_PATH
  });
});

// Add route to check for specific model errors
app.get('/api/run-diagnostics', async (req, res) => {
  console.log('=== RUNNING DIAGNOSTICS ===');

  // 1. Check config
  console.log('Current in-memory config:', config);

  // 2. Check config file
  let fileConfig = {};
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
      console.log('Config file contents:', fileConfig);
    } else {
      console.log('Config file does not exist at path:', CONFIG_FILE_PATH);
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }

  // 3. Try to get model list
  let modelList = [];
  try {
    const response = await axios.get(`${config.ollamaApiUrl}/tags`);
    modelList = response.data.models || [];
    console.log('Available models:', modelList.map(m => m.name));
  } catch (error) {
    console.error('Error fetching models:', error);
  }

  // 4. Search for hardcoded references
  console.log('Searching for any hardcoded model references in memory...');

  // 5. Check if config matches with what clients receive
  console.log('Model that will be used for next request:', config.defaultModel);

  // Return diagnostic info
  res.json({
    timeStamp: new Date().toISOString(),
    memoryConfig: config,
    fileConfig: fileConfig,
    availableModels: modelList.map(m => m.name),
    configFilePath: CONFIG_FILE_PATH,
    configFileExists: fs.existsSync(CONFIG_FILE_PATH),
    diagnosis: "Check server console for complete diagnostic information",
    recommendations: [
      "If you're still seeing 'llama2' in errors, restart the server after these changes",
      "Use the 'Emergency Model Fix' button to set the model directly",
      "Check if available models list includes your desired model"
    ]
  });
});

// API routes for database interaction
app.get('/api/tags', async (req, res) => {
  try {
    const tags = await db.getAllTags();
    res.json({
      success: true,
      tags: tags
    });
  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tags',
      error: error.message
    });
  }
});

app.get('/api/conversations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || 10, 10);
    const conversations = await db.getRecentConversations(limit);
    res.json({
      success: true,
      conversations: conversations
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations',
      error: error.message
    });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { tag } = req.query;
    if (!tag) {
      return res.status(400).json({
        success: false,
        message: 'Tag parameter is required'
      });
    }

    const results = await db.searchByTag(tag);
    res.json({
      success: true,
      results: results
    });
  } catch (error) {
    console.error('Error searching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search conversations',
      error: error.message
    });
  }
});

// Database debug endpoints
app.get('/debug/database', async (req, res) => {
  try {
    // Get counts for all tables
    const [userMessagesCount] = await db.pool.query('SELECT COUNT(*) as count FROM user_messages');
    const [ollamaResponsesCount] = await db.pool.query('SELECT COUNT(*) as count FROM ollama_responses');
    const [tagsCount] = await db.pool.query('SELECT COUNT(*) as count FROM tags');

    // Get most recent conversations
    const [conversations] = await db.pool.query(`
      SELECT
        um.id AS message_id,
        um.message_content AS user_message,
        um.timestamp AS message_time,
        um.tags AS user_tags,
        or.id AS response_id,
        or.response_content AS ollama_response,
        or.timestamp AS response_time,
        or.tags AS response_tags
      FROM user_messages um
      LEFT JOIN ollama_responses or ON um.id = or.user_message_id
      ORDER BY um.timestamp DESC
      LIMIT 10
    `);

    // Get tag statistics
    const [tags] = await db.pool.query(`
      SELECT tag_name, usage_count, first_used
      FROM tags
      ORDER BY usage_count DESC
      LIMIT 20
    `);

    // Generate HTML output
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ollama Chat Database Debug</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
          .card { margin-bottom: 20px; }
          pre { white-space: pre-wrap; background: #f8f9fa; padding: 10px; border-radius: 4px; }
          .tag-pill { display: inline-block; background: #e9ecef; padding: 0.15rem 0.5rem; border-radius: 16px; margin: 2px; }
        </style>
      </head>
      <body>
        <div class="container mt-4 mb-5">
          <h1>Ollama Chat Database Debug</h1>
          <p class="lead">Database statistics and recent conversations</p>

          <div class="card">
            <div class="card-header bg-primary text-white">Database Statistics</div>
            <div class="card-body">
              <div class="row">
                <div class="col-md-4">
                  <div class="card h-100">
                    <div class="card-body text-center">
                      <h3>${userMessagesCount[0].count}</h3>
                      <p class="text-muted">User Messages</p>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="card h-100">
                    <div class="card-body text-center">
                      <h3>${ollamaResponsesCount[0].count}</h3>
                      <p class="text-muted">Ollama Responses</p>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="card h-100">
                    <div class="card-body text-center">
                      <h3>${tagsCount[0].count}</h3>
                      <p class="text-muted">Unique Tags</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header bg-primary text-white">Tag Statistics</div>
            <div class="card-body">
              <div class="row">
                ${tags.map(tag => `
                  <div class="col-md-3 mb-2">
                    <div class="tag-pill">
                      #${tag.tag_name} (${tag.usage_count})
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      </body>
      </html>
    `;

    res.send(html);

  } catch (error) {
    console.error('Error displaying database debug:', error);
    res.status(500).send(`
      <h1>Database Error</h1>
      <p>An error occurred while fetching database information:</p>
      <pre>${error.stack}</pre>
    `);
  }
});
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header bg-primary text-white">Recent Conversations</div>
            <div class="card-body p-0">
              <div class="accordion" id="conversationsAccordion">
                ${conversations.map((conv, index) => `
                  <div class="accordion-item">
                    <h2 class="accordion-header">
                      <button class="accordion-button ${index > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${index}">
                        <strong>ID ${conv.message_id}</strong> - ${new Date(conv.message_time).toLocaleString()}
                        ${conv.response_id ? '' : ' <span class="badge bg-warning ms-2">No Response</span>'}
                      </button>
                    </h2>
                    <div id="collapse${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#conversationsAccordion">
                      <div class="accordion-body">
                        <h5>User Message:</h5>
                        <pre>${escapeHtml(conv.user_message)}</pre>

                        ${conv.user_tags ? `
                          <h6>User Tags:</h6>
                          <div>${formatTags(conv.user_tags)}</div>
                        ` : ''}

                        ${conv.response_id ? `
                          <h5 class="mt-3">Ollama Response:</h5>
                          <pre>${escapeHtml(conv.ollama_response)}</pre>

                          ${conv.response_tags ? `
                            <h6>Response Tags:</h6>
                            <div>${formatTags(conv.response_tags)}</div>
                          ` : ''}
                        ` : `
                          <div class="alert alert-warning mt-3">No response recorded</div>
                        `}
                      </div>
                    </div>
                  </div>
                `).join('')}