// db.js
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Create connection pool using environment variables only
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Create a new chat session
 * @param {string} clientInfo - Client information (browser, OS, etc.)
 * @returns {Promise<string>} Session ID
 */
async function createSession(clientInfo = '') {
  const sessionId = uuidv4();
  
  try {
    await pool.query(
      'INSERT INTO sessions (id, client_info) VALUES (?, ?)',
      [sessionId, clientInfo]
    );
    
    console.log(`New session created with ID: ${sessionId}`);
    return sessionId;
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

/**
 * Update session's last activity timestamp
 * @param {string} sessionId - Session ID to update
 * @returns {Promise<boolean>} Success status
 */
async function updateSessionActivity(sessionId) {
  try {
    await pool.query(
      'UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
      [sessionId]
    );
    return true;
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  }
}

/**
 * Create a session if it doesn't exist, or validate an existing one
 * @param {string} sessionId - Session ID to create or validate
 * @returns {Promise<Object>} - Created or validated session details
 */
async function createOrValidateSession(sessionId) {
  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  
  const connection = await pool.getConnection();
  
  try {
    // Check if session exists
    const [existingSession] = await connection.query(
      'SELECT id, created_at, last_activity FROM sessions WHERE id = ?', 
      [sessionId]
    );
    
    // If session exists, update the last activity and return it
    if (existingSession && existingSession.length > 0) {
      await connection.query(
        'UPDATE sessions SET last_activity = NOW() WHERE id = ?',
        [sessionId]
      );
      
      console.log(`Session ${sessionId} validated and updated`);
      return {
        id: sessionId,
        created: false,
        updated: true,
        createdAt: existingSession[0].created_at,
        lastActive: new Date()
      };
    }
    
    // Session doesn't exist, create it
    const timestamp = new Date();
    await connection.query(
      'INSERT INTO sessions (id, created_at, last_activity) VALUES (?, ?, ?)',
      [sessionId, timestamp, timestamp]
    );
    
    console.log(`New session ${sessionId} created`);
    return {
      id: sessionId,
      created: true,
      updated: false,
      createdAt: timestamp,
      lastActive: timestamp
    };
  } catch (error) {
    console.error('Error creating or validating session:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Remove a tag from a message
 * @param {string} messageId - Message ID
 * @param {string} tag - Tag to remove
 * @returns {Promise<Object>} - Result of the operation
 */
async function removeTagFromMessage(messageId, tag) {
  const connection = await pool.getConnection();
  
  try {
    // First get the current tags for this message
    const [messages] = await connection.query(
      'SELECT tags FROM ollama_responses WHERE message_id = ?',
      [messageId]
    );
    
    if (!messages || messages.length === 0) {
      // Also check user messages
      const [userMessages] = await connection.query(
        'SELECT tags FROM user_messages WHERE message_id = ?',
        [messageId]
      );
      
      if (!userMessages || userMessages.length === 0) {
        throw new Error('Message not found');
      }
      
      // Update user message tags
      let currentTags = [];
      try {
        currentTags = JSON.parse(userMessages[0].tags || '[]');
      } catch (err) {
        console.error('Error parsing tags:', err);
        currentTags = [];
      }
      
      // Remove the tag
      const tagToRemove = tag.startsWith('#') ? tag : `#${tag}`;
      const updatedTags = currentTags.filter(t => 
        t.toLowerCase() !== tagToRemove.toLowerCase() && 
        t.toLowerCase() !== tag.toLowerCase()
      );
      
      // Update the database
      await connection.query(
        'UPDATE user_messages SET tags = ? WHERE message_id = ?',
        [JSON.stringify(updatedTags), messageId]
      );
      
      return { 
        success: true, 
        message: 'Tag removed from user message',
        updatedTags
      };
    }
    
    // For assistant messages
    let currentTags = [];
    try {
      currentTags = JSON.parse(messages[0].tags || '[]');
    } catch (err) {
      console.error('Error parsing tags:', err);
      currentTags = [];
    }
    
    // Remove the tag
    const tagToRemove = tag.startsWith('#') ? tag : `#${tag}`;
    const updatedTags = currentTags.filter(t => 
      t.toLowerCase() !== tagToRemove.toLowerCase() &&
      t.toLowerCase() !== tag.toLowerCase()
    );
    
    // Update the database
    await connection.query(
      'UPDATE ollama_responses SET tags = ? WHERE message_id = ?',
      [JSON.stringify(updatedTags), messageId]
    );
    
    return { 
      success: true, 
      message: 'Tag removed from assistant message',
      updatedTags
    };
  } catch (error) {
    console.error('Error removing tag from message:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Save a user message to the database
 * Supports both:
 * 1. (sessionId, message, hashtags) parameter style
 * 2. ({sessionId, message, messageId}) object parameter style
 * 
 * @param {string|Object} sessionIdOrParams - Session ID string or params object
 * @param {string} [message] - User message content (if not using object style)
 * @param {string[]} [hashtags] - Array of hashtags (if not using object style)
 * @returns {Promise<Object>} - Object containing saved message details
 */
async function saveUserMessage(sessionIdOrParams, message, hashtags) {
  let sessionId, messageContent, messageId, tags;
  
  // Check if first parameter is an object (new style) or string (old style)
  if (typeof sessionIdOrParams === 'object' && sessionIdOrParams !== null) {
    // Extract from object parameter style
    sessionId = sessionIdOrParams.sessionId;
    messageContent = sessionIdOrParams.message;
    messageId = sessionIdOrParams.messageId || uuidv4();
    tags = sessionIdOrParams.hashtags || [];
    
    console.log(`Using object parameter style. SessionID: ${sessionId}, MessageID: ${messageId}`);
  } else {
    // Use traditional parameter style
    sessionId = sessionIdOrParams;
    messageContent = message;
    messageId = uuidv4();
    tags = hashtags || [];
    
    console.log(`Using traditional parameter style. SessionID: ${sessionId}`);
  }
  
  // Validate required parameters
  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  if (!messageContent) {
    throw new Error('Message content is required');
  }
  
  console.log(`Saving user message. SessionID: ${sessionId}, MessageID: ${messageId}`);
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Save message
    const [result] = await connection.query(
      'INSERT INTO user_messages (session_id, message_id, message_content, tags) VALUES (?, ?, ?, ?)',
      [sessionId, messageId, messageContent, JSON.stringify(tags)]
    );
    
    // Add to master log
    await connection.query(
      'INSERT INTO message_log (session_id, message_id, origin, content, tags) VALUES (?, ?, ?, ?, ?)',
      [sessionId, messageId, 'user', messageContent, JSON.stringify(tags)]
    );
    
    // Process tags
    if (tags && tags.length > 0) {
      await processTags(connection, tags);
    }
    
    await connection.commit();
    
    // Update session activity
    await updateSessionActivity(sessionId);
    
    // When returning, don't re-process the hashtags as they should already be filtered
    return {
      id: result.insertId,
      messageId: messageId,
      sessionId: sessionId,
      content: messageContent,
      hashtags: tags
    };
  } catch (error) {
    await connection.rollback();
    console.error('Error saving user message:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Save Ollama response to database with chatbot ID
 * Supports both:
 * 1. (sessionId, response, userMessageId, tags, chatbotId) parameter style
 * 2. ({messageId, response, hashtags, sessionId}) object parameter style
 * 
 * @param {string|Object} sessionIdOrParams - Session ID string or params object
 * @param {string} [response] - Response content (if not using object style)
 * @param {string} [userMessageId] - ID of the user message (if not using object style)
 * @param {Array} [tags=[]] - Array of hashtags (if not using object style)
 * @param {number} [chatbotId=null] - ID of the chatbot used (if not using object style)
 * @returns {Promise<Object>} Response details including ID
 */
async function saveOllamaResponse(sessionIdOrParams, response, userMessageId, tags = [], chatbotId = null) {
  let sessionId, responseContent, messageId, responseTags, botId;
  
  // Check if first parameter is an object (new style) or string (old style)
  if (typeof sessionIdOrParams === 'object' && sessionIdOrParams !== null) {
    // Extract from object parameter style
    sessionId = sessionIdOrParams.sessionId;
    responseContent = sessionIdOrParams.response;
    messageId = sessionIdOrParams.messageId || uuidv4();
    responseTags = sessionIdOrParams.hashtags || [];
    botId = sessionIdOrParams.chatbotId || null;
    userMessageId = sessionIdOrParams.userMessageId || null;
    
    console.log(`Using object parameter style. MessageID: ${messageId}`);
  } else {
    // Use traditional parameter style
    sessionId = sessionIdOrParams;
    responseContent = response;
    messageId = uuidv4();
    responseTags = tags || [];
    botId = chatbotId;
    
    console.log(`Using traditional parameter style. SessionID: ${sessionId}`);
  }
  
  // Validate required parameters
  if (!messageId) {
    messageId = uuidv4(); // Generate ID if not provided
  }
  
  if (!responseContent) {
    throw new Error('Response content is required');
  }
  
  console.log(`Saving Ollama response. MessageID: ${messageId}, Tags: ${responseTags.length}`);
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Save response with chatbot ID
    const [result] = await connection.query(
      'INSERT INTO ollama_responses (session_id, message_id, user_message_id, response_content, tags, chatbot_id) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, messageId, userMessageId, responseContent, JSON.stringify(responseTags), botId]
    );
    
    // Add to master log with chatbot ID
    await connection.query(
      'INSERT INTO message_log (session_id, message_id, origin, content, tags, chatbot_id) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, messageId, 'assistant', responseContent, JSON.stringify(responseTags), botId]
    );
    
    // Process tags
    if (responseTags && responseTags.length > 0) {
      await processTags(connection, responseTags);
    }
    
    await connection.commit();
    
    // Update session activity
    if (sessionId) {
      await updateSessionActivity(sessionId);
    }
    
    // When returning, don't re-process the hashtags as they should already be filtered
    return {
      id: result.insertId,
      messageId: messageId,
      sessionId: sessionId,
      chatbotId: botId,
      content: responseContent,
      hashtags: responseTags
    };
  } catch (error) {
    await connection.rollback();
    console.error('Error saving Ollama response:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Process tags and update tag statistics
 * @param {Object} connection - Database connection
 * @param {Array} tags - Array of hashtags
 * @returns {Promise<void>}
 */
async function processTags(connection, tags) {
  for (const tag of tags) {
    // Remove # symbol for storage
    const tagName = tag.replace(/^#/, '');
    
    try {
      // Try to insert new tag
      await connection.query(
        'INSERT INTO tags (tag_name) VALUES (?) ON DUPLICATE KEY UPDATE usage_count = usage_count + 1',
        [tagName]
      );
    } catch (tagError) {
      console.error('Error processing tag:', tagError);
      // Continue with other tags
    }
  }
}

/**
 * Get all tags with usage statistics
 * @returns {Promise<Array>} Array of tags with statistics
 */
async function getAllTags() {
  try {
    const [rows] = await pool.query(
      'SELECT tag_name, usage_count, first_used FROM tags ORDER BY usage_count DESC'
    );
    return rows;
  } catch (error) {
    console.error('Error fetching tags:', error);
    return [];
  }
}

/**
 * Get recent conversations
 * @param {number} limit - Maximum number of conversations to return
 * @returns {Promise<Array>} Array of conversations
 */
async function getRecentConversations(limit = 10) {
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.id AS session_id,
        s.created_at AS session_start,
        s.last_activity,
        COUNT(DISTINCT m.id) AS message_count
      FROM sessions s
      LEFT JOIN message_log m ON s.id = m.session_id
      GROUP BY s.id
      ORDER BY s.last_activity DESC
      LIMIT ?
    `, [limit]);
    
    return rows;
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
}

/**
 * Get conversation messages by session ID with chatbot information
 * @param {string} sessionId - Session ID
 * @returns {Promise<Array>} Array of messages in the conversation
 */
async function getConversationById(sessionId) {
  try {
    const [rows] = await pool.query(`
      SELECT
        m.message_id,
        m.origin,
        m.content,
        m.tags,
        m.timestamp,
        m.chatbot_id,
        c.name AS chatbot_name,
        (SELECT setting_value FROM chatbot_settings WHERE chatbot_id = m.chatbot_id AND setting_key = 'bubble_color' LIMIT 1) AS bubble_color,
        (SELECT setting_value FROM chatbot_settings WHERE chatbot_id = m.chatbot_id AND setting_key = 'text_color' LIMIT 1) AS text_color
      FROM message_log m
      LEFT JOIN chatbot_configs c ON m.chatbot_id = c.id
      WHERE m.session_id = ?
      ORDER BY m.timestamp ASC
    `, [sessionId]);

    return rows;
  } catch (error) {
    console.error('Error fetching conversation:', error);
    return [];
  }
}

/**
 * Search conversations by tag
 * @param {string} tag - Tag to search for (without # symbol)
 * @returns {Promise<Array>} Array of matching conversations
 */
async function searchByTag(tag) {
  // Remove # symbol if present
  const tagName = tag.replace(/^#/, '');
  
  try {
    const [rows] = await pool.query(`
      SELECT 
        m.session_id,
        s.created_at AS session_start,
        COUNT(m.id) AS match_count,
        MAX(m.timestamp) AS last_match
      FROM message_log m
      JOIN sessions s ON m.session_id = s.id
      WHERE JSON_SEARCH(m.tags, 'one', ?) IS NOT NULL
         OR JSON_SEARCH(m.tags, 'one', ?) IS NOT NULL
      GROUP BY m.session_id
      ORDER BY last_match DESC
    `, [tagName, `#${tagName}`]);
    
    return rows;
  } catch (error) {
    console.error('Error searching by tag:', error);
    return [];
  }
}

/**
 * Add system message to master log with chatbot ID
 * @param {string} sessionId - Session ID
 * @param {string} message - System message content
 * @param {number} chatbotId - ID of the chatbot used
 * @returns {Promise<Object>} Message details including ID
 */
async function logSystemMessage(sessionId, message, chatbotId = null) {
  const messageId = uuidv4();

  try {
    const [result] = await pool.query(
      'INSERT INTO message_log (session_id, message_id, origin, content, tags, chatbot_id) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, messageId, 'system', message, JSON.stringify([]), chatbotId]
    );

    return {
      id: result.insertId,
      messageId: messageId,
      sessionId: sessionId,
      chatbotId: chatbotId
    };
  } catch (error) {
    console.error('Error logging system message:', error);
    throw error;
  }
}

/**
 * Search for tags matching keywords
 * @param {Array} keywords - Array of keywords to search for
 * @returns {Promise<Array>} Matching tags from the database
 */
async function searchTags(keywords) {
  if (!keywords || keywords.length === 0) {
    return [];
  }

  try {
    // Create placeholders for the IN clause
    const placeholders = keywords.map(() => '?').join(',');

    // Query to find matching tags (using LIKE for partial matches)
    const query = `
      SELECT tag_name, usage_count
      FROM tags
      WHERE ${keywords.map(k => `tag_name LIKE ?`).join(' OR ')}
      ORDER BY usage_count DESC
    `;

    // Create parameters with wildcards for LIKE
    const params = keywords.map(keyword => `%${keyword.toLowerCase()}%`);

    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    console.error('Error searching tags:', error);
    return [];
  }
}

/**
 * Find exact tag matches
 * @param {Array} tagNames - Array of tag names to look for
 * @returns {Promise<Array>} Matching tags from the database
 */
async function findExactTags(tagNames) {
  if (!tagNames || tagNames.length === 0) {
    return [];
  }

  try {
    // Create placeholders for the IN clause
    const placeholders = tagNames.map(() => '?').join(',');

    // Query to find exact tag matches
    const query = `
      SELECT tag_name, usage_count
      FROM tags
      WHERE tag_name IN (${placeholders})
      ORDER BY usage_count DESC
    `;

    // Clean tag names (remove # if present)
    const cleanedTagNames = tagNames.map(tag => tag.replace(/^#/, '').toLowerCase());

    const [rows] = await pool.query(query, cleanedTagNames);
    return rows;
  } catch (error) {
    console.error('Error finding exact tags:', error);
    return [];
  }
}

/**
 * Get popular tags (for suggesting common tags)
 * @param {number} limit - Maximum number of tags to return
 * @returns {Promise<Array>} Most popular tags
 */
async function getPopularTags(limit = 20) {
  try {
    const [rows] = await pool.query(`
      SELECT tag_name, usage_count
      FROM tags
      ORDER BY usage_count DESC
      LIMIT ?
    `, [limit]);

    return rows;
  } catch (error) {
    console.error('Error getting popular tags:', error);
    return [];
  }
}

/**
 * Get all chatbot configurations
 * @returns {Promise<Array>} List of all chatbot configurations
 */
async function getAllChatbots() {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, is_default, created_at, updated_at
      FROM chatbot_configs
      ORDER BY name ASC
    `);
    return rows;
  } catch (error) {
    console.error('Error fetching chatbots:', error);
    throw error;
  }
}

/**
 * Get chatbot configuration by ID
 * @param {number} id - Chatbot ID
 * @returns {Promise<Object>} Chatbot configuration with settings and examples
 */
async function getChatbotById(id) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Get basic info
    const [configRows] = await connection.query(`
      SELECT id, name, is_default, created_at, updated_at
      FROM chatbot_configs
      WHERE id = ?
    `, [id]);

    if (configRows.length === 0) {
      throw new Error(`Chatbot with ID ${id} not found`);
    }

    // Get settings
    const [settingsRows] = await connection.query(`
      SELECT setting_key, setting_value
      FROM chatbot_settings
      WHERE chatbot_id = ?
    `, [id]);

    // Convert settings to object
    const settings = {};
    settingsRows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });

    // Get examples
    const [examplesRows] = await connection.query(`
      SELECT id, role, content, sequence
      FROM chatbot_examples
      WHERE chatbot_id = ?
      ORDER BY sequence ASC
    `, [id]);

    await connection.commit();

    // Combine everything
    return {
      ...configRows[0],
      settings,
      examples: examplesRows
    };
  } catch (error) {
    await connection.rollback();
    console.error('Error fetching chatbot details:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Get default chatbot configuration
 * @returns {Promise<Object>} Default chatbot configuration
 */
async function getDefaultChatbot() {
  try {
    const [rows] = await pool.query(`
      SELECT id FROM chatbot_configs WHERE is_default = TRUE LIMIT 1
    `);

    if (rows.length === 0) {
      throw new Error('No default chatbot configuration found');
    }

    return await getChatbotById(rows[0].id);
  } catch (error) {
    console.error('Error fetching default chatbot:', error);
    throw error;
  }
}

/**
 * Create a new chatbot configuration with colors
 * @param {Object} data - Chatbot configuration data
 * @returns {Promise<number>} ID of the created chatbot
 */
async function createChatbot(data) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Insert basic config
    const [result] = await connection.query(`
      INSERT INTO chatbot_configs (name, is_default)
      VALUES (?, ?)
    `, [data.name, data.isDefault || false]);

    const chatbotId = result.insertId;

    // If this is the default chatbot, unset previous defaults
    if (data.isDefault) {
      await connection.query(`
        UPDATE chatbot_configs
        SET is_default = FALSE
        WHERE id != ?
      `, [chatbotId]);
    }

    // Insert settings
    if (data.settings) {
      const settingsEntries = Object.entries(data.settings);
      for (const [key, value] of settingsEntries) {
        await connection.query(`
          INSERT INTO chatbot_settings (chatbot_id, setting_key, setting_value)
          VALUES (?, ?, ?)
        `, [chatbotId, key, value]);
      }
    }

    // Insert bubble_color and text_color settings
    await connection.query(`
      INSERT INTO chatbot_settings (chatbot_id, setting_key, setting_value)
      VALUES (?, 'bubble_color', ?), (?, 'text_color', ?)
    `, [chatbotId, data.bubbleColor || '#f8f8f8', chatbotId, data.textColor || '#000000']);

    // Insert examples
    if (data.examples && Array.isArray(data.examples)) {
      for (let i = 0; i < data.examples.length; i++) {
        const example = data.examples[i];
        await connection.query(`
          INSERT INTO chatbot_examples (chatbot_id, role, content, sequence)
          VALUES (?, ?, ?, ?)
        `, [chatbotId, example.role, example.content, i + 1]);
      }
    }

    await connection.commit();

    return chatbotId;
  } catch (error) {
    await connection.rollback();
    console.error('Error creating chatbot:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Update an existing chatbot configuration with colors
 * @param {number} id - Chatbot ID to update
 * @param {Object} data - Updated chatbot data
 * @returns {Promise<boolean>} Success status
 */
async function updateChatbot(id, data) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Update basic config
    await connection.query(`
      UPDATE chatbot_configs
      SET name = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [data.name, data.isDefault || false, id]);

    // If this is the default chatbot, unset previous defaults
    if (data.isDefault) {
      await connection.query(`
        UPDATE chatbot_configs
        SET is_default = FALSE
        WHERE id != ?
      `, [id]);
    }

    // Update settings - first delete existing
    await connection.query(`
      DELETE FROM chatbot_settings WHERE chatbot_id = ?
    `, [id]);

    // Then insert new settings
    if (data.settings) {
      const settingsEntries = Object.entries(data.settings);
      for (const [key, value] of settingsEntries) {
        await connection.query(`
          INSERT INTO chatbot_settings (chatbot_id, setting_key, setting_value)
          VALUES (?, ?, ?)
        `, [id, key, value]);
      }
    }

    // Insert bubble_color and text_color settings
    await connection.query(`
      INSERT INTO chatbot_settings (chatbot_id, setting_key, setting_value)
      VALUES (?, 'bubble_color', ?), (?, 'text_color', ?)
    `, [id, data.bubbleColor || '#f8f8f8', id, data.textColor || '#000000']);

    // Update examples - first delete existing
    await connection.query(`
      DELETE FROM chatbot_examples WHERE chatbot_id = ?
    `, [id]);

    // Then insert new examples
    if (data.examples && Array.isArray(data.examples)) {
      for (let i = 0; i < data.examples.length; i++) {
        const example = data.examples[i];
        await connection.query(`
          INSERT INTO chatbot_examples (chatbot_id, role, content, sequence)
          VALUES (?, ?, ?, ?)
        `, [id, example.role, example.content, i + 1]);
      }
    }

    await connection.commit();

    return true;
  } catch (error) {
    await connection.rollback();
    console.error('Error updating chatbot:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Delete a chatbot configuration
 * @param {number} id - Chatbot ID to delete
 * @returns {Promise<boolean>} Success status
 */
async function deleteChatbot(id) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check if it's the default chatbot
    const [defaultCheck] = await connection.query(`
      SELECT is_default FROM chatbot_configs WHERE id = ?
    `, [id]);

    if (defaultCheck.length > 0 && defaultCheck[0].is_default) {
      throw new Error('Cannot delete the default chatbot configuration');
    }

    // Delete all related records (settings and examples will be deleted due to ON DELETE CASCADE)
    await connection.query(`DELETE FROM chatbot_configs WHERE id = ?`, [id]);

    await connection.commit();

    return true;
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting chatbot:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Set chatbot for a session
 * @param {string} sessionId - Session ID
 * @param {number} chatbotId - Chatbot ID
 * @returns {Promise<boolean>} Success status
 */
async function setSessionChatbot(sessionId, chatbotId) {
  try {
    await pool.query(`
      UPDATE sessions SET chatbot_id = ? WHERE id = ?
    `, [chatbotId, sessionId]);

    return true;
  } catch (error) {
    console.error('Error setting session chatbot:', error);
    throw error;
  }
}

/**
 * Get chatbot configuration for a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Chatbot configuration
 */
async function getSessionChatbot(sessionId) {
  try {
    const [rows] = await pool.query(`
      SELECT chatbot_id FROM sessions WHERE id = ?
    `, [sessionId]);

    if (rows.length === 0 || !rows[0].chatbot_id) {
      // No chatbot configured for this session, return default
      return await getDefaultChatbot();
    }

    return await getChatbotById(rows[0].chatbot_id);
  } catch (error) {
    console.error('Error getting session chatbot:', error);
    // Fall back to default
    return await getDefaultChatbot();
  }
}

/**
 * Add a tag to the blocked tags list
 * @param {string} tagName - Tag to block
 * @param {string} [reason='user'] - Optional reason for blocking
 * @returns {Promise<boolean>} Success status
 */
async function blockTag(tagName, reason) {
  // Use 'user' as default value if reason is undefined, null, or empty string
  const blockReason = reason || 'user';
  
  // Remove # if present and convert to lowercase
  const cleanedTag = tagName.replace(/^#/, '').toLowerCase().trim();

  if (!cleanedTag) {
    console.error('[DB] Cannot block empty tag');
    return false;
  }

  try {
    console.log(`[DB] Blocking tag "${cleanedTag}" with reason: ${blockReason}`);
    
    // Insert into blocked_tags table with ON DUPLICATE KEY UPDATE to handle duplicates
    await pool.query(
      'INSERT INTO blocked_tags (tag_name, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = ?',
      [cleanedTag, blockReason, blockReason]
    );
    
    console.log(`[DB] Successfully blocked tag "${cleanedTag}"`);
    return true;
  } catch (error) {
    console.error(`[DB] Error blocking tag "${cleanedTag}":`, error);
    return false;
  }
}

/**
 * Add a tag to an assistant message in the database
 * @param {string} tag - Tag to add (with or without # prefix)
 * @param {string} sessionId - Session ID to identify the conversation
 * @param {string} [messageId] - Optional specific message ID to add the tag to
 * @returns {Promise<boolean>} - Success status
 */
async function addTagToLastAssistantMessage(tag, sessionId, messageId = null) {
  console.log(`[DB] ADDING TAG "${tag}" TO MESSAGE - SessionID: ${sessionId}, MessageID: ${messageId || 'not provided'}`);
  
  try {
    // Clean the tag
    const cleanTag = tag.replace(/^#/, '').toLowerCase().trim();
    if (!cleanTag) {
      console.error('[DB] Cannot add empty tag to message');
      return false;
    }
    
    // Format with # prefix
    const formattedTag = `#${cleanTag}`;
    
    let responseId = null;
    let targetMessageId = messageId;
    let existingTagsRaw = null;
    
    // DEBUGGING: Check database connection
    try {
      const [testConn] = await pool.query('SELECT 1 AS test');
      console.log('[DB] Database connection test:', testConn[0].test === 1 ? 'SUCCESS' : 'FAILED');
    } catch (connErr) {
      console.error('[DB] Database connection test FAILED:', connErr);
    }
    
    // If a specific messageId was provided, use that
    if (messageId) {
      console.log(`[DB] Using provided message ID: ${messageId}`);
      
      // Query ollama_responses table to find the message
      try {
        const [messageRows] = await pool.query(
          `SELECT id, message_id, tags FROM ollama_responses WHERE message_id = ?`,
          [messageId]
        );
        console.log(`[DB] Query for message_id ${messageId} returned ${messageRows?.length || 0} rows`);
        
        if (messageRows && messageRows.length > 0) {
          responseId = messageRows[0].id;
          targetMessageId = messageRows[0].message_id;
          existingTagsRaw = messageRows[0].tags;
          console.log(`[DB] Found message by ID in ollama_responses table. ResponseID: ${responseId}, MessageID: ${targetMessageId}, Tags: ${existingTagsRaw}`);
        }
      } catch (err) {
        console.error('[DB] Error querying ollama_responses by message_id:', err);
      }
      
      // If not found, try message_log table
      if (!responseId) {
        try {
          const [logRows] = await pool.query(
            `SELECT message_id, tags FROM message_log WHERE message_id = ? AND origin = 'assistant'`,
            [messageId]
          );
          console.log(`[DB] Fallback query returned ${logRows?.length || 0} rows`);
          
          if (logRows && logRows.length > 0) {
            targetMessageId = logRows[0].message_id;
            existingTagsRaw = logRows[0].tags;
            console.log(`[DB] Found message by ID in message_log table: ${targetMessageId}, Tags: ${existingTagsRaw}`);
          } else {
            console.warn(`[DB] No message found with ID: ${messageId}`);
          }
        } catch (err) {
          console.error('[DB] Error querying message_log:', err);
        }
      }
    } 
    // Otherwise find the latest message in the session
    else if (sessionId) {
      console.log(`[DB] Finding latest message for session: ${sessionId}`);
      
      try {
        const [rows] = await pool.query(
          `SELECT id, message_id, tags FROM ollama_responses 
           WHERE session_id = ?
           ORDER BY timestamp DESC LIMIT 1`,
          [sessionId]
        );
        console.log(`[DB] Latest message query returned ${rows?.length || 0} rows`);
        
        if (rows && rows.length > 0) {
          responseId = rows[0].id;
          targetMessageId = rows[0].message_id;
          existingTagsRaw = rows[0].tags;
          console.log(`[DB] Found latest message: ResponseID: ${responseId}, MessageID: ${targetMessageId}, Tags: ${existingTagsRaw}`);
        } else {
          console.warn(`[DB] No assistant messages found for session ${sessionId}`);
        }
      } catch (err) {
        console.error('[DB] Error querying latest message:', err);
      }
    }
    
    // If we didn't find a message, we can't add a tag
    if (!targetMessageId) {
      console.error('[DB] No message found to add tag to');
      return false;
    }
    
    // Parse existing tags if they exist
    let parsedTags = [];
    
    if (existingTagsRaw) {
      try {
        if (typeof existingTagsRaw === 'string') {
          // Ensure it's a valid JSON string (it might be an empty string)
          if (existingTagsRaw.trim().startsWith('[')) {
            parsedTags = JSON.parse(existingTagsRaw);
          } else {
            // If it's a string but not JSON, treat as a single tag
            parsedTags = [existingTagsRaw];
          }
        } else if (Array.isArray(existingTagsRaw)) {
          parsedTags = existingTagsRaw;
        }
      } catch (parseError) {
        console.error(`[DB] Error parsing tags: ${parseError.message}`, existingTagsRaw);
        // Default to empty array on parse error
        parsedTags = [];
      }
    }
    
    // Ensure parsedTags is an array
    if (!Array.isArray(parsedTags)) {
      parsedTags = [];
    }
    
    console.log(`[DB] Existing parsed tags (${parsedTags.length}):`, parsedTags);
    
    // Check for duplicate tags
    const normalizedTags = parsedTags.map(t => 
      typeof t === 'string' ? t.replace(/^#/, '').toLowerCase() : ''
    );
    
    if (!normalizedTags.includes(cleanTag)) {
      // Add the new tag
      parsedTags.push(formattedTag);
      const tagJson = JSON.stringify(parsedTags);
      
      console.log(`[DB] Updated tags JSON: ${tagJson}`);
      
      // Update ollama_responses if we have a responseId
      if (responseId) {
        try {
          await pool.query(
            `UPDATE ollama_responses SET tags = ? WHERE id = ?`,
            [tagJson, responseId]
          );
          console.log(`[DB] Updated ollama_responses for ID: ${responseId}`);
        } catch (err) {
          console.error('[DB] Error updating ollama_responses:', err);
        }
      }
      
      // Always update message_log
      try {
        await pool.query(
          `UPDATE message_log SET tags = ? WHERE message_id = ? AND origin = 'assistant'`,
          [tagJson, targetMessageId]
        );
        console.log(`[DB] Updated message_log for message ID: ${targetMessageId}`);
      } catch (err) {
        console.error('[DB] Error updating message_log:', err);
      }
      
      return true;
    } else {
      console.log(`[DB] Tag "${cleanTag}" already exists on message ${targetMessageId}`);
      return true;
    }
  } catch (error) {
    console.error(`[DB] Error adding tag: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

/**
 * Add a manually created tag to the tags database
 * @param {string} tagName - Tag to add
 * @returns {Promise<boolean>} Success status
 */
async function addManualTag(tagName) {
  // Remove # if present and convert to lowercase
  const cleanedTag = tagName.replace(/^#/, '').toLowerCase().trim();

  if (!cleanedTag) {
    throw new Error('Tag cannot be empty');
  }

  try {
    // First try to update the usage count if it exists
    const [result] = await pool.query(
      'UPDATE tags SET usage_count = usage_count + 1 WHERE tag_name = ?',
      [cleanedTag]
    );
    
    // If tag doesn't exist, insert it
    if (result.affectedRows === 0) {
      await pool.query(
        'INSERT INTO tags (tag_name, usage_count) VALUES (?, 1)',
        [cleanedTag]
      );
      console.log(`Added new tag: ${cleanedTag}`);
    } else {
      console.log(`Incremented usage count for tag: ${cleanedTag}`);
    }
    return true;
  } catch (error) {
    console.error('Error adding manual tag:', error);
    throw error;
  }
}

/**
 * Remove a tag from the blocked tags list
 * @param {string} tagName - Tag to unblock
 * @returns {Promise<boolean>} Success status
 */
async function unblockTag(tagName) {
  // Remove # if present and convert to lowercase
  const cleanedTag = tagName.replace(/^#/, '').toLowerCase();

  try {
    await pool.query('DELETE FROM blocked_tags WHERE tag_name = ?', [cleanedTag]);
    return true;
  } catch (error) {
    console.error('Error unblocking tag:', error);
    return false;
  }
}

/**
 * Get list of all blocked tags
 * @returns {Promise<Array>} List of blocked tags
 */
async function getBlockedTags() {
  try {
    const [rows] = await pool.query('SELECT tag_name, reason, created_at FROM blocked_tags');
    return rows;
  } catch (error) {
    console.error('Error fetching blocked tags:', error);
    return [];
  }
}

/**
 * Check if a tag is blocked
 * @param {string} tagName - Tag to check
 * @returns {Promise<boolean>} Whether the tag is blocked
 */
async function isTagBlocked(tagName) {
  // Remove # if present and convert to lowercase
  const cleanedTag = tagName.replace(/^#/, '').toLowerCase();

  try {
    const [rows] = await pool.query('SELECT 1 FROM blocked_tags WHERE tag_name = ?', [cleanedTag]);
    return rows.length > 0;
  } catch (error) {
    console.error('Error checking if tag is blocked:', error);
    return false;
  }
}


// Add exports to module.exports
module.exports = {
  pool,
  createSession,
  updateSessionActivity,
  saveUserMessage,
  saveOllamaResponse,
  createOrValidateSession, 
  getAllTags,
  getRecentConversations,
  getConversationById,
  searchByTag,
  logSystemMessage,
  searchTags,
  findExactTags,
  getPopularTags,
  getAllChatbots,
  getChatbotById,
  getDefaultChatbot,
  createChatbot,
  updateChatbot,
  deleteChatbot,
  setSessionChatbot,
  getSessionChatbot,
  blockTag,
  addManualTag,
  unblockTag,
  getBlockedTags,
  isTagBlocked,
  addTagToLastAssistantMessage,
  removeTagFromMessage
};