// routes/debug-routes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper functions for HTML generation
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTags(tagsJson) {
  try {
    const tags = JSON.parse(tagsJson);
    if (Array.isArray(tags)) {
      return tags.map(tag => `<span class="tag-pill">${tag}</span>`).join(' ');
    }
    return tagsJson;
  } catch (e) {
    return tagsJson;
  }
}

// Database debug UI
router.get('/database', async (req, res) => {
  try {
    // Get counts for all tables
    const [userMessagesCount] = await db.pool.query('SELECT COUNT(*) as count FROM user_messages');
    const [ollamaResponsesCount] = await db.pool.query('SELECT COUNT(*) as count FROM ollama_responses');
    const [tagsCount] = await db.pool.query('SELECT COUNT(*) as count FROM tags');

    // Get most recent conversations
    const [conversations] = await db.pool.query(`
      SELECT
        um.id AS message_id,
        um.message_content AS user_message,
        um.timestamp AS message_time,
        um.tags AS user_tags,
        resp.id AS response_id,
        resp.response_content AS ollama_response,
        resp.timestamp AS response_time,
        resp.tags AS response_tags
      FROM user_messages um
      LEFT JOIN ollama_responses resp ON um.id = resp.user_message_id
      ORDER BY um.timestamp DESC
      LIMIT 10
    `);

    // Get tag statistics
    const [tags] = await db.pool.query(`
      SELECT tag_name, usage_count, first_used
      FROM tags
      ORDER BY usage_count DESC
      LIMIT 20
    `);

    // Generate HTML output
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ollama Chat Database Debug</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
          .card { margin-bottom: 20px; }
          pre { white-space: pre-wrap; background: #f8f9fa; padding: 10px; border-radius: 4px; }
          .tag-pill { display: inline-block; background: #e9ecef; padding: 0.15rem 0.5rem; border-radius: 16px; margin: 2px; }
        </style>
      </head>
      <body>
        <div class="container mt-4 mb-5">
          <h1>Ollama Chat Database Debug</h1>
          <p class="lead">Database statistics and recent conversations</p>

          <div class="card">
            <div class="card-header bg-primary text-white">Database Statistics</div>
            <div class="card-body">
              <div class="row">
                <div class="col-md-4">
                  <div class="card h-100">
                    <div class="card-body text-center">
                      <h3>${userMessagesCount[0].count}</h3>
                      <p class="text-muted">User Messages</p>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="card h-100">
                    <div class="card-body text-center">
                      <h3>${ollamaResponsesCount[0].count}</h3>
                      <p class="text-muted">Ollama Responses</p>
                    </div>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="card h-100">
                    <div class="card-body text-center">
                      <h3>${tagsCount[0].count}</h3>
                      <p class="text-muted">Unique Tags</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header bg-primary text-white">Tag Statistics</div>
            <div class="card-body">
              <div class="row">
                ${tags.map(tag => `
                  <div class="col-md-3 mb-2">
                    <div class="tag-pill">
                      #${tag.tag_name} (${tag.usage_count})
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header bg-primary text-white">Recent Conversations</div>
            <div class="card-body p-0">
              <div class="accordion" id="conversationsAccordion">
                ${conversations.map((conv, index) => `
                  <div class="accordion-item">
                    <h2 class="accordion-header">
                      <button class="accordion-button ${index > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${index}">
                        <strong>ID ${conv.message_id}</strong> - ${new Date(conv.message_time).toLocaleString()}
                        ${conv.response_id ? '' : ' <span class="badge bg-warning ms-2">No Response</span>'}
                      </button>
                    </h2>
                    <div id="collapse${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#conversationsAccordion">
                      <div class="accordion-body">
                        <h5>User Message:</h5>
                        <pre>${escapeHtml(conv.user_message)}</pre>

                        ${conv.user_tags ? `
                          <h6>User Tags:</h6>
                          <div>${formatTags(conv.user_tags)}</div>
                        ` : ''}

                        ${conv.response_id ? `
                          <h5 class="mt-3">Ollama Response:</h5>
                          <pre>${escapeHtml(conv.ollama_response)}</pre>

                          ${conv.response_tags ? `
                            <h6>Response Tags:</h6>
                            <div>${formatTags(conv.response_tags)}</div>
                          ` : ''}
                        ` : `
                          <div class="alert alert-warning mt-3">No response recorded</div>
                        `}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
      </body>
      </html>
    `;

    res.send(html);

  } catch (error) {
    console.error('Error displaying database debug:', error);
    res.status(500).send(`
      <h1>Database Error</h1>
      <p>An error occurred while fetching database information:</p>
      <pre>${error.stack}</pre>
    `);
  }
});

// Raw JSON database debug endpoint
router.get('/database/json', async (req, res) => {
  try {
    // Get most recent conversations with a higher limit
    const [conversations] = await db.pool.query(`
      SELECT
        um.id AS message_id,
        um.message_content AS user_message,
        um.timestamp AS message_time,
        um.tags AS user_tags,
        or.id AS response_id,
        or.response_content AS ollama_response,
        or.timestamp AS response_time,
        or.tags AS response_tags
      FROM user_messages um
      LEFT JOIN ollama_responses or ON um.id = or.user_message_id
      ORDER BY um.timestamp DESC
      LIMIT 20
    `);

    // Process tags from JSON string
    conversations.forEach(conv => {
      try {
        if (conv.user_tags) {
          conv.user_tags = JSON.parse(conv.user_tags);
        }
        if (conv.response_tags) {
          conv.response_tags = JSON.parse(conv.response_tags);
        }
      } catch (e) {
        // Keep as is if parsing fails
      }
    });

    // Get tag statistics
    const [tags] = await db.pool.query(`
      SELECT tag_name, usage_count, first_used
      FROM tags
      ORDER BY usage_count DESC
    `);

    // Table counts
    const [counts] = await db.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM user_messages) AS userMessages,
        (SELECT COUNT(*) FROM ollama_responses) AS ollamaResponses,
        (SELECT COUNT(*) FROM tags) AS tags
    `);

    res.json({
      success: true,
      counts: counts[0],
      conversations,
      tags
    });

  } catch (error) {
    console.error('Error getting database debug data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;