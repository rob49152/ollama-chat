// public/client.js
document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  
  // DOM element references - declare ALL elements at the beginning
  const messagesContainer = document.getElementById('chat-messages');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const connectionStatus = document.getElementById('connection-status');
  const modelBadge = document.getElementById('model-badge');
  const hashtagsContainer = document.getElementById('hashtags-container');
  const chatbotTabs = document.getElementById('chatbotTabs');
  const chatbotListTab = document.getElementById('chatbot-list-tab');
  const chatbotEditTab = document.getElementById('chatbot-edit-tab');
  const chatbotConfigModal = document.getElementById('chatbotConfigModal');
  const chatbotsContainer = document.getElementById('chatbots-container');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const chatbotForm = document.getElementById('chatbot-form');
  const chatbotIdInput = document.getElementById('chatbot-id');
  const chatbotNameInput = document.getElementById('chatbot-name');
  const chatbotDefaultCheckbox = document.getElementById('chatbot-default');
  const chatbotPersonalityInput = document.getElementById('chatbot-personality');
  const chatbotHistoryInput = document.getElementById('chatbot-history');
  const chatbotSystemPromptInput = document.getElementById('chatbot-system-prompt');
  const examplesContainer = document.getElementById('examples-container');
  const addExampleBtn = document.getElementById('add-example-btn');
  const removeExampleBtn = document.getElementById('remove-example-btn');
  const newChatbotBtn = document.getElementById('new-chatbot-btn');
  const deleteChatbotBtn = document.getElementById('delete-chatbot-btn');
  const exportChatBtn = document.getElementById('export-chat-btn');
  
  // Configuration related elements
  const configForm = document.getElementById('config-form');
  const ollamaUrlInput = document.getElementById('ollama-url');
  const modelSelect = document.getElementById('model-select');
  const temperatureRange = document.getElementById('temperature-range');
  const temperatureValue = document.getElementById('temperature-value');
  const maxTokensInput = document.getElementById('max-tokens');
  const saveConfigBtn = document.getElementById('save-config-btn');
  const testConnectionBtn = document.getElementById('test-connection-btn');
  const connectionTestResult = document.getElementById('connection-test-result');
  const emergencyFixBtn = document.getElementById('emergency-fix');
  const diagnosticsBtn = document.getElementById('diagnostics-btn');

  // Initialize variables
  let messageHistory = [];
  let currentHashtags = [];
  let currentSessionId = null;
  let chatbots = [];
  let currentChatbot = null;
  let isEditingExisting = false;
  
  // Configuration state - empty defaults
  let currentConfig = {
    defaultModel: '',
    ollamaApiUrl: 'http://localhost:11434/api',
    temperature: 0.7,
    maxTokens: 2000,
    contextMessages: 4
  };
  
  window.currentHashtags = [];

  /**
   * Add a message to the chat
   * @param {string} role - Role of the sender (user/assistant/system)
   * @param {string} content - Message content
   * @param {string} messageId - Optional message ID
   * @param {string} chatbotId - Optional chatbot ID
   * @param {string} bubbleColor - Optional bubble color
   * @param {string} textColor - Optional text color
   */
  function addMessage(role, content, messageId = null, chatbotId = null, bubbleColor = null, textColor = null) {
    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${role}-message`);
    
    if (messageId) {
      messageDiv.setAttribute('data-message-id', messageId);
    }
    
    if (chatbotId) {
      messageDiv.setAttribute('data-chatbot-id', chatbotId);
    }
  
    // Apply custom colors if provided
    if (role === 'assistant' && bubbleColor) {
      messageDiv.style.backgroundColor = bubbleColor;
      if (textColor) {
        messageDiv.style.color = textColor;
      }
    }
    
    // Format message content
    let formattedContent = content;
    
    // Apply markdown if it's not a system message
    if (role !== 'system') {
      try {
        const markdownConverter = window.markdownit && window.markdownit();
        if (markdownConverter) {
          formattedContent = markdownConverter.render(content);
        }
      } catch (error) {
        console.error('Error applying markdown:', error);
      }
    }
    
    // Set the content
    messageDiv.innerHTML = formattedContent;
    
    // Add to container
    messagesContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Add to message history if it's a user or assistant message (not system)
    if (role !== 'system') {
      messageHistory.push({
        role: role,
        content: content
      });
    }
  }

/**
 * Fetch conversations related to hashtags in the user's message
 * @returns {Promise<string>} Formatted context string with related conversations
 */
async function fetchHashtagRelatedConversations() {
  // If no hashtags, return empty context
  if (!currentHashtags || currentHashtags.length === 0) {
    console.log('No hashtags available for context lookup');
    return '';
  }

  console.log('Fetching related conversations for hashtags:', currentHashtags);
  
  // Format hashtags for the query (remove # symbol)
  const tags = currentHashtags.map(tag => tag.replace('#', ''));
  
  try {
    // Build query params
    const queryParams = new URLSearchParams();
    tags.forEach(tag => {
      if (tag && tag.trim()) {
        queryParams.append('tags', tag.trim());
      }
    });
    
    if (queryParams.getAll('tags').length === 0) {
      console.log('No valid tags after filtering');
      return '';
    }
    
    // Session ID handling
    let sessionId = null;
    
    // Try the global currentSessionId first
    if (currentSessionId) {
      sessionId = currentSessionId;
    } 
    // Try to get it from localStorage as fallback
    else if (localStorage.getItem('ollama_chat_session_id')) {
      sessionId = localStorage.getItem('ollama_chat_session_id');
      // Update the global variable for future use
      currentSessionId = sessionId;
    } 
    
    // Only add exclusion parameter if we have a valid session ID
    if (sessionId) {
      queryParams.append('excludeSession', sessionId);
    }
    
    // Log the API call for debugging
    const apiUrl = `/api/conversations-by-tags?${queryParams.toString()}`;
    console.log('Fetching from API:', apiUrl);
    
    // Make the fetch request with timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    try {
      const response = await fetch(apiUrl, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.warn(`API request failed with status: ${response.status}`);
        return '';
      }
      
      // Parse the JSON response
      const data = await response.json();
      console.log('API response received:', data);
      
      if (!data.success || !data.conversations || data.conversations.length === 0) {
        console.log('No related conversations found');
        return '';
      }
      
      console.log(`Found ${data.conversations.length} related conversations`);
      
      // Format conversations as context
      let formattedContext = '### Related conversations on these topics:\n\n';
      
      data.conversations.forEach((convo, index) => {
        formattedContext += `Conversation ${index + 1}:\n`;
        formattedContext += `Human: ${convo.userMessage}\n`;
        formattedContext += `Assistant: ${convo.assistantResponse}\n\n`;
      });
      
      formattedContext += '### End of related conversations\n\n';
      console.log('Context built successfully, length:', formattedContext.length);
      return formattedContext;
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        console.warn('API request timed out after 3 seconds');
      } else {
        console.error('Fetch error:', fetchError);
      }
      return '';
    }
  } catch (error) {
    console.error('Error processing related conversations:', error);
    return '';
  }
}


  /**
 * Add a new hashtag
 * @param {string} tag - The tag to add
 */
function addNewHashtag(tag) {
  if (!tag) return;
  
  // Make sure tag starts with #
  const formattedTag = tag.startsWith('#') ? tag : `#${tag}`;
  
  console.log(`Adding hashtag: ${formattedTag}`);
  
  // Send to server
  socket.emit('addTag', {
    tag: formattedTag.replace('#', ''), // Remove # for server
    sessionId: currentSessionId
  });
}
  
  /**
   * Display hashtags in the UI
   * @param {Array} hashtags - Array of hashtags to display
   */
  function displayHashtags(hashtags) {
    // Get the container element
    const hashtagsContainer = document.getElementById('hashtags-container');
  
    // Completely clear previous hashtags
    hashtagsContainer.innerHTML = '';
  
    // Log for debugging
    console.log('Displaying new hashtags:', hashtags);
  
    // If no hashtags, just return with empty container
    if (!hashtags || hashtags.length === 0) {
      console.log('No hashtags to display');
      return;
    }
  
    // Store the new hashtags
    currentHashtags = [...hashtags]; // Create a copy of the new hashtags
  
    // Add a label before the tags
    const label = document.createElement('span');
    label.className = 'hashtag-label me-2';
    label.textContent = 'Tags:';
    hashtagsContainer.appendChild(label);
    
    // Create a custom tags container
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'custom-tags-container d-inline-flex flex-wrap gap-2';
    hashtagsContainer.appendChild(tagsContainer);
    
    // Add input field for new tags
    const newTagContainer = document.createElement('div');
    newTagContainer.className = 'input-group input-group-sm new-tag-container mt-2';
    newTagContainer.style.maxWidth = '300px';
    
    const newTagInput = document.createElement('input');
    newTagInput.type = 'text';
    newTagInput.className = 'form-control form-control-sm';
    newTagInput.placeholder = 'Add new tag...';
    newTagInput.id = 'new-hashtag-input';
    
    const addButton = document.createElement('button');
    addButton.className = 'btn btn-sm btn-outline-primary';
    addButton.innerHTML = '<i class="bi bi-plus"></i>';
    addButton.type = 'button';
    
    newTagContainer.appendChild(newTagInput);
    newTagContainer.appendChild(addButton);
    hashtagsContainer.appendChild(newTagContainer);
    
    // Add each hashtag as a custom badge
    hashtags.forEach((tag) => {
      addTagBadge(tag, tagsContainer);
    });
    
    // Add event listener for the add button
    addButton.addEventListener('click', () => {
      const tagValue = newTagInput.value.trim();
      if (tagValue) {
        // Format tag with hashtag if needed
        const formattedTag = tagValue.startsWith('#') ? tagValue : `#${tagValue}`;
        
        // Only add if it's not already present
        if (!currentHashtags.includes(formattedTag) && !currentHashtags.includes(tagValue)) {
          // Add to UI
          addTagBadge(formattedTag, tagsContainer);
          
          // Add to our current hashtags
          currentHashtags.push(formattedTag);
          
          // Send to server
          addNewHashtag(formattedTag);
          
          // Clear input
          newTagInput.value = '';
        }
      }
    });
    
    // Allow adding tags with Enter key
    newTagInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addButton.click();
      }
    });
  }

  /**
   * Add a tag badge to the container
   * @param {string} tag - The tag to add
   * @param {HTMLElement} container - The container to add the tag to
   */
  function addTagBadge(tag, container) {
    const cleanTag = tag.replace(/^#/, '').trim();
    if (!cleanTag) return;
    
    const tagId = `tag-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const badge = document.createElement('span');
    badge.className = 'badge bg-primary tag-badge';
    badge.id = tagId;
    badge.dataset.tagValue = cleanTag;
    badge.innerHTML = cleanTag;
    
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'ms-1 tag-delete-btn';
    deleteBtn.innerHTML = '&times;';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.title = 'Remove tag';
    
    // Add delete handler
    deleteBtn.addEventListener('click', () => {
      const tagValue = badge.dataset.tagValue;
      console.log(`Delete button clicked for tag: ${tagValue}`);
      
      if (confirm(`Do you want to block the hashtag #${tagValue}?`)) {
        // Remove from UI
        badge.remove();
        
        // Block the tag
        blockTagFromUI(tagValue);
      }
    });
    
    // Add info handler for clicking on the tag itself
    badge.addEventListener('click', (e) => {
      // Only trigger if the click was not on the delete button
      if (e.target !== deleteBtn) {
        const tagValue = badge.dataset.tagValue;
        messageInput.value = `Tell me more about ${tagValue}`;
        messageInput.focus();
      }
    });
    
    // Add right-click handler for search
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const tagValue = badge.dataset.tagValue;
      
      // Make a search request to our API
      fetch(`/api/search?tag=${encodeURIComponent(tagValue)}`)
        .then(response => response.json())
        .then(data => {
          if (data.success && data.results && data.results.length > 0) {
            addMessage('system', `Found ${data.results.length} previous conversation(s) about "#${tagValue}"`);
          } else {
            addMessage('system', `No previous conversations found about "#${tagValue}"`);
          }
        })
        .catch(error => {
          console.error('Error searching for tag:', error);
        });
    });
    
    // Append delete button to badge
    badge.appendChild(deleteBtn);
    
    // Add the badge to the container
    container.appendChild(badge);
  }
  

  /**
   * Block a tag from the UI
   * @param {string} tag - Tag to block
   */
  async function blockTagFromUI(tag) {
    // Check if tag is defined before proceeding
    if (!tag) {
      console.error("Cannot block undefined tag");
      return;
    }

    // Make sure tag is a string and trim it
    const tagStr = String(tag).trim();
    
    // Remove # if it exists
    const cleanTag = tagStr.replace(/^#/, '');
    
    if (!cleanTag) {
      console.error("Empty tag after cleaning, cannot block");
      return;
    }
    
    console.log(`Attempting to block tag: "${cleanTag}"`);
    
    try {
      const response = await fetch('/api/block-tag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tag: cleanTag })
      });

      const result = await response.json();

      if (result.success) {
        // Remove from currentHashtags array
        currentHashtags = currentHashtags.filter(t => 
          t !== `#${cleanTag}` && t !== cleanTag
        );
        
        console.log(`Tag "#${cleanTag}" has been blocked.`);
        
        // Show a quick notification
        const notification = document.createElement('div');
        notification.className = 'alert alert-success position-fixed top-0 end-0 m-3';
        notification.style.zIndex = 9999;
        notification.textContent = `Tag "#${cleanTag}" has been blocked`;
        document.body.appendChild(notification);
        
        // Remove notification after 3 seconds
        setTimeout(() => {
          notification.remove();
        }, 3000);
      } else {
        console.error(`Failed to block tag: ${result.message}`);
      }
    } catch (error) {
      console.error('Error blocking tag:', error);
    }
  }

  /**
   * Initialize tag management functionality
   */
  function initializeTagManagement() {
    const tagManagementModal = document.getElementById('tagManagementModal');
    const currentSessionTagsContainer = document.getElementById('current-session-tags');
    const blockedTagsListContainer = document.getElementById('blocked-tags-list');
    const newBlockedTagInput = document.getElementById('new-blocked-tag');
    const blockTagBtn = document.getElementById('block-tag-btn');

    // Add action to Actions dropdown menu
    const dropdownMenu = document.querySelector('.dropdown-menu');
    if (dropdownMenu && !document.getElementById('tag-management-btn')) {
      const menuItem = document.createElement('li');
      menuItem.innerHTML = `
        <button class="dropdown-item" id="tag-management-btn" data-bs-toggle="modal" data-bs-target="#tagManagementModal">
          <i class="bi bi-tags"></i> Manage Hashtags
        </button>
      `;
      dropdownMenu.appendChild(menuItem);
    }

    // Modal show event listener to populate tags
    if (tagManagementModal) {
      tagManagementModal.addEventListener('show.bs.modal', async () => {
        // Clear existing content
        currentSessionTagsContainer.innerHTML = '';
        blockedTagsListContainer.innerHTML = '';

        // Populate current session tags
        if (currentHashtags && currentHashtags.length > 0) {
          currentHashtags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.className = 'badge bg-primary me-2 mb-2';
            tagElement.textContent = tag;

            // Add block button to each tag
            const blockBtn = document.createElement('button');
            blockBtn.className = 'btn btn-sm btn-danger ms-2';
            blockBtn.innerHTML = '&times;';
            blockBtn.title = 'Block this tag';
            blockBtn.onclick = () => blockTag(tag);

            tagElement.appendChild(blockBtn);
            currentSessionTagsContainer.appendChild(tagElement);
          });
        } else {
          currentSessionTagsContainer.innerHTML = '<p class="text-muted">No tags in current session</p>';
        }

        // Fetch and populate blocked tags
        try {
          const response = await fetch('/api/blocked-tags');
          const data = await response.json();

          if (data.success && data.blockedTags.length > 0) {
            data.blockedTags.forEach(blockedTag => {
              const tagElement = document.createElement('span');
              tagElement.className = 'badge bg-danger me-2 mb-2';
              tagElement.textContent = `#${blockedTag.tag_name}`;

              // Add unblock button
              const unblockBtn = document.createElement('button');
              unblockBtn.className = 'btn btn-sm btn-light ms-2';
              unblockBtn.innerHTML = '&times;';
              unblockBtn.title = 'Unblock this tag';
              unblockBtn.onclick = () => unblockTag(blockedTag.tag_name);

              tagElement.appendChild(unblockBtn);
              blockedTagsListContainer.appendChild(tagElement);
            });
          } else {
            blockedTagsListContainer.innerHTML = '<p class="text-muted">No blocked tags</p>';
          }
        } catch (error) {
          console.error('Error fetching blocked tags:', error);
          blockedTagsListContainer.innerHTML = '<p class="text-danger">Error loading blocked tags</p>';
        }
      });
    }

    // Block tag functionality
    if (blockTagBtn) {
      blockTagBtn.addEventListener('click', async () => {
        const tagToBlock = newBlockedTagInput.value.trim();
        if (!tagToBlock) return;

        try {
          const response = await fetch('/api/block-tag', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tag: tagToBlock })
          });

          const result = await response.json();

          if (result.success) {
            // Add to blocked tags list
            const tagElement = document.createElement('span');
            tagElement.className = 'badge bg-danger me-2 mb-2';
            tagElement.textContent = `#${tagToBlock}`;

            // Add unblock button
            const unblockBtn = document.createElement('button');
            unblockBtn.className = 'btn btn-sm btn-light ms-2';
            unblockBtn.innerHTML = '&times;';
            unblockBtn.title = 'Unblock this tag';
            unblockBtn.onclick = () => unblockTag(tagToBlock);

            tagElement.appendChild(unblockBtn);
            blockedTagsListContainer.appendChild(tagElement);

            // Clear input
            newBlockedTagInput.value = '';

            // Remove from current session tags if present
            const sessionTagToRemove = Array.from(currentSessionTagsContainer.children)
              .find(el => el.textContent.includes(tagToBlock));
            if (sessionTagToRemove) {
              currentSessionTagsContainer.removeChild(sessionTagToRemove);
            }

            // Remove tag from currentHashtags if it exists
            if (currentHashtags) {
              currentHashtags = currentHashtags.filter(tag => tag !== `#${tagToBlock}`);
            }

            alert(`Tag "#${tagToBlock}" has been blocked.`);
          } else {
            alert(`Failed to block tag: ${result.message}`);
          }
        } catch (error) {
          console.error('Error blocking tag:', error);
          alert('An error occurred while blocking the tag.');
        }
      });
    }

    // Function to unblock a tag
    async function unblockTag(tag) {
      try {
        const response = await fetch('/api/unblock-tag', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ tag })
        });

        const result = await response.json();

        if (result.success) {
          // Remove from blocked tags list
          const blockedTagElements = Array.from(blockedTagsListContainer.children);
          const tagToRemove = blockedTagElements.find(el => el.textContent.includes(tag));
          if (tagToRemove) {
            blockedTagsListContainer.removeChild(tagToRemove);
          }

          alert(`Tag "#${tag}" has been unblocked.`);
        } else {
          alert(`Failed to unblock tag: ${result.message}`);
        }
      } catch (error) {
        console.error('Error unblocking tag:', error);
        alert('An error occurred while unblocking the tag.');
      }
    }

    // Block tag functionality for individual tags
    function blockTag(tag) {
      newBlockedTagInput.value = tag.replace(/^#/, '');
      blockTagBtn.click();
    }
  }

  /**
   * Get conversation history context
   * @returns {string} Formatted conversation context
   */
  function getConversationContext() {
    // If there are no previous messages, return empty context
    if (!messageHistory || messageHistory.length === 0) {
      console.log('No message history available for context');
      return '';
    }

    // Get the configured number of messages to include
    const configuredCount = currentConfig.contextMessages || 4;

    // If context count is set to 0, don't include any previous messages
    if (configuredCount <= 0) {
      console.log('Context messages setting is 0, not including history');
      return '';
    }

    // Determine actual number of messages to include (can't exceed what we have)
    const availableCount = messageHistory.length;
    const actualCount = Math.min(configuredCount, availableCount);

    console.log(`Including ${actualCount} previous messages as context (${availableCount} available, ${configuredCount} configured)`);

    // Get the appropriate slice of message history
    const startIndex = Math.max(0, messageHistory.length - actualCount);
    const contextMessages = messageHistory.slice(startIndex);

    // Format the messages as a conversation
    const formattedContext = contextMessages.map(msg => {
      const roleLabel = msg.role === 'user' ? 'Human' : 'Assistant';
      return `${roleLabel}: ${msg.content}`;
    }).join('\n\n');

    return `Previous conversation:\n${formattedContext}\n\n`;
  }

  /**
 * Send a message to the server with improved context workflow
 */
