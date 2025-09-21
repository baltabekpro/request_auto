// Background script для обработки уведомлений

// Импортируем простой API конфиг
importScripts('api-config.js');
importScripts('config-manager.js');

class ChatMonitorBackground {
    constructor() {
        this.configManager = new ConfigManager();
        this.notifiedChats = new Set(); // Хранение уже уведомленных чатов
        this.settings = {
            enabled: true,
            notificationInterval: 20, // минуты
            soundEnabled: true
        };
        
        this.init();
    }
    
    async init() {
        // Загружаем настройки из storage
        await this.loadSettings();
        
        // Настраиваем слушатели событий
        this.setupEventListeners();
        
        console.log('Chat Monitor Background Script запущен');
    }
    
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['chatMonitorSettings']);
            if (result.chatMonitorSettings) {
                this.settings = { ...this.settings, ...result.chatMonitorSettings };
            }
        } catch (error) {
            console.error('Ошибка при загрузке настроек:', error);
        }
    }
    
    async saveSettings() {
        try {
            await chrome.storage.sync.set({ chatMonitorSettings: this.settings });
        } catch (error) {
            console.error('Ошибка при сохранении настроек:', error);
        }
    }
    
    setupEventListeners() {
        // Слушатель сообщений от content script
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Для асинхронного ответа
        });
        
        // Слушатель установки расширения
        chrome.runtime.onInstalled.addListener(() => {
            this.onInstalled();
        });
        
        // Слушатель кликов по уведомлениям
        chrome.notifications.onClicked.addListener((notificationId) => {
            this.handleNotificationClick(notificationId);
        });
        
        // Слушатель кнопок в уведомлениях
        chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
            this.handleNotificationButtonClick(notificationId, buttonIndex);
        });
        
        // Слушатель горячих клавиш для исправления текста
        chrome.commands.onCommand.addListener(async (command) => {
            if (command === 'correct-text') {
                await this.handleCorrectTextCommand();
            }
        });
    }
    
    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.type) {
                case 'CHAT_NEEDS_CLOSING':
                    await this.handleChatNeedsClosing(request, sender);
                    sendResponse({ success: true });
                    break;
                    
                case 'GET_SETTINGS':
                    sendResponse({ settings: this.settings });
                    break;
                    
                case 'UPDATE_SETTINGS':
                    this.settings = { ...this.settings, ...request.settings };
                    await this.saveSettings();
                    sendResponse({ success: true });
                    break;
                    
                case 'CLEAR_NOTIFICATIONS':
                    this.notifiedChats.clear();
                    sendResponse({ success: true });
                    break;
                    
                case 'CORRECT_ALL_TEXT':
                    console.log('Background: Получен запрос на исправление текста');
                    const result = await this.correctAllTextInActiveElement(sender.tab.id, request.apiKey);
                    sendResponse(result);
                    break;
                    
                case 'GET_API_KEY':
                    const apiKeys = await this.getApiKeys();
                    sendResponse({ apiKey: apiKeys.length > 0 ? apiKeys[0] : null });
                    break;
                    
                case 'GET_STATISTICS':
                    const stats = await this.getStatistics();
                    sendResponse({ stats });
                    break;
                    
                default:
                    sendResponse({ error: 'Неизвестный тип сообщения' });
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
            sendResponse({ error: error.message });
        }
    }
    
    async handleChatNeedsClosing(request, sender) {
        if (!this.settings.enabled) {
            return;
        }
        
        const chatKey = `${request.chatId}_${sender.tab.id}`;
        
        // Проверяем, не отправляли ли мы уже уведомление для этого чата
        if (this.notifiedChats.has(chatKey)) {
            return;
        }
        
        // Добавляем чат в список уведомленных
        this.notifiedChats.add(chatKey);
        
        // Создаем уведомление
        await this.createNotification(request, sender.tab);
        
        // Удаляем из списка уведомленных через 5 минут, чтобы можно было повторно уведомить
        setTimeout(() => {
            this.notifiedChats.delete(chatKey);
        }, 5 * 60 * 1000);
    }
    
    async createNotification(chatInfo, tab) {
        const notificationId = `chat_${chatInfo.chatId}_${Date.now()}`;
        
        const notificationOptions = {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: '⚠️ Чат требует внимания',
            message: `Чат ${chatInfo.chatId} неактивен уже ${chatInfo.timeSinceLastMessage} минут.\\nРекомендуется закрыть неприкрепленный чат.`,
            buttons: [
                { title: '🔗 Перейти к чату' },
                { title: '❌ Закрыть уведомление' }
            ],
            requireInteraction: true
        };
        
        try {
            await chrome.notifications.create(notificationId, notificationOptions);
            
            // Сохраняем информацию о уведомлении для обработки кликов
            await chrome.storage.local.set({
                [`notification_${notificationId}`]: {
                    chatId: chatInfo.chatId,
                    tabId: tab.id,
                    url: chatInfo.url || tab.url,
                    timestamp: Date.now()
                }
            });
            
            console.log(`Уведомление создано для чата ${chatInfo.chatId}`);
            
        } catch (error) {
            console.error('Ошибка создания уведомления:', error);
        }
    }
    
    async handleNotificationClick(notificationId) {
        try {
            // Получаем информацию о уведомлении
            const result = await chrome.storage.local.get([`notification_${notificationId}`]);
            const notificationData = result[`notification_${notificationId}`];
            
            if (notificationData) {
                // Переключаемся на вкладку с чатом
                await chrome.tabs.update(notificationData.tabId, { active: true });
                await chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { focused: true });
            }
            
            // Закрываем уведомление
            await chrome.notifications.clear(notificationId);
            
            // Удаляем данные уведомления
            await chrome.storage.local.remove([`notification_${notificationId}`]);
            
        } catch (error) {
            console.error('Ошибка обработки клика по уведомлению:', error);
        }
    }
    
    async handleNotificationButtonClick(notificationId, buttonIndex) {
        try {
            if (buttonIndex === 0) {
                // Кнопка "Перейти к чату"
                await this.handleNotificationClick(notificationId);
            } else if (buttonIndex === 1) {
                // Кнопка "Закрыть уведомление"
                await chrome.notifications.clear(notificationId);
                await chrome.storage.local.remove([`notification_${notificationId}`]);
            }
        } catch (error) {
            console.error('Ошибка обработки клика по кнопке уведомления:', error);
        }
    }
    
    onInstalled() {
        console.log('Chat Monitor Extension установлено');
        
        // Создаем контекстное меню
        chrome.contextMenus.create({
            id: 'chatMonitorToggle',
            title: 'Включить/выключить мониторинг чатов',
            contexts: ['page']
        });
        
        // Устанавливаем значок расширения
        this.updateIcon();
    }
    
    async updateIcon() {
        const iconPath = this.settings.enabled ? 'icons/icon48.png' : 'icons/icon48_disabled.png';
        
        try {
            await chrome.action.setIcon({ path: iconPath });
            await chrome.action.setTitle({ 
                title: this.settings.enabled ? 
                    'Chat Monitor - Активен' : 
                    'Chat Monitor - Отключен' 
            });
        } catch (error) {
            console.error('Ошибка обновления иконки:', error);
        }
    }
    
    // Метод для получения статистики
    async getStatistics() {
        try {
            const result = await chrome.storage.local.get();
            const notifications = Object.keys(result)
                .filter(key => key.startsWith('notification_'))
                .map(key => result[key]);
                
            return {
                activeNotifications: notifications.length,
                notifiedChatsCount: this.notifiedChats.size,
                isEnabled: this.settings.enabled
            };
        } catch (error) {
            console.error('Ошибка получения статистики:', error);
            return {
                activeNotifications: 0,
                notifiedChatsCount: 0,
                isEnabled: this.settings.enabled
            };
        }
    }
    
    // Обработка команды исправления текста
    async handleCorrectTextCommand() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) return;
        
        await this.correctAllTextInActiveElement(tab.id);
    }
    
    // Исправление всего текста в активном элементе
    async correctAllTextInActiveElement(tabId, providedApiKey = null) {
        try {
            console.log('Background: Начинаем исправление текста...');
            console.log('Background: Предоставлен API ключ:', providedApiKey ? 'да' : 'нет');
            
            let apiKey = providedApiKey;
            
            // Если API ключ не предоставлен, пытаемся получить из storage
            if (!apiKey) {
                const apiKeys = await this.getApiKeys();
                console.log('Background: Получены API ключи из storage:', apiKeys.length, 'шт.');
                
                if (!apiKeys.length) {
                    console.log('Background: API ключи не найдены');
                    await chrome.tabs.sendMessage(tabId, { 
                        action: 'showNotification', 
                        message: 'Необходимо настроить Gemini API ключ в панели расширения', 
                        type: 'error' 
                    });
                    return { success: false, error: 'No Gemini API key found' };
                }
                
                apiKey = apiKeys[0];
            }
            
            console.log('Background: Используем API ключ длиной:', apiKey.length, 'символов');

            // Получаем весь текст из активного элемента
            const textResp = await chrome.tabs.sendMessage(tabId, { action: 'getAllTextFromActiveElement' });
            const allText = textResp?.text || '';

            if (!allText.trim()) {
                await chrome.tabs.sendMessage(tabId, { 
                    action: 'showNotification', 
                    message: 'Нет текста для исправления в активном элементе', 
                    type: 'error' 
                });
                return { success: false, error: 'No text found' };
            }

            await chrome.tabs.sendMessage(tabId, { 
                action: 'showNotification', 
                message: 'Обрабатываю текст с помощью ИИ…', 
                type: 'info' 
            });

            // Исправляем текст с помощью ИИ
            const correctedText = await this.correctTextWithAI(allText, apiKey);

            if (correctedText) {
                if (correctedText.startsWith('Ошибка API:')) {
                    await chrome.tabs.sendMessage(tabId, { 
                        action: 'showNotification', 
                        message: correctedText, 
                        type: 'error' 
                    });
                    return { success: false, error: correctedText };
                } else {
                    // Заменяем весь текст в активном элементе
                    await chrome.tabs.sendMessage(tabId, { 
                        action: 'replaceAllTextInActiveElement', 
                        newText: correctedText 
                    });
                    await chrome.tabs.sendMessage(tabId, { 
                        action: 'showNotification', 
                        message: 'Готово! Текст исправлен', 
                        type: 'success' 
                    });
                    return { success: true, correctedText };
                }
            } else {
                await chrome.tabs.sendMessage(tabId, { 
                    action: 'showNotification', 
                    message: 'Не удалось исправить текст', 
                    type: 'error' 
                });
                return { success: false, error: 'AI correction failed' };
            }
        } catch (error) {
            console.error('Ошибка обработки исправления текста:', error);
            try {
                await chrome.tabs.sendMessage(tabId, { 
                    action: 'showNotification', 
                    message: 'Произошла ошибка при обработке текста', 
                    type: 'error' 
                });
            } catch (_) {}
            return { success: false, error: error.message };
        }
    }
    
    // Получение API ключей (упрощенная версия)
    async getApiKeys() {
        try {
            console.log('Background: Получение API ключа из кода...');
            
            // Сначала пробуем простую функцию из api-config.js
            if (typeof getGeminiApiKey === 'function') {
                const apiKey = getGeminiApiKey();
                if (apiKey) {
                    console.log('Background: API ключ найден в коде, длина:', apiKey.length);
                    return [apiKey];
                }
            }
            
            console.log('Background: Пробуем ConfigManager как fallback...');
            // Fallback к ConfigManager
            const apiKey = await this.configManager.getApiKey();
            
            if (apiKey && apiKey.trim()) {
                console.log('Background: API ключ найден через ConfigManager, длина:', apiKey.length);
                return [apiKey.trim()];
            }
            
            console.log('Background: API ключ не найден нигде');
            return [];
            
        } catch (error) {
            console.error('Background: Ошибка получения API ключей:', error);
            return [];
        }
    }
    
    // Исправление текста с помощью Gemini AI
    async correctTextWithAI(text, apiKey) {
        try {
            // Запрос к Google Gemini API для исправления текста
            const prompt = `Исправь грамматические ошибки, пунктуацию и стиль в следующем тексте. Верни только исправленный текст без дополнительных комментариев:

${text}`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        maxOutputTokens: 2048,
                        temperature: 0.1
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
                const correctedText = data.candidates[0].content.parts[0].text.trim();
                return correctedText;
            } else {
                throw new Error('Неожиданный формат ответа от Gemini API');
            }
            
        } catch (error) {
            console.error('Ошибка вызова Gemini API:', error);
            return `Ошибка API: ${error.message}`;
        }
    }
}

// Создаем экземпляр класса при загрузке
const chatMonitor = new ChatMonitorBackground();