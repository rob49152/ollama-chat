// server.js - Main entry point
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import modules
const db = require('./db');  // Should be imported before using db.pool
const configManager = require('./config/config-manager');
const socketHandler = require('./socket/socket-handler');
const apiRoutes = require('./routes/api-routes');
const debugRoutes = require('./routes/debug-routes');
const ollamaService = require('./services/ollama-service');
const hashtagService = require('./services/hashtag-service');
const { processHashtags } = require('./utils/tag-utils');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Configure middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Initialize configuration
configManager.initConfig();

// Register routes
app.use('/api', apiRoutes);
app.use('/debug', debugRoutes);

// Add or update tag endpoint to use existing hashtag service
app.post('/api/add-tag', async (req, res) => {
  try {
    const { tag, messageId, sessionId } = req.body;
    
    if (!tag || !messageId) {
      return res.status(400).json({
        success: false, 
        message: 'Missing required parameters'
      });
    }
    
    // Format tag
    let formattedTag = tag.trim();
    if (!formattedTag.startsWith('#')) {
      formattedTag = `#${formattedTag}`;
    }
    
    // Check if tag is blocked
    const cleanTag = formattedTag.replace(/^#/, '').toLowerCase();
    const [blockedResult] = await db.pool.query(
      'SELECT 1 FROM blocked_tags WHERE tag_name = ?',
      [cleanTag]
    );
    
    if (blockedResult.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'This tag is blocked'
      });
    }
    
    // Check if common word
    if (hashtagService.shouldExcludeWord && hashtagService.shouldExcludeWord(cleanTag)) {
      return res.status(400).json({
        success: false,
        message: 'This word is too common to be used as a topic'
      });
    }
    
    // Get current tags from ollama_responses
    const [responseRows] = await db.pool.query(
      'SELECT tags FROM ollama_responses WHERE message_id = ?',
      [messageId]
    );
    
    if (!responseRows || responseRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }
    
    // Parse existing tags
    let existingTags = [];
    try {
      existingTags = JSON.parse(responseRows[0].tags || '[]');
    } catch (parseError) {
      console.error('Error parsing tags:', parseError);
    }
    
    // Check if tag already exists
    const normalizedTag = formattedTag.toLowerCase();
    if (existingTags.some(t => t.toLowerCase() === normalizedTag)) {
      return res.status(400).json({
        success: false,
        message: 'Tag already exists'
      });
    }
    
    // Add the new tag and update the database
    existingTags.push(formattedTag);
    
    await db.pool.query(
      'UPDATE ollama_responses SET tags = ? WHERE message_id = ?',
      [JSON.stringify(existingTags), messageId]
    );
    
    // Also update message_log
    await db.pool.query(
      'UPDATE message_log SET tags = ? WHERE message_id = ? AND origin = "assistant"',
      [JSON.stringify(existingTags), messageId]
    );
    
    return res.json({
      success: true,
      message: 'Tag added successfully',
      tags: existingTags
    });
  } catch (error) {
    console.error('Error adding tag:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while adding tag',
      error: error.message
    });
  }
});

// Remove tag endpoint using hashtag service
app.post('/api/remove-tag', async (req, res) => {
  try {
    const { sessionId, messageId, tag } = req.body;
    
    if (!sessionId || !messageId || !tag) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameters' 
      });
    }
    
    // Get existing tags for this message
    const [messageResults] = await db.pool.query(
      'SELECT tags FROM ollama_responses WHERE message_id = ?', 
      [messageId]
    );
    
    let existingTags = [];
    if (messageResults && messageResults.length > 0 && messageResults[0].tags) {
      try {
        existingTags = JSON.parse(messageResults[0].tags);
      } catch (e) {
        console.error('Error parsing existing tags:', e);
      }
    }
    
    // Clean the incoming tag (to handle cases with or without #)
    const tagToRemove = tag.startsWith('#') ? tag : `#${tag}`;
    const cleanTagToRemove = tag.replace(/^#/, '').toLowerCase();
    
    // Filter out the tag to be removed (case insensitive)
    const updatedTags = existingTags.filter(t => {
      const cleanTag = t.replace(/^#/, '').toLowerCase();
      return cleanTag !== cleanTagToRemove;
    });
    
    // Update database with new tags
    await db.pool.query(
      'UPDATE ollama_responses SET tags = ? WHERE message_id = ?',
      [JSON.stringify(updatedTags), messageId]
    );
    
    return res.json({
      success: true,
      message: 'Topic removed successfully',
      updatedTags: updatedTags
    });
  } catch (error) {
    console.error('Error removing tag:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while removing tag', 
      error: error.message 
    });
  }
});

