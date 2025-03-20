const { processHashtags } = require('../utils/tag-utils');
const db = require('../db');  // Import database module

// Add this at the top of the file, after your imports

// List of common words to exclude from hashtag generation
const COMMON_WORDS_TO_EXCLUDE = [
   'a', 'about', 'above', 'after', 'again', 'against', 'all', 'almost', 'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another', 'any', 'anybody', 'anyone', 'anything', 'anywhere', 'are', 'are not', 'around', 'as', 'at', 'back', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'could not', 'did', 'did not', 'do', 'does', 'does not', 'doing', 'do not', 'down', 'during', 'each', 'either', 'else', 'enough', 'even', 'ever', 'every', 'everybody', 'everyone', 'everything', 'everywhere', 'except', 'few', 'for', 'from', 'further', 'get', 'gets', 'getting', 'give', 'given', 'gives', 'go', 'goes', 'going', 'gone', 'got', 'gotten', 'had', 'had not', 'has', 'has not', 'have', 'have not', 'having', 'he', 'he would', 'he will', 'he is', 'her', 'here', 'here is', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how is', 'however', 'i', 'i would', 'i will', 'i am', 'i have', 'if', 'in', 'inside', 'instead', 'into', 'is', 'is not', 'it', 'it is', 'its', 'itself', 'just', 'keep', 'keeps', 'kept', 'kind', 'knew', 'know', 'known', 'knows', 'last', 'later', 'least', 'less', 'let', 'let us', 'like', 'likely', 'long', 'made', 'make', 'makes', 'making', 'many', 'may', 'maybe', 'me', 'mean', 'meant', 'means', 'might', 'might not', 'mine', 'more', 'most', 'mostly', 'much', 'must', 'must not', 'my', 'myself', 'name', 'namely', 'near', 'need', 'needs', 'neither', 'never', 'next', 'no', 'nobody', 'non', 'none', 'nor', 'not', 'nothing', 'now', 'nowhere', 'of', 'off', 'often', 'oh', 'on', 'once', 'one', 'only', 'onto', 'or', 'other', 'others', 'otherwise', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'part', 'particular', 'particularly', 'past', 'per', 'perhaps', 'place', 'please', 'point', 'possible', 'probably', 'put', 'puts', 'quite', 'rather', 'really', 'regarding', 'right', 'said', 'same', 'saw', 'say', 'saying', 'says', 'second', 'see', 'seem', 'seemed', 'seeming', 'seems', 'seen', 'self', 'selves', 'sent', 'several', 'shall', 'shall not', 'she', 'she would', 'she will', 'she is', 'should', 'should not', 'since', 'so', 'some', 'somebody', 'someone', 'something', 'sometime', 'sometimes', 'somewhere', 'soon', 'still', 'such', 'sure', 'take', 'taken', 'taking', 'talked', 'tell', 'tends', 'than', 'that', 'that is', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there is', 'thereafter', 'thereby', 'therefore', 'therein', 'thereupon', 'these', 'they', 'they would', 'they will', 'they are', 'they have', 'thing', 'things', 'think', 'thinks', 'this', 'those', 'though', 'thought', 'through', 'throughout', 'thus', 'till', 'to', 'together', 'too', 'took', 'toward', 'towards', 'tried', 'tries', 'truly', 'try', 'trying', 'twice', 'under', 'underneath', 'undo', 'unfortunately', 'unless', 'unlike', 'unlikely', 'until', 'unto', 'up', 'upon', 'us', 'use', 'used', 'uses', 'using', 'usually', 'value', 'various', 'very', 'via', 'view', 'want', 'wants', 'was', 'was not', 'way', 'we', 'we would', 'we will', 'we are', 'we have', 'well', 'went', 'were', 'were not', 'what', 'what is', 'whatever', 'when', 'whence', 'whenever', 'where', 'where is', 'whereafter', 'whereas', 'whereby', 'wherein', 'whereupon', 'wherever', 'whether', 'which', 'while', 'whither', 'who', 'who is', 'whoever', 'whole', 'whom', 'whose', 'why', 'why is', 'will', 'willing', 'wish', 'with', 'within', 'without', 'will not', 'wonder', 'would', 'would not', 'yes', 'yet', 'you', 'you would', 'you will', 'you are', 'you have', 'your', 'youre', 'yours', 'yourself', 'yourselves'
];

