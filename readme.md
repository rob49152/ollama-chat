# Ollama Chat Web Interface

A web application that allows users to chat with Ollama's LLM models through a user-friendly interface, with all conversations stored in a MySQL database.

## Features

- Real-time chat with Ollama models through a web interface
- Intelligent hashtag generation based on conversation content (with enhanced entity extraction)
- MySQL database for persistent storage of conversations (developed on MariaDB)
- Configuration management for model selection and parameters
- Debugging utilities for troubleshooting

## Prerequisites

- Node.js 14+ and npm
- MySQL database (or MariaDB)
- Ollama installed and running (https://localhost:11434)

## Installation

1. Clone the repository:
   ```
   git clone https://your-repository-url/ollama-chat-web.git
   cd ollama-chat-web
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the project root with the following content:
   ```
   DB_HOST=localhost
   DB_USER=your_database_user
   DB_PASSWORD=your_database_password
   DB_NAME=ollama_chat
   PORT=3000
   ```
   note: 3305 for MariaDb 5.0
         3307 for MariaDb 10.0

4. Set up the database:
   ```
   npm run db-setup
   ```

## Usage

1. Start the application:
   ```
   npm start
   ```

2. Access the web interface at `http://localhost:3000` or 3305 or 3307 (see .env creation above)

3. In the settings modal:
   - Select your preferred Ollama model
   - Adjust temperature and token settings
   - Configure context message count

## Project Structure

```
project-root/
├── server.js              // Main entry point
├── db.js                  // Database module
├── db-setup.js            // Database setup script
├── db-test.js             // Database testing utility
├── ollama-direct.js       // Direct Ollama API testing
├── config/
│   └── config-manager.js  // Configuration loading and management
├── routes/
│   ├── api-routes.js      // API endpoints
│   └── debug-routes.js    // Debugging routes
├── services/
│   ├── hashtag-service.js // Enhanced hashtag generation
│   └── ollama-service.js  // Ollama API interaction
├── socket/
│   └── socket-handler.js  // Socket.IO connection handling
└── public/                // Frontend assets and client-side code
    ├── index.html
    ├── client.js
    └── styles.css
```

## Enhanced Hashtag Generation

The system features an improved hashtag generation algorithm that extracts specific entities from conversations and categorizes them based on the 5W's (Who, What, Where, When, Why/How):

- **People/Organizations (Who)** - Extracts names and organizations using capitalization patterns
- **Actions/Verbs (What)** - Identifies important verbs that describe key activities
- **Locations (Where)** - Recognizes place names and locations
- **Time References (When)** - Captures dates, months, and temporal expressions
- **Concepts/Technical terms (Why/How)** - Identifies domain-specific technical vocabulary

This categorization provides more meaningful and specific hashtags for better conversation organization and searchability.

## API Endpoints

- `/api/config` - Get/set configuration
- `/api/models` - List available Ollama models
- `/api/check-model/:modelName` - Check if a model is installed
- `/api/set-model` - Directly set the model
- `/api/tags` - Get all conversation tags
- `/api/conversations` - Get recent conversations
- `/api/search?tag=hashtag` - Search conversations by tag

## Debugging

- Visit `/debug/database` for a visual database browser
- Use `/api/run-diagnostics` for system diagnostic information
- Check server logs for detailed request/response tracking
