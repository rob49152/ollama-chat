// ...existing code...

// Get all blocked tags
async function getBlockedTags() {
  try {
    const [rows] = await pool.query('SELECT * FROM blocked_tags ORDER BY tag ASC');
    return rows;
  } catch (error) {
    console.error('Error retrieving blocked tags:', error);
    throw error;
  }
}

// Block a tag
async function blockTag(tag) {
  try {
    await pool.query('INSERT IGNORE INTO blocked_tags (tag) VALUES (?)', [tag.toLowerCase()]);
    return true;
  } catch (error) {
    console.error('Error blocking tag:', error);
    throw error;
  }
}

// Unblock a tag
async function unblockTag(tag) {
  try {
    await pool.query('DELETE FROM blocked_tags WHERE tag = ?', [tag.toLowerCase()]);
    return true;
  } catch (error) {
    console.error('Error unblocking tag:', error);
    throw error;
  }
}

// Add a new tag if it doesn't exist
async function addTagIfNotExists(tag) {
  try {
    await pool.query('INSERT IGNORE INTO tags (tag, usage_count) VALUES (?, 1)', [tag.toLowerCase()]);
    return true;
  } catch (error) {
    console.error('Error adding new tag:', error);
    throw error;
  }
}

// Increment tag usage count
async function incrementTagUsage(tag) {
  try {
    await pool.query('UPDATE tags SET usage_count = usage_count + 1 WHERE tag = ?', [tag.toLowerCase()]);
    return true;
  } catch (error) {
    console.error('Error incrementing tag usage:', error);
    throw error;
  }
}

// Find similar tags to given tag
async function findSimilarTags(tag) {
  try {
    // Look for tags that contain the given tag or vice versa
    const [rows] = await pool.query(
      `SELECT tag FROM tags 
       WHERE tag LIKE ? OR ? LIKE CONCAT('%', tag, '%') 
       ORDER BY usage_count DESC 
       LIMIT 5`,
      [`%${tag.toLowerCase()}%`, tag.toLowerCase()]
    );
    return rows.map(row => row.tag);
  } catch (error) {
    console.error('Error finding similar tags:', error);
    throw error;
  }
}

// Add a new manual tag or increment if it exists
async function addManualTag(tag) {
  // Clean the tag (remove # prefix and make lowercase)
  const cleanTag = tag.replace(/^#/, '').toLowerCase().trim();
  
  if (!cleanTag) {
    throw new Error('Tag cannot be empty');
  }
  
  try {
    // First try to increment if it exists
    const [updateResult] = await pool.query(
      'UPDATE tags SET usage_count = usage_count + 1 WHERE tag = ?',
      [cleanTag]
    );
    
    // If no rows were affected, insert a new tag
    if (updateResult.affectedRows === 0) {
      await pool.query(
        'INSERT INTO tags (tag, usage_count) VALUES (?, 1)',
        [cleanTag]
      );
      console.log(`Added new manual tag: ${cleanTag}`);
    } else {
      console.log(`Incremented usage count for existing tag: ${cleanTag}`);
    }
    
    return { success: true, tag: cleanTag };
  } catch (error) {
    console.error('Error adding manual tag:', error);
    throw error;
  }
}

/**
 * Add a tag to the last assistant message in the database
 * @param {string} tag - Tag to add (with or without # prefix)
 * @param {string} sessionId - Session ID to identify the conversation
 * @returns {Promise<boolean>} - Success status
 */
async function addTagToLastAssistantMessage(tag, sessionId) {
  try {
    // Clean the tag
    const cleanTag = tag.replace(/^#/, '').toLowerCase().trim();
    if (!cleanTag) {
      console.error('Cannot add empty tag to message');
      return false;
    }
    
    // Format with # prefix
    const formattedTag = `#${cleanTag}`;
    
    // Get the latest assistant message for this session
    const [rows] = await pool.query(
      `SELECT id, tags FROM ollama_responses 
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY timestamp DESC LIMIT 1`,
      [sessionId]
    );
    
    if (!rows || rows.length === 0) {
      console.warn('No assistant messages found for session', sessionId);
      return false;
    }
    
    // Get the message ID and existing tags
    const messageId = rows[0].id;
    let existingTags = [];
    
    // Parse existing tags if they exist
    if (rows[0].tags) {
      try {
        existingTags = JSON.parse(rows[0].tags);
        if (!Array.isArray(existingTags)) {
          existingTags = [];
        }
      } catch (parseError) {
        console.error('Error parsing existing tags:', parseError);
        existingTags = [];
      }
    }
    
    // Check if tag already exists to avoid duplicates
    if (!existingTags.includes(formattedTag)) {
      // Add new tag to the array
      existingTags.push(formattedTag);
      
      // Update the database
      await pool.query(
        `UPDATE ollama_responses SET tags = ? WHERE id = ?`,
        [JSON.stringify(existingTags), messageId]
      );
      
      console.log(`Added tag ${formattedTag} to message ${messageId}`);
      return true;
    } else {
      console.log(`Tag ${formattedTag} already exists on message ${messageId}`);
      return true; // Already exists, so technically success
    }
  } catch (error) {
    console.error('Error adding tag to last assistant message:', error);
    return false;
  }
}

// ... existing code ...

module.exports = {
  // ... existing exports ...
  getBlockedTags,
  blockTag,
  unblockTag,
  addTagIfNotExists,
  incrementTagUsage,
  findSimilarTags,
  addManualTag,  // Add new export
  addTagToLastAssistantMessage
};