// Function to check if a word should be excluded from becoming a hashtag
function shouldExcludeWord(word) {
  // Convert to lowercase for case-insensitive comparison
  const lowerWord = word.toLowerCase().trim();
  
  // Check if the word is in our exclusion list
  if (COMMON_WORDS_TO_EXCLUDE.includes(lowerWord)) {
    return true;
  }
  
  // Also exclude words that are too short (less than 3 characters)
  if (lowerWord.length < 3) {
    return true;
  }
  
  // Exclude words that are just numbers
  if (/^\d+$/.test(lowerWord)) {
    return true;
  }
  
  return false;
}

/**
 * Extract hashtags from user messages
 * @param {string} message - User message to extract hashtags from
 * @param {number} maxTags - Maximum number of tags to extract
 * @returns {Promise<string[]>} - Array of hashtags
 */
async function generateUserMessageHashtags(message, maxTags = 5) {
  console.log(`Generating hashtags for user message (${message?.length || 0} chars)`);
  
  try {
    if (!message || message.trim().length === 0) {
      console.log('Empty message, returning empty hashtags array');
      return [];
    }

    // First try to extract explicit hashtags
    const explicitTags = extractHashtagsFromText(message, maxTags);
    console.log(`Found ${explicitTags.length} explicit hashtags in text:`, explicitTags);
    
    // If we found explicit hashtags, use those but filter through common words
    if (explicitTags.length > 0) {
      // Filter explicit hashtags through common words exclusion
      const filteredExplicitTags = explicitTags.filter(tag => {
        const cleanTag = tag.replace(/^#/, '').trim();
        return cleanTag.length > 0 && !shouldExcludeWord(cleanTag);
      });
      
      console.log(`After filtering, ${filteredExplicitTags.length} explicit hashtags remain`);
      
      // Process hashtags to filter blocked tags
      const hashtags = await processHashtags(filteredExplicitTags);
      console.log(`Returning ${hashtags.length} processed explicit hashtags`);
      return formatHashtags(hashtags);
    }
    
    // If no explicit hashtags, generate from key terms in the message
    const keywords = extractKeywords(message);
    console.log(`Extracted ${keywords.length} keywords after common word filtering:`, keywords);
    
    if (keywords.length === 0) {
      // Fallback to some generic hashtags based on message length and type
      return generateFallbackHashtags(message);
    }
    
    // Format keywords as hashtags and limit to maxTags
    const keywordTags = keywords.slice(0, maxTags).map(kw => `#${kw}`);
    console.log(`Generated ${keywordTags.length} hashtags from keywords:`, keywordTags);
    
    // Process hashtags to filter blocked tags
    const hashtags = await processHashtags(keywordTags);
    
    return formatHashtags(hashtags);
  } catch (error) {
    console.error('Error generating user message hashtags:', error);
    // Return at least some fallback hashtags
    return ['#chat', '#conversation'].slice(0, maxTags);
  }
}

/**
 * Find messages containing a specific tag
 * @param {string} tag - Tag to search for (with or without # prefix)
 * @param {number} limit - Maximum number of messages to return (default 10)
 * @returns {Promise<Array>} - Array of messages matching the tag
 */
async function findMessagesByTag(tag, limit = 10) {
  try {
    // Normalize tag (remove # if present and convert to lowercase)
    const normalizedTag = tag.replace(/^#/, '').toLowerCase();
    
    console.log(`Searching for messages with tag: ${normalizedTag}`);
    
    if (!normalizedTag || normalizedTag.length < 2) {
      console.log('Tag too short, returning empty array');
      return [];
    }
    
    // Use JSON_SEARCH function for proper JSON field searching in MariaDB
    // This handles both "#tag" and "tag" formats
    const [messageLogRows] = await db.pool.query(`
      SELECT 
        ml.message_id, 
        ml.session_id, 
        ml.origin, 
        ml.content, 
        ml.tags,
        ml.timestamp,
        ml.chatbot_id
      FROM 
        message_log ml
      WHERE 
        (JSON_SEARCH(ml.tags, 'one', ?) IS NOT NULL OR 
         JSON_SEARCH(ml.tags, 'one', ?) IS NOT NULL)
      ORDER BY 
        ml.timestamp DESC
      LIMIT ?
    `, [`#${normalizedTag}`, normalizedTag, limit]);
    
    console.log(`Found ${messageLogRows?.length || 0} messages with tag: ${normalizedTag}`);
    
    if (!messageLogRows || messageLogRows.length === 0) {
      return [];
    }
    
    // Process results to extract relevant information
    const results = await Promise.all(messageLogRows.map(async row => {
      // Parse tags JSON
      let tags = [];
      try {
        tags = JSON.parse(row.tags || '[]');
      } catch (e) {
        console.error('Error parsing tags JSON:', e);
      }
      
      // Format timestamp
      const timestamp = row.timestamp ? new Date(row.timestamp).toISOString() : null;
      
      // Get chatbot name if applicable
      let chatbotName = null;
      if (row.chatbot_id) {
        try {
          const [chatbotRows] = await db.pool.query(
            'SELECT name FROM chatbots WHERE id = ?',
            [row.chatbot_id]
          );
          
          if (chatbotRows && chatbotRows.length > 0) {
            chatbotName = chatbotRows[0].name;
          }
        } catch (err) {
          console.error('Error getting chatbot name:', err);
        }
      }
      
      // Get related context (surrounding messages)
      let context = [];
      try {
        const [contextRows] = await db.pool.query(`
          SELECT 
            message_id, 
            origin, 
            content, 
            timestamp
          FROM 
            message_log
          WHERE 
            session_id = ? AND
            timestamp BETWEEN 
              (SELECT TIMESTAMP(timestamp) - INTERVAL 5 MINUTE FROM message_log WHERE message_id = ?) AND
              (SELECT TIMESTAMP(timestamp) + INTERVAL 5 MINUTE FROM message_log WHERE message_id = ?)
          ORDER BY 
            timestamp ASC
        `, [row.session_id, row.message_id, row.message_id]);
        
        if (contextRows) {
          context = contextRows.map(ctx => ({
            messageId: ctx.message_id,
            origin: ctx.origin,
            content: ctx.content.substring(0, 150) + (ctx.content.length > 150 ? '...' : ''),
            timestamp: ctx.timestamp ? new Date(ctx.timestamp).toISOString() : null,
            isMatch: ctx.message_id === row.message_id
          }));
        }
      } catch (err) {
        console.error('Error getting message context:', err);
      }
      
      // Return formatted result
      return {
        messageId: row.message_id,
        sessionId: row.session_id,
        origin: row.origin,
        content: row.content,
        snippet: row.content.substring(0, 150) + (row.content.length > 150 ? '...' : ''),
        tags: tags,
        timestamp: timestamp,
        chatbotId: row.chatbot_id,
        chatbotName: chatbotName,
        context: context
      };
    }));
    
    return results;
  } catch (error) {
    console.error('Error finding messages by tag:', error);
    return [];
  }
}


/**
 * Extract keywords from text
 * @private
 * @param {string} text - Text to extract keywords from
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(text) {
  // Split text into words
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .split(/\s+/)
    .filter(word => word.length >= 3); // Only keep words with 3+ chars
  
  // Count word frequency
  const wordCount = {};
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1;
  });
  
  // Filter out common words using our comprehensive COMMON_WORDS_TO_EXCLUDE list
  const filteredWords = Object.keys(wordCount).filter(word => !shouldExcludeWord(word));
  
  // Sort by frequency
  return filteredWords.sort((a, b) => wordCount[b] - wordCount[a]);
}

/**
 * Generate fallback hashtags when no explicit tags are found
 * @private
 * @param {string} message - Original message
 * @returns {string[]} - Array of hashtags
 */
function generateFallbackHashtags(message) {
  const fallbackTags = ['#chat'];
  
  // Add sentiment-based tags
  if (message.includes('?')) fallbackTags.push('#question');
  if (message.length > 100) fallbackTags.push('#detailed');
  if (message.length < 20) fallbackTags.push('#brief');
  
  // Add random general tags
  const generalTags = ['#discussion', '#topic', '#conversation', '#query'];
  fallbackTags.push(generalTags[Math.floor(Math.random() * generalTags.length)]);
  
  console.log('Using fallback hashtags:', fallbackTags);
  return fallbackTags;
}

/**
 * Check if tags are in the blocked_tags table and filter them out
 * @param {string[]} tags - Array of tags to check
 * @returns {Promise<string[]>} - Filtered tags
 */
async function filterBlockedTags(tags) {
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return [];
  }
  
  try {
    // Get all blocked tags from database
    const blockedTagsRows = await db.getBlockedTags();
    
    if (!blockedTagsRows || blockedTagsRows.length === 0) {
      return tags;
    }
    
    // Create a set of lowercase blocked tag names for faster lookup
    // Fix: Extract tag_name property from each row object
    const blockedTagSet = new Set(blockedTagsRows.map(row => {
      return typeof row === 'string' ? row.toLowerCase() : row.tag_name.toLowerCase();
    }));
    
    console.log(`Loaded ${blockedTagSet.size} blocked tags from database`);
    
    // Filter out blocked tags
    const filteredTags = tags.filter(tag => {
      if (!tag) return false;
      
      // Extract tag name without # prefix
      const tagName = typeof tag === 'string' 
        ? tag.replace(/^#/, '').toLowerCase().trim()
        : String(tag).replace(/^#/, '').toLowerCase().trim();
        
      return tagName.length > 0 && !blockedTagSet.has(tagName);
    });
    
    console.log(`Filtered out ${tags.length - filteredTags.length} blocked tags`);
    return filteredTags;
  } catch (error) {
    console.error('Error filtering blocked tags:', error);
    return tags; // Return original tags on error
  }
}

/**
 * Ensure hashtags are formatted properly
 * @private
 * @param {Array} hashtags - Array of hashtags to format
 * @returns {string[]} - Properly formatted hashtags
 */
function formatHashtags(hashtags) {
  if (!hashtags || !Array.isArray(hashtags)) return [];
  
  return hashtags.map(tag => {
    // If it's a string, format it properly
    if (typeof tag === 'string') {
      const cleanTag = tag.trim().replace(/^#+/, ''); // Remove existing # prefix
      return cleanTag ? `#${cleanTag}` : '';
    }
    // If it's an object with a name property
    else if (tag && typeof tag === 'object' && tag.name) {
      const cleanTag = tag.name.trim().replace(/^#+/, '');
      return cleanTag ? `#${cleanTag}` : '';
    }
    // Otherwise convert to string
    return tag ? `#${String(tag).trim().replace(/^#+/, '')}` : '';
  }).filter(tag => tag && tag.length > 1); // Remove empty tags
}

/**
 * Extract hashtags from AI response
 * @param {string} response - AI response to extract hashtags from
 * @param {number} maxTags - Maximum number of hashtags to extract
 * @returns {Promise<{content: string, hashtags: string[]}>} - Processed content and hashtags
 */
async function extractHashtags(response, maxTags = 5) {
  console.log(`Attempting to extract hashtags from message (${response?.length || 0} chars)`);
  
  try {
    if (!response || response.trim().length === 0) {
      return { content: '', hashtags: [] };
    }

    // Extract hashtags section or autodetect hashtags in response
    const result = extractHashtagsFromResponse(response);
    
    // If no hashtags found, generate some from the response content
    if (result.hashtags.length === 0) {
      console.log('No hashtags found in response, generating from content');
      const keywords = extractKeywords(response);
      
      // Filter keywords through common word exclusion list
      const filteredKeywords = keywords.filter(keyword => !shouldExcludeWord(keyword));
      console.log(`After common word filtering: ${filteredKeywords.length} keywords remain`);
      
      const keywordTags = filteredKeywords.slice(0, maxTags).map(kw => `#${kw}`);
      result.hashtags = keywordTags;
    } else {
      // Filter existing hashtags using the exclusion list
      result.hashtags = result.hashtags.filter(tag => {
        // Remove # prefix if present for checking
        const cleanTag = tag.replace(/^#/, '').trim();
        return cleanTag.length > 0 && !shouldExcludeWord(cleanTag);
      });
      console.log(`After common word filtering: ${result.hashtags.length} hashtags remain`);
    }
    
    // Check against blocked_tags table
    const nonBlockedTags = await filterBlockedTags(result.hashtags);
    console.log(`After blocked tags filtering: ${nonBlockedTags.length} tags remain`);
    
    // Process hashtags through our processing system (which may do additional checks)
    const processedTags = await processHashtags(nonBlockedTags);
    
    // Format hashtags properly
    const formattedTags = formatHashtags(processedTags);
    
    // Add diagnostic logging
    console.log(`Extracted ${formattedTags.length} hashtags:`, formattedTags);
    
    return {
      content: result.content,
      hashtags: formattedTags
    };
  } catch (error) {
    console.error('Error extracting hashtags:', error);
    // Return fallback hashtags instead of empty array
    return { 
      content: response,
      hashtags: ['#response', '#ai']
    };
  }
}

/**
 * Extract hashtags from text
 * @private
 * @param {string} text - Text to extract hashtags from
 * @param {number} maxTags - Maximum number of tags to extract
 * @returns {string[]} - Array of hashtags
 */
function extractHashtagsFromText(text, maxTags = 5) {
  // This is a simplified version - actual implementation may be more complex
  const hashtags = [];
  
  // Look for explicit hashtags in the message
  const hashtagRegex = /#([a-zA-Z0-9_-]+)/g;
  const matches = text.match(hashtagRegex) || [];
  
  // Add found hashtags to the array
  matches.forEach(tag => {
    if (hashtags.length < maxTags && !hashtags.includes(tag)) {
      hashtags.push(tag);
    }
  });
  
  return hashtags;
}

/**
 * Extract hashtags from AI response
 * @private
 * @param {string} response - AI response to extract hashtags from
 * @returns {{content: string, hashtags: string[]}} - Processed content and hashtags
 */
function extractHashtagsFromResponse(response) {
  // Look for hashtag section like "#HASHTAGS: tag1, tag2, tag3"
  const hashtagSectionRegex = /#\s*HASHTAGS\s*:([^]*?)(?=\n\n|\n$|$)/i;
  const match = response.match(hashtagSectionRegex);
  
  let content = response;
  let hashtags = [];
  
  if (match) {
    // Extract hashtags from section
    const hashtagSection = match[1].trim();
    const hashtagList = hashtagSection.split(/,\s*|\s+/);
    
    // Format hashtags properly
    hashtags = hashtagList
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .map(tag => tag.startsWith('#') ? tag : `#${tag}`);
    
    // Remove hashtag section from content
    content = response.replace(hashtagSectionRegex, '').trim();
  } else {
    // If no hashtag section, look for standalone hashtags in the content
    const hashtagRegex = /#([a-zA-Z0-9_-]+)/g;
    const matches = response.match(hashtagRegex) || [];
    
    // Add found hashtags to the array
    hashtags = [...new Set(matches)]; // Remove duplicates
  }
  
  return { content, hashtags };
}

module.exports = {
  generateUserMessageHashtags,
  extractHashtags,
  filterBlockedTags,
  shouldExcludeWord,
  findMessagesByTag,
  formatHashtags 
};