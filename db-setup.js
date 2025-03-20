// db-setup.js
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Database connection configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

async function setupDatabase() {
  let connection;

  try {
    // First connect without specifying a database to create it if needed
    connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password
    });

    // Create database if it doesn't exist
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    console.log(`Database ${dbConfig.database} created or already exists`);

    // Close connection
    await connection.end();

    // Connect again with the database specified
    connection = await mysql.createConnection(dbConfig);

    // Create sessions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(36) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        client_info TEXT
      )
    `);
    console.log('Sessions table created or already exists');

    // Create chatbots configuration table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chatbot_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('Chatbot configurations table created or already exists');

    // Add chatbot_id column to sessions table if it doesn't exist
    try {
      await connection.query(`
        ALTER TABLE sessions
        ADD COLUMN chatbot_id INT NULL
      `);
      console.log('Added chatbot_id column to sessions table');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('chatbot_id column already exists in sessions table');
      } else {
        console.error('Error adding chatbot_id column:', error);
      }
    }

    // Create chatbot settings table for detailed configuration
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chatbot_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chatbot_id INT NOT NULL,
        setting_key VARCHAR(50) NOT NULL,
        setting_value TEXT,
        UNIQUE KEY unique_chatbot_setting (chatbot_id, setting_key)
      )
    `);
    console.log('Chatbot settings table created or already exists');

    // Create chatbot examples table for example conversations
    await connection.query(`
      CREATE TABLE IF NOT EXISTS chatbot_examples (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chatbot_id INT NOT NULL,
        role ENUM('user', 'assistant') NOT NULL,
        content TEXT NOT NULL,
        sequence INT NOT NULL
      )
    `);
    console.log('Chatbot examples table created or already exists');

    // Add foreign key from sessions to chatbot_configs
    try {
      // Check if the foreign key already exists
      const [foreignKeyCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'sessions'
        AND COLUMN_NAME = 'chatbot_id'
        AND REFERENCED_TABLE_NAME = 'chatbot_configs'
      `);

      if (foreignKeyCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE sessions
          ADD CONSTRAINT fk_sessions_chatbot
          FOREIGN KEY (chatbot_id) REFERENCES chatbot_configs(id) ON DELETE SET NULL
        `);
        console.log('Added chatbot_id foreign key to sessions table');
      } else {
        console.log('Foreign key for chatbot_id already exists in sessions table');
      }
    } catch (fkError) {
      console.warn('Warning: Could not create foreign key for sessions.chatbot_id:', fkError.message);
    }

    // Add foreign keys to chatbot settings and examples tables
    try {
      // Check if the foreign key already exists for chatbot_settings
      const [settingsFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'chatbot_settings'
        AND COLUMN_NAME = 'chatbot_id'
        AND REFERENCED_TABLE_NAME = 'chatbot_configs'
      `);

      if (settingsFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE chatbot_settings
          ADD CONSTRAINT fk_settings_chatbot
          FOREIGN KEY (chatbot_id) REFERENCES chatbot_configs(id) ON DELETE CASCADE
        `);
        console.log('Added chatbot_id foreign key to chatbot_settings table');
      } else {
        console.log('Foreign key for chatbot_id already exists in chatbot_settings table');
      }
    } catch (fkError) {
      console.warn('Warning: Could not create foreign key for chatbot_settings.chatbot_id:', fkError.message);
    }

    try {
      // Check if the foreign key already exists for chatbot_examples
      const [examplesFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'chatbot_examples'
        AND COLUMN_NAME = 'chatbot_id'
        AND REFERENCED_TABLE_NAME = 'chatbot_configs'
      `);

      if (examplesFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE chatbot_examples
          ADD CONSTRAINT fk_examples_chatbot
          FOREIGN KEY (chatbot_id) REFERENCES chatbot_configs(id) ON DELETE CASCADE
        `);
        console.log('Added chatbot_id foreign key to chatbot_examples table');
      } else {
        console.log('Foreign key for chatbot_id already exists in chatbot_examples table');
      }
    } catch (fkError) {
      console.warn('Warning: Could not create foreign key for chatbot_examples.chatbot_id:', fkError.message);
    }

    // Create user_messages table with session_id
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(36) NOT NULL,
        message_id VARCHAR(36) NOT NULL,
        message_content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tags JSON
      )
    `);
    console.log('User messages table created or already exists');

    // Add foreign key from user_messages to sessions
    try {
      // Check if the foreign key already exists
      const [userMsgFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'user_messages'
        AND COLUMN_NAME = 'session_id'
        AND REFERENCED_TABLE_NAME = 'sessions'
      `);

      if (userMsgFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE user_messages
          ADD CONSTRAINT fk_user_messages_session
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        `);
        console.log('Added session_id foreign key to user_messages table');
      } else {
        console.log('Foreign key for session_id already exists in user_messages table');
      }
    } catch (fkError) {
      console.warn('Warning: Could not create foreign key for user_messages.session_id:', fkError.message);
    }

    // Create ollama_responses table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ollama_responses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(36) NOT NULL,
        message_id VARCHAR(36) NOT NULL,
        user_message_id INT,
        response_content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        tags JSON
      )
    `);
    console.log('Ollama responses table created or already exists');

    // Create blocked_tags table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS blocked_tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tag_name VARCHAR(100) NOT NULL UNIQUE,
        reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )

      CREATE INDEX idx_blocked_tag_name ON blocked_tags (tag_name);
    `);
    console.log('Ollama responses table created for blocked tags:');

    // Add chatbot_id column to ollama_responses table if it doesn't exist
    try {
      await connection.query(`
        ALTER TABLE ollama_responses
        ADD COLUMN chatbot_id INT NULL
      `);
      console.log('Added chatbot_id column to ollama_responses table');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('chatbot_id column already exists in ollama_responses table');
      } else {
        console.error('Error adding chatbot_id column:', error);
      }
    }

    // Add foreign keys to ollama_responses table
    try {
      // Session ID foreign key
      const [respSessionFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ollama_responses'
        AND COLUMN_NAME = 'session_id'
        AND REFERENCED_TABLE_NAME = 'sessions'
      `);

      if (respSessionFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE ollama_responses
          ADD CONSTRAINT fk_responses_session
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        `);
        console.log('Added session_id foreign key to ollama_responses table');
      } else {
        console.log('Foreign key for session_id already exists in ollama_responses table');
      }

      // User message ID foreign key
      const [respMsgFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ollama_responses'
        AND COLUMN_NAME = 'user_message_id'
        AND REFERENCED_TABLE_NAME = 'user_messages'
      `);

      if (respMsgFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE ollama_responses
          ADD CONSTRAINT fk_responses_user_message
          FOREIGN KEY (user_message_id) REFERENCES user_messages(id)
        `);
        console.log('Added user_message_id foreign key to ollama_responses table');
      } else {
        console.log('Foreign key for user_message_id already exists in ollama_responses table');
      }

      // Chatbot ID foreign key
      const [respChatbotFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ollama_responses'
        AND COLUMN_NAME = 'chatbot_id'
        AND REFERENCED_TABLE_NAME = 'chatbot_configs'
      `);

      if (respChatbotFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE ollama_responses
          ADD CONSTRAINT fk_responses_chatbot
          FOREIGN KEY (chatbot_id) REFERENCES chatbot_configs(id) ON DELETE SET NULL
        `);
        console.log('Added chatbot_id foreign key to ollama_responses table');
      } else {
        console.log('Foreign key for chatbot_id already exists in ollama_responses table');
      }
    } catch (fkError) {
      console.warn('Warning: Could not create foreign keys for ollama_responses table:', fkError.message);
    }

    // Create tags table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tag_name VARCHAR(100) NOT NULL UNIQUE,
        usage_count INT DEFAULT 1,
        first_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Tags table created or already exists');

    // Create master message log table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS message_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(36) NOT NULL,
        message_id VARCHAR(36) NOT NULL,
        origin ENUM('user', 'assistant', 'system') NOT NULL,
        content TEXT NOT NULL,
        tags JSON,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Master message log table created or already exists');

    // Add chatbot_id column to message_log table if it doesn't exist
    try {
      await connection.query(`
        ALTER TABLE message_log
        ADD COLUMN chatbot_id INT NULL
      `);
      console.log('Added chatbot_id column to message_log table');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('chatbot_id column already exists in message_log table');
      } else {
        console.error('Error adding chatbot_id column:', error);
      }
    }

    // Add foreign keys to message_log table
    try {
      // Session ID foreign key
      const [logSessionFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'message_log'
        AND COLUMN_NAME = 'session_id'
        AND REFERENCED_TABLE_NAME = 'sessions'
      `);

      if (logSessionFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE message_log
          ADD CONSTRAINT fk_log_session
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        `);
        console.log('Added session_id foreign key to message_log table');
      } else {
        console.log('Foreign key for session_id already exists in message_log table');
      }

      // Chatbot ID foreign key
      const [logChatbotFKCheck] = await connection.query(`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'message_log'
        AND COLUMN_NAME = 'chatbot_id'
        AND REFERENCED_TABLE_NAME = 'chatbot_configs'
      `);

      if (logChatbotFKCheck[0].count === 0) {
        await connection.query(`
          ALTER TABLE message_log
          ADD CONSTRAINT fk_log_chatbot
          FOREIGN KEY (chatbot_id) REFERENCES chatbot_configs(id) ON DELETE SET NULL
        `);
        console.log('Added chatbot_id foreign key to message_log table');
      } else {
        console.log('Foreign key for chatbot_id already exists in message_log table');
      }
    } catch (fkError) {
      console.warn('Warning: Could not create foreign keys for message_log table:', fkError.message);
    }

    // Add indexes for performance - checking if they exist before creating them
    console.log('Setting up indexes...');

    // Helper function to safely create indexes
    async function safeCreateIndex(connection, tableName, indexName, columnName) {
      try {
        // Check if index already exists
        const [indexExists] = await connection.query(`
          SELECT COUNT(*) as count FROM information_schema.statistics
          WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
        `, [tableName, indexName]);

        if (indexExists[0].count === 0) {
          // Create the index if it doesn't exist
          await connection.query(`
            CREATE INDEX ${indexName} ON ${tableName}(${columnName})
          `);
          console.log(`Created index ${indexName} on ${tableName}`);
        } else {
          console.log(`Index ${indexName} already exists on ${tableName}`);
        }
      } catch (error) {
        console.warn(`Warning: Error handling index ${indexName} on ${tableName}: ${error.message}`);
      }
    }

    // Create all required indexes
    await safeCreateIndex(connection, 'user_messages', 'idx_session_id_um', 'session_id');
    await safeCreateIndex(connection, 'user_messages', 'idx_message_id_um', 'message_id');
    await safeCreateIndex(connection, 'ollama_responses', 'idx_session_id_or', 'session_id');
    await safeCreateIndex(connection, 'ollama_responses', 'idx_message_id_or', 'message_id');
    await safeCreateIndex(connection, 'ollama_responses', 'idx_user_message_id', 'user_message_id');
    await safeCreateIndex(connection, 'message_log', 'idx_session_id_ml', 'session_id');
    await safeCreateIndex(connection, 'message_log', 'idx_message_id_ml', 'message_id');
    await safeCreateIndex(connection, 'message_log', 'idx_chatbot_id_ml', 'chatbot_id');

    // Ensure default chatbot configuration exists
    const [defaultConfigCheck] = await connection.query(`
      SELECT COUNT(*) as count FROM chatbot_configs WHERE is_default = TRUE
    `);

    if (defaultConfigCheck[0].count === 0) {
      // Create default chatbot
      const [defaultResult] = await connection.query(`
        INSERT INTO chatbot_configs (name, is_default) VALUES ('Default Assistant', TRUE)
      `);

      const chatbotId = defaultResult.insertId;

      // Add default settings
      await connection.query(`
        INSERT INTO chatbot_settings (chatbot_id, setting_key, setting_value) VALUES
        (1, 'personality', 'Helpful, friendly, and informative AI assistant.'),
        (1, 'character_history', 'I am an AI assistant designed to provide helpful and accurate information.'),
        (1, 'system_prompt', 'You are a helpful AI assistant that responds to user queries in a clear and concise manner. Provide accurate information and be conversational in your approach.'),
        (1, 'bubble_color', '#f8f8f8'),
        (1, 'text_color', '#000000')
      `, [chatbotId, chatbotId, chatbotId, chatbotId, chatbotId]);

      // Add some example exchanges
      await connection.query(`
        INSERT INTO chatbot_examples (chatbot_id, role, content, sequence) VALUES
        (1, 'user', 'Can you help me understand how neural networks work?', 1),
        (1, 'assistant', 'Of course! Neural networks are computing systems inspired by the human brain. They consist of layers of interconnected nodes or "neurons" that process information. The basic structure includes input layers, hidden layers, and output layers. Each connection between neurons has a weight that adjusts during learning. Would you like me to explain a specific aspect of neural networks in more detail?', 2),
        (1, 'user', 'What\\'s the weather like today?', 3),
        (1, 'assistant', 'I don\\'t have access to real-time weather data or your location. To get the current weather, you could check a weather website or app like Weather.com, AccuWeather, or use your device\\'s built-in weather app. Is there something else I can help you with?', 4)
      `, [chatbotId, chatbotId, chatbotId, chatbotId]);

      console.log('Created default chatbot configuration');
    }

      // Add default chatbot
      await connection.query(`
        INSERT INTO chatbot_configs (id, name, is_default, created_at, updated_at) VALUES
        (1, 'default chatbot', 1, '2025-03-02 01:03:01', '2025-03-02 01:03:01')
      `, [chatbotId, chatbotId, chatbotId, chatbotId]);

      console.log('Created default chatbot configuration');
    }
    console.log('Database setup completed successfully');
  
  } catch (error) {
    console.error('Error setting up database:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the setup
setupDatabase()
  .then(() => {
    console.log('Database setup completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Database setup failed:', error);
    process.exit(1);
  });