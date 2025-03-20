// socket/socket-handler.js
const db = require('../db');
const ollamaService = require('../services/ollama-service');
const hashtagService = require('../services/hashtag-service');
const { processHashtags } = require('../utils/tag-utils');
// Add this near the top of your file
const debug = require('debug')('ollama:tags');
// If you don't have debug installed, add simple debug function:
// const debug = (...args) => console.log('[TAG DEBUG]', ...args);

/**
 * Utility function to ensure hashtags are properly formatted
 * @param {*} hashtags - Hashtags in any format
 * @returns {string[]} - Array of properly formatted hashtag strings
 */
function ensureHashtagFormat(hashtags) {
  console.log('Ensuring hashtag format for:', hashtags);
  
  if (!hashtags) {
    console.log('Hashtags input is null or undefined, returning empty array');
    return [];
  }
  
  // Convert to array if not already
  let hashtagArray = Array.isArray(hashtags) ? hashtags : [hashtags];
  
  // Format each hashtag properly
  const formatted = hashtagArray.map(tag => {
    if (!tag) return null;
    
    if (typeof tag === 'string') {
      const cleaned = tag.trim();
      return cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
    } else if (typeof tag === 'object' && tag.name) {
      const cleaned = tag.name.trim();
      return cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
    }
    
    const stringTag = String(tag).trim();
    return stringTag.startsWith('#') ? stringTag : `#${stringTag}`;
  }).filter(tag => tag && tag.length > 1);
  
  console.log(`Formatted ${formatted.length} hashtags:`, formatted);
  return formatted;
}

/**
 * Initialize Socket.IO connections
 * @param {Object} io - Socket.IO server instance
 * @param {Function} getConfig - Function to get current configuration
 */
function initialize(io, getConfig) {
  io.on('connection', (socket) => {
    console.log('New client connected');
    
    // Create a new session ID for this connection
    const sessionId = crypto.randomUUID();
    socket.data.sessionId = sessionId;
    
    // Emit session created event
    socket.emit('sessionCreated', { 
      sessionId, 
      timestamp: new Date().toISOString() 
    });
    
    // Create db session record
    db.createSession(sessionId).catch(err => {
      console.error('Error creating session:', err);
    });
    
    // Handle message from client with streaming support
    socket.on('sendMessage', async (message) => {
      try {
        // Get current session ID
        const sessionId = socket.data.sessionId;
        
        if (!sessionId) {
          socket.emit('error', { message: 'No active session' });
          return;
        }
        
        // Validate or create session before processing message
        try {
          await db.createOrValidateSession(sessionId);
        } catch (sessionErr) {
          console.error('Session validation error:', sessionErr);
          socket.emit('error', { 
            message: 'Session error', 
            details: 'Could not validate your session. Please refresh the page.'
          });
          return;
        }
        
        // Now get chatbot and process message as before
        // Get current chatbot ID if set
        let chatbotId = null;
        try {
          const sessionChatbot = await db.getSessionChatbot(sessionId);
          if (sessionChatbot) {
            chatbotId = sessionChatbot.chatbot_id;
          }
        } catch (err) {
          console.error('Error getting session chatbot:', err);
        }
        
        // Update session last activity
        db.updateSessionActivity(sessionId).catch(err => {
          console.error('Error updating session activity:', err);
        });
        
        // Use streaming response handler
        ollamaService.streamCompletion(socket, sessionId, message, chatbotId);
        
      } catch (error) {
        console.error('Error handling message:', error);
        socket.emit('error', { 
          message: 'Error processing your message', 
          details: error.message 
        });
      }
    });
    
    // Other socket handlers...
  });
}

// Add this method to provide a default chatbot configuration
async function getDefaultChatbotConfig() {
  // Create a default chatbot configuration if no specific configuration is found
  return {
    id: 1,
    name: 'Assistant',
    settings: {
      system_prompt: 'You are a helpful AI assistant. Always be kind, direct, and informative.',
      personality: 'Friendly and helpful',
      character_history: 'A general-purpose AI assistant designed to help users with a wide variety of tasks.',
      bubble_color: '#f8f8f8',
      text_color: '#000000'
    },
    examples: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there! How can I help you today?' }
    ]
  };
}

// Helper function to get a valid numeric chatbot ID
function getNormalizedChatbotId(chatbotConfig) {
  // If chatbot config is null or undefined
  if (!chatbotConfig) {
    console.warn('No chatbot configuration found, using default');
    return 1; // Default to first chatbot
  }

  // If ID is already a number, return it
  if (typeof chatbotConfig.id === 'number') {
    return chatbotConfig.id;
  }

  // Try to convert string ID to number
  const numericId = parseInt(chatbotConfig.id, 10);
  if (!isNaN(numericId)) {
    return numericId;
  }

  // Fallback to default
  console.warn('Invalid chatbot ID, using default');
  return 1;
}