// Extract tags endpoint
app.post('/api/extract-tags', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'No text provided for tag extraction'
      });
    }
    
    // Use your existing hashtag service
    const result = await hashtagService.extractHashtags(text);
    
    return res.json({
      success: true,
      tags: result.hashtags,
      message: `Extracted ${result.hashtags.length} tags`
    });
  } catch (error) {
    console.error('Error extracting tags:', error);
    res.status(500).json({
      success: false,
      message: 'Error extracting tags',
      error: error.message
    });
  }
});

// Add this API endpoint for debugging tags
app.get('/api/debug-tags', async (req, res) => {
  try {
    const tag = req.query.tag;
    const sample = parseInt(req.query.sample) || 10;
    
    if (!tag) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a tag parameter'
      });
    }
    
    // Clean the tag
    const cleanTag = tag.replace(/^#/, '').trim();
    
    // Search for the tag in the message_log table
    const [rows] = await db.pool.query(`
      SELECT 
        message_id, 
        origin, 
        content, 
        tags,
        session_id 
      FROM 
        message_log 
      WHERE 
        (JSON_SEARCH(tags, 'one', ?) IS NOT NULL OR JSON_SEARCH(tags, 'one', ?) IS NOT NULL)
      ORDER BY 
        timestamp DESC
      LIMIT ?
    `, [`#${cleanTag}`, cleanTag, sample]);
    
    return res.json({
      success: true,
      tag: cleanTag,
      matches: rows.length,
      results: rows.map(row => {
        let parsedTags = [];
        try {
          parsedTags = JSON.parse(row.tags || '[]');
        } catch (e) {
          console.error('Error parsing tags:', e);
        }
        
        return {
          messageId: row.message_id,
          origin: row.origin,
          snippet: row.content.substring(0, 100) + (row.content.length > 100 ? '...' : ''),
          tags: parsedTags,
          sessionId: row.session_id
        };
      })
    });
  } catch (error) {
    console.error('Error debugging tags:', error);
    res.status(500).json({
      success: false,
      message: 'Error debugging tags',
      error: error.message
    });
  }
});