async function sendMessage() {
  const message = messageInput.value.trim();
  if (message) {
    try {
      console.log('=== PROCESSING MESSAGE ===');
      
      // Step 1: Extract hashtags from the new message
      console.log('Step 1: Extracting hashtags from new message...');
      
      // Call the API endpoint to extract hashtags
      const tagResponse = await fetch('/api/extract-tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: message })
      });
      
      const tagData = await tagResponse.json();
      const extractedTags = tagData.success ? tagData.tags : [];
      console.log('Extracted hashtags:', extractedTags);
      
      // Update current hashtags with newly extracted ones (without duplicates)
      if (!currentHashtags) currentHashtags = [];
      
      // Add # prefix if needed and merge with existing hashtags
      const newHashtags = extractedTags.map(tag => tag.startsWith('#') ? tag : `#${tag}`);
      currentHashtags = [...new Set([...currentHashtags, ...newHashtags])];
      console.log('Updated hashtags:', currentHashtags);
      
      // Step 2: Search for previous related conversations using these hashtags
      console.log('Step 2: Searching for related conversations...');
      const hashtagContext = await fetchHashtagRelatedConversations();
      console.log('Related conversations context length:', hashtagContext?.length || 0);
      
      // Step 3: Add user message to chat (this adds it to message history)
      console.log('Step 3: Adding user message to chat...');
      addMessage('user', message);
      
      // Add typing indicator
      const typingDiv = document.createElement('div');
      typingDiv.classList.add('typing-indicator');
      typingDiv.textContent = `${currentConfig.defaultModel || 'AI'} is thinking...`;
      typingDiv.id = 'typing-indicator';
      messagesContainer.appendChild(typingDiv);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      
      // Step 4: Build the complete context for the AI
      console.log('Step 4: Building complete context...');
      let fullContext = '';
      
      // First add related conversations from previous sessions
      if (hashtagContext) {
        console.log('Adding hashtag-related conversation context');
        fullContext += hashtagContext;
      }
      
      // Then add current conversation history
      const conversationContext = getConversationContext();
      if (conversationContext) {
        console.log('Adding current conversation context');
        fullContext += conversationContext;
      }
      
      // Add topic keywords if available
      if (currentHashtags && currentHashtags.length > 0) {
        const tagStrings = currentHashtags.map(tag => tag.replace('#', '')).join(', ');
        console.log('Adding topic keywords:', tagStrings);
        fullContext += `Topic keywords: ${tagStrings}\n\n`;
      }
      
      // Step 5: Create the final message with context + new user message
      let contextualMessage = message;
      if (fullContext) {
        contextualMessage = `${fullContext}Human: ${message}`;
        console.log('Final context structure:');
        // Show the first few lines of context to debug
        const contextPreview = fullContext.split('\n').slice(0, 5).join('\n') + '...';
        console.log(contextPreview);
        console.log(`Total context length: ${fullContext.length} characters`);
      }
      
      // Step 6: Send to Ollama server
      console.log('Step 6: Sending message to Ollama server...');
      socket.emit('sendMessage', contextualMessage);
      
    } catch (error) {
      console.error('Error processing message:', error);
      // Send original message without context if there's an error
      socket.emit('sendMessage', message);
      addMessage('system', 'Note: Failed to include context - ' + error.message);
    }
    
    // Clear input
    messageInput.value = '';
  }
}

