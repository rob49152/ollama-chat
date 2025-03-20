const axios = require('axios');
const crypto = require('crypto');
const configManager = require('../config/config-manager');
const db = require('../db');
const EventEmitter = require('events');
const hashtagService = require('./hashtag-service');

// Create an event emitter for ollama service events
const serviceEvents = new EventEmitter();

// Configure axios timeouts and retry settings
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 60000; // 60 seconds
const RETRY_DELAY = 1000; // 1 second

// Modify your getCompletion function to support streaming
async function getCompletion(params) {
  // Always set stream to true for streaming responses
  const requestData = {
    ...params,
    stream: true
  };
  
  // Return a response stream instead of a completed response
  return axios.post(`${config.ollamaApiUrl}/generate`, requestData, {
    responseType: 'stream'
  });
}

/**
 * Find related conversations based on user hashtags
 * @param {Array} userHashtags - Array of hashtags extracted from user message
 * @param {string} sessionId - Current session ID
 * @param {number} limit - Maximum number of related conversations to return
 * @returns {Promise<Array>} - Array of related message objects
 */
async function findRelatedConversation(userHashtags, sessionId, limit = 3) {
  if (!userHashtags || userHashtags.length === 0) {
    console.log('No hashtags to find related conversations, returning empty array');
    return [];
  }
  
  console.log(`Finding related conversations for ${userHashtags.length} hashtags:`, userHashtags);
  
  try {
    const relatedMessages = [];
    const processedMessageIds = new Set(); // Track which messages we've already processed
    
    // Build SQL for multiple tags at once using OR conditions
    const params = [];
    const tagConditions = [];
    
    // Process all hashtags at once for better SQL performance
    for (const tag of userHashtags) {
      // Skip if tag is invalid
      if (!tag) continue;
      
      const cleanTag = tag.replace(/^#/, '').toLowerCase().trim();
      if (cleanTag.length < 3) continue;
      
      // Add conditions for this tag (both with and without # prefix)
      tagConditions.push('(JSON_SEARCH(ml.tags, "one", ?) IS NOT NULL OR JSON_SEARCH(ml.tags, "one", ?) IS NOT NULL)');
      params.push(`#${cleanTag}`, cleanTag);
    }
    
    // If no valid tags, return empty array
    if (tagConditions.length === 0) {
      console.log('No valid tags for SQL search');
      return [];
    }
    
    // Combined query for all tags using OR
    const sql = `
      SELECT 
        ml.message_id, 
        ml.content, 
        ml.origin,
        ml.timestamp,
        ml.session_id
      FROM 
        message_log ml
      WHERE 
        (${tagConditions.join(' OR ')})
        AND ml.session_id != ?
      ORDER BY 
        ml.timestamp DESC
      LIMIT 30
    `;
    
    // Add sessionId to params for exclusion
    params.push(sessionId);
    
    console.log('Executing tag search SQL with params:', params);
    const [rows] = await db.pool.query(sql, params);
    
    if (!rows || rows.length === 0) {
      console.log(`No matching messages found for any tags`);
      return [];
    }
    
    console.log(`Found ${rows.length} total tag matches`);
    
    // For each matching message, get the conversation context
    for (const row of rows) {
      // Skip if we already processed this message or reached our limit
      if (processedMessageIds.has(row.message_id) || relatedMessages.length >= limit) {
        continue;
      }
      
      processedMessageIds.add(row.message_id);
      
      // If this is a user message, find the assistant response
      let relevantContent;
      
      if (row.origin === 'user') {
        // Find the assistant's response to this message
        const [responseRows] = await db.pool.query(`
          SELECT 
            response_content, 
            message_id
          FROM 
            ollama_responses
          WHERE 
            user_message_id = ?
          LIMIT 1
        `, [row.message_id]);
        
        if (responseRows && responseRows.length > 0) {
          relevantContent = {
            userMessage: row.content,
            assistantResponse: responseRows[0].response_content,
            messageId: responseRows[0].message_id,
            timestamp: new Date(row.timestamp).toISOString(),
            sessionId: row.session_id
          };
        }
      } else {
        // For assistant message, find the preceding user message
        const [userRows] = await db.pool.query(`
          SELECT 
            content,
            message_id
          FROM 
            message_log
          WHERE 
            session_id = ? 
            AND timestamp < ? 
            AND origin = 'user'
          ORDER BY 
            timestamp DESC
          LIMIT 1
        `, [row.session_id, row.timestamp]);
        
        if (userRows && userRows.length > 0) {
          relevantContent = {
            userMessage: userRows[0].content,
            assistantResponse: row.content,
            messageId: row.message_id,
            timestamp: new Date(row.timestamp).toISOString(),
            sessionId: row.session_id
          };
        }
      }
      
      // Add to related messages if we have both parts
      if (relevantContent && relevantContent.userMessage && relevantContent.assistantResponse) {
        relatedMessages.push(relevantContent);
        console.log(`Added related message pair, ID: ${row.message_id}`);
      }
    }
    
    console.log(`Returning ${relatedMessages.length} complete related conversations`);
    return relatedMessages;
  } catch (error) {
    console.error('Error finding related conversations:', error);
    return [];
  }
}

/**
 * Stream completion from Ollama API with robust JSON parsing
 * @param {Object} socket - Socket.io socket for real-time communication
 * @param {string} sessionId - Current session ID
 * @param {string} message - User message
 * @param {string|null} chatbotId - Optional chatbot ID
 * @returns {Promise<void>}
 */
async function streamCompletion(socket, sessionId, message, chatbotId = null) {
  try {
    // First, ensure the session exists in the database
    let sessionExists = false;
    try {
      const [sessionCheck] = await db.pool.query('SELECT id FROM sessions WHERE id = ?', [sessionId]);
      sessionExists = sessionCheck && sessionCheck.length > 0;
    } catch (err) {
      console.error('Error checking session existence:', err);
    }
    
    // Create the session if it doesn't exist
    if (!sessionExists) {
      console.log(`Session ${sessionId} doesn't exist in database, creating it now...`);
      try {
        await db.createSession(sessionId);
        console.log(`Created new session: ${sessionId}`);
      } catch (err) {
        console.error('Error creating session:', err);
        throw new Error(`Failed to create session: ${err.message}`);
      }
    } else {
      console.log(`Session ${sessionId} found in database`);
    }
    
    const config = configManager.getConfig();
    const model = config.defaultModel || 'llama2';
    const ollamaApiUrl = config.ollamaApiUrl || 'http://localhost:11434/api';
    
    // Get chatbot settings if chatbotId is provided
    let systemPrompt = config.systemPrompt || '';
    let temperature = config.temperature || 0.7;
    let bubbleColor = null;
    let textColor = null;
    
    if (chatbotId) {
      try {
        const chatbot = await db.getChatbotById(chatbotId);
        if (chatbot) {
          systemPrompt = chatbot.system_prompt || systemPrompt;
          temperature = chatbot.temperature || temperature;
          bubbleColor = chatbot.bubble_color;
          textColor = chatbot.text_color;
        }
      } catch (err) {
        console.error('Error getting chatbot settings:', err);
      }
    }
    
    // Generate a unique message ID for this response
    const messageId = crypto.randomUUID();
    
    // Extract parameters for message logging
    const messageParams = {
      sessionId: sessionId,
      message: message,
      messageId: messageId
    };
    
    // Store user message in DB
    await db.saveUserMessage(messageParams);
    
    // Extract hashtags from user message
    let userHashtags = [];
    let enhancedPrompt = message;
    
    try {
      const userTagsResult = await hashtagService.generateUserMessageHashtags(message);
      userHashtags = userTagsResult;
      console.log('Extracted user message hashtags:', userHashtags);
      
      // Update user message with extracted hashtags
      await db.pool.query(
        'UPDATE user_messages SET tags = ? WHERE message_id = ?',
        [JSON.stringify(userHashtags), messageParams.messageId]
      );
      
      // Update message_log with hashtags too
      await db.pool.query(
        'UPDATE message_log SET tags = ? WHERE message_id = ? AND origin = "user"',
        [JSON.stringify(userHashtags), messageParams.messageId]
      );
      
      // Send user hashtags to client immediately
      socket.emit('userHashtags', {
        hashtags: userHashtags,
        messageId: messageParams.messageId
      });
      
      // Find related conversations using the hashtags
      const relatedConversations = await findRelatedConversation(userHashtags, sessionId);
      console.log(`Found ${relatedConversations.length} related conversations`);
      
      // Format related conversations as context for the Ollama prompt
      if (relatedConversations.length > 0) {
        let relatedContext = '\n\n### Related conversations on these topics:\n\n';
        
        relatedConversations.forEach((convo, index) => {
          relatedContext += `Previous Conversation ${index + 1}:\n`;
          //relatedContext += `Human: ${convo.userMessage}\n`;
          relatedContext += `Assistant: ${convo.assistantResponse}\n\n`;
        });
        
        relatedContext += '### End of related conversations\n\n';
        relatedContext += 'Now, responding to the current query:\nHuman: ' + message + '\nAssistant:';
        
        // Use the enhanced prompt with context
        enhancedPrompt = relatedContext;
        console.log('Enhanced prompt with related conversations');
        console.log('Enhanced prompt length:', enhancedPrompt.length);

        megaprompt = '\n------\n' + enhancedPrompt + '\n------\n';
        console.log(megaprompt);
      }
    } catch (err) {
      console.error('Error extracting user message hashtags:', err);
    }
    
    // Extract hashtags before generating the response
    let hashtags = [];
    try {
      const tagsResult = await axios.post(`http://localhost:${process.env.PORT || 3000}/api/extract-tags`, {
        text: message
      });
      
      if (tagsResult.data && tagsResult.data.success && tagsResult.data.tags) {
        hashtags = tagsResult.data.tags;
        console.log('Extracted hashtags:', hashtags);
      }
    } catch (err) {
      console.error('Error extracting hashtags:', err);
    }
    
    // Create request data for Ollama API
    const requestData = {
      model,
      prompt: enhancedPrompt, // Use the enhanced prompt with related conversations
      stream: true // Enable streaming
    };
    
    if (systemPrompt) {
      requestData.system = systemPrompt;
    }
    
    if (temperature) {
      requestData.temperature = Number(temperature);
      // Ensure valid temperature range
      if (isNaN(requestData.temperature)) {
        delete requestData.temperature;
      } else {
        requestData.temperature = Math.max(0, Math.min(1, requestData.temperature));
      }
    }
    
    console.log(`Sending request to Ollama API at ${ollamaApiUrl}/generate`);
    console.log('Request data:', {
      ...requestData,
      prompt: requestData.prompt.length > 100 ? 
        requestData.prompt.substring(0, 100) + '...' : 
        requestData.prompt
    });
    
    // Start response timer
    const startTime = Date.now();
    
    // Make streaming request to Ollama
    const response = await axios({
      method: 'post',
      url: `${ollamaApiUrl}/generate`,
      data: requestData,
      responseType: 'stream'
    });
    
    // Variables to track the streaming response
    let fullResponse = '';
    let chunkCount = 0;
    let contentExtracted = false;
    let buffer = ''; // Buffer for accumulating JSON chunks
    
    // Process the stream in chunks with improved JSON parsing
    response.data.on('data', chunk => {
      try {
        // Add chunk to buffer
        buffer += chunk.toString();
        
        // Process complete JSON objects in the buffer
        let startIdx = 0;
        let jsonStartPos = 0;
        
        // Scan through buffer looking for complete JSON objects
        for (let i = 0; i < buffer.length; i++) {
          // Look for newlines which typically separate JSON objects
          if (buffer[i] === '\n') {
            const jsonStr = buffer.substring(startIdx, i).trim();
            startIdx = i + 1;
            
            // Skip empty lines
            if (!jsonStr) continue;
            
            try {
              // Parse JSON object
              const data = JSON.parse(jsonStr);
              
              // Handle response chunk
              if (data.response) {
                // Add to full response
                fullResponse += data.response;
                chunkCount++;
                
                // Send chunk to client
                socket.emit('messageChunk', {
                  chunk: data.response,
                  messageId,
                  done: false,
                  bubbleColor,
                  textColor
                });
                
                // Extract hashtags periodically during streaming
                if (!contentExtracted && fullResponse.length > 200 && chunkCount % 10 === 0) {
                  axios.post(`http://localhost:${process.env.PORT || 3000}/api/extract-tags`, {
                    text: fullResponse
                  })
                  .then(tagsResult => {
                    if (tagsResult.data && tagsResult.data.success && tagsResult.data.tags) {
                      const streamTags = tagsResult.data.tags;
                      socket.emit('streamingHashtags', {
                        hashtags: streamTags,
                        messageId,
                        final: false
                      });
                      
                      // Set flag to avoid too frequent extraction
                      if (streamTags.length > 0) {
                        contentExtracted = true;
                      }
                    }
                  })
                  .catch(err => console.error('Error extracting tags during stream:', err));
                }
              }
              
              // Handle completion
              if (data.done) {
                const responseTime = Date.now() - startTime;
                console.log(`Generation completed in ${responseTime}ms, response length: ${fullResponse.length}`);
                
                // Process the completed response
                processCompletedResponse(socket, messageId, fullResponse, hashtags, 
                                        sessionId, responseTime, bubbleColor, textColor);
              }
            } catch (parseError) {
              // Safely handle JSON parse errors
              console.error('Error parsing JSON line:', parseError.message);
              console.log('Problematic JSON line:', jsonStr.length > 100 ? 
                        `${jsonStr.substring(0, 100)}... (truncated)` : jsonStr);
            }
          }
        }
        
        // Keep any remaining incomplete content in the buffer
        if (startIdx < buffer.length) {
          buffer = buffer.substring(startIdx);
        } else {
          buffer = '';
        }
        
      } catch (chunkError) {
        console.error('Error processing chunk:', chunkError);
      }
    });
    
    // Handle stream errors
    response.data.on('error', error => {
      console.error('Stream error:', error);
      socket.emit('error', { 
        message: 'Error during streaming response', 
        error: error.message 
      });
    });
    
  } catch (error) {
    console.error('Error setting up stream:', error);
    socket.emit('error', { 
      message: 'Failed to generate streaming response', 
      error: error.message 
    });
  }
}


/**
 * Process a completed response and finalize message
 * @param {Object} socket - Socket.io socket
 * @param {string} messageId - Message ID
 * @param {string} fullResponse - Complete response text
 * @param {Array} hashtags - Initial hashtags
 * @param {string} sessionId - Session ID
 * @param {number} responseTime - Time taken to generate response
 * @param {string} bubbleColor - Optional bubble color
 * @param {string} textColor - Optional text color
 */
async function processCompletedResponse(socket, messageId, fullResponse, hashtags, 
  sessionId, responseTime, bubbleColor, textColor) {
try {
// Use existing hashtag service to extract hashtags from response
const hashtagResult = await hashtagService.extractHashtags(fullResponse);
const finalTags = hashtagResult.hashtags;

console.log(`Extracted ${finalTags.length} tags using hashtag service:`, finalTags);

// Save response to database with final tags
try {
await db.saveOllamaResponse({
messageId, 
response: fullResponse,
hashtags: finalTags,
sessionId: sessionId
});

console.log(`Saved response to database with ${finalTags.length} tags, messageId: ${messageId}`);
} catch (dbErr) {
console.error('Error saving response to database:', dbErr);
}

// Update session activity
try {
await db.updateSessionActivity(sessionId);
} catch (sessionErr) {
console.error('Error updating session activity:', sessionErr);
}

// Send final signal to client with the extracted hashtags
socket.emit('messageChunk', {
chunk: '',  // Empty chunk signals completion
messageId,
done: true,
hashtags: finalTags,
bubbleColor,
textColor,
responseTime
});
} catch (error) {
console.error('Error in final response processing:', error);

// Still send completion signal even if there was an error
socket.emit('messageChunk', {
chunk: '',
messageId,
done: true,
hashtags: hashtags || [],
bubbleColor,
textColor,
responseTime
});
}
}

/**
 * Makes a request to the Ollama API with proper error handling
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request data
 * @returns {Promise<Object>} Response from Ollama
 */
async function makeOllamaRequest(endpoint, data) {
  // Get configuration from the config manager
  const config = configManager.getConfig();
  
  // Fix potential double "api/" in URL construction
  let baseUrl = config.ollamaApiUrl;
  let apiEndpoint = endpoint;
  
  // Remove trailing slash from base URL if present
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  
  // Handle case where baseUrl already contains /api
  if (baseUrl.endsWith('/api') && endpoint.startsWith('api/')) {
    apiEndpoint = endpoint.substring(4); // Remove the 'api/' prefix
  }
  
  const fullUrl = `${baseUrl}/${apiEndpoint}`;
  console.log(`Making request to ${fullUrl} at ${new Date().toISOString()}...`);
  
  try {
    // Sanitize parameters before sending to avoid type issues
    if (data.temperature !== undefined) {
      // Ensure temperature is a proper number
      data.temperature = Number(data.temperature);
      
      // If after conversion it's not a valid number, remove it
      if (isNaN(data.temperature)) {
        console.warn('Invalid temperature value, removing from request');
        delete data.temperature;
      }
    }
    
    // Similar check for max_tokens if present
    if (data.max_tokens !== undefined) {
      data.max_tokens = Number(data.max_tokens);
      if (isNaN(data.max_tokens)) {
        console.warn('Invalid max_tokens value, removing from request');
        delete data.max_tokens;
      }
    }
    
    // Handle options object if present
    if (data.options && typeof data.options === 'object') {
      // Convert num_predict to integer if it exists
      if (data.options.num_predict !== undefined) {
        data.options.num_predict = parseInt(data.options.num_predict, 10);
        if (isNaN(data.options.num_predict)) {
          console.warn('Invalid num_predict value, removing from request');
          delete data.options.num_predict;
        }
      }
      
      // Convert temperature inside options if it exists
      if (data.options.temperature !== undefined) {
        data.options.temperature = Number(data.options.temperature);
        if (isNaN(data.options.temperature)) {
          console.warn('Invalid temperature in options, removing from request');
          delete data.options.temperature;
        }
      }
    }
    
    // Log request data for debugging
    console.log('Sending request to Ollama:', JSON.stringify(data, null, 2));
    
    const response = await axios.post(fullUrl, data, {
      timeout: 120000, // 2-minute timeout
      headers: { 'Content-Type': 'application/json' }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error calling Ollama API:', error);
    
    // Check for page not found vs. model not found
    if (error.response?.status === 404) {
      const errorData = error.response.data;
      
      // Check if this is a general API 404 (page not found) or specific model 404
      if (errorData === '404 page not found' || typeof errorData === 'string' && errorData.includes('404 page not found')) {
        console.error('API ENDPOINT ERROR: The Ollama API endpoint was not found.');
        console.error(`The requested URL "${fullUrl}" returned a 404 error.`);
        console.error('Check your Ollama API URL configuration. The correct format is usually:');
        console.error('- http://localhost:11434/api (without extra "api/" in endpoints)');
        console.error('- http://your-server-ip:11434/api');
        
        // Create a customized error for this case
        const enhancedError = new Error(`Ollama API endpoint not found: ${fullUrl}`);
        enhancedError.details = {
          message: 'API endpoint not found (404)',
          code: 'API_ENDPOINT_NOT_FOUND',
          status: 404,
          statusText: 'Not Found',
          serverError: false,
          endpoint: fullUrl,
          configuredUrl: config.ollamaApiUrl,
          troubleshooting: [
            'Check if the Ollama server is running',
            'Make sure your API URL configuration is correct', 
            'Try using http://localhost:11434/api as the API URL',
            'The current API URL setting may have an incorrect format'
          ]
        };
        throw enhancedError;
      } else if (data.model) {
        // This is likely a model not found error
        console.error(`404 Not Found: Model "${data.model}" not found.`);
        console.error('1. The model is not installed in Ollama');
        console.error('2. The model name format is incorrect');
        console.error('3. The model might be installed with a different name or tag');
        console.error(`Try running "ollama list" to see all available models`);
      }
    }
    
    // Create a detailed error object with troubleshooting info
    const enhancedError = new Error(`Ollama API request failed: ${error.message}`);
    enhancedError.details = {
      message: error.message,
      code: error.code,
      stack: error.stack,
      status: error.response?.status,
      statusText: error.response?.statusText,
      serverError: error.response?.status >= 500,
      data: error.response?.data
    };
    
    // Add model name if available in the original request
    if (data.model) {
      enhancedError.details.modelName = data.model;
    }
    
    // For 500 errors, add more specific troubleshooting
    if (error.response?.status === 500) {
      const errorText = error.response.data?.error || '';
      enhancedError.details.errorText = errorText;
      
      // Handle common Ollama error patterns
      if (errorText.includes('temperature')) {
        enhancedError.details.parameterError = true;
        console.log('Detected temperature parameter error:', errorText);
        enhancedError.details.troubleshooting = [
          'The temperature parameter must be a valid number between 0 and 1',
          'Remove temperature parameter or provide a valid value'
        ];
      } else if (errorText.includes('no such model')) {
        enhancedError.details.modelError = true;
        enhancedError.details.troubleshooting = [
          `The model "${data.model}" is not installed or available`,
          `Run "ollama pull ${data.model}" to download the model`
        ];
      }
    }
    
    throw enhancedError;
  }
}

// Add a helper function to validate and fix API URL
function validateApiUrl(url) {
  if (!url) {
    return 'http://localhost:11434/api';
  }
  
  try {
    const parsedUrl = new URL(url);
    
    // Make sure URL has /api path
    if (!parsedUrl.pathname.includes('/api')) {
      // Add /api to path
      parsedUrl.pathname = parsedUrl.pathname.endsWith('/') 
        ? `${parsedUrl.pathname}api`
        : `${parsedUrl.pathname}/api`;
    }
    
    // Remove trailing slash if present
    if (parsedUrl.pathname.endsWith('/')) {
      parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
    }
    
    return parsedUrl.toString();
  } catch (e) {
    // If URL parsing fails, return default
    console.warn('Invalid API URL format:', url);
    return 'http://localhost:11434/api';
  }
}

/**
 * Generate a response using Ollama
 * @param {Object} options - Options for generation
 * @returns {Promise<Object>} Generated response
 */
async function generateResponse(options) {
  // Create a sanitized copy of the options
  const sanitizedOptions = { ...options };
  
  // Log the model being used and temperature setting
  const config = configManager.getConfig();
  console.log(`Generating response with model: ${options.model}, temperature: ${options.temperature}`);
  console.log(`Prompt length: ${options.prompt?.length || 0} characters`);
  
  // Ensure mandatory parameters are set
  if (!sanitizedOptions.model) {
    throw new Error('Model name is required for generation');
  }
  
  // Check if model exists before sending request - but don't prevent the request if the check fails
  // since the user has confirmed the model is loaded
  try {
    const availability = await checkModelAvailability(sanitizedOptions.model);
    if (!availability.available) {
      console.warn(`⚠️ Model "${sanitizedOptions.model}" not found in model list, but proceeding anyway as user confirmed it exists`);
      console.log(`Available models according to API: ${availability.availableModels.join(', ')}`);
      
      // Try to find similar model names to help debugging
      const possibleMatches = findSimilarModelNames(sanitizedOptions.model, availability.availableModels);
      if (possibleMatches.length > 0) {
        console.log(`Possible matching models: ${possibleMatches.join(', ')}`);
      }
    } else {
      console.log(`✅ Model "${sanitizedOptions.model}" is available on Ollama server`);
    }
  } catch (availabilityError) {
    // If the check fails, log but continue anyway
    console.warn('Could not verify model availability, proceeding with request anyway:', availabilityError.message);
  }
  
  // Ensure prompt exists
  if (!sanitizedOptions.prompt) {
    console.warn('Empty prompt detected, using a placeholder');
    sanitizedOptions.prompt = 'Hello';
  }
  
  // Handle and validate temperature
  if (sanitizedOptions.temperature !== undefined) {
    // Convert to number and validate
    const temp = Number(sanitizedOptions.temperature);
    if (isNaN(temp)) {
      // If invalid, remove it from request
      console.warn(`Invalid temperature (${sanitizedOptions.temperature}), removing parameter`);
      delete sanitizedOptions.temperature;
    } else {
      // Ensure it's in valid range (0-1)
      sanitizedOptions.temperature = Math.max(0, Math.min(1, temp));
    }
  }
  
  // Handle max_tokens and num_predict
  if (sanitizedOptions.max_tokens !== undefined) {
    sanitizedOptions.max_tokens = parseInt(sanitizedOptions.max_tokens, 10);
    if (isNaN(sanitizedOptions.max_tokens)) {
      delete sanitizedOptions.max_tokens;
    }
  }
  
  // If using the options object format, ensure numeric values are properly typed
  if (sanitizedOptions.options && typeof sanitizedOptions.options === 'object') {
    // Ensure num_predict is an integer
    if (sanitizedOptions.options.num_predict !== undefined) {
      sanitizedOptions.options.num_predict = parseInt(sanitizedOptions.options.num_predict, 10);
      if (isNaN(sanitizedOptions.options.num_predict)) {
        delete sanitizedOptions.options.num_predict;
      }
    }
  }
  
  try {
    return await makeOllamaRequest('api/generate', sanitizedOptions);
  } catch (error) {
    // Re-throw with more context if needed
    if (error.details?.parameterError) {
      console.error('Parameter error detected in request:', sanitizedOptions);
    } else if (error.response?.status === 404) {
      // Specific handling for 404 errors (model not found)
      console.error(`404 Error: Model "${sanitizedOptions.model}" not found`);
      error.details = {
        ...error.details,
        modelName: sanitizedOptions.model,
        modelError: true,
        possibleModelIssue: true,
        troubleshooting: [
          `The model "${sanitizedOptions.model}" is not installed on your Ollama server`,
          `Run "ollama pull ${sanitizedOptions.model}" to download this model`,
          'Check that the model name is spelled correctly',
          'Run "ollama list" to see all available models'
        ]
      };
    } else if (error.response?.data?.error) {
      // Extract specific error details from Ollama
      const errorMsg = error.response.data.error;
      console.error('Ollama API error details:', errorMsg);
      
      // Add better error context based on the error message
      if (errorMsg.includes('must be of type integer')) {
        error.details = {
          ...error.details,
          parameterError: true,
          errorType: 'type_error',
          message: `Parameter type error: ${errorMsg}`
        };
      }
    }
    throw error;
  }
}

/**
 * Test connection to Ollama API
 * @returns {Promise<boolean>} Connection successful
 */
async function testConnection() {
  try {
    const config = configManager.getConfig();
    
    // Use the validated URL
    const baseUrl = validateApiUrl(config.ollamaApiUrl);
    
    console.log(`Testing connection to Ollama API at ${baseUrl}`);
    
    // Use simple GET request to check if server is responding
    // Remove /api from baseUrl if it's already included
    const tagsUrl = baseUrl.endsWith('/api') 
      ? `${baseUrl}/tags` 
      : `${baseUrl}/api/tags`;
      
    console.log(`Checking models at URL: ${tagsUrl}`);
    const response = await axios.get(tagsUrl, { timeout: 5000 });
    
    if (response.status === 200) {
      console.log('✅ Successfully connected to Ollama API');
      serviceEvents.emit('connection', { success: true });
      return true;
    } else {
      console.log(`❌ Failed to connect to Ollama API: Unexpected status code ${response.status}`);
      serviceEvents.emit('connection', { success: false, status: response.status });
      return false;
    }
  } catch (error) {
    console.log('❌ Failed to connect to Ollama API:', error.message);
    serviceEvents.emit('connection', { 
      success: false, 
      error: error.message,
      code: error.code,
      status: error.response?.status
    });
    return false;
  }
}

/**
 * Get available models from Ollama API
 * @returns {Promise<Array>} Array of available models
 */
async function getModels() {
  try {
    const config = configManager.getConfig();
    const baseUrl = validateApiUrl(config.ollamaApiUrl);
    
    // Use GET request to retrieve models
    // Handle /api properly in URL construction
    const tagsUrl = baseUrl.endsWith('/api') 
      ? `${baseUrl}/tags` 
      : `${baseUrl}/api/tags`;
      
    console.log(`Fetching models from: ${tagsUrl}`);
    const response = await axios.get(tagsUrl, { timeout: 10000 });
    
    if (response.status === 200 && response.data) {
      return response.data.models || [];
    } else {
      return [];
    }
  } catch (error) {
    console.error('Error fetching models from Ollama:', error);
    // Return empty array instead of throwing - this is more resilient
    return [];
  }
}

/**
 * Check if a specific model is available on the Ollama server
 * @param {string} modelName - Model name to check
 * @returns {Promise<Object>} Result with availability status
 */
async function checkModelAvailability(modelName) {
  try {
    // Get all available models
    const models = await getModels();
    
    // If we couldn't get any models, log and return a default response
    if (!models || models.length === 0) {
      console.warn('No models returned from Ollama API');
      return {
        available: false,
        modelName: modelName,
        availableModels: [],
        pullCommand: `ollama pull ${modelName}`,
        error: 'Could not retrieve models list'
      };
    }
    
    // Log all available models to help with debugging
    console.log('Available models from Ollama API:', models.map(m => m.name).join(', '));
    
    // Check if the requested model is in the list - with more flexible matching
    const normalizedRequestedModel = modelName.toLowerCase().trim();
    const isAvailable = models.some(model => {
      const normalizedModelName = model.name.toLowerCase().trim();
      
      // Check for exact match or match without tags
      return normalizedModelName === normalizedRequestedModel || 
             normalizedModelName.split(':')[0] === normalizedRequestedModel ||
             normalizedRequestedModel.includes(normalizedModelName);
    });
    
    return {
      available: isAvailable,
      modelName: modelName,
      availableModels: models.map(model => model.name),
      pullCommand: `ollama pull ${modelName}`
    };
  } catch (error) {
    console.error('Error checking model availability:', error);
    throw error;
  }
}

/**
 * Find models with similar names to help with debugging
 * @param {string} modelName - The requested model name
 * @param {Array<string>} availableModels - List of available model names
 * @returns {Array<string>} List of similar model names
 */
function findSimilarModelNames(modelName, availableModels) {
  if (!modelName || !availableModels || availableModels.length === 0) {
    return [];
  }
  
  const normalizedRequestedModel = modelName.toLowerCase().trim();
  const baseModelName = normalizedRequestedModel.split(':')[0]; // Remove tags
  
  return availableModels.filter(model => {
    const normalizedName = model.toLowerCase();
    
    // Check for partial matches
    return normalizedName.includes(baseModelName) || 
           baseModelName.includes(normalizedName) ||
           // Check for similar model families
           (normalizedName.includes('llama') && baseModelName.includes('llama')) ||
           (normalizedName.includes('mistral') && baseModelName.includes('mistral'));
  });
}

// Add a diagnostic function to test models
async function diagnoseModel(modelName) {
  try {
    // First check if the model exists
    const models = await getModels();
    const modelExists = models.some(model => model.name === modelName);
    
    if (!modelExists) {
      return {
        status: 'not_found',
        message: `Model "${modelName}" is not installed in Ollama`,
        recommendation: 'Install the model using Ollama CLI or try using a different model'
      };
    }
    
    // Try a minimal completion to test the model
    const testResult = await generateResponse({
      model: modelName,
      prompt: 'Say hello in one word.',
      stream: false,
      temperature: 0.1,
      max_tokens: 10
    });
    
    return {
      status: 'ok',
      message: `Model "${modelName}" is working properly`,
      sample_response: testResult.response
    };
  } catch (error) {
    return {
      status: 'error',
      message: `Model "${modelName}" encountered an error`,
      error: error.details || error.message,
      recommendation: 'The model may be corrupted or incompatible. Consider removing and reinstalling it.'
    };
  }
}

module.exports = {
  generateResponse,
  testConnection,
  getModels,
  checkModelAvailability,
  serviceEvents,
  diagnoseModel,
  makeOllamaRequest,
  getCompletion,
  streamCompletion,
  findRelatedConversation,
  processCompletedResponse
};