// ollama-direct.js
// A script to directly test ollama API without socket.io or express

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// Get configuration from file or use defaults
let config;
try {
  if (fs.existsSync('./config.json')) {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
  } else {
    config = {
      ollamaApiUrl: 'http://localhost:11434/api',
      defaultModel: '',
      temperature: 0.7,
      maxTokens: 2000
    };
  }
} catch (error) {
  console.error('Error reading config:', error);
  process.exit(1);
}

// Use direct Axios with logging of every step of the process
async function testOllamaDirectly() {
  console.log('========== DIRECT OLLAMA API TEST ==========');
  console.log('Using configuration:');
  console.log('- API URL:', config.ollamaApiUrl);
  console.log('- Model:', config.defaultModel || 'Will auto-select');
  console.log('- Temperature:', config.temperature);
  console.log('- Max Tokens:', config.maxTokens);
  
  try {
    // Step 1: Get available models
    console.log('\n1. Getting available models...');
    const tagsResponse = await axios.get(`${config.ollamaApiUrl}/tags`);
    const availableModels = tagsResponse.data.models || [];
    
    if (availableModels.length === 0) {
      console.error('❌ No models available on your Ollama server!');
      return;
    }
    
    console.log('Available models:');
    availableModels.forEach(model => {
      console.log(`- ${model.name} (${formatSize(model.size)})`);
    });
    
    // Step 2: Select model to use (from config or first available)
    let modelToUse = config.defaultModel;
    if (!modelToUse || modelToUse.trim() === '') {
      modelToUse = availableModels[0].name;
      console.log(`\nNo model configured, using first available: ${modelToUse}`);
    } else {
      // Check if the model exists
      const modelExists = availableModels.some(m => m.name === modelToUse);
      if (!modelExists) {
        console.warn(`⚠️ Warning: Model "${modelToUse}" not found on server!`);
        console.log(`Using first available model instead: ${availableModels[0].name}`);
        modelToUse = availableModels[0].name;
      }
    }
    
    // Step 3: Prepare and send a message to Ollama
    console.log(`\n2. Sending test message to model: ${modelToUse}`);
    
    const testMessage = 'Write a single paragraph about programming. Add specific hashtags.';
    console.log('Test message:', testMessage);
    
    const requestPayload = {
      model: modelToUse,
      prompt: testMessage + "\n\nInclude 3-5 very specific hashtags as: '#HASHTAGS: #tag1 #tag2'",
      stream: false,
      temperature: parseFloat(config.temperature) || 0.7,
      max_tokens: parseInt(config.maxTokens, 10) || 2000
    };
    
    console.log('\nRequest payload:');
    console.log(JSON.stringify(requestPayload, null, 2));
    
    // Time the request
    const startTime = Date.now();
    
    // Make the request with increased timeout
    console.log(`\n3. Making request to ${config.ollamaApiUrl}/generate at ${new Date().toISOString()}...`);
    const generateResponse = await axios.post(
      `${config.ollamaApiUrl}/generate`,
      requestPayload,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000 // 2 minutes timeout
      }
    );
    
    const endTime = Date.now();
    const responseTime = (endTime - startTime) / 1000;
    
    // Step 4: Process the response
    console.log(`\n4. Received response in ${responseTime.toFixed(2)} seconds`);
    console.log('Response status:', generateResponse.status);
    console.log('Response headers:', JSON.stringify(generateResponse.headers, null, 2));
    
    if (generateResponse.data && generateResponse.data.response) {
      console.log('\n5. Response content:');
      console.log('-'.repeat(50));
      console.log(generateResponse.data.response);
      console.log('-'.repeat(50));
      
      // Parse hashtags
      console.log('\n6. Extracting hashtags...');
      
      const hashtagRegex = /#\w+/g;
      const hashtags = generateResponse.data.response.match(hashtagRegex) || [];
      
      if (hashtags.length > 0) {
        console.log('Found hashtags:', hashtags.join(', '));
      } else {
        console.log('No hashtags found in the response');
      }
      
      console.log('\n✅ Direct Ollama test completed successfully!');
      
    } else {
      console.error('❌ Response does not contain expected data:');
      console.log(JSON.stringify(generateResponse.data, null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ Error testing Ollama API directly:');
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      console.error('No response received from Ollama.');
      console.error('Request details:', error.request._header);
      console.error('Is Ollama running? Check with: ps aux | grep ollama');
    } else {
      console.error('Error details:', error.message);
    }
    
    if (error.code === 'ECONNABORTED') {
      console.error('Request timed out after 2 minutes!');
      console.error('This could indicate the model is too large or your system is under heavy load.');
    }
  }
}

// Format file size
function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run the test
testOllamaDirectly();