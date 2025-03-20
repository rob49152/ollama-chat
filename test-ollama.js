// test-ollama.js
// A simple script to test the connection to Ollama directly

const axios = require('axios');

async function testOllama() {
  const OLLAMA_API_URL = 'http://localhost:11434/api';
  
  console.log('Testing Ollama connection...');
  
  try {
    // Test 1: Check available models
    console.log('Test 1: Checking available models...');
    const tagsResponse = await axios.get(`${OLLAMA_API_URL}/tags`);
    console.log('Available models:', tagsResponse.data.models.map(m => m.name).join(', '));
    
    // Test 2: Simple generation request
    console.log('\nTest 2: Testing simple generation...');
    const model = tagsResponse.data.models[0]?.name || 'mistral';
    console.log(`Using model: ${model}`);
    
    const response = await axios.post(`${OLLAMA_API_URL}/generate`, {
      model: model,
      prompt: 'Say hello to the world in one sentence.',
      stream: false
    });
    
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
    
    console.log('\n✅ Ollama connection test successful!');
  } catch (error) {
    console.error('❌ Error testing Ollama connection:');
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      console.error('No response received. Is Ollama running?');
    } else {
      console.error('Error:', error.message);
    }
  }
}

testOllama();