/**
 * Handle user message, generate response and process hashtags
 * @param {Object} socket - Socket.IO socket instance
 * @param {string} message - User message
 * @param {Function} getConfig - Function to get current configuration
 */
async function handleUserMessage(socket, message, getConfig) {
  // Check if we have a valid session
  if (!socket.sessionId) {
    // Try to create a session as a fallback
    try {
      const clientInfo = JSON.stringify({
        userAgent: socket.handshake.headers['user-agent'] || 'Unknown',
        ip: socket.handshake.address || 'Unknown',
        time: new Date().toISOString(),
        note: 'Created during message handling (fallback)'
      });

      socket.sessionId = await db.createSession(clientInfo);
      console.log(`Created fallback session ${socket.sessionId} for socket ${socket.id}`);
    } catch (error) {
      console.error('Failed to create fallback session:', error);
      socket.emit('messageResponse', {
        role: 'system',
        content: 'Error: Could not create chat session. Please refresh the page and try again.'
      });
      return;
    }
  }

  // Fallback default chatbot configuration
  const getDefaultChatbotConfig = () => ({
    id: 'default_chatbot',
    name: 'Assistant',
    settings: {
      system_prompt: 'You are a helpful AI assistant. Always be kind, direct, and informative.',
      personality: 'Friendly and helpful',
      character_history: 'A general-purpose AI assistant designed to help users with a wide variety of tasks.',
      bubble_color: '#f8f8f8',
      text_color: '#000000'
    },
    examples: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there! How can I help you today?' }
    ]
  });

  // Variable to store message details for later use with response
  let userMessageDetails = null;

  try {
    // Try to get the chatbot configuration for this session
    let chatbotConfig;
    try {
      chatbotConfig = await db.getSessionChatbot(socket.sessionId);
    } catch (configError) {
      console.warn('Could not retrieve session chatbot, using default:', configError);
      chatbotConfig = getDefaultChatbotConfig();
    }

    // Ensure we have a valid chatbot configuration
    if (!chatbotConfig) {
      chatbotConfig = getDefaultChatbotConfig();
    }

    console.log(`Using chatbot "${chatbotConfig.name}" for session ${socket.sessionId}`);

    // Get chatbot colors
    const bubbleColor = chatbotConfig.settings.bubble_color || '#f8f8f8';
    const textColor = chatbotConfig.settings.text_color || '#000000';

    // Generate hashtags for the user message with better error handling
    let rawUserHashtags = [];
    try {
      console.log('Generating hashtags for user message');
      rawUserHashtags = await hashtagService.generateUserMessageHashtags(message, 6);
      console.log(`Raw user hashtags (${rawUserHashtags.length}):`, rawUserHashtags);
    } catch (hashtagError) {
      console.error('Error generating user message hashtags:', hashtagError);
    }
    
    // Process hashtags to filter blocked tags and use better alternatives
    let userHashtags = [];
    try {
      userHashtags = await processHashtags(rawUserHashtags);
      console.log(`Processed user hashtags (${userHashtags.length}):`, userHashtags);
    } catch (processError) {
      console.error('Error processing hashtags:', processError);
      userHashtags = rawUserHashtags; // Fallback to unprocessed hashtags
    }

    // Save user message to database with proper error handling
    try {
      console.log(`Saving user message with ${userHashtags.length} hashtags:`, userHashtags);
      console.log(`Raw hashtags type: ${typeof userHashtags}, isArray: ${Array.isArray(userHashtags)}`);
      
      // First define formatted hashtags
      const formattedUserHashtags = userHashtags.map(tag => {
        // If the tag is already a string, use it as is
        if (typeof tag === 'string') {
          return tag.trim();
        } 
        // If the tag is an object with a name property, use that
        else if (tag && typeof tag === 'object' && tag.name) {
          return tag.name.trim();
        }
        return String(tag).trim();
      }).filter(tag => tag.length > 0);
      
      console.log(`Formatted hashtags (${formattedUserHashtags.length}):`, formattedUserHashtags);
      
      // Now we can use formattedUserHashtags in the DB parameters
      const dbParams = {
        sessionId: socket.sessionId,
        message: message,
        hashtags: formattedUserHashtags
      };
      
      console.log('Database parameters:', JSON.stringify(dbParams));
      
      userMessageDetails = await db.saveUserMessage(
        socket.sessionId, 
        message, 
        formattedUserHashtags
      );
      
      console.log(`Saved user message to database with ID: ${userMessageDetails.id}, message ID: ${userMessageDetails.messageId}`);

      // Send the user hashtags back to the client immediately
      if (formattedUserHashtags.length > 0) {
        console.log('Emitting user hashtags to client');
        socket.emit('hashtagsUpdate', {
          role: 'user',
          hashtags: formattedUserHashtags,
          messageId: userMessageDetails.messageId
        });

        // Update current hashtags in socket for context
        socket.currentHashtags = formattedUserHashtags;
      }
    } catch (dbError) {
      console.error('Error saving user message to database:', dbError);
      // Continue execution even if database save fails
    }

    // Generate response from Ollama with chatbot configuration included
    try {
      // Prepare the message with the chatbot's personality included
      let enhancedMessage = message;

      // Add chatbot configuration as context
      if (chatbotConfig.settings) {
        // Build system prompt from settings
        let systemPrompt = chatbotConfig.settings.system_prompt || '';

        if (chatbotConfig.settings.personality) {
          systemPrompt += `\nPersonality: ${chatbotConfig.settings.personality}`;
        }

        if (chatbotConfig.settings.character_history) {
          systemPrompt += `\nBackground: ${chatbotConfig.settings.character_history}`;
        }

        // Add example conversations if available
        if (chatbotConfig.examples && chatbotConfig.examples.length > 0) {
          systemPrompt += '\n\nHere are some examples of how you should respond:';

          // Group examples by pairs
          for (let i = 0; i < chatbotConfig.examples.length; i += 2) {
            if (i + 1 < chatbotConfig.examples.length) {
              const userExample = chatbotConfig.examples[i];
              const assistantExample = chatbotConfig.examples[i + 1];

              if (userExample.role === 'user' && assistantExample.role === 'assistant') {
                systemPrompt += `\n\nUser: ${userExample.content}\nAssistant: ${assistantExample.content}`;
              }
            }
          }
        }

        // Add the system prompt to the beginning of the message
        enhancedMessage = `${systemPrompt}\n\n# Current Conversation\nUser: ${message}`;
        console.log('Enhanced message with chatbot configuration');
      }

      // Send the enhanced message to Ollama
      const config = getConfig();
      
      // Ensure temperature is a valid float32
      let temperature = 0.7; // Default fallback value
      if (config.temperature !== undefined && config.temperature !== null) {
        // Try to convert to float and validate
        temperature = parseFloat(config.temperature);
        
        // Check if it's a valid number
        if (isNaN(temperature)) {
          console.warn(`Invalid temperature value: ${config.temperature}, using default 0.7`);
          temperature = 0.7;
        }
        
        // Clamp between 0 and 1
        temperature = Math.max(0, Math.min(1, temperature));
      }
      
      const response = await ollamaService.generateResponse({
        model: config.defaultModel,
        prompt: enhancedMessage,
        system: chatbotConfig.settings.system_prompt,
        temperature: temperature, // Use validated temperature
        max_tokens: config.maxTokens
      });

      // Process the response
      // Modified section for standard response processing
      if (response && response.response) {
        console.log('Processing regular response data...');
        console.log('Response data preview:', response.response.substring(0, 100) + '...');
        
        // Extract hashtags from the response with better error handling
        let assistantHashtags = [];
        let content = response.response;
        try {
          const hashtagResult = await hashtagService.extractHashtags(response.response, 6);
          content = hashtagResult.content || response.response;
          assistantHashtags = hashtagResult.hashtags || [];
          
          console.log(`Generated ${assistantHashtags.length} hashtags for response:`, assistantHashtags);
          
          if (!assistantHashtags || assistantHashtags.length === 0) {
            console.log('No hashtags extracted, trying direct generation');
            const directHashtags = await hashtagService.generateUserMessageHashtags(response.response, 6);
            assistantHashtags = directHashtags || [];
            console.log(`Generated ${assistantHashtags.length} hashtags with direct generation:`, assistantHashtags);
          }
        } catch (hashtagError) {
          console.error('Error generating hashtags for response:', hashtagError);
          assistantHashtags = ['#response', '#ai']; // Default fallback hashtags
          console.log('Using default hashtags due to error:', assistantHashtags);
        }
        
        // Process hashtags to filter blocked tags and use better alternatives
        let processedHashtags = [];
        try {
          processedHashtags = await processHashtags(assistantHashtags);
          console.log(`Processed response hashtags (${processedHashtags.length}):`, processedHashtags);
        } catch (processError) {
          console.error('Error processing hashtags:', processError);
          processedHashtags = assistantHashtags; // Use unprocessed on error
        }
        
        // Format hashtags for database storage
        const formattedAssistantHashtags = processedHashtags.map(tag => {
          if (typeof tag === 'string') {
            const cleanTag = tag.trim();
            return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
          } else if (tag && typeof tag === 'object' && tag.name) {
            const cleanTag = tag.name.trim();
            return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
          }
          return `#${String(tag).trim()}`;
        }).filter(tag => tag.length > 1);
        
        console.log(`Final formatted assistant hashtags (${formattedAssistantHashtags.length}):`, formattedAssistantHashtags);

        // Update current hashtags in socket for context
        socket.currentHashtags = formattedAssistantHashtags;

        // Ensure chatbotId is an integer when saving the response
        const chatbotId = getNormalizedChatbotId(chatbotConfig);

        // Save response to database with proper error handling
        let responseDetails = null;
        try {
          if (userMessageDetails && userMessageDetails.id) {
            responseDetails = await db.saveOllamaResponse(
              socket.sessionId,
              content,
              userMessageDetails.id,
              formattedAssistantHashtags, // Use formatted hashtags
              chatbotId
            );
            console.log(`Saved response to DB with ID: ${responseDetails.id}, message ID: ${responseDetails.messageId}, hashtags: ${formattedAssistantHashtags.length}`);
            
            // Store the message ID on the socket for future tag additions
            socket.lastAssistantMessageId = responseDetails.messageId;
            console.log(`Stored last assistant message ID on socket: ${socket.lastAssistantMessageId}`);
          } else {
            // Add fallback for when userMessageDetails is not available
            responseDetails = await db.saveOllamaResponse(
              socket.sessionId,
              content,
              null,
              formattedAssistantHashtags, // Use formatted hashtags
              chatbotId
            );
            
            // Store the message ID on the socket even in fallback case
            if (responseDetails && responseDetails.messageId) {
              socket.lastAssistantMessageId = responseDetails.messageId;
              console.log(`Stored last assistant message ID on socket (fallback): ${socket.lastAssistantMessageId}`);
            }
          }
        } catch (dbError) {
          console.error('Error saving response to database:', dbError);
          // Continue execution even if database save fails
        }

        // Send response with hashtags to client
        console.log(`Sending response to client with ${formattedAssistantHashtags.length} hashtags`);

        // Store the message ID on the socket for future tag additions
        socket.lastAssistantMessageId = responseDetails ? responseDetails.messageId : null;

        socket.emit('messageResponse', {
          role: 'assistant',
          content: content,
          hashtags: formattedAssistantHashtags,
          messageId: responseDetails ? responseDetails.messageId : null,
          chatbotId: chatbotId,
          bubbleColor: bubbleColor,
          textColor: textColor
        });
        
        // Send separate hashtag update to ensure client receives them
        if (formattedAssistantHashtags.length > 0) {
          console.log('Explicitly sending assistant hashtags update to client');
          socket.emit('hashtagsUpdate', {
            role: 'assistant',
            hashtags: formattedAssistantHashtags,
            messageId: responseDetails ? responseDetails.messageId : null
          });
        }

        console.log('Response processing complete');
      } 
      // Modified section for streaming response processing
      else if (response && typeof response === 'string' && response.includes('"done":true')) {
        console.log('Processing streaming response');
        try {
          // Split the response by newlines and parse each line as JSON
          const lines = response.split('\n').filter(line => line.trim() !== '');
          let combinedResponse = '';
          
          // Combine all the response tokens
          lines.forEach(line => {
            try {
              const jsonObj = JSON.parse(line);
              if (jsonObj.response) {
                combinedResponse += jsonObj.response;
              }
            } catch (parseError) {
              console.warn('Error parsing JSON line:', parseError);
            }
          });
          
          console.log('Combined streaming response:', combinedResponse.substring(0, 100) + '...');
          
          // Generate hashtags for streaming response with better error handling
          console.log('Generating hashtags for streaming response');
          let streamingHashtags = [];
          let streamingContent = combinedResponse;
          
          try {
            const hashtagResult = await hashtagService.extractHashtags(combinedResponse, 6);
            streamingContent = hashtagResult.content || combinedResponse;
            streamingHashtags = hashtagResult.hashtags || [];
            
            console.log(`Extracted ${streamingHashtags.length} hashtags from streaming response:`, streamingHashtags);
            
            if (!streamingHashtags || streamingHashtags.length === 0) {
              console.log('No hashtags extracted, trying direct generation');
              const directHashtags = await hashtagService.generateUserMessageHashtags(combinedResponse, 6);
              streamingHashtags = directHashtags || [];
              console.log(`Generated ${streamingHashtags.length} hashtags with direct generation:`, streamingHashtags);
            }
          } catch (streamHashtagError) {
            console.error('Error generating hashtags for streaming response:', streamHashtagError);
            streamingHashtags = [];
          }
          
          // Process hashtags for streaming response
          let processedStreamingHashtags = [];
          try {
            processedStreamingHashtags = await processHashtags(streamingHashtags);
            console.log(`Processed streaming hashtags (${processedStreamingHashtags.length}):`, processedStreamingHashtags);
          } catch (processError) {
            console.error('Error processing streaming hashtags:', processError);
            processedStreamingHashtags = streamingHashtags; // Use unprocessed on error
          }
          
          // Format hashtags for database storage - ensure # prefix
          const formattedStreamingHashtags = processedStreamingHashtags.map(tag => {
            if (typeof tag === 'string') {
              const cleanTag = tag.trim();
              return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
            } else if (tag && typeof tag === 'object' && tag.name) {
              const cleanTag = tag.name.trim();
              return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
            }
            return `#${String(tag).trim()}`;
          }).filter(tag => tag.length > 1);
          
          console.log(`Formatted streaming hashtags (${formattedStreamingHashtags.length}):`, formattedStreamingHashtags);
          
          // Update current hashtags in socket
          socket.currentHashtags = formattedStreamingHashtags;
          
          // Ensure chatbotId is an integer
          const chatbotId = getNormalizedChatbotId(chatbotConfig);
          
          // Save streaming response to database with proper error handling
          let responseDetails = null;
          try {
            if (userMessageDetails && userMessageDetails.id) {
              responseDetails = await db.saveOllamaResponse(
                socket.sessionId,
                streamingContent,
                userMessageDetails.id,
                formattedStreamingHashtags, // Use formatted hashtags
                chatbotId
              );
              console.log(`Saved streaming response to DB with ID: ${responseDetails?.id}, messageId: ${responseDetails?.messageId}`);
            } else {
              // Add fallback for when userMessageDetails is not available
              responseDetails = await db.saveOllamaResponse(
                socket.sessionId,
                streamingContent,
                null,
                formattedStreamingHashtags,
                chatbotId
              );
              console.log(`Saved streaming response to DB without message reference, ID: ${responseDetails?.id}`);
            }
          } catch (dbError) {
            console.error('Error saving streaming response to database:', dbError);
          }
          
          // Send streaming response with hashtags to client
          console.log(`Sending streaming response to client with ${formattedStreamingHashtags.length} hashtags`);
          socket.emit('messageResponse', {
            role: 'assistant',
            content: streamingContent,
            hashtags: formattedStreamingHashtags, // Use formatted hashtags
            messageId: responseDetails ? responseDetails.messageId : null,
            chatbotId: chatbotId,
            bubbleColor: bubbleColor,
            textColor: textColor
          });
          
          // Send separate hashtag update for streaming response
          if (formattedStreamingHashtags.length > 0) {
            console.log('Explicitly sending streaming hashtags update to client');
            socket.emit('hashtagsUpdate', {
              role: 'assistant',
              hashtags: formattedStreamingHashtags,
              messageId: responseDetails ? responseDetails.messageId : null
            });
          }
          
          console.log('Streaming response processing complete');
        } catch (streamError) {
          console.error('Failed to process streaming response:', streamError);
          // Proper error handling for streaming errors
          socket.emit('messageResponse', {
            role: 'assistant',
            content: 'Error: Failed to process streaming response from the Ollama server.',
            chatbotId: getNormalizedChatbotId(chatbotConfig), // Use function directly
            bubbleColor: bubbleColor,
            textColor: textColor
          });
        }
      } else {
        console.error('Response received but data is invalid:', JSON.stringify(response));
        // Fix: Use getNormalizedChatbotId function directly instead of referencing undefined chatbotId
        const normalizedChatbotId = getNormalizedChatbotId(chatbotConfig);
        socket.emit('messageResponse', {
          role: 'assistant',
          content: 'Error: Received an invalid response from the Ollama server.',
          chatbotId: normalizedChatbotId, // Use the local variable
          bubbleColor: bubbleColor,
          textColor: textColor
        });
      }
    } catch (error) {
      console.error('Error generating response:', error);
      
      // Enhanced error handling with more user-friendly messages
      let errorMessage = 'Failed to generate a response';
      let troubleshootingSteps = [];
      
      // Get config to access the model name
      const config = getConfig();
      
      // Extract model name for more helpful error messages
      const modelName = config?.defaultModel || 'unknown';
      
      // Check for Axios errors (from HTTP requests)
      if (error.isAxiosError) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        
        // Log the complete error details for debugging
        console.log('Complete Ollama API error:', {
          status,
          data: errorData,
          message: error.message,
          code: error.code
        });
        
        // Handle specific HTTP status codes
        if (status === 500) {
          errorMessage = `The Ollama server encountered an internal error (500)`;
          troubleshootingSteps = [
            'The model may have crashed due to insufficient memory',
            'Try using a smaller model or increasing system resources',
            `Run "ollama pull ${modelName}" to ensure the model is properly installed`
          ];
          
          // Add specific error details if available
          if (errorData?.error) {
            // Check for specific known error patterns
            if (errorData.error.includes('temperature')) {
              errorMessage = `Parameter error: ${errorData.error}`;
              troubleshootingSteps = [
                'The temperature value must be a valid number between 0 and 1',
                'Check your configuration and try again'
              ];
            } else if (errorData.error.includes('model')) {
              errorMessage = `Model error: ${errorData.error}`;
              troubleshootingSteps = [
                `Run "ollama pull ${modelName}" to reinstall the model`,
                'Try a different model to see if the issue persists'
              ];
            } else {
              troubleshootingSteps.unshift(`Error details: ${errorData.error}`);
            }
          }
        } else if (status === 404) {
          errorMessage = `Model "${modelName}" not found`;
          troubleshootingSteps = [
            `Run "ollama pull ${modelName}" to download the model`,
            'Check if the model name is spelled correctly'
          ];
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
          errorMessage = 'Cannot connect to Ollama server';
          troubleshootingSteps = [
            'Make sure the Ollama server is running',
            'Run "ollama serve" in your terminal'
          ];
        } else if (error.code === 'ERR_BAD_RESPONSE') {
          // Handle specific ERR_BAD_RESPONSE error code
          errorMessage = `The Ollama server returned a malformed response`;
          troubleshootingSteps = [
            'The Ollama server may have crashed while generating a response',
            'The model may be too large for your available memory',
            'Try using a smaller model or increasing RAM allocation',
            `Run "ollama pull ${modelName}" to reinstall the model`
          ];
          
          // Check if there's a specific message in the error
          if (error.message && error.message.includes('500')) {
            troubleshootingSteps.unshift('Ollama returned a 500 internal server error');
          }
        } else if (error.details) {
          // Handle detailed errors from our service layer
          if (error.details.serverError) {
            errorMessage = 'The AI model encountered an internal error';
            if (error.details.possibleModelIssue) {
              errorMessage += ` with model "${error.details.modelName || modelName}"`;
              troubleshootingSteps = error.details.troubleshooting || [];
            }
          } else if (error.details.status === 404) {
            errorMessage = 'The requested model could not be found';
            troubleshootingSteps = [
              'Check if the model name is spelled correctly',
              'Make sure the model is installed in Ollama',
              'Try running "ollama list" in your terminal to see available models'
            ];
          }
        }
      } else if (error.details) {
        // Handle detailed errors from our service layer
        if (error.details.serverError) {
          errorMessage = 'The AI model encountered an internal error';
          if (error.details.possibleModelIssue) {
            errorMessage += ` with model "${error.details.modelName || modelName}"`;
            troubleshootingSteps = error.details.troubleshooting || [];
          }
        } else if (error.details.status === 404) {
          errorMessage = 'The requested model could not be found';
          troubleshootingSteps = [
            'Check if the model name is spelled correctly',
            'Make sure the model is installed in Ollama',
            'Try running "ollama list" in your terminal to see available models'
          ];
        }
      }
      
      // Add debugging information to the console for all errors
      console.log('Sending error to client:', {
        message: errorMessage,
        troubleshooting: troubleshootingSteps,
        details: error.response?.data || error.message
      });
      
      // Send error to client
      socket.emit('error', {
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? (error.response?.data || error.message) : undefined,
        troubleshooting: troubleshootingSteps,
        messageId: userMessageDetails?.id,
        modelName: modelName
      });
    }
  } catch (error) {
    console.error('Error processing message:', error);
    socket.emit('messageResponse', {
      role: 'assistant',
      content: `Error processing your message: ${error.message}`
    });
  }
}

