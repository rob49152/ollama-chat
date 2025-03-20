// db.js
require('dotenv').config();
const mysql = require('mysql2/promise');

// Create a connection pool for better performance with multiple connections
const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.1.176',
  user: process.env.DB_USER || 'rob',
  password: process.env.DB_PASSWORD || 'Tardi$49152',
  database: process.env.DB_NAME || 'ollama_chat',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Save a user message to the database
 * @param {string} message - The user's message content
 * @param {Array} tags - Array of hashtags associated with the message
 * @returns {Promise<number>} - ID of the inserted message
 */
async function saveUserMessage(message, tags = []) {
  try {
    // Convert tags array to JSON string
    const tagsJson = JSON.stringify(tags);
    
    // Insert the message
    const [result] = await pool.query(
      'INSERT INTO user_messages (message_content, tags) VALUES (?, ?)',
      [message, tagsJson]
    );
    
    // Save tags to the tags table
    if (tags && tags.length > 0) {
      await saveTags(tags);
    }
    
    return result.insertId;
  } catch (error) {
    console.error('Error saving user message:', error);
    throw error;
  }
}

/**
 * Save an Ollama response to the database
 * @param {string} response - The assistant's response content
 * @param {number} userMessageId - ID of the associated user message
 * @param {Array} tags - Array of hashtags associated with the response
 * @returns {Promise<number>} - ID of the inserted response
 */
async function saveOllamaResponse(response, userMessageId, tags = []) {
  try {
    // Convert tags array to JSON string
    const tagsJson = JSON.stringify(tags);
    
    // Insert the response
    const [result] = await pool.query(
      'INSERT INTO ollama_responses (response_content, user_message_id, tags) VALUES (?, ?, ?)',
      [response, userMessageId, tagsJson]
    );
    
    // Save tags to the tags table
    if (tags && tags.length > 0) {
      await saveTags(tags);
    }
    
    return result.insertId;
  } catch (error) {
    console.error('Error saving ollama response:', error);
    throw error;
  }
}

/**
 * Save or update tags in the tags table
 * @param {Array} tags - Array of hashtags
 */
async function saveTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return;
  
  try {
    for (const tag of tags) {
      // Remove the # prefix if present
      const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
      
      if (!cleanTag) continue; // Skip empty tags
      
      // Try to update existing tag
      const [updateResult] = await pool.query(
        'UPDATE tags SET usage_count = usage_count + 1 WHERE tag_name = ?',
        [cleanTag]
      );
      
      // If tag doesn't exist, insert it
      if (updateResult.affectedRows === 0) {
        await pool.query(
          'INSERT INTO tags (tag_name, usage_count) VALUES (?, 1)',
          [cleanTag]
        );
      }
    }
  } catch (error) {
    console.error('Error saving tags:', error);
    // Continue execution even if tag saving fails
  }
}

/**
 * Get all tags with their usage counts
 * @returns {Promise<Array>} - Array of tag objects
 */
async function getAllTags() {
  try {
    const [rows] = await pool.query(
      'SELECT tag_name, usage_count, first_used FROM tags ORDER BY usage_count DESC'
    );
    return rows;
  } catch (error) {
    console.error('Error fetching tags:', error);
    throw error;
  }
}

/**
 * Get recent conversations (user messages with corresponding responses)
 * @param {number} limit - Maximum number of conversations to retrieve
 * @returns {Promise<Array>} - Array of conversation objects
 */
async function getRecentConversations(limit = 10) {
  try {
    const [rows] = await pool.query(`
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
      LIMIT ?
    `, [limit]);
    
    return rows;
  } catch (error) {
    console.error('Error fetching recent conversations:', error);
    throw error;
  }
}

/**
 * Search conversations by tag
 * @param {string} tag - Tag to search for (with or without # prefix)
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} - Array of matching conversations
 */
async function searchByTag(tag, limit = 50) {
  // Remove # if present
  const searchTag = tag.startsWith('#') ? tag.substring(1) : tag;
  
  try {
    const [rows] = await pool.query(`
      SELECT 
        um.id AS message_id, 
        um.message_content AS user_message,
        um.timestamp AS message_time,
        or.response_content AS ollama_response,
        or.timestamp AS response_time
      FROM user_messages um
      LEFT JOIN ollama_responses or ON um.id = or.user_message_id
      WHERE 
        um.tags LIKE ? OR 
        or.tags LIKE ?
      ORDER BY um.timestamp DESC
      LIMIT ?
    `, [`%"${searchTag}"%`, `%"${searchTag}"%`, limit]);
    
    return rows;
  } catch (error) {
    console.error('Error searching by tag:', error);
    throw error;
  }
}

// Handle process exit to close pool gracefully
process.on('exit', () => {
  pool.end();
});

module.exports = {
  pool,
  saveUserMessage,
  saveOllamaResponse,
  saveTags,
  getAllTags,
  getRecentConversations,
  searchByTag
};