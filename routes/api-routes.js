// routes/api-routes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const configManager = require('../config/config-manager');
const ollamaService = require('../services/ollama-service');

// Get current configuration
router.get('/config', (req, res) => {
  res.json(configManager.getConfig());
});

// Update configuration
router.post('/config', express.json(), (req, res) => {
  try {
    // Update config with new values
    const newConfig = req.body;
    const updatedConfig = configManager.updateConfig(newConfig);

    // Return success response
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      config: updatedConfig
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

// Get available models
router.get('/models', async (req, res) => {
  try {
    const models = await ollamaService.getModels();
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
    
    // Determine if this is a connection error
    const isConnectionError = error.message.includes('ECONNREFUSED') || 
                             error.message.includes('forcibly closed') ||
                             error.message.includes('timeout') ||
                             error.message.includes('socket hang up');
    
    res.status(500).json({
      success: false,
      message: isConnectionError 
        ? 'Failed to connect to Ollama server. The service may be down or experiencing issues.'
        : 'Failed to fetch models',
      error: error.message,
      connectionStatus: isConnectionError ? 'disconnected' : 'unknown',
      troubleshooting: isConnectionError ? [
        'Make sure Ollama is running on your system',
        'Check if the Ollama API URL is correct in your configuration',
        'Restart the Ollama service if it crashed',
        'Check system resources (memory/CPU) if Ollama keeps crashing'
      ] : []
    });
  }
});

// Check if a model is installed
router.get('/check-model/:modelName', async (req, res) => {
  try {
    const { modelName } = req.params;
    const result = await ollamaService.checkModelAvailability(modelName);
    res.json(result);
  } catch (error) {
    console.error('Error checking model:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check if model exists',
      error: error.message
    });
  }
});

// Set model directly
router.post('/set-model', express.json(), (req, res) => {
  try {
    const { modelName } = req.body;

    if (!modelName) {
      return res.status(400).json({
        success: false,
        message: 'Model name is required'
      });
    }

    // Read the latest config
    let currentConfig = configManager.getConfigFromFile();

    // Update model
    currentConfig.defaultModel = modelName;

    // Set defaults for missing fields
    if (!currentConfig.ollamaApiUrl) currentConfig.ollamaApiUrl = 'http://localhost:11434/api';
    if (!currentConfig.temperature) currentConfig.temperature = 0.7;
    if (!currentConfig.maxTokens) currentConfig.maxTokens = 2000;

    // Save config
    configManager.saveConfig(currentConfig);

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

// Test connection to Ollama
router.get('/test-ollama', async (req, res) => {
  try {
    const config = configManager.getConfig();
    console.log(`Testing connection to Ollama server at ${config.ollamaApiUrl}...`);
    const models = await ollamaService.getAvailableModels();
    res.json({
      success: true,
      message: 'Successfully connected to Ollama',
      models: models
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

// Test Ollama completion functionality
router.post('/test-completion', express.json(), async (req, res) => {
  try {
    const config = configManager.getConfig();
    const modelName = req.body.model || config.defaultModel;
    const prompt = req.body.prompt || "Say hello in one short sentence.";
    
    console.log(`Testing Ollama completion with model ${modelName}...`);
    
    // Call the completion API with a simple prompt and minimal tokens
    const result = await ollamaService.getCompletion({
      model: modelName,
      prompt: prompt,
      stream: false,
      max_tokens: 20,
      temperature: 0.7
    });
    
    res.json({
      success: true,
      message: 'Successfully tested Ollama completion',
      result: result
    });
  } catch (error) {
    console.error('Error testing Ollama completion:', error);
    
    // Determine if this is a connection error
    const isConnectionError = error.message.includes('ECONNREFUSED') || 
                             error.message.includes('forcibly closed') ||
                             error.message.includes('timeout') ||
                             error.message.includes('socket hang up');
    
    // Check if this might be a resource issue (often causes crashes)
    const possibleResourceIssue = isConnectionError && 
                                 (error.message.includes('forcibly closed') || 
                                  error.message.includes('socket hang up'));
    
    const errorDetails = {
      message: error.message
    };
    
    if (error.response) {
      errorDetails.status = error.response.status;
      errorDetails.data = error.response.data;
    } else if (error.request) {
      errorDetails.request = 'Request sent but no response received';
    }
    
    // Generate troubleshooting steps based on error type
    const troubleshooting = [];
    
    if (isConnectionError) {
      troubleshooting.push('Make sure Ollama is running on your system');
      troubleshooting.push('Check if the Ollama API URL is correct in your configuration');
      
      if (possibleResourceIssue) {
        troubleshooting.push('Ollama may be crashing due to insufficient memory');
        troubleshooting.push('Try using a smaller model');
        troubleshooting.push('Close other memory-intensive applications');
        troubleshooting.push('Check system logs for out-of-memory errors');
      }
      
      troubleshooting.push('Restart the Ollama service');
    }
    
    res.status(500).json({
      success: false,
      message: isConnectionError 
        ? 'Ollama connection was terminated during the request. The service may have crashed.'
        : 'Failed to get completion from Ollama',
      error: errorDetails,
      connectionStatus: isConnectionError ? 'terminated' : 'unknown',
      possibleResourceIssue: possibleResourceIssue,
      troubleshooting: troubleshooting
    });
  }
});

// Get debugging information
router.get('/debug', (req, res) => {
  // Read directly from file to get the absolute latest
  const fileConfig = configManager.getConfigFromFile();

  res.json({
    inMemoryConfig: configManager.getConfig(),
    fileConfig: fileConfig,
    configFile: configManager.CONFIG_FILE_PATH,
    configFileExists: require('fs').existsSync(configManager.CONFIG_FILE_PATH),
  });
});

// Run diagnostics
router.get('/run-diagnostics', async (req, res) => {
  console.log('=== RUNNING DIAGNOSTICS ===');

  // 1. Check config
  const memoryConfig = configManager.getConfig();
  console.log('Current in-memory config:', memoryConfig);

  // 2. Check config file
  const fileConfig = configManager.getConfigFromFile();
  console.log('Config file contents:', fileConfig);

  // 3. Try to get model list
  let modelList = [];
  try {
    modelList = await ollamaService.getAvailableModels();
    console.log('Available models:', modelList.map(m => m.name));
  } catch (error) {
    console.error('Error fetching models:', error);
  }

  // 4. Check if config matches with what clients receive
  console.log('Model that will be used for next request:', memoryConfig.defaultModel);

  // Return diagnostic info
  res.json({
    timeStamp: new Date().toISOString(),
    memoryConfig: memoryConfig,
    fileConfig: fileConfig,
    availableModels: modelList.map(m => m.name),
    configFilePath: configManager.CONFIG_FILE_PATH,
    configFileExists: require('fs').existsSync(configManager.CONFIG_FILE_PATH),
    diagnosis: "Check server console for complete diagnostic information",
    recommendations: [
      "If you're still seeing model errors, restart the server after these changes",
      "Use the 'Emergency Model Fix' button to set the model directly",
      "Check if available models list includes your desired model"
    ]
  });
});

// Diagnose a specific model
router.get('/diagnose-model/:modelName', async (req, res) => {
  try {
    const { modelName } = req.params;
    console.log(`Diagnosing model: ${modelName}`);
    
    const diagnosis = await ollamaService.diagnoseModel(modelName);
    
    res.json({
      success: true,
      diagnosis: diagnosis
    });
  } catch (error) {
    console.error(`Error diagnosing model ${req.params.modelName}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to diagnose model',
      error: error.details || error.message
    });
  }
});

// Enhanced error diagnostic route for Ollama API
router.post('/diagnose-ollama-request', express.json(), async (req, res) => {
  try {
    const { endpoint, method, data } = req.body;
    
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint parameter is required'
      });
    }
    
    // Log the diagnostic attempt
    console.log(`Running diagnostic request to Ollama endpoint: ${endpoint}`);
    
    try {
      // Make a direct request to Ollama with the provided parameters
      const result = await ollamaService.makeOllamaRequest(
        endpoint,
        method || 'GET',
        data || null
      );
      
      res.json({
        success: true,
        message: 'Ollama API request successful',
        result: result
      });
    } catch (error) {
      // When the request fails, return detailed diagnostics
      // but with a 200 status since this is expected behavior for diagnostics
      res.json({
        success: false,
        message: 'Ollama API request failed with error',
        error: error.details || {
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        },
        recommendation: error.details?.troubleshooting || [
          'Check if Ollama is running',
          'Verify that the specified model is installed',
          'Check system resources (memory/CPU)',
          'Review Ollama logs for more details'
        ]
      });
    }
  } catch (error) {
    console.error('Error in diagnostic endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to run Ollama API diagnostics',
      error: error.message
    });
  }
});

// Get all tags
router.get('/tags', async (req, res) => {
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

// Get recent conversations
router.get('/conversations', async (req, res) => {
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

// Search by tag
router.get('/search', async (req, res) => {
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

// Fetch conversations related to specific hashtags with timeout handling
router.get('/conversations-by-tags', (req, res) => {
  try {
    const tags = req.query.tags;
    const excludeSession = req.query.excludeSession;
    
    if (!tags || (!Array.isArray(tags) && typeof tags !== 'string')) {
      return res.json({ 
        success: false, 
        message: 'No tags provided' 
      });
    }
    
    // Format tags as array
    const tagArray = Array.isArray(tags) ? tags : [tags];
    
    console.log(`Fetching conversations related to tags: ${tagArray.join(', ')}`);
    
    // Build dynamic conditions for searching tags in JSON array
    const tagConditions = tagArray.map((_, index) => 
      `JSON_SEARCH(ml.tags, 'one', CONCAT('#', ?)) IS NOT NULL`
    ).join(' OR ');
    
    console.log('Tag search conditions:', tagConditions);
    
    // SQL query with proper JSON search
    const query = `
      SELECT 
        um.message_id,
        um.message_content as user_message,
        resp.response_content as assistant_response,
        um.timestamp,
        ml.tags
      FROM 
        user_messages um
      JOIN 
        ollama_responses resp ON um.message_id = resp.message_id
      JOIN 
        message_log ml ON um.message_id = ml.message_id
      WHERE 
        (${tagConditions})
        ${excludeSession ? 'AND um.session_id != ?' : ''}
      GROUP BY 
        um.message_id
      ORDER BY 
        um.timestamp DESC
      LIMIT 5
    `;
    
    // Build parameters array - strip # from tags when searching
    const params = tagArray.map(tag => tag.replace('#', ''));
    if (excludeSession) {
      params.push(excludeSession);
    }
    
    console.log('Executing query with params:', params);
    
    // Set a timeout for the query
    const queryTimeout = setTimeout(() => {
      console.error('Database query timeout after 5000ms');
      return res.json({ 
        success: false, 
        message: 'Database query timed out',
        conversations: []
      });
    }, 5000);
    
    // Execute query with additional error handling
    db.pool.query(query, params, (error, results) => {
      // Clear the timeout since we got a response
      clearTimeout(queryTimeout);
      
      if (error) {
        console.error('Database error:', error);
        return res.json({ 
          success: false, 
          message: 'Database query error',
          error: error.message,
          conversations: [] // Return empty array to avoid client-side errors
        });
      }
      
      const resultsCount = results ? results.length : 0;
      console.log(`Found ${resultsCount} related conversations`);
      
      return res.json({ 
        success: true, 
        conversations: results || []
      });
    });
  } catch (error) {
    console.error('Error fetching conversations by tags:', error);
    return res.json({ 
      success: false, 
      message: 'Error fetching conversations',
      error: error.message,
      conversations: [] // Return empty array to avoid client-side errors
    });
  }
});

// Export conversation by session ID
router.get('/export-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Fetch session details
    const [sessionDetails] = await db.pool.query(`
      SELECT id, created_at, last_activity, client_info
      FROM sessions
      WHERE id = ?
    `, [sessionId]);

    if (!sessionDetails || sessionDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Fetch all messages in this session
    const messages = await db.getConversationById(sessionId);

    // Generate export data
    const exportData = {
      session: sessionDetails[0],
      messages: messages,
      exportDate: new Date().toISOString(),
      totalMessages: messages.length
    };

    // Set filename for download
    const filename = `ollama-chat-session-${sessionId.substring(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/json');

    // Send JSON data
    res.json(exportData);

  } catch (error) {
    console.error('Error exporting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export session',
      error: error.message
    });
  }
});

// Export conversation by session ID
router.get('/export-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const format = req.query.format || 'json'; // Default to JSON

    // Fetch session details
    const [sessionDetails] = await db.pool.query(`
      SELECT id, created_at, last_activity, client_info
      FROM sessions
      WHERE id = ?
    `, [sessionId]);

    if (!sessionDetails || sessionDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Fetch all messages in this session
    const messages = await db.getConversationById(sessionId);

    // Base filename without extension
    const baseFilename = `ollama-chat-session-${sessionId.substring(0, 8)}-${new Date().toISOString().slice(0, 10)}`;

    // Format and send response based on requested format
    switch (format.toLowerCase()) {
      case 'text':
        // Plain text format
        res.setHeader('Content-Disposition', `attachment; filename=${baseFilename}.txt`);
        res.setHeader('Content-Type', 'text/plain');

        let textContent = `Ollama Chat Session Export\n`;
        textContent += `Session ID: ${sessionId}\n`;
        textContent += `Created: ${new Date(sessionDetails[0].created_at).toLocaleString()}\n`;
        textContent += `Last Activity: ${new Date(sessionDetails[0].last_activity).toLocaleString()}\n\n`;
        textContent += `Total Messages: ${messages.length}\n\n`;
        textContent += `===== CONVERSATION =====\n\n`;

        messages.forEach(msg => {
          const sender = msg.origin === 'user' ? 'You' :
                         msg.origin === 'assistant' ? 'Ollama' : 'System';
          const time = new Date(msg.timestamp).toLocaleString();
          textContent += `[${time}] ${sender}:\n${msg.content}\n\n`;

          // Add tags if present
          if (msg.tags && msg.tags !== '[]') {
            try {
              const tags = JSON.parse(msg.tags);
              if (tags.length > 0) {
                textContent += `Tags: ${tags.join(' ')}\n\n`;
              }
            } catch (e) {}
          }

          textContent += `----------------------------\n\n`;
        });

        return res.send(textContent);

      case 'html':
        // HTML format
        res.setHeader('Content-Disposition', `attachment; filename=${baseFilename}.html`);
        res.setHeader('Content-Type', 'text/html');

        let htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ollama Chat Export</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    .message { margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee; }
    .user { background-color: #f1f8ff; padding: 10px; border-radius: 5px; }
    .assistant { background-color: #f8f8f8; padding: 10px; border-radius: 5px; }
    .system { background-color: #fff8e1; padding: 10px; border-radius: 5px; font-style: italic; }
    .meta { color: #666; font-size: 0.8em; margin-bottom: 5px; }
    .tags { margin-top: 10px; }
    .tag { display: inline-block; background: #e9ecef; padding: 2px 8px; border-radius: 12px; margin-right: 5px; font-size: 0.85em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Ollama Chat Export</h1>
    <p>Session ID: ${sessionId}</p>
    <p>Created: ${new Date(sessionDetails[0].created_at).toLocaleString()}</p>
    <p>Last Activity: ${new Date(sessionDetails[0].last_activity).toLocaleString()}</p>
    <p>Total Messages: ${messages.length}</p>
  </div>
  <div class="conversation">`;

        messages.forEach(msg => {
          const sender = msg.origin === 'user' ? 'You' :
                         msg.origin === 'assistant' ? 'Ollama' : 'System';
          const time = new Date(msg.timestamp).toLocaleString();

          htmlContent += `
    <div class="message">
      <div class="meta">${time} - ${sender}</div>
      <div class="${msg.origin}">${msg.content.replace(/\n/g, '<br>')}</div>`;

          // Add tags if present
          if (msg.tags && msg.tags !== '[]') {
            try {
              const tags = JSON.parse(msg.tags);
              if (tags.length > 0) {
                htmlContent += `
      <div class="tags">
        ${tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
      </div>`;
              }
            } catch (e) {}
          }

          htmlContent += `
    </div>`;
        });

        htmlContent += `
  </div>
</body>
</html>`;

        return res.send(htmlContent);

      case 'markdown':
        // Markdown format
        res.setHeader('Content-Disposition', `attachment; filename=${baseFilename}.md`);
        res.setHeader('Content-Type', 'text/markdown');

        let mdContent = `# Ollama Chat Export\n\n`;
        mdContent += `**Session ID:** ${sessionId}  \n`;
        mdContent += `**Created:** ${new Date(sessionDetails[0].created_at).toLocaleString()}  \n`;
        mdContent += `**Last Activity:** ${new Date(sessionDetails[0].last_activity).toLocaleString()}  \n`;
        mdContent += `**Total Messages:** ${messages.length}\n\n`;
        mdContent += `## Conversation\n\n`;

        messages.forEach(msg => {
          const sender = msg.origin === 'user' ? 'You' :
                         msg.origin === 'assistant' ? 'Ollama' : 'System';
          const time = new Date(msg.timestamp).toLocaleString();

          mdContent += `### ${sender} (${time})\n\n`;
          mdContent += `${msg.content}\n\n`;

          // Add tags if present
          if (msg.tags && msg.tags !== '[]') {
            try {
              const tags = JSON.parse(msg.tags);
              if (tags.length > 0) {
                mdContent += `Tags: ${tags.join(' ')}\n\n`;
              }
            } catch (e) {}
          }

          mdContent += `---\n\n`;
        });

        return res.send(mdContent);

      case 'json':
      default:
        // JSON format (default)
        const exportData = {
          session: sessionDetails[0],
          messages: messages,
          exportDate: new Date().toISOString(),
          totalMessages: messages.length
        };

        res.setHeader('Content-Disposition', `attachment; filename=${baseFilename}.json`);
        res.setHeader('Content-Type', 'application/json');
        return res.json(exportData);
    }

  } catch (error) {
    console.error('Error exporting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export session',
      error: error.message
    });
  }
});

    // Get all chatbot configurations
    router.get('/chatbots', async (req, res) => {
      try {
        console.log('API: Fetching all chatbots from database');
        const chatbots = await db.getAllChatbots();
        console.log(`API: Successfully retrieved ${chatbots ? chatbots.length : 0} chatbots`);
        res.json({
          success: true,
          chatbots: chatbots || [] // Ensure we always return an array
        });
      } catch (error) {
        console.error('Error fetching chatbots:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch chatbot configurations',
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });

    // Get chatbot details by ID
    router.get('/chatbots/:id', async (req, res) => {
      try {
        const chatbot = await db.getChatbotById(parseInt(req.params.id));
        res.json({
          success: true,
          chatbot
        });
      } catch (error) {
        console.error('Error fetching chatbot details:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch chatbot configuration',
          error: error.message
        });
      }
    });

    // Create new chatbot configuration
    router.post('/chatbots', express.json(), async (req, res) => {
      try {
        const {
          name,
          isDefault,
          settings = {},
          examples = []
        } = req.body;

        if (!name) {
          return res.status(400).json({
            success: false,
            message: 'Chatbot name is required'
          });
        }

        const chatbotId = await db.createChatbot({
          name,
          isDefault: !!isDefault,
          settings,
          examples
        });

        res.json({
          success: true,
          message: 'Chatbot configuration created successfully',
          chatbotId
        });
      } catch (error) {
        console.error('Error creating chatbot:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to create chatbot configuration',
          error: error.message
        });
      }
    });

    // Update chatbot configuration
    router.put('/chatbots/:id', express.json(), async (req, res) => {
      try {
        const chatbotId = parseInt(req.params.id);
        const {
          name,
          isDefault,
          settings = {},
          examples = []
        } = req.body;

        if (!name) {
          return res.status(400).json({
            success: false,
            message: 'Chatbot name is required'
          });
        }

        await db.updateChatbot(chatbotId, {
          name,
          isDefault: !!isDefault,
          settings,
          examples
        });

        res.json({
          success: true,
          message: 'Chatbot configuration updated successfully'
        });
      } catch (error) {
        console.error('Error updating chatbot:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to update chatbot configuration',
          error: error.message
        });
      }
    });

    // Delete chatbot configuration
    router.delete('/chatbots/:id', async (req, res) => {
      try {
        const chatbotId = parseInt(req.params.id);
        await db.deleteChatbot(chatbotId);

        res.json({
          success: true,
          message: 'Chatbot configuration deleted successfully'
        });
      } catch (error) {
        console.error('Error deleting chatbot:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to delete chatbot configuration',
          error: error.message
        });
      }
    });

    // Set chatbot for current session
    router.post('/session/chatbot', express.json(), async (req, res) => {
      try {
        const { sessionId, chatbotId } = req.body;

        if (!sessionId) {
          return res.status(400).json({
            success: false,
            message: 'Session ID is required'
          });
        }

        if (!chatbotId) {
          return res.status(400).json({
            success: false,
            message: 'Chatbot ID is required'
          });
        }

        await db.setSessionChatbot(sessionId, parseInt(chatbotId));

        // Get the chatbot details to send back
        const chatbot = await db.getChatbotById(parseInt(chatbotId));

        res.json({
          success: true,
          message: 'Session chatbot set successfully',
          chatbot
        });
      } catch (error) {
        console.error('Error setting session chatbot:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to set session chatbot',
          error: error.message
        });
      }
    });

    // Get current session's chatbot
    router.get('/session/:sessionId/chatbot', async (req, res) => {
      try {
        const { sessionId } = req.params;

        if (!sessionId) {
          return res.status(400).json({
            success: false,
            message: 'Session ID is required'
          });
        }

        const chatbot = await db.getSessionChatbot(sessionId);

        res.json({
          success: true,
          chatbot
        });
      } catch (error) {
        console.error('Error getting session chatbot:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to get session chatbot',
          error: error.message
        });
      }
    });

// Get blocked tags
router.get('/blocked-tags', async (req, res) => {
  try {
    const blockedTags = await db.getBlockedTags();
    res.json({
      success: true,
      blockedTags: blockedTags
    });
  } catch (error) {
    console.error('Error fetching blocked tags:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch blocked tags',
      error: error.message
    });
  }
});

// Add a tag to blocked list
router.post('/block-tag', express.json(), async (req, res) => {
  try {
    const { tag } = req.body;
    
    if (!tag) {
      return res.status(400).json({
        success: false,
        message: 'Tag is required'
      });
    }
    
    await db.blockTag(tag);
    
    res.json({
      success: true,
      message: `Tag "${tag}" has been blocked successfully`
    });
  } catch (error) {
    console.error('Error blocking tag:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block tag',
      error: error.message
    });
  }
});

// Remove a tag from blocked list
router.delete('/unblock-tag/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    await db.unblockTag(tag);
    
    res.json({
      success: true,
      message: `Tag "${tag}" has been unblocked successfully`
    });
  } catch (error) {
    console.error('Error unblocking tag:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock tag',
      error: error.message
    });
  }
});

// Extract tags from text
router.post('/extract-tags', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.json({
        success: false,
        message: 'No text provided',
        tags: []
      });
    }
    
    // Call the tag extraction function with better error handling
    const extractedTags = await extractAndProcessTags(text);
    
    return res.json({
      success: true,
      tags: extractedTags
    });
  } catch (error) {
    console.error('Error extracting tags:', error);
    return res.json({
      success: false,
      message: 'Failed to extract tags',
      error: error.message,
      tags: [] // Return empty array to avoid null/undefined errors in client
    });
  }
});

// Improved extractAndProcessTags function with better filtering
async function extractAndProcessTags(text) {
  // Guard against undefined or null text
  if (!text) {
    console.log('No text provided for tag extraction');
    return [];
  }
  
  try {
    // Get blocked tags from database with null safety
    const blockedTagsResult = await db.pool.query('SELECT tag_name FROM blocked_tags');
    const blockedTags = (blockedTagsResult || [])
      .map(row => row?.tag_name)
      .filter(tag => tag) // Filter out null/undefined
      .map(tag => tag.toLowerCase());
    
    console.log(`Loaded ${blockedTags.length} blocked tags from database`);
    
    // Use the comprehensive stopWords list instead of the limited commonWords
    const stopWords = [
      'a', 'about', 'above', 'after', 'again', 'against', 'all', 'almost', 'along', 'already', 
      'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another', 'any', 'anybody', 
      'anyone', 'anything', 'anywhere', 'are', 'are not', 'around', 'as', 'at', 'back', 'be', 
      'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 
      'cannot', 'could', 'could not', 'did', 'did not', 'do', 'does', 'does not', 'doing', 
      'do not', 'down', 'during', 'each', 'either', 'else', 'enough', 'even', 'ever', 'every', 
      'everybody', 'everyone', 'everything', 'everywhere', 'except', 'few', 'for', 'from', 
      'further', 'get', 'gets', 'getting', 'give', 'given', 'gives', 'go', 'goes', 'going', 
      'gone', 'got', 'gotten', 'had', 'had not', 'has', 'has not', 'have', 'have not', 'having', 
      'he', 'he would', 'he will', 'he is', 'her', 'here', 'here is', 'hers', 'herself', 'him', 
      'himself', 'his', 'how', 'how is', 'however', 'i', 'i would', 'i will', 'i am', 'i have', 
      'if', 'in', 'inside', 'instead', 'into', 'is', 'is not', 'it', 'it is', 'its', 'itself', 
      'just', 'keep', 'keeps', 'kept', 'kind', 'knew', 'know', 'known', 'knows', 'last', 
      'later', 'least', 'less', 'let', 'let us', 'like', 'likely', 'long', 'made', 'make', 
      'makes', 'making', 'many', 'may', 'maybe', 'me', 'mean', 'meant', 'means', 'might', 
      'might not', 'mine', 'more', 'most', 'mostly', 'much', 'must', 'must not', 'my', 'myself', 
      'name', 'namely', 'near', 'need', 'needs', 'neither', 'never', 'next', 'no', 'nobody', 
      'non', 'none', 'nor', 'not', 'nothing', 'now', 'nowhere', 'of', 'off', 'often', 'oh', 
      'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others', 'otherwise', 'ought', 'our', 
      'ours', 'ourselves', 'out', 'over', 'own', 'part', 'particular', 'particularly', 'past', 
      'per', 'perhaps', 'place', 'please', 'point', 'possible', 'probably', 'put', 'puts', 
      'quite', 'rather', 'really', 'regarding', 'right', 'said', 'same', 'saw', 'say', 'saying', 
      'says', 'second', 'see', 'seem', 'seemed', 'seeming', 'seems', 'seen', 'self', 'selves', 
      'sent', 'several', 'shall', 'shall not', 'she', 'she would', 'she will', 'she is', 'should', 
      'should not', 'since', 'so', 'some', 'somebody', 'someone', 'something', 'sometime', 
      'sometimes', 'somewhere', 'soon', 'still', 'such', 'sure', 'take', 'taken', 'taking', 
      'tell', 'tends', 'than', 'that', 'that is', 'the', 'their', 'theirs', 'them', 'themselves', 
      'then', 'there', 'there is', 'thereafter', 'thereby', 'therefore', 'therein', 'thereupon', 
      'these', 'they', 'they would', 'they will', 'they are', 'they have', 'thing', 'things', 
      'think', 'thinks', 'this', 'those', 'though', 'thought', 'through', 'throughout', 'thus', 
      'till', 'to', 'together', 'too', 'took', 'toward', 'towards', 'tried', 'tries', 'truly', 
      'try', 'trying', 'twice', 'under', 'underneath', 'undo', 'unfortunately', 'unless', 
      'unlike', 'unlikely', 'until', 'unto', 'up', 'upon', 'us', 'use', 'used', 'uses', 'using', 
      'usually', 'value', 'various', 'very', 'via', 'view', 'want', 'wants', 'was', 'was not', 
      'way', 'we', 'we would', 'we will', 'we are', 'we have', 'well', 'went', 'were', 'were not', 
      'what', 'what is', 'whatever', 'when', 'whence', 'whenever', 'where', 'where is', 
      'whereafter', 'whereas', 'whereby', 'wherein', 'whereupon', 'wherever', 'whether', 'which', 
      'while', 'whither', 'who', 'who is', 'whoever', 'whole', 'whom', 'whose', 'why', 'why is', 
      'will', 'willing', 'wish', 'with', 'within', 'without', 'will not', 'wonder', 'would', 
      'would not', 'yes', 'yet', 'you', 'you would', 'you will', 'you are', 'you have', 'your', 
      'yours', 'yourself', 'yourselves'
    ];
    
    // Extract words from text with improved cleaning
    const words = text
      .toLowerCase()
      .replace(/[^\w\s#]/g, '') // Remove punctuation except hashtags
      .split(/\s+/)              // Split by whitespace
      .filter(word => word && word.length > 2); // Keep words longer than 2 chars
    
    console.log(`After initial extraction: ${words.length} words found`);
    
    // Filter out stop words and blocked tags in one pass
    const filteredWords = words.filter(word => {
      // Skip words in stop words list
      const wordWithoutHash = word.startsWith('#') ? word.substring(1) : word;
      
      if (stopWords.includes(wordWithoutHash.toLowerCase())) {
        return false;
      }
      
      // Check against blocked tags list
      if (blockedTags.includes(wordWithoutHash.toLowerCase())) {
        return false;
      }
      
      return true;
    });
    
    console.log(`After common word filtering: ${filteredWords.length} keywords remain`);
    console.log(`Filtered out ${words.length - filteredWords.length} common/blocked words`);
    
    // Format and limit tags
    const uniqueTags = [...new Set(filteredWords)]
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
      .slice(0, 10);
    
    console.log(`Final hashtag count: ${uniqueTags.length}`);
    return uniqueTags;
  } catch (error) {
    console.error("Error processing tags:", error);
    return [];
  }
}

// Find similar tags to a given tag
router.get('/similar-tags/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const similarTags = await db.findSimilarTags(tag);
    
    res.json({
      success: true,
      originalTag: tag,
      similarTags: similarTags
    });
  } catch (error) {
    console.error('Error finding similar tags:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to find similar tags',
      error: error.message
    });
  }
});

// Function to extract keywords from text
function extractKeywords(text) {
  // Remove punctuation and convert to lowercase
  const cleanedText = text.toLowerCase().replace(/[^\w\s]/g, '');
  
  // Split into words
  const words = cleanedText.split(/\s+/);
  
  // Remove common stop words
  const stopWords = [
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'almost', 'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another', 'any', 'anybody', 'anyone', 'anything', 'anywhere', 'are', 'are not', 'around', 'as', 'at', 'back', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'could not', 'did', 'did not', 'do', 'does', 'does not', 'doing', 'do not', 'down', 'during', 'each', 'either', 'else', 'enough', 'even', 'ever', 'every', 'everybody', 'everyone', 'everything', 'everywhere', 'except', 'few', 'for', 'from', 'further', 'get', 'gets', 'getting', 'give', 'given', 'gives', 'go', 'goes', 'going', 'gone', 'got', 'gotten', 'had', 'had not', 'has', 'has not', 'have', 'have not', 'having', 'he', 'he would', 'he will', 'he is', 'her', 'here', 'here is', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how is', 'however', 'i', 'i would', 'i will', 'i am', 'i have', 'if', 'in', 'inside', 'instead', 'into', 'is', 'is not', 'it', 'it is', 'its', 'itself', 'just', 'keep', 'keeps', 'kept', 'kind', 'knew', 'know', 'known', 'knows', 'last', 'later', 'least', 'less', 'let', 'let us', 'like', 'likely', 'long', 'made', 'make', 'makes', 'making', 'many', 'may', 'maybe', 'me', 'mean', 'meant', 'means', 'might', 'might not', 'mine', 'more', 'most', 'mostly', 'much', 'must', 'must not', 'my', 'myself', 'name', 'namely', 'near', 'need', 'needs', 'neither', 'never', 'next', 'no', 'nobody', 'non', 'none', 'nor', 'not', 'nothing', 'now', 'nowhere', 'of', 'off', 'often', 'oh', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others', 'otherwise', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'part', 'particular', 'particularly', 'past', 'per', 'perhaps', 'place', 'please', 'point', 'possible', 'probably', 'put', 'puts', 'quite', 'rather', 'really', 'regarding', 'right', 'said', 'same', 'saw', 'say', 'saying', 'says', 'second', 'see', 'seem', 'seemed', 'seeming', 'seems', 'seen', 'self', 'selves', 'sent', 'several', 'shall', 'shall not', 'she', 'she would', 'she will', 'she is', 'should', 'should not', 'since', 'so', 'some', 'somebody', 'someone', 'something', 'sometime', 'sometimes', 'somewhere', 'soon', 'still', 'such', 'sure', 'take', 'taken', 'taking', 'tell', 'tends', 'than', 'that', 'that is', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there is', 'thereafter', 'thereby', 'therefore', 'therein', 'thereupon', 'these', 'they', 'they would', 'they will', 'they are', 'they have', 'thing', 'things', 'think', 'thinks', 'this', 'those', 'though', 'thought', 'through', 'throughout', 'thus', 'till', 'to', 'together', 'too', 'took', 'toward', 'towards', 'tried', 'tries', 'truly', 'try', 'trying', 'twice', 'under', 'underneath', 'undo', 'unfortunately', 'unless', 'unlike', 'unlikely', 'until', 'unto', 'up', 'upon', 'us', 'use', 'used', 'uses', 'using', 'usually', 'value', 'various', 'very', 'via', 'view', 'want', 'wants', 'was', 'was not', 'way', 'we', 'we would', 'we will', 'we are', 'we have', 'well', 'went', 'were', 'were not', 'what', 'what is', 'whatever', 'when', 'whence', 'whenever', 'where', 'where is', 'whereafter', 'whereas', 'whereby', 'wherein', 'whereupon', 'wherever', 'whether', 'which', 'while', 'whither', 'who', 'who is', 'whoever', 'whole', 'whom', 'whose', 'why', 'why is', 'will', 'willing', 'wish', 'with', 'within', 'without', 'will not', 'wonder', 'would', 'would not', 'yes', 'yet', 'you', 'you would', 'you will', 'you are', 'you have', 'your', 'yours', 'yourself', 'yourselves'
  ];
  
  // Filter out stop words and short words
  const keywords = words.filter(word => 
    !stopWords.includes(word) && word.length > 2
  );
  
  // Extract phrases (bigrams and trigrams)
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (!stopWords.includes(words[i]) && !stopWords.includes(words[i+1])) {
      phrases.push(words[i] + words[i+1]);
    }
  }
  
  // Combine individual words and meaningful phrases
  return [...keywords, ...phrases];
}

// Function to normalize keywords
function normalizeKeyword(keyword) {
  return keyword.trim().toLowerCase();
}

// Find best matching tag from existing tags
function findBestMatchingTag(keyword, existingTags) {
  // Convert existingTags array of objects to array of strings if needed
  const tagStrings = existingTags.map(tag => 
    typeof tag === 'string' ? tag : tag.tag
  );
  
  // Check for exact matches first
  const exactMatch = tagStrings.find(tag => 
    tag.toLowerCase() === keyword.toLowerCase()
  );
  
  if (exactMatch) return exactMatch;
  
  // Check for tags that contain this keyword or vice versa
  const containsMatch = tagStrings.find(tag => 
    tag.toLowerCase().includes(keyword.toLowerCase()) || 
    keyword.toLowerCase().includes(tag.toLowerCase())
  );
  
  if (containsMatch) return containsMatch;
  
  // If no match found, return null
  return null;
}

module.exports = router;