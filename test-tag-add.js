// Simple script to test tag addition
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

async function testAddTag() {
  try {
    // 1. Create a session in the sessions table first
    const sessionId = uuidv4();
    console.log(`Creating test session with ID: ${sessionId}`);
    
    // Insert the session first with correct column names
    await db.pool.query(
      `INSERT INTO sessions (id, created_at, last_activity) 
       VALUES (?, NOW(), NOW())`,
      [sessionId]
    );
    console.log("Inserted session into sessions table");
    
    // 2. Create a fake message
    const messageId = uuidv4();
    console.log(`Created test message: ${messageId}`);
    
    // 3. Insert the test message
    await db.pool.query(
      `INSERT INTO ollama_responses (session_id, message_id, response_content, tags) 
       VALUES (?, ?, ?, ?)`,
      [sessionId, messageId, "This is a test message", "[]"]
    );
    console.log("Inserted test message into ollama_responses");
    
    await db.pool.query(
      `INSERT INTO message_log (session_id, message_id, origin, content, tags) 
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, messageId, "assistant", "This is a test message", "[]"]
    );
    console.log("Inserted test message into message_log");
    
    // 4. Try to add a tag to it
    const tag = "test-tag-" + Date.now();
    console.log(`Adding tag: ${tag}`);
    
    const result = await db.addTagToLastAssistantMessage(tag, sessionId, messageId);
    console.log(`Result: ${result ? "SUCCESS" : "FAILURE"}`);
    
    // 5. Verify
    const [rows] = await db.pool.query(
      `SELECT tags FROM message_log WHERE message_id = ?`,
      [messageId]
    );
    
    if (rows.length > 0) {
      console.log(`Final tags in message_log: ${rows[0].tags}`);
    } else {
      console.log("No message found in message_log");
    }
    
    const [responseRows] = await db.pool.query(
      `SELECT tags FROM ollama_responses WHERE message_id = ?`,
      [messageId]
    );
    
    if (responseRows.length > 0) {
      console.log(`Final tags in ollama_responses: ${responseRows[0].tags}`);
    } else {
      console.log("No message found in ollama_responses");
    }
    
    console.log("Test complete");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

testAddTag();