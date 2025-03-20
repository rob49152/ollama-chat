const express = require('express');
const router = express.Router();
const hashtagService = require('../services/hashtag-service');
const utils = require('../utils/tag-utils');

// Add a test endpoint for hashtags
router.post('/test/hashtags', async (req, res) => {
  try {
    const { message } = req.body;
    const result = {
      original: message,
      steps: []
    };
    
    // Step 1: Generate user hashtags
    try {
      const rawHashtags = await hashtagService.generateUserMessageHashtags(message, 6);
      result.steps.push({
        name: 'generateUserMessageHashtags',
        success: true,
        result: rawHashtags
      });
    } catch (error) {
      result.steps.push({
        name: 'generateUserMessageHashtags',
        success: false,
        error: error.message
      });
    }
    
    // Step 2: Process hashtags
    try {
      const processed = await utils.processHashtags(result.steps[0].result);
      result.steps.push({
        name: 'processHashtags',
        success: true,
        result: processed
      });
    } catch (error) {
      result.steps.push({
        name: 'processHashtags',
        success: false,
        error: error.message
      });
    }
    
    // Step 3: Extract hashtags
    try {
      const extracted = await hashtagService.extractHashtags(message, 6);
      result.steps.push({
        name: 'extractHashtags',
        success: true,
        result: extracted
      });
    } catch (error) {
      result.steps.push({
        name: 'extractHashtags',
        success: false,
        error: error.message
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;