/**
 * Show a notification message
 * @param {string} message - Message to display
 * @param {string} type - Type of notification: 'success' (default) or 'error'
 */
function showNotification(message, type = 'success') {
  // Create or get notification container
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.zIndex = '1000';
    document.body.appendChild(container);
  }
  
  // Create notification
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.style.padding = '10px 15px';
  notification.style.marginTop = '10px';
  notification.style.borderRadius = '4px';
  notification.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
  
  // Style based on type
  if (type === 'error') {
    notification.style.backgroundColor = '#f8d7da';
    notification.style.color = '#721c24';
    notification.style.border = '1px solid #f5c6cb';
  } else {
    notification.style.backgroundColor = '#d4edda';
    notification.style.color = '#155724';
    notification.style.border = '1px solid #c3e6cb';
  }
  
  notification.textContent = message;
  
  // Add to container
  container.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.5s';
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}




  /**
   * Format file size in bytes to human-readable form
   * @param {number} bytes - Size in bytes
   * @returns {string} Human-readable file size
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Update UI elements with current configuration
   * @param {Object} config - Configuration object
   */
  function updateUIWithConfig(config) {
    ollamaUrlInput.value = config.ollamaApiUrl || 'http://localhost:11434/api';
    temperatureRange.value = config.temperature || 0.7;
    temperatureValue.textContent = config.temperature || 0.7;
    maxTokensInput.value = config.maxTokens || 2000;

    // Check if context messages input exists before trying to set its value
    const contextInput = document.getElementById('context-messages');
    if (contextInput) {
      contextInput.value = config.contextMessages || 4;
    }

    modelBadge.textContent = `Model: ${config.defaultModel || 'Not set'}`;

    // Update manual model input
    document.getElementById('model-manual').value = '';

    // Select the current model in the dropdown if it exists
    if (config.defaultModel && modelSelect.options.length > 0) {
      let modelFound = false;
      for (let i = 0; i < modelSelect.options.length; i++) {
        if (modelSelect.options[i].value === config.defaultModel) {
          modelSelect.selectedIndex = i;
          modelFound = true;
          break;
        }
      }

      // If model isn't in the dropdown, add it
      if (!modelFound && config.defaultModel) {
        const option = document.createElement('option');
        option.value = config.defaultModel;
        option.textContent = config.defaultModel + ' (manual)';
        modelSelect.appendChild(option);
        modelSelect.value = config.defaultModel;
      }
    }
  }

  /**
   * Fetch available models from the server
   */
  async function fetchModels() {
    try {
      const response = await fetch('/api/models');
      const data = await response.json();

      if (data.success && data.models.length > 0) {
        // Clear and populate model select
        modelSelect.innerHTML = '';
        data.models.forEach(model => {
          const option = document.createElement('option');
          option.value = model.name;
          option.textContent = `${model.name} (${formatFileSize(model.size)})`;
          modelSelect.appendChild(option);
        });

        // Select current model if it exists
        if (currentConfig.defaultModel) {
          for (let i = 0; i < modelSelect.options.length; i++) {
            if (modelSelect.options[i].value === currentConfig.defaultModel) {
              modelSelect.selectedIndex = i;
              break;
            }
          }
        }
      } else {
        modelSelect.innerHTML = '<option value="" disabled selected>No models available</option>';
      }
    } catch (error) {
      console.error('Error fetching models:', error);
      modelSelect.innerHTML = '<option value="" disabled selected>Error loading models</option>';
    }
  }
  

  // Chatbot-related functions

  /**
   * Add a chatbot indicator to UI
   */
  function updateChatbotIndicator() {
    // Create indicator if it doesn't exist
    let chatbotIndicator = document.getElementById('chatbot-indicator');
    if (!chatbotIndicator) {
      chatbotIndicator = document.createElement('span');
      chatbotIndicator.id = 'chatbot-indicator';
      chatbotIndicator.className = 'badge bg-light text-dark me-2';
      modelBadge.insertAdjacentElement('afterend', chatbotIndicator);
    }
    
    if (currentChatbot) {
      chatbotIndicator.textContent = `Chatbot: ${currentChatbot.name}`;
      chatbotIndicator.title = currentChatbot.settings?.personality || '';
    } else {
      chatbotIndicator.textContent = 'Chatbot: Default';
    }
  }

  /**
   * Render the list of chatbots
   */
  function renderChatbotList() {
    if (!chatbots || !Array.isArray(chatbots) || chatbots.length === 0) {
      chatbotsContainer.innerHTML = `
        <div class="col">
          <div class="alert alert-warning">
            <h5>No chatbots found</h5>
            <p>Click "Create New Chatbot" to get started.</p>
          </div>
        </div>
      `;
      return;
    }

    chatbotsContainer.innerHTML = '';

    chatbots.forEach(chatbot => {
      const isActive = currentChatbot && currentChatbot.id === chatbot.id;
      const card = document.createElement('div');
      card.className = 'col';
      card.innerHTML = `
        <div class="card h-100 ${isActive ? 'border-primary' : ''}">
          <div class="card-body">
            <h5 class="card-title">
              ${chatbot.name}
              ${chatbot.is_default ? '<span class="badge bg-success ms-2">Default</span>' : ''}
              ${isActive ? '<span class="badge bg-primary ms-2">Active</span>' : ''}
            </h5>
            <p class="card-text chatbot-preview">Loading details...</p>
          </div>
          <div class="card-footer d-flex justify-content-between">
            <button class="btn btn-sm btn-outline-secondary edit-chatbot-btn" data-chatbot-id="${chatbot.id}">
              <i class="bi bi-pencil"></i> Edit
            </button>
            <button class="btn btn-sm btn-primary select-chatbot-btn" data-chatbot-id="${chatbot.id}" ${isActive ? 'disabled' : ''}>
              ${isActive ? 'Currently Active' : 'Select'}
            </button>
          </div>
        </div>
      `;

      chatbotsContainer.appendChild(card);

      // Load chatbot details
      loadChatbotPreview(chatbot.id, card.querySelector('.chatbot-preview'));
    });

    // Add event listeners to buttons
    document.querySelectorAll('.edit-chatbot-btn').forEach(btn => {
      btn.addEventListener('click', () => editChatbot(btn.dataset.chatbotId));
    });

    document.querySelectorAll('.select-chatbot-btn').forEach(btn => {
      btn.addEventListener('click', () => selectChatbot(btn.dataset.chatbotId));
    });
  }

  /**
   * Load chatbot preview
   * @param {string} chatbotId - ID of the chatbot
   * @param {HTMLElement} previewElement - Element to populate with preview
   */
  async function loadChatbotPreview(chatbotId, previewElement) {
    try {
      const response = await fetch(`/api/chatbots/${chatbotId}`);
      const data = await response.json();

      if (data.success) {
        const chatbot = data.chatbot;
        const personality = chatbot.settings.personality || 'No personality defined';
        const exampleCount = chatbot.examples ? Math.floor(chatbot.examples.length / 2) : 0;

        previewElement.innerHTML = `
          <strong>Personality:</strong> ${personality}<br>
          <strong>Examples:</strong> ${exampleCount} conversation pair${exampleCount !== 1 ? 's' : ''}
        `;
      } else {
        previewElement.textContent = 'Failed to load chatbot details';
      }
    } catch (error) {
      console.error('Error loading chatbot preview:', error);
      previewElement.textContent = 'Error loading details';
    }
  }

  /**
   * Load all available chatbots
   */
  async function loadChatbots() {
    console.log('Client: Loading chatbots from API');
    // Show loading state
    chatbotsContainer.innerHTML = `
      <div class="col">
        <div class="card h-100">
          <div class="card-body">
            <h5 class="card-title">Loading...</h5>
            <p class="card-text">Please wait while we load available chatbots.</p>
            <div class="progress">
              <div class="progress-bar progress-bar-striped progress-bar-animated" 
                   role="progressbar" style="width: 100%"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    try {
      console.log('Client: Sending request to /api/chatbots');
      const response = await fetch('/api/chatbots');
      console.log('Client: Received response from /api/chatbots', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Client: Parsed JSON data', data);

      if (data.success) {
        chatbots = Array.isArray(data.chatbots) ? data.chatbots : [];
        console.log(`Client: Successfully loaded ${chatbots.length} chatbots`);
        renderChatbotList();

        // Also load the current session's chatbot
        if (currentSessionId) {
          loadSessionChatbot();
        }
      } else {
        console.error('Failed to load chatbots:', data.message);
        chatbotsContainer.innerHTML = `
          <div class="col">
            <div class="alert alert-danger">
              <h5>Failed to load chatbots</h5>
              <p>${data.message}</p>
              <button class="btn btn-primary btn-sm retry-load-btn">Retry</button>
            </div>
          </div>
        `;

        // Add retry button handler
        document.querySelector('.retry-load-btn').addEventListener('click', loadChatbots);
      }
    } catch (error) {
      console.error('Error loading chatbots:', error);
      chatbotsContainer.innerHTML = `
        <div class="col">
          <div class="alert alert-danger">
            <h5>Error loading chatbots</h5>
            <p>${error.message}</p>
            <pre class="small mt-2">${error.stack || ''}</pre>
            <button class="btn btn-primary btn-sm retry-load-btn mt-2">Retry</button>
          </div>
        </div>
      `;

      // Add retry button handler
      document.querySelector('.retry-load-btn').addEventListener('click', loadChatbots);
    }
  }

  /**
   * Load current session's chatbot
   */
  async function loadSessionChatbot() {
    try {
      const response = await fetch(`/api/session/${currentSessionId}/chatbot`);
      const data = await response.json();

      if (data.success) {
        currentChatbot = data.chatbot;
        updateChatbotIndicator();
      } else {
        console.error('Failed to load session chatbot:', data.message);
      }
    } catch (error) {
      console.error('Error loading session chatbot:', error);
    }
  }

/**
   * Edit a chatbot
   * @param {string} chatbotId - ID of the chatbot to edit
   */
  async function editChatbot(chatbotId) {
    try {
      const response = await fetch(`/api/chatbots/${chatbotId}`);
      const data = await response.json();

      if (data.success) {
        isEditingExisting = true;
        const chatbot = data.chatbot;

        // Fill the form with chatbot data
        chatbotIdInput.value = chatbot.id;
        chatbotNameInput.value = chatbot.name;
        chatbotDefaultCheckbox.checked = chatbot.is_default;
        chatbotPersonalityInput.value = chatbot.settings.personality || '';
        chatbotHistoryInput.value = chatbot.settings.character_history || '';
        chatbotSystemPromptInput.value = chatbot.settings.system_prompt || '';

        // Set color values
        const bubbleColorPicker = document.getElementById('chatbot-bubble-color');
        const bubbleColorText = document.getElementById('chatbot-bubble-color-text');
        const textColorPicker = document.getElementById('chatbot-text-color');
        const textColorText = document.getElementById('chatbot-text-color-text');
        
        if (bubbleColorPicker && bubbleColorText && textColorPicker && textColorText) {
          const bubbleColor = chatbot.settings.bubble_color || '#f8f8f8';
          const textColor = chatbot.settings.text_color || '#000000';

          bubbleColorPicker.value = bubbleColor;
          bubbleColorText.value = bubbleColor;
          textColorPicker.value = textColor;
          textColorText.value = textColor;

          // Update preview
          updateColorPreview();
        }

        // Clear examples container
        examplesContainer.innerHTML = '';

        // Add example pairs
        if (chatbot.examples && chatbot.examples.length > 0) {
          // Group examples by pairs
          for (let i = 0; i < chatbot.examples.length; i += 2) {
            if (i + 1 < chatbot.examples.length) {
              const userExample = chatbot.examples[i];
              const assistantExample = chatbot.examples[i + 1];

              if (userExample.role === 'user' && assistantExample.role === 'assistant') {
                addExamplePair(userExample.content, assistantExample.content);
              }
            }
          }
        }

        // Ensure at least one example pair
        if (examplesContainer.querySelectorAll('.example-pair').length === 0) {
          addExamplePair();
        }

        // Show delete button
        deleteChatbotBtn.classList.remove('d-none');

        // Switch to edit tab
        const editTab = new bootstrap.Tab(chatbotEditTab);
        editTab.show();
      } else {
        alert(`Failed to load chatbot details: ${data.message}`);
      }
    } catch (error) {
      console.error('Error editing chatbot:', error);
      alert('An error occurred while loading chatbot details');
    }
  }

  /**
   * Select a chatbot for the current session
   * @param {string} chatbotId - ID of the chatbot to select
   */
  async function selectChatbot(chatbotId) {
    if (!currentSessionId) {
      alert('No active session found. Please refresh the page and try again.');
      return;
    }

    try {
      const response = await fetch('/api/session/chatbot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          chatbotId: chatbotId
        })
      });

      const data = await response.json();

      if (data.success) {
        currentChatbot = data.chatbot;
        updateChatbotIndicator();
        renderChatbotList();

        // Close the modal
        const modalInstance = bootstrap.Modal.getInstance(chatbotConfigModal);
        if (modalInstance) {
          modalInstance.hide();
        }

        // Add system message about chatbot change
        addMessage('system', `Switched to chatbot: ${currentChatbot.name}`);
      } else {
        alert(`Failed to select chatbot: ${data.message}`);
      }
    } catch (error) {
      console.error('Error selecting chatbot:', error);
      alert('An error occurred while selecting the chatbot');
    }
  }

  /**
   * Reset the chatbot form
   */
  function resetChatbotForm() {
    chatbotIdInput.value = '';
    chatbotNameInput.value = '';
    chatbotDefaultCheckbox.checked = false;
    chatbotPersonalityInput.value = '';
    chatbotHistoryInput.value = '';
    chatbotSystemPromptInput.value = '';

    // Reset colors to defaults
    const bubbleColorPicker = document.getElementById('chatbot-bubble-color');
    const bubbleColorText = document.getElementById('chatbot-bubble-color-text');
    const textColorPicker = document.getElementById('chatbot-text-color');
    const textColorText = document.getElementById('chatbot-text-color-text');
    
    if (bubbleColorPicker && bubbleColorText && textColorPicker && textColorText) {
      bubbleColorPicker.value = '#f8f8f8';
      bubbleColorText.value = '#f8f8f8';
      textColorPicker.value = '#000000';
      textColorText.value = '#000000';
      updateColorPreview();
    }

    examplesContainer.innerHTML = '';
  }

  /**
   * Update the color preview
   */
  function updateColorPreview() {
    const colorPreview = document.getElementById('chatbot-color-preview');
    const bubbleColorPicker = document.getElementById('chatbot-bubble-color');
    const textColorPicker = document.getElementById('chatbot-text-color');
    
    if (colorPreview && bubbleColorPicker && textColorPicker) {
      colorPreview.style.backgroundColor = bubbleColorPicker.value;
      colorPreview.style.color = textColorPicker.value;
    }
  }

  /**
   * Add an example conversation pair
   * @param {string} userContent - User message content
   * @param {string} assistantContent - Assistant response content
   */
  function addExamplePair(userContent = '', assistantContent = '') {
    const pairDiv = document.createElement('div');
    pairDiv.classList.add('example-pair', 'mb-3');
    pairDiv.innerHTML = `
      <div class="row">
        <div class="col-md-6">
          <div class="mb-2">
            <label class="form-label">User Message:</label>
            <textarea class="form-control example-user" rows="2" placeholder="Example user message">${userContent}</textarea>
          </div>
        </div>
        <div class="col-md-6">
          <div class="mb-2">
            <label class="form-label">Assistant Response:</label>
            <textarea class="form-control example-assistant" rows="2" placeholder="Example assistant response">${assistantContent}</textarea>
          </div>
        </div>
      </div>
    `;

    examplesContainer.appendChild(pairDiv);
  }

/**
 * Get session ID from cookies
 * @returns {string} Session ID
 */
function getSessionId() {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'sessionId') {
      return value;
    }
  }
  return null;
}

 /**
 * Updates the UI to display hashtags/topics
 * @param {Array} hashtags - The hashtags to display
 * @param {boolean} isPreliminary - Whether these are preliminary tags (not final)
 */
 function updateHashtags(hashtags, isPreliminary = false) {
  // Find or create hashtags container
  let hashtagsContainer = document.getElementById('hashtags-container');
  
  if (!hashtagsContainer) {
    hashtagsContainer = document.createElement('div');
    hashtagsContainer.id = 'hashtags-container';
    hashtagsContainer.className = 'hashtags-container';
    
    // Find a good place to insert it in the DOM
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer && chatContainer.parentNode) {
      chatContainer.parentNode.insertBefore(hashtagsContainer, chatContainer.nextSibling);
    } else {
      document.body.appendChild(hashtagsContainer);
    }
  }
  
  // Store the current hashtags globally
  if (!isPreliminary) {
    window.currentHashtags = hashtags || [];
  }
  
  // Clear previous hashtags if they exist and this is not preliminary
  if (!isPreliminary) {
    hashtagsContainer.innerHTML = '';
  }
  
  // Create tags list container with title
  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'tags-list';
  
  // Add the title
  const title = document.createElement('div');
  title.className = 'hashtags-title';
  title.textContent = 'Topics:';
  tagsContainer.appendChild(title);
  
  // Display hashtags
  if (hashtags && hashtags.length > 0) {
    hashtags.forEach(tag => {
      // Skip if already exists (for preliminary updates)
      if (isPreliminary && 
          tagsContainer.querySelector(`.hashtag[data-tag="${tag.replace('#', '')}"]`)) {
        return;
      }
      
      const tagContainer = document.createElement('div');
      tagContainer.className = 'tag-container';
      
      const tagElement = document.createElement('span');
      tagElement.className = 'hashtag';
      
      // Store the tag name without # for data attribute
      const tagName = tag.replace('#', '');
      tagElement.setAttribute('data-tag', tagName);
      tagElement.textContent = tag;
      
      // Add click handler to filter by tag
      tagElement.addEventListener('click', function() {
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
          messageInput.value = `Tell me more about ${tagName}`;
          messageInput.focus();
        }
      });
      
      tagContainer.appendChild(tagElement);
      
      // Add delete button (X) inside the tag container
      if (!isPreliminary) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-tag-button';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Remove topic';
        deleteBtn.addEventListener('click', function(e) {
          e.stopPropagation(); // Prevent clicking the parent tag
          
          // Get the current message ID
          const messageId = document.querySelector('.assistant-message:last-child')?.dataset?.messageId;
          if (!messageId) return;
          
          // Send delete request to server
          fetch('/api/block-tag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              tag: tagName,
              messageId: messageId,
              sessionId: getSessionId()
            })
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              // Remove tag from UI
              tagContainer.remove();
              
              // Remove from current tags array
              const currentTags = window.currentHashtags || [];
              const index = currentTags.findIndex(t => 
                t.replace('#', '').toLowerCase() === tagName.toLowerCase());
              if (index !== -1) {
                currentTags.splice(index, 1);
                window.currentHashtags = currentTags;
              }
              
              // If all tags are gone, update UI
              if (currentTags.length === 0) {
                updateHashtags([]);
              }
            } else {
              console.error('Failed to block tag:', data.message);
            }
          })
          .catch(error => {
            console.error('Error blocking tag:', error);
          });
        });
        
        tagContainer.appendChild(deleteBtn);
      }
      
      tagsContainer.appendChild(tagContainer);
    });
  } else if (!isPreliminary) {
    // Show "no topics" message if there are no hashtags
    const noTagsMsg = document.createElement('div');
    noTagsMsg.className = 'no-tags-message';
    noTagsMsg.textContent = 'No topics yet';
    tagsContainer.appendChild(noTagsMsg);
  }
  
  // Add the "+" button to add a new tag if not preliminary
  if (!isPreliminary) {
    const addButton = document.createElement('button');
    addButton.className = 'add-tag-button';
    addButton.textContent = '+';
    addButton.title = 'Add a new topic';
    addButton.addEventListener('click', showAddTagModal);
    tagsContainer.appendChild(addButton);
  }
  
  // Add the tags container to the main container
  hashtagsContainer.innerHTML = '';
  hashtagsContainer.appendChild(tagsContainer);
}

/**
 * Show modal for adding a new tag
 */
function showAddTagModal() {
  // Remove any existing modals
  const existingModal = document.getElementById('tag-modal');
  if (existingModal) existingModal.remove();
  
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'tag-modal-overlay';
  overlay.id = 'tag-modal-overlay';
  
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'tag-modal';
  modal.id = 'tag-modal';
  
  // Create modal header
  const header = document.createElement('div');
  header.className = 'tag-modal-header';
  
  const title = document.createElement('div');
  title.className = 'tag-modal-title';
  title.textContent = 'Add New Topic';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tag-modal-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeAddTagModal);
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  
  // Create input for new tag
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.id = 'new-tag-input';
  input.placeholder = 'Enter topic (without # prefix)';
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveNewTag();
    else if (e.key === 'Escape') closeAddTagModal();
  });
  
  // Create buttons
  const buttons = document.createElement('div');
  buttons.className = 'tag-modal-buttons';
  
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'tag-modal-button tag-modal-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeAddTagModal);
  
  const saveBtn = document.createElement('button');
  saveBtn.className = 'tag-modal-button tag-modal-save';
  saveBtn.textContent = 'Add Topic';
  saveBtn.addEventListener('click', saveNewTag);
  
  buttons.appendChild(cancelBtn);
  buttons.appendChild(saveBtn);
  
  // Assemble modal
  modal.appendChild(header);
  modal.appendChild(input);
  modal.appendChild(buttons);
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Focus the input
  setTimeout(() => input.focus(), 100);
}

/**
 * Close the add tag modal
 */
function closeAddTagModal() {
  const overlay = document.getElementById('tag-modal-overlay');
  if (overlay) {
    overlay.remove();
  }
}

/**
 * Save the new tag entered in the modal
 */
function saveNewTag() {
  const input = document.getElementById('new-tag-input');
  if (!input) return;
  
  const tagText = input.value.trim();
  
  if (tagText) {
    // Format with # if missing
    const formattedTag = tagText.startsWith('#') ? tagText : `#${tagText}`;
    
    // Get current message ID
    const messageId = document.querySelector('.assistant-message:last-child')?.dataset?.messageId;
    if (!messageId) {
      closeAddTagModal();
      return;
    }
    
    // Send API request to add tag
    fetch('/api/add-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        tag: formattedTag,
        messageId: messageId,
        sessionId: getSessionId()
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // Add the new tag to the current list
        const currentTags = window.currentHashtags || [];
        currentTags.push(formattedTag);
        
        // Update UI with new tags
        updateHashtags(currentTags);
      } else {
        console.error('Failed to add tag:', data.message);
      }
    })
    .catch(error => {
      console.error('Error adding tag:', error);
    });
  }
  
  closeAddTagModal();
}

