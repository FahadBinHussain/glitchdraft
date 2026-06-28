(function() {
    'use strict';

    // Configuration options
    const config = {
        debugMode: false
    };

    // WhatsApp state management
    let whatsappCurrentChatId = null;
    let whatsappChatObserver = null;

    // Load initial config from Firestore (with local cache fallback during load)
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        if (response && response.success && response.settings?.appConfig) {
            Object.assign(config, response.settings.appConfig);
        }
        // Re-initialize UI elements that depend on config if needed
        const debugToggleButton = document.querySelector('button[title="Toggle debug mode"]');
        if (debugToggleButton) {
            debugToggleButton.textContent = config.debugMode ? '🐞 On' : '🐞 Off';
        }
    });

    // Save app config to Firestore settings
    function saveConfig() {
        chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
            const currentSettings = (response && response.success) ? response.settings : {};
            chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: { uiPositions: currentSettings.uiPositions || {}, appConfig: config }
            });
        });
    }

    // Add complete CSS with theme system
    const completeCSS = `
    :root {
        /* Light theme variables (default) */
        --bg-primary: #ffffff;
        --bg-secondary: #f0f2f5;
        --bg-tertiary: #e4e6ea;
        --text-primary: #1c1e21;
        --text-secondary: #65676b;
        --border: #dddfe2;
        --accent: #0084ff;
        --accent-hover: #0066cc;
        --success: #42b883;
        --danger: #e74c3c;
    }

    [data-theme="dark"] {
        /* Dark theme variables */
        --bg-primary: #18191a;
        --bg-secondary: #242526;
        --bg-tertiary: #3a3b3c;
        --text-primary: #e4e6ea;
        --text-secondary: #b0b3b8;
        --border: #3e4042;
        --accent: #0084ff;
        --accent-hover: #1877f2;
        --success: #42b883;
        --danger: #e74c3c;
    }

    .saved-messages-container {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        height: 500px;
        background-color: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        font-family: system-ui, -apple-system, sans-serif;
        color: var(--text-primary);
        resize: both;
        overflow: hidden;
        min-width: 300px;
        min-height: 400px;
        max-width: 600px;
        max-height: 700px;
        transition: opacity 0.3s ease, box-shadow 0.3s ease;
        box-sizing: border-box;
    }

    .saved-messages-toggle {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 38px;
        height: 38px;
        background-color: var(--accent);
        color: white;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        box-shadow: 0 4px 20px rgba(0, 132, 255, 0.3);
        z-index: 9999;
        transition: background-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .saved-messages-toggle:hover {
        background-color: var(--accent-hover);
        transform: scale(1.05);
    }

    .saved-messages-header {
        padding: 6px 10px;
        background-color: var(--accent);
        color: white;
        font-weight: bold;
        font-size: 13px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: move;
        min-height: 32px;
    }

    .saved-messages-close {
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
    }

    .saved-messages-body {
        padding: 12px;
        overflow-y: auto;
        flex-grow: 1;
        background-color: var(--bg-primary);
    }

    .saved-messages-item {
        margin-bottom: 10px;
        padding: 8px;
        background-color: var(--bg-secondary);
        border-radius: 8px;
        position: relative;
        border: 1px solid var(--border);
    }

    .saved-messages-timestamp {
        font-size: 10px;
        color: var(--text-secondary);
        margin-top: 4px;
    }

    .saved-messages-actions {
        display: flex;
        gap: 8px;
        margin-top: 5px;
    }

    .saved-messages-actions button {
        padding: 4px 8px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.2s ease;
    }

    .saved-message-use {
        background-color: var(--accent);
        color: white;
    }

    .saved-message-use:hover {
        background-color: var(--accent-hover);
    }

    .saved-message-copy {
        background-color: var(--bg-tertiary);
        color: var(--text-primary);
    }

    .saved-message-copy:hover {
        background-color: var(--border);
    }

    .saved-message-delete {
        background-color: var(--danger);
        color: white;
    }

    .saved-message-delete:hover {
        opacity: 0.8;
    }

    .saved-messages-input {
        padding: 12px;
        display: flex;
        gap: 8px;
        border-top: 1px solid var(--border);
        background-color: var(--bg-primary);
    }

    .saved-messages-input textarea,
    .message-input-div {
        flex-grow: 1;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 8px;
        font-family: inherit;
        resize: vertical;
        min-height: 60px;
        max-height: 150px;
        background-color: var(--bg-primary);
        color: var(--text-primary);
    }

    .saved-messages-input button {
        background-color: var(--accent);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 18px;
        font-weight: bold;
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s ease;
    }

    .saved-messages-input button:hover {
        background-color: var(--accent-hover);
    }

    .keyboard-shortcut {
        display: inline-block;
        margin-left: 5px;
        background-color: rgba(255,255,255,0.2);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 9px;
        color: rgba(255,255,255,0.85);
    }

    .saved-messages-menu {
        display: flex;
        justify-content: space-between;
        padding: 4px 8px;
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
        gap: 2px;
    }

    .saved-messages-menu button {
        border: none;
        background-color: transparent;
        color: var(--text-primary);
        cursor: pointer;
        font-size: 11px;
        padding: 3px 6px;
        border-radius: 3px;
        transition: background-color 0.2s ease;
        white-space: nowrap;
    }

    .saved-messages-menu button:hover {
        background-color: var(--bg-tertiary);
    }

    .saved-messages-sync-status {
        padding: 4px 8px;
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
        font-size: 10px;
        line-height: 1.3;
    }

    .status {
        color: var(--text-secondary);
    }

    .status.success {
        color: var(--success);
    }

    .status.error {
        color: var(--danger);
    }

    .status.warning {
        color: #ff9800;
    }

    .sync-info {
        margin-top: 2px;
        font-size: 10px;
        color: var(--text-secondary);
        line-height: 1.2;
    }

    .sync-progress-container {
        margin-top: 4px;
        height: 3px;
        background-color: var(--bg-tertiary);
        border-radius: 2px;
        overflow: hidden;
    }

    .sync-progress-bar {
        height: 100%;
        background-color: var(--accent);
        transition: width 0.3s ease;
        border-radius: 2px;
    }

    .auth-button {
        background-color: #34a853;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        margin-top: 4px;
        transition: background-color 0.2s ease;
    }

    .auth-button:hover {
        background-color: #2d8a46;
    }

    .auth-button:disabled {
        background-color: var(--bg-tertiary);
        cursor: not-allowed;
    }

    .hidden {
        display: none;
    }

    .file-input-hidden {
        display: none;
    }

    .saved-messages-notification {
        position: fixed;
        top: 80px;
        right: 20px;
        background-color: #333;
        color: white;
        padding: 4px 10px;
        border-radius: 3px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        z-index: 10001;
        font-size: 11px;
        line-height: 1.2;
        opacity: 0;
        transform: translateY(-5px);
        transition: all 0.15s ease;
        max-width: 180px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .saved-messages-notification.visible {
        opacity: 0.9;
        transform: translateY(0);
    }
    `;

    // Add complete CSS to document
    const style = document.createElement('style');
    style.textContent = completeCSS;
    document.head.appendChild(style);

    // Theme detection and management
    function detectSystemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const container = document.querySelector('.saved-messages-container');
        const toggleButton = document.querySelector('.saved-messages-toggle');

        if (container) {
            container.setAttribute('data-theme', theme);
        }
        if (toggleButton) {
            toggleButton.setAttribute('data-theme', theme);
        }

        // Update config
        config.theme = theme;
        saveConfig();
    }

    function initializeTheme() {
        const systemTheme = detectSystemTheme();
        const savedTheme = config.theme || systemTheme;
        applyTheme(savedTheme);

        // Listen for system theme changes
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addListener((e) => {
                if (!config.manualTheme) {
                    applyTheme(e.matches ? 'dark' : 'light');
                }
            });
        }
    }

    // Add custom styles
    // GM_addStyle(`
    //     .saved-messages-container {
    //         position: fixed;
    //         right: 20px;
    //         bottom: 100px;
    //         width: 300px;
    //         background-color: #ffffff;
    //         border-radius: 8px;
    //         box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    //         z-index: 9999;
    //         overflow: hidden;
    //         display: flex;
    //         flex-direction: column;
    //         max-height: 400px;
    //         border: 1px solid #e4e6eb;
    //     }

    //     .saved-messages-header {
    //         padding: 12px;
    //         background-color: #0084ff;
    //         color: white;
    //         font-weight: bold;
    //         display: flex;
    //         justify-content: space-between;
    //         align-items: center;
    //         cursor: move;
    //     }

    //     .saved-messages-close {
    //         cursor: pointer;
    //         font-size: 18px;
    //     }

    //     .saved-messages-body {
    //         padding: 12px;
    //         overflow-y: auto;
    //         flex-grow: 1;
    //     }

    //     .saved-messages-item {
    //         margin-bottom: 10px;
    //         padding: 8px;
    //         background-color: #f0f2f5;
    //         border-radius: 8px;
    //         position: relative;
    //     }

    //     .saved-messages-timestamp {
    //         font-size: 10px;
    //         color: #65676B;
    //         margin-top: 4px;
    //     }

    //     .saved-messages-actions {
    //         display: flex;
    //         gap: 8px;
    //         margin-top: 5px;
    //     }

    //     .saved-messages-actions button {
    //         padding: 4px 8px;
    //         border: none;
    //         border-radius: 4px;
    //         cursor: pointer;
    //         font-size: 12px;
    //     }

    //     .saved-message-use {
    //         background-color: #0084ff;
    //         color: white;
    //     }

    //     .saved-message-delete {
    //         background-color: #f44336;
    //         color: white;
    //     }

    //     .saved-messages-input {
    //         padding: 12px;
    //         display: flex;
    //         gap: 8px;
    //         border-top: 1px solid #e4e6eb;
    //     }

    //     .saved-messages-input textarea {
    //         flex-grow: 1;
    //         border: 1px solid #e4e6eb;
    //         border-radius: 20px;
    //         padding: 8px 12px;
    //         resize: none;
    //     }

    //     .saved-messages-input .message-input-div {
    //         flex-grow: 1;
    //         border: 1px solid #e4e6eb;
    //         border-radius: 20px;
    //         padding: 8px 12px;
    //         min-height: 36px;
    //         max-height: 220px;
    //         overflow-y: auto;
    //         background-color: white;
    //         user-select: text;
    //         white-space: pre-wrap;
    //         word-break: break-word;
    //     }
    //     .message-input-div:empty:before {
    //         content: attr(data-placeholder);
    //         color: #999;
    //         pointer-events: none;
    //     }

    //     .saved-messages-input .message-input-div img,
    //     .saved-messages-item img {
    //         max-width: 100%;
    //         max-height: 180px;
    //         display: block;
    //         border-radius: 6px;
    //         margin: 4px 0;
    //         object-fit: contain;
    //     }

    //     .saved-messages-input button {
    //         background-color: #0084ff;
    //         color: white;
    //         border: none;
    //         border-radius: 50%;
    //         width: 36px;
    //         height: 36px;
    //         display: flex;
    //         align-items: center;
    //         justify-content: center;
    //         cursor: pointer;
    //     }

    //     .saved-messages-toggle {
    //         position: fixed;
    //         bottom: 20px;
    //         right: 20px;
    //         width: 50px;
    //         height: 50px;
    //         background-color: #0084ff;
    //         border-radius: 50%;
    //         display: flex;
    //         align-items: center;
    //         justify-content: center;
    //         color: white;
    //         font-size: 24px;
    //         cursor: pointer;
    //         box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    //         z-index: 9999;
    //     }

    //     .saved-messages-category {

    //         bottom: 20px;
    //         left: 50%;
    //         transform: translateX(-50%);
    //         background-color: #333;
    //         color: white;
    //         padding: 10px 20px;
    //         border-radius: 5px;
    //         z-index: 10000;
    //         opacity: 0;
    //         transition: opacity 0.5s, visibility 0.5s;
    //         visibility: hidden;
    //     }

    //     .saved-messages-notification.visible {
    //         opacity: 1;
    //         visibility: visible;
    //     }
    // `);

    let isContainerVisible = false;
    let currentChatUrl = '';
    let dragOffset = { x: 0, y: 0 };
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let hasMoved = false;
    const DRAG_THRESHOLD = 5; // pixels
    let fileInput = null;

    // Function to get the current chat URL/ID
    function getCurrentChatId() {
        const url = window.location.href;
        
        // Try to match Facebook Messenger chat pattern
        const fbMatch = url.match(/\/t\/(\d+)/);
        if (fbMatch) {
            const numericId = fbMatch[1];
            const name = getCurrentChatName();
            const nameSlug = name ? sanitizeNameSlug(name) : null;
            return nameSlug ? `messenger_web_${numericId}_${nameSlug}` : `messenger_web_${numericId}`;
        }
        
        // Try to match Discord channel pattern: /channels/SERVER_ID/CHANNEL_ID
        const discordMatch = url.match(/\/channels\/(\d+)\/(\d+)/);
        if (discordMatch) {
            return `discord_${discordMatch[1]}_${discordMatch[2]}`;
        }
        
        // Handle WhatsApp Web
        if (url.includes('web.whatsapp.com')) {
            return getWhatsAppChatId();
        }
        
        // For other sites, use a sanitized version of the URL as the ID
        // Remove protocol and hash, replace special characters with underscores
        const sanitizedUrl = url
            .replace(/^https?:\/\//, '')  // Remove protocol
            .replace(/#.*$/, '')           // Remove hash
            .replace(/[^a-zA-Z0-9]/g, '_') // Replace special chars with underscore
            .substring(0, 200);            // Limit length
        
        return sanitizedUrl || 'default_page';
    }

    // Converts a display name to a safe Firestore document ID slug
    // e.g. "Cat Fren" → "cat_fren", "ফাহাদ" → unicode preserved but spaces/specials → _
    function sanitizeNameSlug(name) {
        return name
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, '_')  // replace non-letter/digit with _
            .replace(/_+/g, '_')               // collapse multiple underscores
            .replace(/^_|_$/g, '')             // trim leading/trailing _
            .substring(0, 50);                 // max 50 chars
    }

    function cleanDisplayName(name) {
        if (!name) return null;
        const cleaned = String(name)
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned && cleaned.length < 200 ? cleaned : null;
    }

    function cleanMessengerDisplayName(name) {
        let cleaned = cleanDisplayName(name);
        if (!cleaned) return null;

        cleaned = cleaned
            .replace(/^conversation\s+with\s+/i, '')
            .replace(/\s*\(\s*messenger_(?:web|android)_\d+(?:_[^)]+)?\s*\)\s*$/i, '')
            .replace(/\s*[-–|]\s*(?:Messenger|Facebook)\s*$/i, '')
            .trim();

        const isNoiseLabel = /^(?:chats(?:\s*[·•-]\s*\d+\s+unread)?|chat details|search messenger|new message|active now|messenger|facebook)$/i.test(cleaned);
        if (isNoiseLabel) return null;
        if (!cleaned || /^(?:Messenger|Facebook)$/i.test(cleaned)) return null;
        return cleaned;
    }

    function getDisplayNameFromChatId(chatId) {
        const messengerMatch = chatId?.match(/^messenger_(?:web|android)_\d+_(.+)$/);
        if (messengerMatch) {
            return messengerMatch[1]
                .replace(/_/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || null;
        }
        return null;
    }

    // Function to get the display name of the current conversation partner / group
    function getCurrentChatName() {
        const url = window.location.href;

        // ── Messenger (messenger.com / facebook.com) ──
        if (url.includes('messenger.com') || url.match(/facebook\.com.*\/t\//)) {
            // Messenger uses obfuscated CSS class names, so prefer scoped header/role selectors.
            const headerSelectors = [
                'div[role="main"] [aria-label^="Conversation with "]',
                'div[role="main"] [aria-label*="Conversation with "]',
                'div[role="main"] h1',
                'div[role="main"] h2',
                'div[role="main"] [role="heading"]',
                'div[data-testid="conversation-title"] span',
                'header h1',
                'header h2',
            ];
            for (const sel of headerSelectors) {
                const el = document.querySelector(sel);
                const name = cleanMessengerDisplayName(el?.getAttribute('aria-label') || el?.textContent);
                if (name) return name;
            }

            // Last DOM fallback: old observed Messenger heading class, but scoped to the main chat only.
            const candidateByClass = document.querySelector('div[role="main"] span.x1c1uobl');
            if (candidateByClass) {
                const name = cleanMessengerDisplayName(candidateByClass.textContent);
                if (name) return name;
            }

            // Strategy 3: document title (Messenger sets title to the contact name)
            const titleMatch = document.title.match(/^(.+?)(?:\s*[\|\-–].*)?$/);
            if (titleMatch && titleMatch[1] && titleMatch[1] !== 'Messenger' && titleMatch[1] !== 'Facebook') {
                return cleanMessengerDisplayName(titleMatch[1]);
            }
            return null;
        }

        // ── WhatsApp Web ──
        if (url.includes('web.whatsapp.com')) {
            const selectors = [
                'header[data-testid="conversation-header"] span[data-testid="conversation-info-header-chat-title"]',
                'header[data-testid="conversation-header"] span[dir="auto"]',
                'div[data-testid="conversation-panel-wrapper"] header span[title]',
                'span[data-testid="conversation-info-header-chat-title"]',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                const name = el?.getAttribute('title') || el?.textContent?.trim();
                if (name && name.length > 0 && name.length < 200) return name;
            }
            return null;
        }

        // ── Discord ──
        if (url.includes('discord.com')) {
            const selectors = [
                // DM header name
                'section[aria-label] h3[class*="username"]',
                'div[class*="headerContent"] h1',
                // Channel name in header
                'div[class*="title-"] h3',
                'h3[class*="header-"]',
                // Sidebar active channel
                'a[class*="selected"] div[class*="name"]',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                const name = el?.textContent?.trim();
                if (name && name.length > 0 && name.length < 200) return name;
            }
            // Fallback: document title (Discord sets "<ChannelName> | Discord")
            const titleMatch = document.title.match(/^@?([^|]+?)\s*\|/);
            if (titleMatch) return titleMatch[1].trim();
            return null;
        }

        // ── Generic fallback ──
        // Try to infer a human-readable name from the page title
        const title = document.title?.trim();
        if (title && title.length > 0 && title.length < 200) return title;
        return null;
    }

    // Thin wrapper — implementation lives in draftSync.js (gdLazyRenameIfNeeded)
    function lazyRenameIfNeeded(response, currentChatId) {
        gdLazyRenameIfNeeded(response, currentChatId, getCurrentChatName);
    }

    // WhatsApp-specific chat detection
    function getWhatsAppChatId() {
        // Return cached chat ID if available
        if (whatsappCurrentChatId) {
            return whatsappCurrentChatId;
        }

        // Try to detect chat from DOM
        const chatId = extractWhatsAppChatId();
        if (chatId) {
            whatsappCurrentChatId = chatId;
            return chatId;
        }

        return null;
    }

    // Extract WhatsApp chat ID from DOM
    function extractWhatsAppChatId() {
        // Method 1: Check for active chat in sidebar (most reliable)
        const activeChat = document.querySelector('div[data-testid="cell-frame-container"][class*="active"]') ||
                          document.querySelector('div[aria-selected="true"]');
        
        if (activeChat) {
            // Try to get data-id attribute
            const dataIdElement = activeChat.querySelector('[data-id]');
            const dataId = dataIdElement?.getAttribute('data-id');
            
            if (dataId && dataId.includes('@')) {
                const sanitizedId = dataId.replace(/[^a-zA-Z0-9@]/g, '_');
                return `whatsapp_${sanitizedId}`;
            }
            
            // Try to get title attribute from span
            const chatTitleElement = activeChat.querySelector('span[title]');
            const chatTitle = chatTitleElement?.getAttribute('title');
            
            if (chatTitle) {
                const sanitizedName = chatTitle
                    .replace(/[^a-zA-Z0-9\s]/g, '')
                    .replace(/\s+/g, '_')
                    .substring(0, 100);
                return `whatsapp_${sanitizedName}`;
            }
        }

        // Method 2: Check for chat header with contact name/group name
        const headerSelectors = [
            'header[data-testid="conversation-header"] span[dir="auto"]',
            'div[data-testid="conversation-panel-wrapper"] header span[title]'
        ];

        for (const selector of headerSelectors) {
            const headerElement = document.querySelector(selector);
            
            if (headerElement) {
                const chatName = headerElement.getAttribute('title') || headerElement.textContent?.trim();
                
                if (chatName && chatName.length > 0) {
                    const sanitizedName = chatName
                        .replace(/[^a-zA-Z0-9\s]/g, '')
                        .replace(/\s+/g, '_')
                        .substring(0, 100);
                    return `whatsapp_${sanitizedName}`;
                }
            }
        }

        // Method 3: Try to find from URL data attribute in conversation area
        const conversationPanel = document.querySelector('[data-id*="@"]');
        
        if (conversationPanel) {
            const dataId = conversationPanel.getAttribute('data-id');
            
            if (dataId && dataId.includes('@')) {
                const sanitizedId = dataId.replace(/[^a-zA-Z0-9@]/g, '_');
                return `whatsapp_${sanitizedId}`;
            }
        }

        return null;
    }

    // Initialize WhatsApp chat observer
    function initWhatsAppObserver() {
        if (!window.location.href.includes('web.whatsapp.com')) {
            return;
        }

        // Disconnect existing observer if any
        if (whatsappChatObserver) {
            whatsappChatObserver.disconnect();
        }

        // Wait for WhatsApp to load - check multiple elements
        const checkWhatsAppLoaded = setInterval(() => {
            const app = document.querySelector('#app');
            const main = document.querySelector('#main');
            
            // Start if we find main app container
            if (app || main) {
                clearInterval(checkWhatsAppLoaded);
                
                // Try initial chat detection
                const initialChatId = extractWhatsAppChatId();
                
                if (initialChatId && initialChatId !== whatsappCurrentChatId) {
                    whatsappCurrentChatId = initialChatId;
                    handleChatChange();
                }

                // Set up MutationObserver to watch for chat changes
                whatsappChatObserver = new MutationObserver((mutations) => {
                    const newChatId = extractWhatsAppChatId();
                    
                    if (newChatId && newChatId !== whatsappCurrentChatId) {
                        whatsappCurrentChatId = newChatId;
                        handleChatChange();
                    }
                });

                // Observe the entire app area for better detection
                const observeTarget = app || main || document.body;
                whatsappChatObserver.observe(observeTarget, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['title', 'data-id', 'aria-selected', 'class']
                });
                
                // Also add a polling mechanism as backup (check every 2 seconds)
                setInterval(() => {
                    const newChatId = extractWhatsAppChatId();
                    if (newChatId && newChatId !== whatsappCurrentChatId) {
                        whatsappCurrentChatId = newChatId;
                        handleChatChange();
                    }
                }, 2000);
            }
        }, 500);

        // Stop checking after 30 seconds
        setTimeout(() => {
            clearInterval(checkWhatsAppLoaded);
        }, 30000);
    }

    // Handle chat change event
    function handleChatChange() {
        // Update chat ID display
        updateChatIdDisplay();
        // Reload drafts for the new chat
        loadDraftsFromCloud();
    }

    // Update the chat ID display in the UI
    function updateChatIdDisplay() {
        const chatIdDisplay = document.getElementById('chatIdDisplay');
        if (chatIdDisplay) {
            const chatId = getCurrentChatId();
            const chatName = getCurrentChatName() || getDisplayNameFromChatId(chatId);
            if (chatName) {
                chatIdDisplay.textContent = chatName;
                chatIdDisplay.title = `ID: ${chatId || 'Unknown'}`;
            } else {
                chatIdDisplay.textContent = `Chat ID: ${chatId || 'Unknown'}`;
                chatIdDisplay.title = '';
            }
        }
    }

    /* Debug function for WhatsApp - commented out for optimization
    function debugWhatsAppStructure() {
        console.log('=== WhatsApp Debug Info ===');
        
        const header = document.querySelector('header[data-testid="conversation-header"]');
        console.log('Header:', header);
        if (header) {
            console.log('Header HTML:', header.innerHTML);
            const spans = header.querySelectorAll('span');
            console.log('Header spans:', Array.from(spans).map(s => ({
                text: s.textContent,
                title: s.getAttribute('title'),
                dir: s.getAttribute('dir')
            })));
        }
        
        const activeChats = document.querySelectorAll('[aria-selected="true"]');
        console.log('Active chats (aria-selected):', activeChats);
        activeChats.forEach((chat, i) => {
            console.log(`Active chat ${i}:`, {
                html: chat.innerHTML.substring(0, 200),
                dataId: chat.getAttribute('data-id'),
                title: chat.querySelector('[title]')?.getAttribute('title')
            });
        });
        
        const dataIdElements = document.querySelectorAll('[data-id*="@"]');
        console.log('Elements with data-id containing @:', dataIdElements.length);
        Array.from(dataIdElements).slice(0, 5).forEach((el, i) => {
            console.log(`data-id element ${i}:`, {
                dataId: el.getAttribute('data-id'),
                tagName: el.tagName,
                className: el.className
            });
        });
        
        console.log('Current extracted chat ID:', extractWhatsAppChatId());
        console.log('=== End Debug Info ===');
    }
    */

    // Function to create UI elements
    function createUI() {
        // Create toggle button
        const toggleButton = document.createElement('div');
        toggleButton.className = 'saved-messages-toggle';
        toggleButton.dataset.savedMessageUiElement = 'true';
        toggleButton.textContent = '📝';
        toggleButton.title = 'GlitchDraft (Alt+M)';
        document.body.appendChild(toggleButton);

        // Create container
        const container = document.createElement('div');
        container.className = 'saved-messages-container hidden';
        container.dataset.savedMessageUiElement = 'true';

        // Create header
        const header = document.createElement('div');
        header.className = 'saved-messages-header';
        header.textContent = 'GlitchDraft';
        header.innerHTML += '<span class="keyboard-shortcut">Alt+M</span>';
        header.dataset.savedMessageUiElement = 'true';

        // Create chat ID display for debugging
        const chatIdDisplay = document.createElement('div');
        chatIdDisplay.id = 'chatIdDisplay';
        chatIdDisplay.className = 'chat-id-display';
        chatIdDisplay.dataset.savedMessageUiElement = 'true';
        chatIdDisplay.style.fontSize = '9px';
        chatIdDisplay.style.color = 'var(--text-secondary)';
        chatIdDisplay.style.padding = '1px 4px';
        chatIdDisplay.style.marginTop = '1px';
        chatIdDisplay.style.wordBreak = 'break-all';
        chatIdDisplay.textContent = 'Chat ID: Loading...';
        header.appendChild(chatIdDisplay);

        // Create close button
        const closeButton = document.createElement('span');
        closeButton.className = 'saved-messages-close';
        closeButton.textContent = '×';
        closeButton.dataset.savedMessageUiElement = 'true';
        header.appendChild(closeButton);

        // Create menu
        const menu = document.createElement('div');
        menu.className = 'saved-messages-menu';
        menu.dataset.savedMessageUiElement = 'true';

        const exportButton = document.createElement('button');
        exportButton.textContent = 'Export All';
        exportButton.dataset.savedMessageUiElement = 'true';
        exportButton.onclick = exportSavedMessages;

        const importButton = document.createElement('button');
        importButton.textContent = 'Import';
        importButton.dataset.savedMessageUiElement = 'true';
        importButton.onclick = triggerImportDialog;

        // Add sync button
        const syncButton = document.createElement('button');
        syncButton.textContent = 'Sync Now';
        syncButton.dataset.savedMessageUiElement = 'true';
        syncButton.onclick = syncWithCloud;

        // Add theme toggle button
        const themeButton = document.createElement('button');
        themeButton.textContent = '🌙';
        themeButton.title = 'Toggle theme';
        themeButton.dataset.savedMessageUiElement = 'true';
        themeButton.onclick = toggleTheme;

        const debugButton = document.createElement('button');
        debugButton.textContent = 'Debug';
        debugButton.title = 'Find input field selectors';
        debugButton.style.marginLeft = 'auto';
        debugButton.dataset.savedMessageUiElement = 'true';
        debugButton.onclick = debugInputFields;

        const debugToggleButton = document.createElement('button');
        debugToggleButton.textContent = config.debugMode ? '🐞 On' : '🐞 Off';
        debugToggleButton.title = 'Toggle debug mode';
        debugToggleButton.style.marginLeft = '5px';
        debugToggleButton.dataset.savedMessageUiElement = 'true';
        debugToggleButton.onclick = toggleDebugMode;

        menu.appendChild(exportButton);
        menu.appendChild(importButton);
        menu.appendChild(syncButton);
        menu.appendChild(themeButton);
        menu.appendChild(debugToggleButton);

        if (config.debugMode) {
            menu.appendChild(debugButton);
        }

        // Hidden file input for import
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.className = 'file-input-hidden';
        fileInput.dataset.savedMessageUiElement = 'true';
        fileInput.onchange = importSavedMessages;
        document.body.appendChild(fileInput);

        // Create sync status section
        const syncStatusSection = document.createElement('div');
        syncStatusSection.className = 'saved-messages-sync-status';
        syncStatusSection.dataset.savedMessageUiElement = 'true';

        const syncStatusText = document.createElement('div');
        syncStatusText.id = 'syncStatus';
        syncStatusText.className = 'status';
        syncStatusText.dataset.savedMessageUiElement = 'true';

        const syncInfoText = document.createElement('div');
        syncInfoText.id = 'syncInfo';
        syncInfoText.className = 'sync-info';
        syncInfoText.dataset.savedMessageUiElement = 'true';

        syncStatusSection.appendChild(syncStatusText);
        syncStatusSection.appendChild(syncInfoText);

        // Create body
        const body = document.createElement('div');
        body.className = 'saved-messages-body';
        body.dataset.savedMessageUiElement = 'true';

        // Create input area
        const inputArea = document.createElement('div');
        inputArea.className = 'saved-messages-input';
        inputArea.dataset.savedMessageUiElement = 'true';

        const textarea = document.createElement('div');
        textarea.className = 'message-input-div';
        textarea.contentEditable = 'true';
        textarea.setAttribute('role', 'textbox');
        textarea.dataset.placeholder = 'Type message or paste image... (Alt+S to save)';
        textarea.dataset.savedMessageUiElement = 'true';

        const saveButton = document.createElement('button');
        saveButton.textContent = '+';
        saveButton.title = 'Save Message (Alt+S)';
        saveButton.dataset.savedMessageUiElement = 'true';

        inputArea.appendChild(textarea);
        inputArea.appendChild(saveButton);

        // Append all elements
        container.appendChild(header);
        container.appendChild(menu);
        container.appendChild(syncStatusSection);
        container.appendChild(body);
        container.appendChild(inputArea);
        document.body.appendChild(container);

        // Add event listeners
        toggleButton.addEventListener('click', toggleContainer);
        closeButton.addEventListener('click', toggleContainer);
        saveButton.addEventListener('click', saveMessage);

        // Add keyboard shortcut for saving message
        textarea.addEventListener('keydown', (e) => {
            if (e.altKey && e.key === 's') {
                e.preventDefault();
                saveMessage();
            }
        });

        // Add paste event listener to capture GIFs
        textarea.addEventListener('paste', handlePaste);

        // Add drag functionality
        header.addEventListener('mousedown', startDragging);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDragging);

        // Make the toggle button draggable as well
        toggleButton.addEventListener('mousedown', startDraggingToggle);
        document.addEventListener('mousemove', dragToggle);
        document.addEventListener('mouseup', stopDraggingToggle);

        // Load saved positions
        loadPositions();

        // Initialize theme
        initializeTheme();

        return {
            container,
            body,
            textarea,
            toggleButton
        };
    }

    // Create UI elements
    const ui = createUI();

    // Add ResizeObserver to track container size changes
    let resizeTimeout;
    let dragSaveTimeout; // Debounce position saves to avoid race conditions
    let isApplyingRemoteResize = false; // Prevent sync loop
    let localPositionDirty = false;    // Suppress remote position sync after local drag/resize
    let localPositionDirtyTimeout = null;
    // Shared hash for local position-change detection in this content script.
    let lastKnownPositionsHash = '';
    let lastSavedWidth = 0;
    let lastSavedHeight = 0;
    
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            if (entry.target === ui.container && !isApplyingRemoteResize) {
                // Only save if container is visible and size actually changed significantly
                const isVisible = !ui.container.classList.contains('hidden') && 
                                  getComputedStyle(ui.container).display !== 'none';
                const rect = ui.container.getBoundingClientRect();
                const currentWidth = Math.round(rect.width);
                const currentHeight = Math.round(rect.height);
                
                // Add threshold: only save if changed by at least 10px
                const widthDiff = Math.abs(currentWidth - lastSavedWidth);
                const heightDiff = Math.abs(currentHeight - lastSavedHeight);
                
                if (!isVisible || (widthDiff < 10 && heightDiff < 10)) {
                    return;
                }
                
                // Debounce resize events to avoid too many saves
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    const currentSite = window.location.hostname;
                    const positionKey = `uiPositions_${currentSite}`;
                    const localCacheKey = `glitchdraft_pos_${currentSite}`;
                    
                    // Block remote sync from overwriting while we save
                    localPositionDirty = true;
                    clearTimeout(localPositionDirtyTimeout);
                    
                    // Snapshot position NOW (before any async)
                    const containerRect = ui.container.getBoundingClientRect();
                    const newContainerPos = positionToEdgeAnchored(
                        containerRect.left,
                        containerRect.top,
                        currentWidth,
                        currentHeight
                    );

                    // Write to local cache IMMEDIATELY so a refresh always has the latest size/position
                    lastSavedWidth = currentWidth;
                    lastSavedHeight = currentHeight;
                    chrome.storage.local.get(localCacheKey, (cached) => {
                        const existing = cached[localCacheKey] || {};
                        existing.container = newContainerPos;
                        chrome.storage.local.set({ [localCacheKey]: existing });
                        lastKnownPositionsHash = JSON.stringify(existing);
                    });
                    
                    // Get current settings from Firestore
                    chrome.runtime.sendMessage({ action: 'getSettings' }, (settingsResponse) => {
                        if (!settingsResponse || !settingsResponse.success) {
                            showNotification(
                                'Position load failed',
                                settingsResponse?.message || 'getSettings failed',
                                'error'
                            );
                            localPositionDirty = false;
                            return;
                        }
                        
                        const uiPositions = settingsResponse.settings.uiPositions || {};
                        uiPositions[positionKey] = uiPositions[positionKey] || {};
                        uiPositions[positionKey].container = newContainerPos;

                        // Update local cache (may already be up to date from the immediate write above)
                        chrome.storage.local.set({ [localCacheKey]: uiPositions[positionKey] });
                        lastKnownPositionsHash = JSON.stringify(uiPositions[positionKey]);
                        
                        // Save to Firestore
                        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { uiPositions } }, (response) => {
                            if (response && response.success) {
                                showNotification('Window size saved!', '', 'success');
                            } else {
                                showNotification(
                                    'Window size save failed',
                                    response?.message || 'saveSettings failed',
                                    'error'
                                );
                            }
                            // Allow remote sync again after 3s grace period
                            localPositionDirtyTimeout = setTimeout(() => { localPositionDirty = false; }, 3000);
                        });
                    });
                }, 500); // Wait 500ms after resize stops
            }
        }
    });
    
    resizeObserver.observe(ui.container);

    // Register global keyboard shortcut (Alt+M)
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'm') {
            e.preventDefault();
            toggleContainer();
        }
    });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleUI') {
            toggleContainer();
            sendResponse({ success: true });
        } else if (request.action === 'resetPosition') {
            // Randomize toggle button position
            const randomLeft = Math.random() * (window.innerWidth - 60);
            const randomTop = Math.random() * (window.innerHeight - 60);
            ui.toggleButton.style.left = randomLeft + 'px';
            ui.toggleButton.style.top = randomTop + 'px';
            ui.toggleButton.style.right = 'auto';
            ui.toggleButton.style.bottom = 'auto';
            
            // Randomize container position
            const containerWidth = ui.container.offsetWidth || 300;
            const containerHeight = ui.container.offsetHeight || 400;
            const containerLeft = Math.random() * (window.innerWidth - containerWidth);
            const containerTop = Math.random() * (window.innerHeight - containerHeight);
            ui.container.style.left = containerLeft + 'px';
            ui.container.style.top = containerTop + 'px';
            ui.container.style.right = 'auto';
            ui.container.style.bottom = 'auto';
            
            showNotification('UI position randomized!', '', 'success');
            sendResponse({ success: true });
        } else if (request.action === 'remoteUpdate') {
            // Handle remote update notification
            console.log('Remote update detected, refreshing data...');
            // Show notification
            showNotification('Remote changes detected', 'Your saved messages have been updated from another device.', 'info');
            // Reload saved messages
            loadSavedMessages();
            // Update sync info
            updateSyncInfo();
            // Send response if needed
            if (sendResponse) sendResponse({ success: true });
        }
        return true;
    });

    // Register in Tampermonkey menu
    // GM_registerMenuCommand("Toggle Saved Messages", toggleContainer); // TODO: Replace with chrome.storage
    // GM_registerMenuCommand("Export All Saved Messages", exportSavedMessages); // TODO: Replace with chrome.storage
    // GM_registerMenuCommand("Toggle Debug Mode", toggleDebugMode); // TODO: Replace with chrome.storage
    if (config.debugMode) {
        // GM_registerMenuCommand("Debug Input Fields", debugInputFields); // TODO: Replace with chrome.storage
    }

    // Check sync status when UI is opened
    function checkSyncStatus() {
        try {
            chrome.runtime.sendMessage({ action: 'getSyncStatus' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Failed to check sync status:', chrome.runtime.lastError);
                    return;
                }

                if (response && response.success) {
                    updateSyncInfo(response);
                }
            });
        } catch (error) {
            console.error('Failed to check sync status:', error);
        }
    }

    // Update sync information display
    function updateSyncInfo(statusData = null) {
        const syncStatusText = document.getElementById('syncStatus');
        const syncInfoText = document.getElementById('syncInfo');
        const syncStatusSection = document.querySelector('.saved-messages-sync-status');

        if (!syncStatusText || !syncInfoText || !syncStatusSection) return;

        if (!statusData) {
            // Get status from background
            chrome.runtime.sendMessage({ action: 'getSyncStatus' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Failed to get sync status:', chrome.runtime.lastError);
                    return;
                }

                if (response && response.success) {
                    updateSyncInfo(response);
                }
            });
            return;
        }

        // Clear any existing auth button
        const existingAuthButton = syncStatusSection.querySelector('.auth-button');
        if (existingAuthButton) {
            existingAuthButton.remove();
        }

        // Clear any existing progress bar
        const existingProgressBar = syncStatusSection.querySelector('.sync-progress-container');
        if (existingProgressBar) {
            existingProgressBar.remove();
        }

        // Update authentication status
        if (statusData.authenticated) {
            const providerLabel = statusData.provider === 'neon'
                ? 'Neon'
                : (statusData.provider === 'firebase' ? 'Firestore' : 'Backend');
            syncStatusText.textContent = `Connected to ${providerLabel}`;
            syncStatusText.className = 'status success';
        } else {
            syncStatusText.textContent = 'Not configured';
            syncStatusText.className = 'status warning';

            // Add config instruction if not configured
            const configNote = document.createElement('div');
            configNote.className = 'config-note';
            configNote.textContent = 'Configure backend in extension popup';
            configNote.dataset.savedMessageUiElement = 'true';
            syncStatusSection.appendChild(configNote);
        }

        // Update sync info
        let infoText = '';

        if (statusData.lastSyncTime) {
            const lastSync = new Date(statusData.lastSyncTime);
            const timeAgo = getTimeAgo(lastSync);
            infoText = `Last sync: ${timeAgo}`;
        } else {
            infoText = 'No sync history';
        }

        if (statusData.syncInProgress) {
            infoText += ' (Sync in progress...)';

            // Add progress bar for sync in progress
            const progressContainer = document.createElement('div');
            progressContainer.className = 'sync-progress-container';
            progressContainer.dataset.savedMessageUiElement = 'true';

            const progressBar = document.createElement('div');
            progressBar.className = 'sync-progress-bar';
            progressBar.dataset.savedMessageUiElement = 'true';

            // Animate the progress bar
            let progress = 0;
            let checkCount = 0;
            const maxChecks = 100; // Maximum 30 seconds (100 * 300ms)
            
            const progressInterval = setInterval(() => {
                checkCount++;
                
                // Slow down as we approach 90% to simulate waiting for server
                if (progress < 90) {
                    progress += (90 - progress) / 10;
                }
                progressBar.style.width = `${progress}%`;

                // Check if sync is still in progress
                chrome.runtime.sendMessage({ action: 'getSyncStatus' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[CONTENT] Error checking sync status:', chrome.runtime.lastError);
                        // On error, assume sync completed
                        clearInterval(progressInterval);
                        if (progressContainer.parentNode) {
                            progressContainer.parentNode.removeChild(progressContainer);
                        }
                        updateSyncInfo();
                        return;
                    }
                    
                    if (response && response.success && !response.syncInProgress) {
                        // Sync completed, fill the bar and remove it
                        console.log('[CONTENT] Sync completed, removing progress bar');
                        clearInterval(progressInterval);
                        progressBar.style.width = '100%';
                        setTimeout(() => {
                            if (progressContainer.parentNode) {
                                progressContainer.parentNode.removeChild(progressContainer);
                            }
                            updateSyncInfo(response);
                        }, 500);
                    } else if (checkCount >= maxChecks) {
                        // Timeout - assume sync completed or failed
                        console.log('[CONTENT] Progress check timeout, removing progress bar');
                        clearInterval(progressInterval);
                        if (progressContainer.parentNode) {
                            progressContainer.parentNode.removeChild(progressContainer);
                        }
                        updateSyncInfo();
                    }
                });
            }, 300);

            progressContainer.appendChild(progressBar);
            syncStatusSection.appendChild(progressContainer);
        }

        syncInfoText.textContent = infoText;
    }

    // Helper function to get time ago
    function getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minutes ago`;
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays < 7) return `${diffDays} days ago`;
        return date.toLocaleDateString();
    }

    // Function to authenticate with Google
    async function authenticateWithGoogle() {
        const syncStatusText = document.getElementById('syncStatus');
        const authButton = document.querySelector('.auth-button');

        if (syncStatusText) {
            syncStatusText.textContent = 'Signing in...';
            syncStatusText.className = 'status';
        }

        if (authButton) {
            authButton.disabled = true;
            authButton.textContent = 'Signing in...';
        }

        try {
            // Check current status first
            const statusResponse = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'getSyncStatus' }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (statusResponse && statusResponse.success && statusResponse.authenticated) {
                if (syncStatusText) {
                    syncStatusText.textContent = 'Already authenticated!';
                    syncStatusText.className = 'status success';
                }
                updateSyncInfo(statusResponse);
                return;
            }

            // Trigger authentication by requesting a sync
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'sync' }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                if (syncStatusText) {
                    syncStatusText.textContent = 'Authentication successful!';
                    syncStatusText.className = 'status success';
                }
                updateSyncInfo();
            } else {
                if (syncStatusText) {
                    syncStatusText.textContent = response ? response.message : 'Authentication failed. Please try again.';
                    syncStatusText.className = 'status error';
                }
            }
        } catch (error) {
            if (syncStatusText) {
                syncStatusText.textContent = 'Authentication failed: ' + error.message;
                syncStatusText.className = 'status error';
            }
            console.error('Error authenticating with Google:', error);
        } finally {
            if (authButton) {
                authButton.disabled = false;
                authButton.textContent = 'Sign in with Google';
            }
        }
    }

    // Function to sync with cloud
    async function syncWithCloud() {
        console.log('DEBUG: syncWithCloud() called');
        const syncStatusText = document.getElementById('syncStatus');
        if (syncStatusText) {
            syncStatusText.textContent = 'Starting sync...';
            syncStatusText.className = 'status';
        }

        // Update sync info to show progress bar
        const statusData = {
            authenticated: true,  // Assume authenticated since we're syncing
            syncInProgress: true,
            lastSyncTime: Date.now()
        };
        updateSyncInfo(statusData);

        try {
            console.log('DEBUG: Sending sync message to background script');
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'sync' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.log('DEBUG: Chrome runtime error:', chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        console.log('DEBUG: Received response from background:', response);
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                if (syncStatusText) {
                    syncStatusText.textContent = response.message || 'Synced successfully!';
                    syncStatusText.className = 'status success';
                }
                // Refresh the messages list
                loadSavedMessages();
                // Update sync info
                updateSyncInfo();
            } else {
                if (syncStatusText) {
                    syncStatusText.textContent = response ? response.message : 'Sync failed. Please try again.';
                    syncStatusText.className = 'status error';
                }
                // Update sync info to remove progress bar
                updateSyncInfo();
            }
        } catch (error) {
            if (syncStatusText) {
                syncStatusText.textContent = 'Sync failed: ' + error.message;
                syncStatusText.className = 'status error';
            }
            console.error('Error syncing with cloud:', error);
            // Update sync info to remove progress bar
            updateSyncInfo();
        }
    }

    // Load saved messages when URL changes
    function checkUrlChange() {
        const chatId = getCurrentChatId();
        if (chatId && chatId !== currentChatUrl) {
            currentChatUrl = chatId;
            updateChatIdDisplay();
            loadSavedMessages();
        }
    }

    // Function to toggle container visibility
    function toggleContainer() {
        isContainerVisible = !isContainerVisible;
        if (isContainerVisible) {
            // Suppress ResizeObserver during show (container going from hidden→visible triggers resize)
            isApplyingRemoteResize = true;
            ui.container.classList.remove('hidden');
            setTimeout(() => { isApplyingRemoteResize = false; }, 400); // Wait for CSS transition
            updateChatIdDisplay();
            loadSavedMessages();
            // Check sync status when panel is opened
            checkSyncStatus();
            // Focus the textarea when panel is opened
            setTimeout(() => ui.textarea.focus(), 100);
        } else {
            ui.container.classList.add('hidden');
        }
    }

    // Format timestamp
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();

        // If today, show time only
        if (date.toDateString() === now.toDateString()) {
            return 'Today at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // If yesterday
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Otherwise show full date
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Functions for drag functionality
    function startDragging(e) {
        isDragging = true;
        hasMoved = false;
        dragStartPos.x = e.clientX;
        dragStartPos.y = e.clientY;
        const containerRect = ui.container.getBoundingClientRect();
        dragOffset.x = e.clientX - containerRect.left;
        dragOffset.y = e.clientY - containerRect.top;
    }

    function drag(e) {
        if (isDragging) {
            // Check if moved beyond threshold
            const deltaX = Math.abs(e.clientX - dragStartPos.x);
            const deltaY = Math.abs(e.clientY - dragStartPos.y);
            
            if (!hasMoved && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
                hasMoved = true;
                ui.container.style.cursor = 'grabbing';
            }
            
            // Only move if threshold exceeded
            if (hasMoved) {
                ui.container.style.left = (e.clientX - dragOffset.x) + 'px';
                ui.container.style.top = (e.clientY - dragOffset.y) + 'px';
                ui.container.style.right = 'auto';
                ui.container.style.bottom = 'auto';
            }
        }
    }

    function stopDragging() {
        if (isDragging) {
            isDragging = false;
            ui.container.style.cursor = 'default';
            
            // Only save position if actually moved
            if (hasMoved) {
                const currentSite = window.location.hostname;
                const positionKey = `uiPositions_${currentSite}`;
                const localCacheKey = `glitchdraft_pos_${currentSite}`;
                
                // Block remote sync from overwriting while we save
                localPositionDirty = true;
                clearTimeout(localPositionDirtyTimeout);
                clearTimeout(dragSaveTimeout);

                // Snapshot position NOW (before any async)
                // Store edge-anchored distances so position is reproduced accurately on any screen size
                const containerRect = ui.container.getBoundingClientRect();
                const newContainerPos = positionToEdgeAnchored(
                    containerRect.left,
                    containerRect.top,
                    ui.container.offsetWidth,
                    ui.container.offsetHeight
                );

                // Write to local cache IMMEDIATELY so a refresh always has the latest position
                chrome.storage.local.get(localCacheKey, (cached) => {
                    const existing = cached[localCacheKey] || {};
                    existing.container = newContainerPos;
                    chrome.storage.local.set({ [localCacheKey]: existing });
                    lastKnownPositionsHash = JSON.stringify(existing);
                });

                // Debounce: wait 300ms so rapid drags only fire one save
                dragSaveTimeout = setTimeout(() => {
                    // Get current settings from Firestore
                    chrome.runtime.sendMessage({ action: 'getSettings' }, (settingsResponse) => {
                        if (!settingsResponse || !settingsResponse.success) {
                            showNotification(
                                'Position load failed',
                                settingsResponse?.message || 'getSettings failed',
                                'error'
                            );
                            localPositionDirty = false;
                            return;
                        }
                        
                        const uiPositions = settingsResponse.settings.uiPositions || {};
                        uiPositions[positionKey] = uiPositions[positionKey] || {};
                        uiPositions[positionKey].container = newContainerPos;

                        // Update local cache (may already be up to date from the immediate write above)
                        chrome.storage.local.set({ [localCacheKey]: uiPositions[positionKey] });
                        lastKnownPositionsHash = JSON.stringify(uiPositions[positionKey]);
                        
                        // Save to Firestore
                        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { uiPositions } }, (response) => {
                            if (response && response.success) {
                                showNotification('Position & size saved!', '', 'success');
                            } else {
                                showNotification(
                                    'Position save failed',
                                    response?.message || 'saveSettings failed',
                                    'error'
                                );
                            }
                            // Allow remote sync again after 3s grace period
                            localPositionDirtyTimeout = setTimeout(() => { localPositionDirty = false; }, 3000);
                        });
                    });
                }, 300);
            }
            hasMoved = false;
        }
    }

    // --- Toggle button dragging functions ---
    let isDraggingToggle = false;
    let toggleDragOffset = { x: 0, y: 0 };
    let toggleDragStartPos = { x: 0, y: 0 };
    let toggleHasMoved = false;

    function startDraggingToggle(e) {
        // Prevent event from bubbling up to header drag
        if (e.target === ui.toggleButton) {
            isDraggingToggle = true;
            toggleHasMoved = false;
            toggleDragStartPos.x = e.clientX;
            toggleDragStartPos.y = e.clientY;
            const toggleRect = ui.toggleButton.getBoundingClientRect();
            toggleDragOffset.x = e.clientX - toggleRect.left;
            toggleDragOffset.y = e.clientY - toggleRect.top;
            e.stopPropagation();
        }
    }

    function dragToggle(e) {
        if (isDraggingToggle) {
            // Check if moved beyond threshold
            const deltaX = Math.abs(e.clientX - toggleDragStartPos.x);
            const deltaY = Math.abs(e.clientY - toggleDragStartPos.y);
            
            if (!toggleHasMoved && (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD)) {
                toggleHasMoved = true;
                ui.toggleButton.style.cursor = 'grabbing';
            }
            
            // Only move if threshold exceeded
            if (toggleHasMoved) {
                ui.toggleButton.style.left = (e.clientX - toggleDragOffset.x) + 'px';
                ui.toggleButton.style.top = (e.clientY - toggleDragOffset.y) + 'px';
                ui.toggleButton.style.right = 'auto';
                ui.toggleButton.style.bottom = 'auto';
            }
        }
    }

    function stopDraggingToggle() {
        if (isDraggingToggle) {
            isDraggingToggle = false;
            ui.toggleButton.style.cursor = 'pointer';
            
            // Only save position if actually moved
            if (toggleHasMoved) {
                // Snapshot position NOW (before async)
                // Store edge-anchored distances so position is reproduced accurately on any screen size
                const toggleRect = ui.toggleButton.getBoundingClientRect();
                const currentSite = window.location.hostname;
                const positionKey = `uiPositions_${currentSite}`;
                const localCacheKey = `glitchdraft_pos_${currentSite}`;
                const newTogglePos = positionToEdgeAnchored(
                    toggleRect.left,
                    toggleRect.top,
                    ui.toggleButton.offsetWidth  || 38,
                    ui.toggleButton.offsetHeight || 38
                );
                
                // Block remote sync from overwriting while we save
                localPositionDirty = true;
                clearTimeout(localPositionDirtyTimeout);
                clearTimeout(dragSaveTimeout);

                // Write to local cache IMMEDIATELY so a refresh always has the latest position
                chrome.storage.local.get(localCacheKey, (cached) => {
                    const existing = cached[localCacheKey] || {};
                    existing.toggle = newTogglePos;
                    chrome.storage.local.set({ [localCacheKey]: existing });
                    lastKnownPositionsHash = JSON.stringify(existing);
                });

                // Debounce: wait 300ms so rapid drags only fire one save
                dragSaveTimeout = setTimeout(() => {
                    // Get current settings
                    chrome.runtime.sendMessage({ action: 'getSettings' }, (settingsResponse) => {
                        if (!settingsResponse || !settingsResponse.success) {
                            showNotification(
                                'Position load failed',
                                settingsResponse?.message || 'getSettings failed',
                                'error'
                            );
                            localPositionDirty = false;
                            return;
                        }
                        
                        const uiPositions = settingsResponse.settings.uiPositions || {};
                        uiPositions[positionKey] = uiPositions[positionKey] || {};
                        uiPositions[positionKey].toggle = newTogglePos;

                        // Update local cache (may already be up to date from the immediate write above)
                        chrome.storage.local.set({ [localCacheKey]: uiPositions[positionKey] });
                        lastKnownPositionsHash = JSON.stringify(uiPositions[positionKey]);
                        
                        // Save to Firestore
                        chrome.runtime.sendMessage({ action: 'saveSettings', settings: { uiPositions } }, (response) => {
                            if (response && response.success) {
                                showNotification('Button position saved!', '', 'success');
                            } else {
                                showNotification(
                                    'Button position save failed',
                                    response?.message || 'saveSettings failed',
                                    'error'
                                );
                            }
                            // Allow remote sync again after 3s grace period
                            localPositionDirtyTimeout = setTimeout(() => { localPositionDirty = false; }, 3000);
                        });
                    });
                }, 300);
            }
            toggleHasMoved = false;
        }
    }

    // Convert a bounding rect position to an edge-anchored position object.
    // We measure distance from the NEAREST horizontal edge (left vs right) and
    // NEAREST vertical edge (top vs bottom).  This way the widget "sticks" to
    // the same corner on every device, regardless of screen size.
    function positionToEdgeAnchored(left, top, elementWidth, elementHeight) {
        const distFromRight  = window.innerWidth  - left - elementWidth;
        const distFromBottom = window.innerHeight - top  - elementHeight;
        const anchorH = distFromRight < left ? 'right' : 'left';
        const anchorV = distFromBottom < top ? 'bottom' : 'top';
        return {
            anchorH,
            anchorV,
            [anchorH]: anchorH === 'right'  ? distFromRight  : left,
            [anchorV]: anchorV === 'bottom' ? distFromBottom : top,
            width:  elementWidth,
            height: elementHeight,
            unit: 'edge'
        };
    }

    // Apply an edge-anchored position to an element, without clamping.
    function applyEdgePosition(el, pos, defaultWidth, defaultHeight) {
        const w = pos.width  || defaultWidth  || el.offsetWidth  || 350;
        const h = pos.height || defaultHeight || el.offsetHeight || 38;

        let left, top;
        if (pos.anchorH === 'right') {
            left = window.innerWidth - w - (pos.right || 0);
        } else {
            left = pos.left || 0;
        }
        if (pos.anchorV === 'bottom') {
            top = window.innerHeight - h - (pos.bottom || 0);
        } else {
            top = pos.top || 0;
        }

        el.style.left   = left + 'px';
        el.style.top    = top  + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
    }

    function applyPositionsToUI(positions) {
        if (!positions) return;
        isApplyingRemoteResize = true;
        if (positions.container) {
            const c = positions.container;
            if (c.unit === 'edge') {
                // New edge-anchored format
                applyEdgePosition(ui.container, c, 350, 500);
                if (c.width) {
                    ui.container.style.width = c.width + 'px';
                    lastSavedWidth = c.width;
                }
                if (c.height) {
                    ui.container.style.height = c.height + 'px';
                    lastSavedHeight = c.height;
                }
            } else {
                // Legacy: percent or raw px — convert and apply without clamping
                const isPercent = c.unit === 'percent';
                const left = isPercent ? c.left * window.innerWidth  : c.left;
                const top  = isPercent ? c.top  * window.innerHeight : c.top;
                ui.container.style.left   = left + 'px';
                ui.container.style.top    = top  + 'px';
                ui.container.style.right  = 'auto';
                ui.container.style.bottom = 'auto';
                if (c.width) {
                    ui.container.style.width = c.width + 'px';
                    lastSavedWidth = c.width;
                }
                if (c.height) {
                    ui.container.style.height = c.height + 'px';
                    lastSavedHeight = c.height;
                }
            }
        }
        if (positions.toggle) {
            const t = positions.toggle;
            if (t.unit === 'edge') {
                applyEdgePosition(ui.toggleButton, t, 38, 38);
            } else {
                const isPercent = t.unit === 'percent';
                const left = isPercent ? t.left * window.innerWidth  : t.left;
                const top  = isPercent ? t.top  * window.innerHeight : t.top;
                ui.toggleButton.style.left   = left + 'px';
                ui.toggleButton.style.top    = top  + 'px';
                ui.toggleButton.style.right  = 'auto';
                ui.toggleButton.style.bottom = 'auto';
            }
        }
        setTimeout(() => { isApplyingRemoteResize = false; }, 100);
    }

    function loadPositions() {
        const currentSite = window.location.hostname;
        const positionKey = `uiPositions_${currentSite}`;
        const localCacheKey = `glitchdraft_pos_${currentSite}`;

        // 1. Apply cached positions instantly (no flash)
        chrome.storage.local.get(localCacheKey, (cached) => {
            const cachedPositions = cached[localCacheKey];
            if (cachedPositions) {
                applyPositionsToUI(cachedPositions);
                lastKnownPositionsHash = JSON.stringify(cachedPositions);
            }

            // 2. Then fetch from Firestore and update if different
            chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
                if (!response || !response.success) return;
                const positions = response.settings.uiPositions?.[positionKey];
                if (!positions) return;

                // Update local cache
                chrome.storage.local.set({ [localCacheKey]: positions });

                // Only re-apply if different from what we already applied
                const remoteHash = JSON.stringify(positions);
                if (remoteHash !== lastKnownPositionsHash) {
                    applyPositionsToUI(positions);
                    lastKnownPositionsHash = remoteHash;
                }
            });
        });
    }

    function showNotification(title, description = '', type = 'info') {
        let notification = document.querySelector('.saved-messages-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.className = 'saved-messages-notification';
            notification.dataset.savedMessageUiElement = 'true';
            document.body.appendChild(notification);
        }

        // Set content (ignore description for compact display)
        notification.textContent = title;

        // Add type class for color
        notification.className = 'saved-messages-notification visible';
        if (type === 'success') {
            notification.style.backgroundColor = '#42b883';
        } else if (type === 'error') {
            notification.style.backgroundColor = '#e74c3c';
        } else {
            notification.style.backgroundColor = '#333';
        }

        // Auto-hide
        setTimeout(() => {
            notification.classList.remove('visible');
        }, title.toLowerCase().includes('syncing') ? 800 : 2000);
    }

    // Function to save a message
    async function saveMessage() {
        console.log('DEBUG: saveMessage() called');
        const messageInput = ui.textarea;
        const messageHtml = messageInput.innerHTML.trim();

        if (!messageHtml) {
            console.log('DEBUG: saveMessage() - no message content, returning');
            return;
        }

        // Create a temporary div to process the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = messageHtml;

        // Find all images and convert blob sources to data URLs
        const images = Array.from(tempDiv.querySelectorAll('img'));
        const conversionPromises = images.map(async (img) => {
            if (img.src.startsWith('blob:')) {
                try {
                    const response = await fetch(img.src);
                    const blob = await response.blob();
                    const dataUrl = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    img.src = dataUrl;
                } catch (error) {
                    console.error('Error converting blob to data URL:', error);
                    // Optionally remove the image if conversion fails
                    img.remove();
                }
            }
        });

        await Promise.all(conversionPromises);

        const finalHtml = tempDiv.innerHTML;

        const chatId = getCurrentChatId();
        if (!chatId) {
            alert('Cannot save message: No chat detected');
            return;
        }

        // Extract text content and image files for cloud sync
        const textContent = tempDiv.textContent || tempDiv.innerText || '';
        const imageFiles = [];

        // Extract images as files for cloud sync
        const imageElements = tempDiv.querySelectorAll('img');
        for (const img of imageElements) {
            if (img.src.startsWith('data:')) {
                try {
                    const response = await fetch(img.src);
                    const blob = await response.blob();
                    const file = new File([blob], 'image.jpg', { type: blob.type });
                    imageFiles.push(file);
                } catch (error) {
                    console.error('Error converting image to file:', error);
                }
            }
        }

        // Get current messages from Firestore
        chrome.runtime.sendMessage({ action: 'getDraft', chatId: chatId }, (response) => {
            if (!response || !response.success) {
                console.error('Failed to load messages:', response?.message);
                return;
            }
            
            const savedMessages = response.messages || [];
            lazyRenameIfNeeded(response, chatId);

            // Add the new message at the beginning
            savedMessages.unshift({
                html: finalHtml,
                timestamp: Date.now()
            });

            // Save to Firestore
            chrome.runtime.sendMessage({ action: 'saveDraft', chatId: chatId, messages: savedMessages, contactName: getCurrentChatName() }, (saveResponse) => {
                if (saveResponse && saveResponse.success) {
                    console.log('Message saved to Firestore');
                    messageInput.innerHTML = '';
                    loadSavedMessages();
                } else {
                    console.error('Failed to save:', saveResponse?.message);
                }
            });
        });
    }

    // Function to sync draft to Firestore
    async function syncDraftToCloud(textContent, imageFile) {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'uploadDraft',
                    data: {
                        textContent: textContent,
                        imageFile: imageFile
                    }
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                console.log('Draft synced to Firestore successfully');
            } else {
                console.log('Cloud sync failed:', response ? response.message : 'Unknown error');
            }
        } catch (error) {
            console.error('Error syncing to cloud:', error);
        }
    }

    // Function to load saved messages for current chat
    function loadSavedMessages() {
        const chatId = getCurrentChatId();
        if (!chatId) {
            ui.body.innerHTML = '<p>Open a chat to see saved messages</p>';
            return;
        }

        chrome.runtime.sendMessage({ action: 'getDraft', chatId: chatId }, (response) => {
            if (!response || !response.success) {
                const msg = response?.message || 'Error loading messages';
                const escaped = String(msg).replace(/</g, "&lt;").replace(/>/g, "&gt;");
                ui.body.innerHTML = `
                    <div style="color:#b71c1c; font-size:12px; line-height:1.4;">
                        <div><strong>Load failed</strong></div>
                        <div style="margin-top:6px; white-space:pre-wrap;">${escaped}</div>
                        <div style="margin-top:8px; color:#555;">
                            Troubleshoot:
                            <br>1) Ensure backend is running (try /api/health)
                            <br>2) Neon config JSON uses apiBaseUrl + apiKey
                            <br>3) Reload extension after settings/manifest changes
                        </div>
                    </div>`;
                return;
            }
            
            const savedMessages = response.messages || [];

            // Lazy rename: if the doc was found under a legacy/no-slug ID, rename it to the correct chatId
            lazyRenameIfNeeded(response, chatId);

            // Lazy back-fill: patch missing or noisy contactName values with the current clean display name.
            if (response.exists && !response.needsRename) {
                const detectedName = getCurrentChatName();
                const storedName = chatId.startsWith('messenger_')
                    ? cleanMessengerDisplayName(response.contactName)
                    : cleanDisplayName(response.contactName);
                if (detectedName && storedName !== detectedName) {
                    chrome.runtime.sendMessage({
                        action: 'saveDraft',
                        chatId: chatId,
                        messages: savedMessages,
                        contactName: detectedName
                    });
                }
            }

            if (savedMessages.length === 0) {
                ui.body.innerHTML = '<p>No saved messages for this chat</p>';
                return;
            }

            ui.body.innerHTML = '';

            // Sort messages by timestamp (newest first)
            savedMessages.sort((a, b) => b.timestamp - a.timestamp);

            // Render all messages
            savedMessages.forEach((message, index) => {
                const messageElement = document.createElement('div');
                messageElement.className = 'saved-messages-item';
                messageElement.dataset.savedMessageUiElement = 'true';

                const messageText = document.createElement('div');
                messageText.innerHTML = message.html;
                messageText.dataset.savedMessageUiElement = 'true';

                const timestampDiv = document.createElement('div');
                timestampDiv.className = 'saved-messages-timestamp';
                timestampDiv.textContent = formatTimestamp(message.timestamp);
                timestampDiv.dataset.savedMessageUiElement = 'true';

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'saved-messages-actions';
                actionsDiv.dataset.savedMessageUiElement = 'true';

                const useButton = document.createElement('button');
                useButton.className = 'saved-message-use';
                useButton.textContent = 'Use';
                useButton.dataset.savedMessageUiElement = 'true';
                useButton.onclick = () => useMessage(message.html);

                const copyButton = document.createElement('button');
                copyButton.className = 'saved-message-copy';
                copyButton.textContent = 'Copy';
                copyButton.style.backgroundColor = '#4CAF50';
                copyButton.style.color = 'white';
                copyButton.title = 'Copy to clipboard';
                copyButton.dataset.savedMessageUiElement = 'true';
                copyButton.onclick = () => copyToClipboard(message.html, 'Message copied to clipboard! You can now paste it.');

                const editButton = document.createElement('button');
                editButton.className = 'saved-message-edit';
                editButton.textContent = 'Edit';
                editButton.style.backgroundColor = '#2196F3';
                editButton.style.color = 'white';
                editButton.title = 'Edit message';
                editButton.dataset.savedMessageUiElement = 'true';
                editButton.onclick = () => editMessage(message.timestamp, message.html, messageElement);

                const deleteButton = document.createElement('button');
                deleteButton.className = 'saved-message-delete';
                deleteButton.textContent = 'Delete';
                deleteButton.dataset.savedMessageUiElement = 'true';
                deleteButton.onclick = () => deleteMessage(message.timestamp);

                actionsDiv.appendChild(useButton);
                actionsDiv.appendChild(copyButton);
                actionsDiv.appendChild(editButton);
                actionsDiv.appendChild(deleteButton);

                messageElement.appendChild(messageText);
                messageElement.appendChild(timestampDiv);
                messageElement.appendChild(actionsDiv);

                ui.body.appendChild(messageElement);
            });
        });
    }

    async function copyImageNatively(imageUrl, callback) {
        try {
            // The ClipboardItem API is the modern and correct way to do this.
            // It should be available in an extension context with clipboardWrite permission.
            if (typeof ClipboardItem === 'undefined') {
                throw new Error('ClipboardItem API is not available in this context. Cannot copy image.');
            }

            // We must fetch the data URL to convert it into a blob.
            const response = await fetch(imageUrl);
            const blob = await response.blob();

            // Create a clipboard item with the blob.
            await navigator.clipboard.write([
                new ClipboardItem({
                    [blob.type]: blob
                })
            ]);

            showNotification('Image copied to clipboard! Press Ctrl+V to paste.');
            callback(true);

        } catch (error) {
            console.error('Failed to copy image using ClipboardItem API:', error);
            // If this fails, there's no better fallback for native image copy.
            callback(false);
        }
    }

    // Add this function to simulate file drop for GIFs
    function simulateFileDrop(file, targetElement) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        ['dragenter', 'dragover', 'drop'].forEach(eventType => {
            const event = new DragEvent(eventType, {
                bubbles: true,
                cancelable: true,
                dataTransfer
            });
            targetElement.dispatchEvent(event);
        });
    }

    // Function to use a saved message with retry mechanism
    function useMessage(html) {
        // Create a temporary div to manipulate the content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Find all links and ensure they're properly preserved
        const links = tempDiv.querySelectorAll('a');
        links.forEach(link => {
            // Replace the link element with its href as plain text
            const href = link.href;
            const textNode = document.createTextNode(href);
            link.parentNode.replaceChild(textNode, link);
        });

        // Find all images
        const images = Array.from(tempDiv.querySelectorAll('img'));

        // Get the HTML of the first image for the clipboard
        const firstImageSrc = images.length > 0 ? images[0].src : null;

        // Remove images from the div to get the text-only HTML
        images.forEach(img => img.remove());
        const htmlToInsert = tempDiv.innerHTML.trim();

        // Blur our own textarea and hide the panel
        if (document.activeElement === ui.textarea) {
            ui.textarea.blur();
        }
        toggleContainer();

        setTimeout(() => {
            // If there's text, insert it.
            if (htmlToInsert) {
                const attemptInsert = (remainingTries = 3) => {
                    const result = insertMessageIntoInputField(htmlToInsert);
                    if (!result && remainingTries > 0) {
                        setTimeout(() => attemptInsert(remainingTries - 1), 300);
                    }
                };
                attemptInsert();
            }

            // If there was an image, use the simulateFileDrop method
            if (firstImageSrc) {
                (async () => {
                    try {
                        // Fetch the image data
                        const response = await fetch(firstImageSrc);
                        const blob = await response.blob();

                        // Create a File object with the appropriate MIME type
                        const mimeType = blob.type || 'image/png'; // Default to PNG if type is not available
                        const fileName = mimeType.includes('gif') ? "saved.gif" : "saved.png";
                        const file = new File([blob], fileName, { type: mimeType });

                        // Find the messenger input field
                        const inputField = findMessengerInputField();
                        if (inputField) {
                            // Simulate file drop for better image handling
                            simulateFileDrop(file, inputField);
                        } else {
                            showNotification('Could not find message field to add image');

                            // Fallback to copying to clipboard
                            try {
                                await navigator.clipboard.write([
                                    new ClipboardItem({
                                        [mimeType]: blob
                                    })
                                ]);
                                showNotification('Image copied to clipboard! Press Ctrl+V to paste.');
                            } catch (clipboardError) {
                                console.error('Failed to copy image to clipboard:', clipboardError);
                                const imageHtml = `<img src="${firstImageSrc}">`;
                                copyToClipboard(imageHtml, 'Failed to add image directly. Copied as HTML instead.');
                            }
                        }
                    } catch (error) {
                        console.error('Error using image:', error);
                        showNotification('Error adding image. Try copying it manually.');
                    }
                })();
            }
        }, 50);
    }

    function findMessengerInputField() {
        // This is the list of selectors used to find the input box.
        // It's duplicated from insertMessageIntoInputField for now.
        const possibleSelectors = [
            'div[aria-label="Message"][contenteditable="true"][data-lexical-editor="true"]',
            '.xzsf02u.notranslate[contenteditable="true"][role="textbox"]',
            '.notranslate[contenteditable="true"][data-lexical-editor="true"]',
            '[aria-label="Message"][contenteditable="true"]',
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][data-lexical-editor="true"]',
            '.xzsf02u[role="textbox"]',
            '[aria-label="Message"]',
            '[placeholder="Aa"]',
            '.notranslate[contenteditable="true"]',
            'div[role="textbox"][spellcheck="true"]',
            'form [contenteditable="true"]',
            '[contenteditable="true"]'
        ];

        for (const selector of possibleSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                if (elements.length > 1) {
                    let maxBottom = 0;
                    let bestElement = null;
                    for (const el of elements) {
                        if (isOurUIElement(el)) continue;
                        const rect = el.getBoundingClientRect();
                        if (rect.bottom > maxBottom && rect.width > 50) {
                            maxBottom = rect.bottom;
                            bestElement = el;
                        }
                    }
                    if (bestElement) return bestElement;
                } else if (!isOurUIElement(elements[0])) {
                    return elements[0];
                }
            }
        }
        return null;
    }

    // Helper function to check if element belongs to our UI
    function isOurUIElement(element) {
        if (!element) return false;

        // Check if the element itself has our marker
        if (element.dataset && element.dataset.savedMessageUiElement === 'true') {
            return true;
        }

        // Check if it's within our UI container
        if (ui.container && ui.container.contains(element)) {
            return true;
        }

        // Check if it's our toggle button
        if (ui.toggleButton && ui.toggleButton.contains(element)) {
            return true;
        }

        // Check if it's part of the file input
        if (fileInput && fileInput.contains(element)) {
            return true;
        }

        return false;
    }

    // Helper function to actually insert the message
    function insertMessageIntoInputField(html) {
        // Find the message input field - try multiple possible selectors
        let inputField = null;
        let matchedSelector = '';

        // Try different selectors that might match the Messenger input field
        const possibleSelectors = [
            // Add the exact selector from the user's console output first (highest priority)
            'div[aria-label="Message"][contenteditable="true"][data-lexical-editor="true"]',
            '.xzsf02u.notranslate[contenteditable="true"][role="textbox"]',
            '.notranslate[contenteditable="true"][data-lexical-editor="true"]',
            '[aria-label="Message"][contenteditable="true"]',
            // Previous selectors as fallback
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][data-lexical-editor="true"]',
            '.xzsf02u[role="textbox"]',
            '[aria-label="Message"]',
            '[placeholder="Aa"]',
            '.notranslate[contenteditable="true"]',
            'div[role="textbox"][spellcheck="true"]',
            // Try to find the bottom-most contenteditable element (likely to be the input)
            'form [contenteditable="true"]',
            '[contenteditable="true"]'
        ];

        // First try direct match with the console output
        const specificSelector = 'div.xzsf02u.x1a2a7pz.x1n2onr6.x14wi4xw.x1iyjqo2.x1gh3ibb.xisnujt.xeuugli.x1odjw0f.notranslate[contenteditable="true"][role="textbox"][spellcheck="true"][data-lexical-editor="true"]';
        const specificElement = document.querySelector(specificSelector);

        if (specificElement && !isOurUIElement(specificElement)) {
            inputField = specificElement;
            matchedSelector = specificSelector;
        } else {
            // Try the other selectors if specific one failed
            for (const selector of possibleSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    // If multiple elements match, prefer the one closer to the bottom of the page
                    // and ensure it's not part of our own UI
                    if (elements.length > 1) {
                        let maxBottom = 0;
                        for (const el of elements) {
                            if (isOurUIElement(el)) continue; // Skip our own UI elements

                            const rect = el.getBoundingClientRect();
                            if (rect.bottom > maxBottom && rect.width > 50) { // Ensure it's not a tiny element
                                maxBottom = rect.bottom;
                                inputField = el;
                            }
                        }
                    } else if (!isOurUIElement(elements[0])) {
                        inputField = elements[0];
                    }

                    if (inputField) {
                        matchedSelector = selector;
                        break;
                    }
                }
            }
        }

        if (config.debugMode) {
            console.log('Input field search results:', {
                found: !!inputField,
                matchedSelector,
                element: inputField,
                isOurElement: inputField ? isOurUIElement(inputField) : false
            });
        }

        if (inputField && !isOurUIElement(inputField)) {
            try {
                // First, focus the element. This is important for many paste handlers.
                inputField.focus();

                // Method 1: The most robust method is simulating a paste event.
                // This should trigger all of Facebook's listeners.
                simulatePaste(inputField, html);

                // Give it a moment to process the event, then check and fallback
                setTimeout(() => {
                    if (!checkTextInserted(inputField, html)) {
                        if (config.debugMode) {
                            console.log('Paste simulation failed, trying direct insertion as fallback.');
                        }
                        // Method 2: Fallback to direct insertion.
                        insertTextDirectly(inputField, html);
                    }

                    // Final check and focus adjustment
                    setTimeout(() => {
                        if (checkTextInserted(inputField, html)) {
                            if (config.debugMode) {
                                console.log('Message insertion successful using selector:', matchedSelector);
                            }
                            positionCursorAtEnd(inputField);

                            // If there's a "send" button visible, we could optionally focus that too
                            const sendButton = document.querySelector('button[aria-label="Send"]');
                            if (sendButton) {
                                setTimeout(() => sendButton.focus(), 50);
                            }
                        } else {
                            if (config.debugMode) {
                                console.log('All insertion methods failed.');
                            }
                        }
                    }, 100);

                }, 50);

                return true; // We attempted insertion.
            } catch (error) {
                console.error('Error inserting message:', error);
                if (config.debugMode) {
                    alert('Error inserting message: ' + error.message);
                }
                return false;
            }
        } else {
            console.error('Could not find suitable message input field (that is not part of our own UI)');
            alert('Could not find message input field. Please make sure you are in a Messenger chat.\n\nIf this error persists, please set debugMode to true in the script and use the Debug button to find working selectors, or use the "Copy" button instead.');
            return false;
        }
    }

    // Position cursor at the end of content
    function positionCursorAtEnd(element) {
        try {
            // Create range at end of content
            const range = document.createRange();
            range.selectNodeContents(element);
            range.collapse(false); // collapse to end

            // Apply the selection
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (e) {
            if (config.debugMode) {
                console.log('Could not position cursor at end:', e);
            }
        }
    }

    // Insert text directly into the element
    function insertTextDirectly(element, html) {
        // Additional safety check to ensure we're not affecting our own UI
        if (isOurUIElement(element)) {
            console.error('Attempted to modify our own UI element');
            return false;
        }

        try {
            // First clear the field
            element.innerHTML = '';

            // Setting innerHTML is the most direct way for HTML content
            element.innerHTML = html;

            // Dispatch events to notify React/Facebook
            ['input', 'change'].forEach(eventType => {
                try {
                    const event = new Event(eventType, { bubbles: true });
                    element.dispatchEvent(event);
                } catch (e) {
                    if (config.debugMode) {
                        console.log(`Failed to dispatch ${eventType} event:`, e);
                    }
                }
            });

            return true;
        } catch (e) {
            console.log('Direct HTML insertion failed:', e);
            return false;
        }
    }

    function simulatePaste(element, html) {
        if (isOurUIElement(element)) {
            console.error('Attempted to paste into our own UI element');
            return false;
        }
        try {
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer()
            });

            // Add both HTML and plain text versions for compatibility
            pasteEvent.clipboardData.setData('text/html', html);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html.replace(/<br\s*\/?>/gi, '\n'); // Convert <br> to newlines for text
            pasteEvent.clipboardData.setData('text/plain', tempDiv.textContent || '');

            element.dispatchEvent(pasteEvent);
            return true;
        } catch (e) {
            if (config.debugMode) {
                console.error('Simulating paste event failed:', e);
            }
            return false;
        }
    }

    // Helper function to check if text was successfully inserted
    function checkTextInserted(element, expectedHtml) {
        if (!element || !expectedHtml) return false;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = expectedHtml;
        const expectedText = tempDiv.textContent.trim();
        const expectedImgCount = tempDiv.querySelectorAll('img').length;

        const actualText = element.textContent.trim();
        const actualImgCount = element.querySelectorAll('img').length;

        // If the target is empty, insertion definitely failed.
        if (!element.innerHTML.trim()) {
            return false;
        }

        // If we expect images, we must have at least that many images.
        if (expectedImgCount > 0 && actualImgCount < expectedImgCount) {
            return false;
        }

        // If we expect text, it must be present.
        if (expectedText && !actualText.includes(expectedText)) {
            return false;
        }

        // If we expect only an image and text is empty, but we have an image, it's a success.
        if (expectedImgCount > 0 && !expectedText) {
            return actualImgCount > 0;
        }

        return true;
    }

    // Function to delete a saved message
    function editMessage(timestamp, currentHtml, messageElement) {
        // Convert the message display to an editable textarea
        const messageText = messageElement.querySelector('div:first-child');
        const actionsDiv = messageElement.querySelector('.saved-messages-actions');
        
        // Create textarea with current content
        const textarea = document.createElement('textarea');
        textarea.style.width = '100%';
        textarea.style.minHeight = '80px';
        textarea.style.padding = '8px';
        textarea.style.border = '1px solid #ccc';
        textarea.style.borderRadius = '4px';
        textarea.style.fontFamily = 'inherit';
        textarea.style.fontSize = 'inherit';
        textarea.style.resize = 'vertical';
        textarea.dataset.savedMessageUiElement = 'true';
        
        // Strip HTML tags for editing (plain text)
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = currentHtml;
        textarea.value = tempDiv.textContent || tempDiv.innerText || '';
        
        // Replace message content with textarea
        messageText.innerHTML = '';
        messageText.appendChild(textarea);
        
        // Change buttons to Save/Cancel
        actionsDiv.innerHTML = '';
        
        const saveButton = document.createElement('button');
        saveButton.className = 'saved-message-use';
        saveButton.textContent = 'Save';
        saveButton.style.backgroundColor = '#4CAF50';
        saveButton.style.color = 'white';
        saveButton.dataset.savedMessageUiElement = 'true';
        saveButton.onclick = () => saveEditedMessage(timestamp, textarea.value);
        
        const cancelButton = document.createElement('button');
        cancelButton.className = 'saved-message-delete';
        cancelButton.textContent = 'Cancel';
        cancelButton.dataset.savedMessageUiElement = 'true';
        cancelButton.onclick = () => loadSavedMessages(); // Reload to cancel
        
        actionsDiv.appendChild(saveButton);
        actionsDiv.appendChild(cancelButton);
        
        textarea.focus();
    }
    
    function saveEditedMessage(timestamp, newContent) {
        const chatId = getCurrentChatId();
        if (!chatId) return;
        
        chrome.runtime.sendMessage({ action: 'getDraft', chatId: chatId }, (response) => {
            if (!response || !response.success) {
                console.error('Failed to load messages for edit');
                return;
            }
            
            const savedMessages = response.messages || [];
            lazyRenameIfNeeded(response, chatId);
            
            // Find and update the message
            const messageIndex = savedMessages.findIndex(msg => msg.timestamp === timestamp);
            if (messageIndex === -1) {
                console.log('Message not found');
                return;
            }
            
            // Update the message with new content (as plain HTML)
            savedMessages[messageIndex].html = newContent.replace(/\n/g, '<br>');
            
            // Save updated list to Firestore
            chrome.runtime.sendMessage({ action: 'saveDraft', chatId: chatId, messages: savedMessages, contactName: getCurrentChatName() }, (saveResponse) => {
                if (saveResponse && saveResponse.success) {
                    console.log('Message updated in Firestore');
                    loadSavedMessages();
                } else {
                    console.error('Failed to update:', saveResponse?.message);
                }
            });
        });
    }

    function deleteMessage(timestamp) {
        console.log('Deleting message with timestamp:', timestamp);
        const chatId = getCurrentChatId();
        if (!chatId) return;

        chrome.runtime.sendMessage({ action: 'getDraft', chatId: chatId }, (response) => {
            if (!response || !response.success) {
                console.error('Failed to load messages for delete');
                return;
            }
            
            const savedMessages = response.messages || [];
            lazyRenameIfNeeded(response, chatId);

            // Find and remove the message
            const messageIndex = savedMessages.findIndex(msg => msg.timestamp === timestamp);
            if (messageIndex === -1) {
                console.log('Message not found');
                return;
            }

            savedMessages.splice(messageIndex, 1);

            // Save updated list to Firestore
            chrome.runtime.sendMessage({ action: 'saveDraft', chatId: chatId, messages: savedMessages, contactName: getCurrentChatName() }, (saveResponse) => {
                if (saveResponse && saveResponse.success) {
                    console.log('Message deleted from Firestore');
                    loadSavedMessages();
                } else {
                    console.error('Failed to delete:', saveResponse?.message);
                }
            });
        });
    }

    // Helper function to send messages to background script
    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    // Function to sync deletion to Firestore
    async function syncDeletionToCloud(jsonFileId, imageFileId) {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'deleteDraft',
                    draftId: jsonFileId,
                    imageFileId: imageFileId
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                console.log('Draft deletion synced to Firestore successfully');
            } else {
                console.log('Cloud deletion failed:', response ? response.message : 'Unknown error');
            }
        } catch (error) {
            console.error('Error syncing deletion to cloud:', error);
        }
    }

    // Function to trigger the import dialog
    function triggerImportDialog() {
        fileInput.click();
    }

    // Import/export — implementation lives in draftImport.js

    function importSavedMessages(event) {
        gdImportSavedMessages(event, ui, isContainerVisible, toggleContainer, loadSavedMessages);
    }

    function showImportSelectionDialog(chatEntries, rawData) {
        gdShowImportSelectionDialog(chatEntries, ui, isContainerVisible, toggleContainer, loadSavedMessages);
    }

    function exportSavedMessages() {
        gdExportSavedMessages();
    }

    function downloadJSON(data, filename) {
        gdDownloadJSON(data, filename);
    }

    // Debug function to find input field selectors
    function debugInputFields() {
        const selectors = [
            '[contenteditable="true"]',
            '[role="textbox"]',
            '[contenteditable="true"][role="textbox"]',
            '[contenteditable="true"][data-lexical-editor="true"]',
            '.xzsf02u',
            '.notranslate',
            '[aria-label="Message"]',
            '[aria-label*="essage"]',
            '[placeholder="Aa"]',
            '.notranslate[contenteditable="true"]',
            'div[role="textbox"]',
            'div[contenteditable="true"]'
        ];

        const results = selectors.map(selector => {
            const elements = document.querySelectorAll(selector);
            return {
                selector,
                count: elements.length,
                elements: Array.from(elements).map(el => ({
                    tagName: el.tagName,
                    classes: el.className,
                    attributes: {
                        role: el.getAttribute('role'),
                        contenteditable: el.getAttribute('contenteditable'),
                        'data-lexical-editor': el.getAttribute('data-lexical-editor'),
                        'aria-label': el.getAttribute('aria-label'),
                        spellcheck: el.getAttribute('spellcheck')
                    },
                    text: el.textContent.substring(0, 20) + (el.textContent.length > 20 ? '...' : ''),
                    rect: el.getBoundingClientRect()
                }))
            };
        });

        // Find closest to bottom of page (likely the input field)
        let maxBottom = 0;
        let bottomElement = null;
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.bottom > maxBottom) {
                maxBottom = rect.bottom;
                bottomElement = el;
            }
        });

        console.log('Potential Input Field Selectors:', results);
        console.log('Likely input field (bottom-most contenteditable):', bottomElement);

        if (bottomElement) {
            console.log('Bottom element classes:', bottomElement.className);
            console.log('Bottom element attributes:', {
                role: bottomElement.getAttribute('role'),
                contenteditable: bottomElement.getAttribute('contenteditable'),
                'data-lexical-editor': bottomElement.getAttribute('data-lexical-editor'),
                'aria-label': bottomElement.getAttribute('aria-label'),
                spellcheck: bottomElement.getAttribute('spellcheck')
            });

            // Create accurate CSS selector for this element
            let accurateSelector = bottomElement.tagName.toLowerCase();
            if (bottomElement.className) {
                accurateSelector += '.' + bottomElement.className.trim().replace(/\s+/g, '.');
            }
            ['role', 'contenteditable', 'data-lexical-editor', 'aria-label', 'spellcheck'].forEach(attr => {
                const value = bottomElement.getAttribute(attr);
                if (value) {
                    accurateSelector += `[${attr}="${value}"]`;
                }
            });

            console.log('Accurate selector for bottom element:', accurateSelector);
            alert('Check your browser console for detailed results. The most likely input field has been identified with selector: ' + accurateSelector);

            // Test with a temp message
            const origContent = bottomElement.innerHTML;
            try {
                bottomElement.innerHTML = '<p>⚠️ Test message - will be removed in 2 seconds ⚠️</p>';
                setTimeout(() => {
                    bottomElement.innerHTML = origContent;
                }, 2000);
            } catch (e) {
                console.error('Error setting test message:', e);
            }
        }

        // Show alert with summary
        const matchingSelectorsList = results
            .filter(r => r.count > 0)
            .map(r => `${r.selector}: ${r.count} element(s)`)
            .join('\n');

        alert(`Potential input field selectors found:\n${matchingSelectorsList}\n\nCheck browser console for details.`);
    }

    // Function to toggle debug mode
    function toggleDebugMode() {
        config.debugMode = !config.debugMode;
        saveConfig();

        // Update UI to reflect debug mode
        const debugToggleButton = document.querySelector('button[title="Toggle debug mode"]');
        if (debugToggleButton) {
            debugToggleButton.textContent = config.debugMode ? '🐞 On' : '🐞 Off';
        }

        // Add or remove debug button based on debug mode
        const menu = document.querySelector('.saved-messages-menu');
        const existingDebugButton = menu.querySelector('button[title="Find input field selectors"]');

        if (config.debugMode && !existingDebugButton) {
            const debugButton = document.createElement('button');
            debugButton.textContent = 'Debug';
            debugButton.title = 'Find input field selectors';
            debugButton.style.marginLeft = 'auto';
            debugButton.onclick = debugInputFields;
            menu.appendChild(debugButton);
        } else if (!config.debugMode && existingDebugButton) {
            existingDebugButton.remove();
        }

        alert(`Debug mode ${config.debugMode ? 'enabled' : 'disabled'}. ${config.debugMode ? 'Additional debug options are now available.' : ''}`);
    }

    // Function to copy text to clipboard
    function copyToClipboard(html, message) {
        // Set a default message if one isn't provided.
        const notificationMessage = message || 'Message copied to clipboard! You can now paste it.';

        function listener(e) {
            e.clipboardData.setData('text/html', html);
            // Also set a plain text fallback
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            e.clipboardData.setData('text/plain', tempDiv.textContent || '');
            e.preventDefault();
        }
        document.addEventListener('copy', listener);
        document.execCommand('copy');
        document.removeEventListener('copy', listener);

        showNotification(notificationMessage);
    }

    // Add this new function to handle paste events
    async function handlePaste(e) {
        // Check if the clipboard contains a GIF
        if (e.clipboardData && e.clipboardData.items) {
            const items = e.clipboardData.items;

            for (let i = 0; i < items.length; i++) {
                // Check for any image type
                if (items[i].type.indexOf('image/') !== -1) {
                    // We found an image, let's handle it
                    e.preventDefault(); // Prevent default paste behavior

                    const blob = items[i].getAsFile();
                    const isGif = items[i].type === 'image/gif';

                    if (isGif) {
                        // For GIFs, use the simulateFileDrop approach for better compatibility
                        const file = new File([blob], "pasted.gif", { type: "image/gif" });

                        // First add to our textarea for saving
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });

                        // Create an img element with the GIF data for our saved messages
                        const imgElement = document.createElement('img');
                        imgElement.src = dataUrl;
                        ui.textarea.appendChild(imgElement);

                        // Position cursor after the image
                        positionCursorAtEnd(ui.textarea);

                        return;
                    } else {
                        // For other images, convert to data URL as before
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });

                        // Create an img element with the image data
                        const imgElement = document.createElement('img');
                        imgElement.src = dataUrl;
                        ui.textarea.appendChild(imgElement);

                        // Position cursor after the image
                        positionCursorAtEnd(ui.textarea);

                        return;
                    }
                }
            }

            // Check for URLs that might be GIFs
            const text = e.clipboardData.getData('text');
            if (text && (text.endsWith('.gif') || text.includes('.gif?'))) {
                e.preventDefault(); // Prevent default paste behavior

                try {
                    // Fetch the GIF
                    const response = await fetch(text);
                    const blob = await response.blob();

                    if (blob.type === 'image/gif') {
                        // Create a File object for the GIF
                        const file = new File([blob], "pasted.gif", { type: "image/gif" });

                        // Convert to data URL for our saved messages
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });

                        // Create an img element with the GIF data
                        const imgElement = document.createElement('img');
                        imgElement.src = dataUrl;
                        ui.textarea.appendChild(imgElement);

                        // Position cursor after the image
                        positionCursorAtEnd(ui.textarea);

                        return;
                    }
                } catch (error) {
                    console.error('Error adding GIF from URL:', error);
                    // Let the default paste behavior happen
                }
            }
        }

        // If no image was found, let the default paste behavior happen
    }

    // Initialize
    function init() {
        // Check for URL changes every second
        setInterval(checkUrlChange, 1000);

        // Initial URL check
        checkUrlChange();

        // Set up MutationObserver to detect dynamically loaded elements
        setupMutationObserver();

        // Initialize WhatsApp observer if on WhatsApp Web
        initWhatsAppObserver();

        // Check authentication status on page load
        checkSyncStatus();
    }

    // Set up MutationObserver to detect when Messenger dynamically adds or removes elements
    function setupMutationObserver() {
        // Options for the observer (which mutations to observe)
        const config = {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        };

        // Create an observer instance linked to the callback function
        const observer = new MutationObserver((mutationsList, observer) => {
            // Check if the input field is now available
            if (document.querySelector('[contenteditable="true"][role="textbox"]')) {
                // Input field detected, no need to do anything special
                return;
            }

            // If URL has changed, check if we're in a new chat
            const chatId = getCurrentChatId();
            if (chatId && chatId !== currentChatUrl) {
                currentChatUrl = chatId;
                loadSavedMessages();
            }
        });

        // Start observing the target node for configured mutations
        observer.observe(document.body, config);
        
        // Start real-time sync polling
        startRealtimeSync();
        // Start real-time position listener (content-script based, no SW limit)
        startPositionListener();
    }
    
    // Real-time sync / position polling — implementations live in draftSync.js

    function startPositionListener() {
        gdStartPositionListener(
            applyPositionsToUI,
            () => isDragging || isDraggingToggle,
            () => localPositionDirty
        );
    }

    function startRealtimeSync() {
        gdStartRealtimeSync(
            getCurrentChatId,
            loadSavedMessages,
            showNotification,
            applyPositionsToUI,
            () => localPositionDirty
        );
    }

    // Theme toggle function
    function toggleTheme() {
        const currentTheme = config.theme || detectSystemTheme();
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        config.manualTheme = true; // Mark as manually set
        applyTheme(newTheme);

        // Update theme button
        const themeButton = document.querySelector('button[title="Toggle theme"]');
        if (themeButton) {
            themeButton.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        }
    }

    // Start after page load
    window.addEventListener('load', init);
    
    // Debug function exposed (commented out for optimization)
    // window.debugWhatsAppGlitchDraft = debugWhatsAppStructure;
})();