/**
 * Handle errors from Ollama API with chatbot information
 * @param {Object} socket - Socket.IO socket instance
 * @param {Object} error - Error object
 * @param {Object} chatbotConfig - Chatbot configuration or null
 */
function handleOllamaError(socket, error, chatbotConfig = null) {
  console.error('Error from Ollama API:', error);

  let errorMessage = 'Error: Could not connect to Ollama server. Make sure it is running.';
  let diagnosticDetails = '';

  if (error.connectionError) {
    errorMessage = `Connection Error: Cannot reach the Ollama server. Please check that Ollama is running and reachable at the configured URL.`;
    diagnosticDetails = 'Run "ollama serve" in your terminal to start the Ollama server.';
  } else if (error.code === 'ECONNREFUSED') {
    errorMessage = `Connection Refused: The Ollama server refused the connection. Make sure Ollama is running.`;
    diagnosticDetails = 'Run "ollama serve" in your terminal or check your firewall settings.';
  } else if (error.code === 'ECONNABORTED' || error.timeout) {
    errorMessage = `Timeout: The request to Ollama timed out. The server might be overloaded or the model is too large for your system resources.`;
    diagnosticDetails = 'Try using a smaller model or increasing system resources.';
  } else if (error.status === 404) {
    // Check if it's a model not found error
    if (error.modelName) {
      errorMessage = `Model Not Found: Model "${error.modelName}" is not available on your Ollama server.`;
      diagnosticDetails = `Run "ollama pull ${error.modelName}" in your terminal to download this model.`;
    } else {
      errorMessage = `API Error 404: ${error.data?.error || 'Unknown error'}. API endpoint may be incorrect.`;
      diagnosticDetails = 'Check your Ollama API URL configuration.';
    }
  } else if (error.status === 500) {
    errorMessage = `Server Error: The Ollama server encountered an internal error.`;
    
    // Check for common error messages in the response
    if (error.data?.error) {
      const errorText = error.data.error;
      
      if (errorText.includes('connection was forcibly closed')) {
        errorMessage = 'Ollama crashed or was terminated while generating a response.';
        diagnosticDetails = 'This often happens when the model is too large for your available memory. Try using a smaller model.';
      } else if (errorText.includes('out of memory')) {
        errorMessage = 'Ollama ran out of memory while loading or running the model.';
        diagnosticDetails = 'Your system does not have enough RAM for this model. Try a smaller model or increase system memory.';
      } else if (errorText.includes('no such file')) {
        errorMessage = `Model files not found or corrupt. The model may need to be re-downloaded.`;
        diagnosticDetails = `Try running "ollama pull ${error.modelName || 'your-model'}" to reinstall the model.`;
      } else {
        // Include the actual error message from Ollama if available
        diagnosticDetails = `Technical details: ${errorText}`;
      }
    }
  } else if (error.status) {
    errorMessage = `Error ${error.status}: Request to Ollama failed.`;
    
    if (error.data?.error) {
      diagnosticDetails = `Technical details: ${error.data.error}`;
    }
  }

  // Combine main message with diagnostic details
  const fullMessage = diagnosticDetails ? 
    `${errorMessage}\n\n${diagnosticDetails}` : 
    errorMessage;

  // Get chatbot colors if available
  const bubbleColor = chatbotConfig?.settings?.bubble_color || '#f8f8f8';
  const textColor = chatbotConfig?.settings?.text_color || '#000000';

  // Try to log the error as a system message
  if (socket.sessionId) {
    try {
      // Fix: Use chatbotConfig?.id instead of chatbotId
      db.logSystemMessage(
        socket.sessionId,
        fullMessage,
        chatbotConfig?.id || null
      ).catch(err => console.error('Failed to log error as system message:', err));
    } catch (logError) {
      console.error('Error logging system message:', logError);
    }
  }

  socket.emit('messageResponse', {
    role: 'assistant',
    content: fullMessage,
    chatbotId: chatbotConfig?.id || null,
    bubbleColor: bubbleColor,
    textColor: textColor
  });
}