/**
 * Get session ID from cookies
 */
function getSessionId() {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'sessionId') {
      return value;
    }
  }
  return null;
}

  /**
   * Ensure at least one example pair exists
   */
  function ensureExamplePair() {
    if (examplesContainer.querySelectorAll('.example-pair').length === 0) {
      addExamplePair();
    }
  }

  /**
   * Get examples from form
   * @returns {Array} Array of example objects
   */
  function getExamplesFromForm() {
    const examples = [];
    const examplePairs = examplesContainer.querySelectorAll('.example-pair');

    examplePairs.forEach(pair => {
      const userMessage = pair.querySelector('.example-user').value.trim();
      const assistantResponse = pair.querySelector('.example-assistant').value.trim();

      if (userMessage && assistantResponse) {
        examples.push({
          role: 'user',
          content: userMessage
        });

        examples.push({
          role: 'assistant',
          content: assistantResponse
        });
      }
    });

    return examples;
  }

  /**
   * Function to trigger download
   * @param {string} format - Format to download (json, text, html, markdown)
   */
  function downloadExport(format) {
    // Close the modal
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById('exportFormatModal'));
    if (modalInstance) {
      modalInstance.hide();
    }

    // Open download in new window/tab
    window.open(`/api/export-session/${currentSessionId}?format=${format}`, '_blank');
  }
  
  // Event listeners

  // Handle submit button click for sending messages
  sendButton.addEventListener('click', sendMessage);

  // Handle Enter key press in message input
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  // Temperature range display update
  temperatureRange.addEventListener('input', () => {
    temperatureValue.textContent = temperatureRange.value;
  });

  // Test connection button
  testConnectionBtn.addEventListener('click', async () => {
    const url = ollamaUrlInput.value.trim();
    connectionTestResult.classList.remove('d-none', 'alert-success', 'alert-danger');
    connectionTestResult.classList.add('alert', 'alert-info');
    connectionTestResult.textContent = 'Testing connection...';

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        connectionTestResult.classList.remove('alert-info');
        connectionTestResult.classList.add('alert-success');
        connectionTestResult.textContent = 'Connection successful!';
      } else {
        connectionTestResult.classList.remove('alert-info');
        connectionTestResult.classList.add('alert-danger');
        connectionTestResult.textContent = `Connection failed: ${data.error ? data.error.message : 'Unknown error'}`;
      }
    } catch (error) {
      connectionTestResult.classList.remove('alert-info');
      connectionTestResult.classList.add('alert-danger');
      connectionTestResult.textContent = `Error: ${error.message}`;
    }
  });

  // Add a model checker button to settings
  const modelCheckBtn = document.getElementById('model-check-btn') || document.createElement('button');
  if (!modelCheckBtn.id) {
    modelCheckBtn.id = 'model-check-btn';
    modelCheckBtn.className = 'btn btn-info mb-3 ms-2';
    modelCheckBtn.textContent = 'Check Model Availability';
    document.getElementById('test-connection-btn').after(modelCheckBtn);
  }

  modelCheckBtn.addEventListener('click', async () => {
    // Get model from either dropdown or manual input
    let modelToCheck = modelSelect.value;
    const manualModel = document.getElementById('model-manual').value.trim();

    if (manualModel) {
      modelToCheck = manualModel;
    }

    if (!modelToCheck) {
      alert('Please select or enter a model name to check');
      return;
    }

    connectionTestResult.classList.remove('d-none', 'alert-success', 'alert-danger');
    connectionTestResult.classList.add('alert', 'alert-info');
    connectionTestResult.textContent = `Checking if model "${modelToCheck}" is available...`;

    try {
      const response = await fetch(`/api/check-model/${encodeURIComponent(modelToCheck)}`);
      const data = await response.json();

      if (data.success) {
        connectionTestResult.classList.remove('alert-info');
        connectionTestResult.classList.add('alert-success');
        connectionTestResult.innerHTML = `<strong>Success!</strong> Model "${modelToCheck}" is installed on your Ollama server.`;
      } else {
        connectionTestResult.classList.remove('alert-info');
        connectionTestResult.classList.add('alert-warning');
        connectionTestResult.innerHTML = `<strong>Warning:</strong> Model "${modelToCheck}" is NOT installed on your Ollama server.<br>
          Available models: ${data.availableModels.join(', ')}<br>
          You can install it by running this command in your terminal:<br>
          <code>${data.pullCommand}</code>`;
      }
    } catch (error) {
      connectionTestResult.classList.remove('alert-info');
      connectionTestResult.classList.add('alert-danger');
      connectionTestResult.textContent = `Error checking model: ${error.message}`;
    }
  });

  // Save configuration button
  saveConfigBtn.addEventListener('click', async () => {
    // Get model from either dropdown or manual input
    let selectedModel = modelSelect.value;
    const manualModel = document.getElementById('model-manual').value.trim();

    if (manualModel) {
      selectedModel = manualModel;
    }

    if (!selectedModel) {
      alert('Please select or enter a model name');
      return;
    }

    // Get context messages count, defaulting to 4 if not found
    let contextCount = 4;
    const contextInput = document.getElementById('context-messages');
    if (contextInput) {
      contextCount = parseInt(contextInput.value, 10) || 4;
    }

    const newConfig = {
      ollamaApiUrl: ollamaUrlInput.value.trim(),
      defaultModel: selectedModel,
      temperature: temperatureRange.value,
      maxTokens: maxTokensInput.value,
      contextMessages: contextCount
    };

    console.log('Saving configuration:', newConfig);

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newConfig)
      });

      const result = await response.json();

      if (result.success) {
        // Update current config
        currentConfig = result.config;
        updateUIWithConfig(currentConfig);

        // Close modal
        const configModal = bootstrap.Modal.getInstance(document.getElementById('configModal'));
        configModal.hide();

        // Add system message
        addMessage('system', `Configuration updated successfully! Using model: ${currentConfig.defaultModel}`);
      } else {
        alert(`Failed to save configuration: ${result.message}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  });

  // Emergency model fix button
  emergencyFixBtn.addEventListener('click', async () => {
    const modelName = prompt('Enter the exact model name to use:', 'dolphin-llama3:70b');

    if (!modelName) return;

    try {
      const response = await fetch('/api/set-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ modelName })
      });

      const result = await response.json();

      if (result.success) {
        currentConfig = result.config;
        updateUIWithConfig(currentConfig);
        addMessage('system', `Model directly set to: ${modelName}`);

        // Force refresh debug info to console
        const debugResponse = await fetch('/api/debug');
        const debugData = await debugResponse.json();
        console.log('Updated config debug info:', debugData);
      } else {
        alert(`Failed to set model: ${result.message}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  });

  // Diagnostics button
  diagnosticsBtn.addEventListener('click', async () => {
    addMessage('system', 'Running diagnostics, please wait...');

    try {
      const response = await fetch('/api/run-diagnostics');
      const data = await response.json();

      console.log('Diagnostics results:', data);

      let diagnosticMessage = `== Diagnostics Results ==\n`;
      diagnosticMessage += `Time: ${data.timeStamp}\n\n`;

      diagnosticMessage += `Current model: ${data.memoryConfig.defaultModel}\n`;
      diagnosticMessage += `API URL: ${data.memoryConfig.ollamaApiUrl}\n\n`;

      diagnosticMessage += `Available models: ${data.availableModels.join(', ') || 'None detected'}\n\n`;

      diagnosticMessage += `Recommendations:\n`;
      data.recommendations.forEach(rec => {
        diagnosticMessage += `- ${rec}\n`;
      });

      // Check if the model is available
      if (data.availableModels.includes(data.memoryConfig.defaultModel)) {
        diagnosticMessage += `\n✅ Your configured model "${data.memoryConfig.defaultModel}" is available on the server.`;
      } else {
        diagnosticMessage += `\n❌ Your configured model "${data.memoryConfig.defaultModel}" is NOT available on the server!`;
        diagnosticMessage += `\nRun this command to install it: ollama pull ${data.memoryConfig.defaultModel}`;
      }

      addMessage('system', diagnosticMessage);
    } catch (error) {
      console.error('Error running diagnostics:', error);
      addMessage('system', `Error running diagnostics: ${error.message}`);
    }
  });


  // Handle the color pickers for chatbot customization
  const bubbleColorPicker = document.getElementById('chatbot-bubble-color');
  const bubbleColorText = document.getElementById('chatbot-bubble-color-text');
  const textColorPicker = document.getElementById('chatbot-text-color');
  const textColorText = document.getElementById('chatbot-text-color-text');
  
  if (bubbleColorPicker && bubbleColorText) {
    // Update color text input when color picker changes
    bubbleColorPicker.addEventListener('input', () => {
      bubbleColorText.value = bubbleColorPicker.value;
      updateColorPreview();
    });

    // Update color picker when text input changes
    bubbleColorText.addEventListener('input', () => {
      // Validate hex color
      if (/^#([0-9A-F]{3}){1,2}$/i.test(bubbleColorText.value)) {
        bubbleColorPicker.value = bubbleColorText.value;
        updateColorPreview();
      }
    });
  }

  if (textColorPicker && textColorText) {
    // Update text color text input when color picker changes
    textColorPicker.addEventListener('input', () => {
      textColorText.value = textColorPicker.value;
      updateColorPreview();
    });

    // Update text color picker when text input changes
    textColorText.addEventListener('input', () => {
      // Validate hex color
      if (/^#([0-9A-F]{3}){1,2}$/i.test(textColorText.value)) {
        textColorPicker.value = textColorText.value;
        updateColorPreview();
      }
    });
  }

  // Handle adding example pairs
  if (addExampleBtn) {
    addExampleBtn.addEventListener('click', () => {
      addExamplePair();
    });
  }

  // Handle removing example pairs
  if (removeExampleBtn) {
    removeExampleBtn.addEventListener('click', () => {
      const examplePairs = examplesContainer.querySelectorAll('.example-pair');
      if (examplePairs.length > 1) {
        examplesContainer.removeChild(examplePairs[examplePairs.length - 1]);
      }
    });
  }

  // Handle creating a new chatbot
  if (newChatbotBtn) {
    newChatbotBtn.addEventListener('click', () => {
      // Additional step to ensure no descendant of the list tab retains focus
      document.activeElement.blur();

      // Original functionality preserved
      isEditingExisting = false;
      resetChatbotForm();
      ensureExamplePair();

      // Switch to edit tab with proper focus management
      const editTab = new bootstrap.Tab(chatbotEditTab);
      editTab.show();

      // Focus the first field in the form after tab switch
      setTimeout(() => {
        document.getElementById('chatbot-name').focus();
      }, 50);

      // Hide delete button for new chatbot
      document.getElementById('delete-chatbot-btn').classList.add('d-none');
    });
  } else {
    console.warn('New chatbot button not found in DOM');
  }

  // Handle canceling edit
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
      // Clear focus from any field in the edit tab before switching
      document.activeElement.blur();

      // Switch to list tab
      const listTab = new bootstrap.Tab(chatbotListTab);
      listTab.show();
    });
  } else {
    console.warn('Cancel edit button not found in the DOM');
  }

  // Handle deleting a chatbot
  if (deleteChatbotBtn) {
    deleteChatbotBtn.addEventListener('click', async () => {
      if (!chatbotIdInput.value) return;

      if (!confirm('Are you sure you want to delete this chatbot? This action cannot be undone.')) {
        return;
      }

      try {
        const response = await fetch(`/api/chatbots/${chatbotIdInput.value}`, {
          method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
          alert('Chatbot deleted successfully');
          const listTab = new bootstrap.Tab(chatbotListTab);
          listTab.show();
          loadChatbots();
        } else {
          alert(`Failed to delete chatbot: ${result.message}`);
        }
      } catch (error) {
        console.error('Error deleting chatbot:', error);
        alert('An error occurred while deleting the chatbot');
      }
    });
  }

  // Handle form submission
  if (chatbotForm) {
    chatbotForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Collect form data
      const chatbotData = {
        name: chatbotNameInput.value,
        isDefault: chatbotDefaultCheckbox.checked,
        settings: {
          personality: chatbotPersonalityInput.value,
          character_history: chatbotHistoryInput.value,
          system_prompt: chatbotSystemPromptInput.value,
          bubble_color: document.getElementById('chatbot-bubble-color')?.value || '#f8f8f8',
          text_color: document.getElementById('chatbot-text-color')?.value || '#000000'
        },
        bubbleColor: document.getElementById('chatbot-bubble-color')?.value || '#f8f8f8',
        textColor: document.getElementById('chatbot-text-color')?.value || '#000000',
        examples: getExamplesFromForm()
      };

      try {
        let response;

        if (isEditingExisting) {
          // Update existing chatbot
          response = await fetch(`/api/chatbots/${chatbotIdInput.value}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(chatbotData)
          });
        } else {
          // Create new chatbot
          response = await fetch('/api/chatbots', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(chatbotData)
          });
        }

        const result = await response.json();

        if (result.success) {
          alert(isEditingExisting ? 'Chatbot updated successfully' : 'Chatbot created successfully');
          const listTab = new bootstrap.Tab(chatbotListTab);
          listTab.show();
          loadChatbots();
        } else {
          alert(`Failed to ${isEditingExisting ? 'update' : 'create'} chatbot: ${result.message}`);
        }
      } catch (error) {
        console.error(`Error ${isEditingExisting ? 'updating' : 'creating'} chatbot:`, error);
        alert(`An error occurred while ${isEditingExisting ? 'updating' : 'creating'} the chatbot`);
      }
    });
  }

  // Export buttons
  document.getElementById('export-json-btn')?.addEventListener('click', () => {
    downloadExport('json');
  });

  document.getElementById('export-text-btn')?.addEventListener('click', () => {
    downloadExport('text');
  });

  document.getElementById('export-html-btn')?.addEventListener('click', () => {
    downloadExport('html');
  });

  document.getElementById('export-markdown-btn')?.addEventListener('click', () => {
    downloadExport('markdown');
  });

// Socket event listeners

  // Add these event handlers in your DOMContentLoaded event handler
socket.on('messageChunk', function(data) {
  // Check if this is the first chunk for this message
  const existingMessage = document.querySelector(`.message[data-message-id="${data.messageId}"]`);
  
  if (!existingMessage) {
    // Create a new message container for the first chunk
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', 'assistant-message');
    messageDiv.setAttribute('data-message-id', data.messageId);
    
    // Apply custom colors if provided
    if (data.bubbleColor) {
      messageDiv.style.backgroundColor = data.bubbleColor;
      if (data.textColor) {
        messageDiv.style.color = data.textColor;
      }
    }
    
    // Store raw content for markdown processing
    messageDiv._rawContent = data.chunk;
    
    // Process content (markdown or plain text)
    if (window.markdownit && data.chunk.includes('\n') || 
        data.chunk.includes('```') || 
        data.chunk.includes('**')) {
      const md = window.markdownit();
      messageDiv.innerHTML = md.render(data.chunk);
    } else {
      messageDiv.textContent = data.chunk;
    }
    
    // Remove typing indicator if present
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }
    
    // Add to container
    messagesContainer.appendChild(messageDiv);
  } else {
    // Add this chunk to existing message
    if (data.chunk) {
      // Add to raw content storage
      existingMessage._rawContent = (existingMessage._rawContent || '') + data.chunk;
      
      // Process with markdown if available and content looks like markdown
      if (window.markdownit && (
        existingMessage._rawContent.includes('\n') || 
        existingMessage._rawContent.includes('```') || 
        existingMessage._rawContent.includes('**')
      )) {
        try {
          const md = window.markdownit();
          existingMessage.innerHTML = md.render(existingMessage._rawContent);
        } catch (e) {
          // Fallback to plain text on markdown error
          existingMessage.textContent = existingMessage._rawContent;
        }
      } else {
        existingMessage.textContent = existingMessage._rawContent;
      }
    }
  }
  
  // Scroll to bottom with each chunk
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  
  // If this is the final chunk, finalize the message
  if (data.done) {
    // Add final response to message history
    messageHistory.push({
      role: 'assistant',
      content: existingMessage._rawContent || existingMessage.textContent
    });
    
    // Update hashtags if provided
    if (data.hashtags && Array.isArray(data.hashtags)) {
      updateHashtags(data.hashtags);
    }
    
    // Show response time if available
    if (data.responseTime) {
      const responseTime = Math.round(data.responseTime / 100) / 10;
      console.log(`Response completed in ${responseTime}s`);
    }
  }
});