// Block tag endpoint
app.post('/api/block-tag', async (req, res) => {
  try {
    const { tag, messageId, sessionId } = req.body;
    
    if (!tag) {
      return res.status(400).json({
        success: false, 
        message: 'Missing tag parameter'
      });
    }
    
    // Clean tag (remove # if present)
    const cleanTag = tag.replace(/^#/, '');
    
    // Add to blocked_tags table
    await db.pool.query(
      'INSERT IGNORE INTO blocked_tags (tag_name, reason) VALUES (?, ?)',
      [cleanTag.toLowerCase(), 'Manually blocked by user']
    );
    
    // Remove from message_log and ollama_responses if messageId provided
    if (messageId) {
      // Get current tags from ollama_responses
      const [responseRows] = await db.pool.query(
        'SELECT tags FROM ollama_responses WHERE message_id = ?',
        [messageId]
      );
      
      if (responseRows && responseRows.length > 0) {
        try {
          // Parse existing tags
          const existingTags = JSON.parse(responseRows[0].tags || '[]');
          
          // Filter out the blocked tag (case insensitive)
          const updatedTags = existingTags.filter(t => {
            const tagName = t.replace(/^#/, '').toLowerCase();
            return tagName !== cleanTag.toLowerCase();
          });
          
          // Update the database with filtered tags
          await db.pool.query(
            'UPDATE ollama_responses SET tags = ? WHERE message_id = ?',
            [JSON.stringify(updatedTags), messageId]
          );
          
          // Also update message_log
          await db.pool.query(
            'UPDATE message_log SET tags = ? WHERE message_id = ? AND origin = "assistant"',
            [JSON.stringify(updatedTags), messageId]
          );
        } catch (parseError) {
          console.error('Error parsing tags:', parseError);
        }
      }
    }
    
    return res.json({
      success: true,
      message: `Tag "${cleanTag}" has been blocked and removed from messages`
    });
  } catch (error) {
    console.error('Error blocking tag:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while blocking tag',
      error: error.message
    });
  }
});

// Add endpoint to unblock a tag
app.post('/api/unblock-tag', async (req, res) => {
  try {
    const { tag } = req.body;
    
    if (!tag) {
      return res.json({ success: false, message: 'Tag is required' });
    }

    // Clean the tag (remove # if present)
    const cleanTag = tag.replace(/^#/, '').trim();
    
    if (!cleanTag) {
      return res.json({ success: false, message: 'Invalid tag' });
    }
    
    // Delete from blocked_tags table
    await db.pool.query('DELETE FROM blocked_tags WHERE tag_name = ?', [cleanTag]);
    
    return res.json({ success: true, message: 'Tag unblocked successfully' });
  } catch (error) {
    console.error('Error unblocking tag:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Add endpoint to get all blocked tags
app.get('/api/blocked-tags', async (req, res) => {
  try {
    // Get all blocked tags
    const [blockedTags] = await db.pool.query('SELECT * FROM blocked_tags ORDER BY tag_name');
    
    return res.json({ success: true, blockedTags });
  } catch (error) {
    console.error('Error getting blocked tags:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// API endpoint to find conversations by tags
app.get('/api/conversations-by-tags', async (req, res) => {
  try {
    // Get tags from query parameters
    const tags = Array.isArray(req.query.tags) ? req.query.tags : [req.query.tags];
    const excludeSession = req.query.excludeSession;
    
    if (!tags || tags.length === 0 || !tags[0]) {
      return res.json({
        success: false,
        message: 'No tags provided'
      });
    }
    
    console.log(`Finding conversations for tags:`, tags);
    console.log(`Excluding session: ${excludeSession || 'none'}`);
    
    // Build SQL for multiple tags with JSON_SEARCH
    // This is crucial for proper MariaDB JSON field searching
    const params = [];
    const tagConditions = [];
    
    tags.forEach(tag => {
      if (!tag) return;
      
      const cleanTag = tag.replace(/^#/, '').trim().toLowerCase();
      if (cleanTag) {
        // Search for both "#tag" and "tag" formats in JSON
        tagConditions.push('(JSON_SEARCH(ml.tags, "one", ?) IS NOT NULL OR JSON_SEARCH(ml.tags, "one", ?) IS NOT NULL)');
        params.push(`#${cleanTag}`, cleanTag);
      }
    });
    
    if (tagConditions.length === 0) {
      return res.json({
        success: false,
        message: 'No valid tags after processing'
      });
    }
    
    // Build the SQL query with proper JSON searching
    let sql = `
      SELECT 
        ml.message_id, 
        ml.content, 
        ml.origin, 
        ml.tags, 
        ml.timestamp,
        ml.session_id
      FROM 
        message_log ml
      WHERE 
        (${tagConditions.join(' OR ')})
    `;
    
    // Add session exclusion if provided
    if (excludeSession) {
      sql += ' AND ml.session_id != ?';
      params.push(excludeSession);
    }
    
    // Order by timestamp, limit results
    sql += `
      ORDER BY ml.timestamp DESC
      LIMIT 10
    `;
    
    console.log('Executing SQL:', sql);
    console.log('With parameters:', params);
    
    // Execute the query
    const [rows] = await db.pool.query(sql, params);
    
    if (!rows || rows.length === 0) {
      return res.json({
        success: false,
        message: 'No matching conversations found'
      });
    }
    
    // Process results to build conversation pairs
    const conversations = [];
    
    for (const row of rows) {
      // Only process if we don't already have this message
      if (conversations.some(c => c.messageId === row.message_id)) {
        continue;
      }
      
      // Get paired content for the conversation
      let conversation = null;
      
      if (row.origin === 'user') {
        // Get the assistant's response for this user message
        const [assistantRows] = await db.pool.query(`
          SELECT response_content, message_id
          FROM ollama_responses
          WHERE user_message_id = ?
          LIMIT 1
        `, [row.message_id]);
        
        if (assistantRows && assistantRows.length > 0) {
          conversation = {
            messageId: assistantRows[0].message_id,
            userMessage: row.content,
            assistantResponse: assistantRows[0].response_content,
            timestamp: new Date(row.timestamp).toISOString(),
            sessionId: row.session_id
          };
        }
      } else {
        // For assistant message, find the preceding user message
        const [userRows] = await db.pool.query(`
          SELECT content, message_id
          FROM message_log
          WHERE session_id = ? AND timestamp < ? AND origin = 'user'
          ORDER BY timestamp DESC
          LIMIT 1
        `, [row.session_id, row.timestamp]);
        
        if (userRows && userRows.length > 0) {
          conversation = {
            messageId: row.message_id,
            userMessage: userRows[0].content,
            assistantResponse: row.content,
            timestamp: new Date(row.timestamp).toISOString(),
            sessionId: row.session_id
          };
        }
      }
      
      // Add conversation if we found both parts
      if (conversation) {
        conversations.push(conversation);
      }
      
      // Limit to 5 complete conversations
      if (conversations.length >= 5) break;
    }
    
    return res.json({
      success: true,
      conversations: conversations
    });
  } catch (error) {
    console.error('Error finding conversations by tags:', error);
    res.status(500).json({
      success: false,
      message: 'Server error finding conversations',
      error: error.message
    });
  }
});




// Set up Socket.IO connection handling
socketHandler.initialize(io, configManager.getConfig);

// In your socket.io connection handling section
io.on('connection', (socket) => {
  // Make sure existing event handlers process hashtags correctly
  socket.on('userMessage', async (data) => {
    try {
      const { message, sessionId } = data;
      
      // Use the streamCompletion function that leverages the hashtag system
      await ollamaService.streamCompletion(socket, sessionId, message);
    } catch (error) {
      console.error('Error processing user message:', error);
      socket.emit('error', { message: 'Error processing your message' });
    }
  });
  
  // Add a handler for when user clicks on a hashtag
  socket.on('tagClick', async (data) => {
    try {
      const { tag, sessionId } = data;
      
      // Find conversations related to this tag
      const relatedMessages = await hashtagService.findMessagesByTag(tag);
      
      // Send related conversations to client
      socket.emit('relatedMessages', {
        tag: tag,
        messages: relatedMessages
      });
    } catch (error) {
      console.error('Error processing tag click:', error);
    }
  });
});

// Start the server using PORT from .env
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to chat with Ollama`);

  // Test Ollama connection at startup
  await ollamaService.testConnection();

  // Log database connection status
  try {
    // Test database connection by running a simple query
    const [rows] = await db.pool.query('SELECT 1 as test');
    console.log('✅ Successfully connected to MySQL database');
    console.log('You can set up the database by running: npm run db-setup');
  } catch (error) {
    console.error('❌ Failed to connect to MySQL database:', error.message);
    console.log('Make sure your MySQL server is running and .env file is configured correctly');
    console.log('You can set up the database by running: npm run db-setup');
  }
});