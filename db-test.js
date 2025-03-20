// db-test.js
// A script to test database connection and perform diagnostic queries

require('dotenv').config();
const mysql = require('mysql2/promise');
const { pool } = require('./db');

async function testDatabase() {
  console.log('========== DATABASE TEST ==========');
  
  try {
    // Test 1: Basic connection
    console.log('Test 1: Testing database connection...');
    const [connectionTest] = await pool.query('SELECT 1 as connection_test');
    console.log('✅ Connection successful:', connectionTest[0]);

    // Test 2: Check if tables exist
    console.log('\nTest 2: Checking tables...');
    const [tables] = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = ?
    `, [process.env.DB_NAME || 'ollama_chat']);
    
    console.log('Tables found:', tables.map(t => t.table_name));

    // Test 3: Count records in each table
    console.log('\nTest 3: Counting records in tables...');
    
    for (const table of tables) {
      const tableName = table.table_name;
      const [count] = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      console.log(`- ${tableName}: ${count[0].count} records`);
    }

    // Test 4: Sample data from user_messages
    console.log('\nTest 4: Sample data from user_messages (up to 5 records)...');
    const [messages] = await pool.query(`
      SELECT id, message_content, timestamp, tags
      FROM user_messages
      ORDER BY timestamp DESC
      LIMIT 5
    `);

    if (messages.length === 0) {
      console.log('No user messages found in the database.');
    } else {
      messages.forEach(msg => {
        console.log(`\nMessage ID: ${msg.id}`);
        console.log(`Time: ${msg.timestamp}`);
        console.log(`Content: ${msg.message_content.substring(0, 100)}${msg.message_content.length > 100 ? '...' : ''}`);
        console.log(`Tags: ${msg.tags || 'none'}`);
      });
    }

    // Test 5: Sample data from ollama_responses
    console.log('\nTest 5: Sample data from ollama_responses (up to 5 records)...');
    const [responses] = await pool.query(`
      SELECT id, user_message_id, timestamp, tags, 
             response_content
      FROM ollama_responses
      ORDER BY timestamp DESC
      LIMIT 5
    `);

    if (responses.length === 0) {
      console.log('No Ollama responses found in the database.');
    } else {
      responses.forEach(resp => {
        console.log(`\nResponse ID: ${resp.id}`);
        console.log(`For message ID: ${resp.user_message_id}`);
        console.log(`Time: ${resp.timestamp}`);
        console.log(`Content: ${resp.response_content.substring(0, 100)}${resp.response_content.length > 100 ? '...' : ''}`);
        console.log(`Tags: ${resp.tags || 'none'}`);
      });
    }

    // Test 6: All tags with usage
    console.log('\nTest 6: All tags with usage counts...');
    const [tags] = await pool.query(`
      SELECT tag_name, usage_count, first_used
      FROM tags
      ORDER BY usage_count DESC
    `);

    if (tags.length === 0) {
      console.log('No tags found in the database.');
    } else {
      tags.forEach(tag => {
        console.log(`- ${tag.tag_name}: ${tag.usage_count} uses (first: ${tag.first_used})`);
      });
    }

    // Test 7: Test a transaction
    console.log('\nTest 7: Testing transaction...');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      // Insert a test message
      const [insertMsg] = await conn.query(`
        INSERT INTO user_messages (message_content, tags) 
        VALUES (?, ?)
      `, ['This is a database test message', JSON.stringify(['#test', '#database'])]);
      
      const msgId = insertMsg.insertId;
      console.log(`Inserted test message with ID: ${msgId}`);
      
      // Insert a test response
      const [insertResp] = await conn.query(`
        INSERT INTO ollama_responses (response_content, user_message_id, tags)
        VALUES (?, ?, ?)
      `, ['This is a test response from the database test script', msgId, JSON.stringify(['#test', '#response'])]);
      
      console.log(`Inserted test response with ID: ${insertResp.insertId}`);
      
      // Update tags table
      await conn.query(`
        INSERT INTO tags (tag_name, usage_count) VALUES
        ('test', 1), ('database', 1), ('response', 1)
        ON DUPLICATE KEY UPDATE usage_count = usage_count + 1
      `);
      
      // Commit the transaction
      await conn.commit();
      console.log('✅ Transaction committed successfully');
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    console.log('\n✅ All database tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Database test failed:', error);
  } finally {
    // Close the connection pool
    pool.end();
  }
}

// Run the test
testDatabase();