/**
 * Debug helper to inspect hashtag generation and processing
 * @param {Array|Object} hashtags - Raw hashtags or hashtag result object
 * @param {string} source - Source of the hashtags (e.g., 'user', 'assistant')
 * @returns {Array} - Cleaned hashtag array
 */
function debugHashtags(hashtags, source) {
  console.log(`DEBUG: Inspecting hashtags from ${source}`);
  
  if (!hashtags) {
    console.log(`DEBUG: Hashtags from ${source} is null or undefined`);
    return [];
  }
  
  if (Array.isArray(hashtags)) {
    console.log(`DEBUG: Got array of ${hashtags.length} hashtags from ${source}`);
    
    // Log the first few hashtags
    if (hashtags.length > 0) {
      console.log('DEBUG: Sample hashtags:', hashtags.slice(0, 3));
      
      // Check hashtag format
      const firstTag = hashtags[0];
      if (typeof firstTag === 'string') {
        console.log('DEBUG: Hashtags are in string format');
      } else if (typeof firstTag === 'object') {
        console.log('DEBUG: Hashtags are in object format:', JSON.stringify(firstTag));
      }
    }
    
    // Return cleaned hashtags
    return hashtags.map(tag => {
      if (typeof tag === 'string') return tag.trim();
      if (tag && typeof tag === 'object' && tag.name) return tag.name.trim();
      return String(tag).trim();
    }).filter(tag => tag.length > 0);
  } else if (typeof hashtags === 'object') {
    console.log(`DEBUG: Got hashtag object from ${source}:`, JSON.stringify(hashtags));
    
    if (hashtags.hashtags && Array.isArray(hashtags.hashtags)) {
      console.log(`DEBUG: Extracted ${hashtags.hashtags.length} hashtags from object`);
      return debugHashtags(hashtags.hashtags, `${source} (nested)`);
    }
  }
  
  console.log(`DEBUG: Hashtags from ${source} is not an array: ${typeof hashtags}`);
  return [];
}