// Handle streaming hashtags updates
socket.on('streamingHashtags', function(data) {
  if (data.hashtags && Array.isArray(data.hashtags)) {
    // Only update UI if these are preliminary hashtags
    if (!data.final) {
      updateHashtags(data.hashtags, true); // true = preliminary update
    }
  }
});

  // Debug: Log socket connection events
  socket.on('connect', () => {
    console.log('Connected to server');
    connectionStatus.textContent = 'Connected to server';
    connectionStatus.className = 'text-success';
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    connectionStatus.textContent = 'Disconnected from server';
    connectionStatus.className = 'text-danger';
    addMessage('system', 'Disconnected from server. Please refresh the page.');
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
    connectionStatus.textContent = 'Connection error';
    connectionStatus.className = 'text-danger';
    addMessage('system', 'Connection error: ' + error);
  });

  // Handle session creation event
  socket.on('sessionCreated', function(data) {
    console.log('Received session ID from server:', data);
    
    // Set the session ID globally with proper validation
    if (data && data.sessionId) {
      currentSessionId = data.sessionId;
      console.log('Session ID set successfully:', currentSessionId);
      
      // Store session ID in localStorage for potential recovery
      try {
        localStorage.setItem('ollama_chat_session_id', currentSessionId);
        localStorage.setItem('ollama_chat_session_time', data.timestamp || new Date().toISOString());
        console.log('Session ID stored in localStorage');
      } catch (e) {
        console.error('Failed to store session ID in localStorage:', e);
      }
  
      // Add system message to chat
      addMessage('system', `Chat session started (ID: ${currentSessionId.substring(0, 8)}...)`);
      
      // Load chatbots if container exists
      if (chatbotsContainer) {
        console.log('Preloading chatbots after session creation');
        setTimeout(loadChatbots, 1000);
      }
    } else {
      console.error('Invalid session data received:', data);
      addMessage('system', 'Warning: Session initialization issue detected');
    }
  });

  // Handle message response from server
  socket.on('messageResponse', (data) => {
    console.log('Received message response from server:', data);

    // Remove typing indicator
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }

    // Remove hashtags from content
    let cleanContent = data.content;
    if (data.hashtags && data.hashtags.length > 0) {
      // Remove #HASHTAGS: section if present
      cleanContent = cleanContent.replace(/#HASHTAGS:\s*[^]*?(?=$|\n\n)/i, '').trim();

      // Remove any standalone hashtags at the end of the message
      data.hashtags.forEach(tag => {
        cleanContent = cleanContent.replace(new RegExp(`\\s*${tag}\\b`, 'g'), '').trim();
      });
    }

    // Add assistant message with message ID, chatbot ID, and colors
    addMessage(
      data.role,
      cleanContent,
      data.messageId,
      data.chatbotId,
      data.bubbleColor,
      data.textColor
    );

    // Display hashtags if present
    if (data.hashtags && data.hashtags.length > 0) {
      console.log('Displaying hashtags:', data.hashtags);
      displayHashtags(data.hashtags);
    } else {
      console.log('No hashtags to display');
    }
  });

  // Handle hashtags update for user messages
  socket.on('hashtagsUpdate', (data) => {
    console.log('Received hashtags update from server:', data);

    // Only process if we have hashtags
    if (data.hashtags && data.hashtags.length > 0) {
      console.log('Displaying hashtags for user message:', data.hashtags);

      // Update the latest user message with its message ID if provided
      if (data.messageId) {
        const userMessages = document.querySelectorAll('.user-message');
        if (userMessages.length > 0) {
          const lastUserMessage = userMessages[userMessages.length - 1];
          lastUserMessage.setAttribute('data-message-id', data.messageId);
        }
      }

      displayHashtags(data.hashtags);
    }
  });

  // Handle tag result responses
  socket.on('tagResult', function(result) {
    if (result.success) {
      showToast(`Hashtag ${result.formattedTag || '#' + result.tag} added successfully`, 'success');
      
      // If you have a tag display area, update it
      if (typeof updateTagDisplay === 'function') {
        updateTagDisplay();
      }
    } else {
      showToast(`Failed to add hashtag: ${result.error || 'Unknown error'}`, 'error');
    }
  });

  // Handle config updates from server
  socket.on('configUpdate', (config) => {
    currentConfig = config;
    updateUIWithConfig(config);

    // Fetch available models
    fetchModels();
  });

  // Test socket connection functionality
  socket.on('testResponse', (data) => {
    console.log('Received test response from server:', data);
    addMessage('system', 'Server received test and responded: ' + JSON.stringify(data));
  });

  // Load chatbots when the modal is opened
  if (chatbotConfigModal) {
    chatbotConfigModal.addEventListener('show.bs.modal', loadChatbots);
  }

  // Initialize tag management
  initializeTagManagement();

  // Create a chatbot indicator in the UI
  updateChatbotIndicator();

  // Make addNewHashtag function globally accessible
  window.addNewHashtag = addNewHashtag;
});

