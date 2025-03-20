// db-setup.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function setupDatabase() {
  console.log('Starting database setup...');
  
  // Get database configuration from environment variables or use defaults
  const dbConfig = {
    host: process.env.DB_HOST || '192.168.1.176',
    user: process.env.DB_USER || 'rob',
    password: process.env.DB_PASSWORD || 'Tardi$49152',
    multipleStatements: true // Allow multiple statements for setup
  };
  
  console.log(`Connecting to MySQL at ${dbConfig.host}...`);
  
  // Create initial connection without specifying database
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
  } catch (err) {
    console.error('Failed to connect to MySQL:', err);
    process.exit(1);
  }

  const dbName = process.env.DB_NAME || 'ollama_chat';
  
  try {
    // Create database if it doesn't exist
    console.log(`Creating database ${dbName} if it doesn't exist...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    
    // Switch to the database
    console.log(`Switching to database ${dbName}...`);
    await connection.query(`USE ${dbName}`);
    
    // Create user_messages table
    console.log('Creating user_messages table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        tags TEXT,
        INDEX (timestamp)
      )
    `);
    
    // Create ollama_responses table
    console.log('Creating ollama_responses table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ollama_responses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        response_content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_message_id INT,
        tags TEXT,
        INDEX (timestamp),
        FOREIGN KEY (user_message_id) REFERENCES user_messages(id) ON DELETE CASCADE
      )
    `);
    
    // Create tags table
    console.log('Creating tags table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tag_name VARCHAR(255) NOT NULL,
        first_used DATETIME DEFAULT CURRENT_TIMESTAMP,
        usage_count INT DEFAULT 1,
        UNIQUE KEY (tag_name)
      )
    `);
    
    console.log('Database setup completed successfully!');
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

// Run the setup if this script is executed directly
if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log('Database setup complete.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Database setup failed:', err);
      process.exit(1);
    });
} else {
  // Export for use in other files
  module.exports = setupDatabase;
}