/**
 * Diagnose hashtag issues by checking all parts of the process
 * @param {Array|Object} hashtags - The hashtags to diagnose
 * @param {string} source - Source of the hashtags for logs
 * @returns {Array} - Cleaned hashtag array
 */
async function diagnoseHashtagIssue(hashtags, source) {
  console.log(`=== HASHTAG DIAGNOSIS: ${source} ===`);
  
  // 1. Check if hashtags array is valid
  if (!hashtags) {
    console.log(`❌ Hashtags is ${hashtags} (${typeof hashtags})`);
    return [];
  }
  
  if (!Array.isArray(hashtags)) {
    console.log(`❌ Hashtags is not an array: ${typeof hashtags}`);
    console.log('Value:', hashtags);
    
    // Try to convert to array if possible
    if (typeof hashtags === 'string') {
      // Split by commas or spaces if it's a string
      const parsed = hashtags.split(/[,\s]+/).filter(t => t.trim().length > 0);
      console.log(`Converted string to array with ${parsed.length} items:`, parsed);
      return parsed;
    } else if (hashtags && typeof hashtags === 'object') {
      // Try to extract if it's an object with a hashtags property
      if (hashtags.hashtags && Array.isArray(hashtags.hashtags)) {
        console.log(`Extracted nested hashtags array with ${hashtags.hashtags.length} items`);
        return hashtags.hashtags;
      }
      // If it's a map/object of hashtags convert to array
      return Object.values(hashtags).filter(v => v && typeof v === 'string');
    }
    return [];
  }
  
  // 2. Check content of hashtags array
  console.log(`✅ Hashtags is an array with ${hashtags.length} items`);
  
  if (hashtags.length === 0) {
    console.log('⚠️ Hashtags array is empty');
    return [];
  }
  
  // 3. Check types within array
  const types = hashtags.map(tag => typeof tag);
  const uniqueTypes = [...new Set(types)];
  console.log(`Types in array: ${uniqueTypes.join(', ')}`);
  
  // 4. Format hashtags for consistent storage
  const formatted = hashtags.map(tag => {
    if (typeof tag === 'string') {
      return tag.trim();
    } else if (tag && typeof tag === 'object' && tag.name) {
      return tag.name.trim();
    } else if (tag && typeof tag === 'object' && tag.tag) {
      return tag.tag.trim();
    }
    return String(tag).trim();
  }).filter(tag => tag && tag.length > 0);
  
  console.log(`Formatted ${formatted.length} valid hashtags:`, formatted);
  return formatted;
}

// Add this function before the module.exports
/**
 * Create or validate a session using the database
 * @param {string} sessionId - Session ID to validate or create
 * @returns {Promise<Object>} - Session validation result
 */
async function createOrValidateSession(sessionId) {
  try {
    // We'll delegate to the db module's implementation
    return await db.createOrValidateSession(sessionId);
  } catch (error) {
    console.error('Error in socket handler createOrValidateSession:', error);
    throw error;
  }
}

module.exports = {
  initialize,
  getDefaultChatbotConfig,
  createOrValidateSession,
  debugHashtags, // Expose for testing if needed
  diagnoseHashtagIssue // Expose for testing if needed
};
