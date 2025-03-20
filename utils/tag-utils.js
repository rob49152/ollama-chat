const db = require('../db');

/**
 * Process a list of hashtags to filter out blocked tags and replace with better alternatives
 * @param {string[]} hashtags - Array of hashtags to process
 * @returns {Promise<string[]>} - Processed hashtags
 */
async function originalProcessHashtags(hashtags) {
  if (!hashtags || !Array.isArray(hashtags) || hashtags.length === 0) {
    console.log('No hashtags to process, returning empty array');
    return [];
  }

  try {
    // Normalize hashtags first
    const normalizedTags = hashtags.map(tag => {
      if (typeof tag === 'string') {
        // Make sure each tag starts with #
        const cleanTag = tag.trim();
        return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
      } else if (tag && typeof tag === 'object' && tag.name) {
        const cleanTag = tag.name.trim();
        return cleanTag.startsWith('#') ? cleanTag : `#${cleanTag}`;
      }
      return `#${String(tag).trim()}`;
    }).filter(tag => tag.length > 1);

    // Get all blocked tags
    const [blockedTagsResults] = await db.pool.query('SELECT tag_name FROM blocked_tags');
    const blockedTags = blockedTagsResults.map(row => row.tag_name.toLowerCase());

    // Get tag synonyms/replacements
    const [tagSynonymsResults] = await db.pool.query('SELECT original_tag, better_tag FROM tag_synonyms');
    const tagSynonyms = {};
    
    // Create a map of original -> better tags
    tagSynonymsResults.forEach(row => {
      tagSynonyms[row.original_tag.toLowerCase()] = row.better_tag;
    });

    console.log(`Processing ${normalizedTags.length} hashtags with ${blockedTags.length} blocked tags and ${Object.keys(tagSynonyms).length} synonyms`);

    // Process each hashtag: filter out blocked tags and replace with better alternatives
    const processedTags = [];
    const seenTags = new Set(); // Track already added tags to avoid duplicates

    for (const tag of normalizedTags) {
      // Remove # prefix and normalize
      const cleanTag = tag.replace(/^#/, '').trim().toLowerCase();
      
      // Skip this tag if it's blocked
      if (blockedTags.includes(cleanTag)) {
        console.log(`Tag #${cleanTag} is blocked, skipping`);
        continue;
      }
      
      // Check if there's a better alternative for this tag
      let bestTag;
      if (tagSynonyms[cleanTag]) {
        console.log(`Using better tag #${tagSynonyms[cleanTag]} instead of #${cleanTag}`);
        bestTag = tagSynonyms[cleanTag];
      } else {
        bestTag = cleanTag;
      }
      
      // Add # prefix back
      const formattedTag = `#${bestTag}`;
      
      // Only add if not already seen
      if (!seenTags.has(formattedTag.toLowerCase())) {
        processedTags.push(formattedTag);
        seenTags.add(formattedTag.toLowerCase());
      }
    }
    
    // If all tags were filtered out, provide some default tags
    if (processedTags.length === 0 && normalizedTags.length > 0) {
      console.log('All tags were filtered out, adding default tag');
      processedTags.push('#conversation');
    }
    
    return processedTags;
  } catch (error) {
    console.error('Error processing hashtags:', error);
    // If DB error occurs, return the original hashtags
    return hashtags.map(tag => {
      if (typeof tag === 'string') {
        return tag.trim().startsWith('#') ? tag.trim() : `#${tag.trim()}`;
      }
      return `#${String(tag).trim()}`;
    }).filter(tag => tag.length > 1);
  }
}

// Add a diagnostic wrapper to the processHashtags function

// Replace with diagnostic wrapper
async function processHashtags(hashtags) {
  console.log(`PROCESS HASHTAGS called with:`, hashtags);
  console.log(`Type: ${typeof hashtags}, isArray: ${Array.isArray(hashtags)}, length: ${hashtags?.length || 'N/A'}`);
  
  if (!hashtags) return [];
  
  if (!Array.isArray(hashtags)) {
    console.warn('processHashtags received non-array input, converting to array');
    if (typeof hashtags === 'string') {
      hashtags = [hashtags];
    } else if (typeof hashtags === 'object') {
      hashtags = Object.values(hashtags).filter(v => v);
    } else {
      hashtags = [];
    }
  }
  
  try {
    const result = await originalProcessHashtags(hashtags);
    console.log(`PROCESS HASHTAGS result:`, result);
    return result;
  } catch (error) {
    console.error('Error in processHashtags:', error);
    // Return original hashtags as fallback
    return hashtags;
  }
}

module.exports = { processHashtags };
