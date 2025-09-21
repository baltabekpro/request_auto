// Background script для обработки уведомлений
class ChatMonitorBackground {
    constructor() {
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
                    const result = await this.correctAllTextInActiveElement(sender.tab.id);
                    sendResponse(result);
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
    async correctAllTextInActiveElement(tabId) {
        try {
            // Получаем API ключи из хранилища
            const apiKeys = await this.getApiKeys();
            if (!apiKeys.length) {
                await chrome.tabs.sendMessage(tabId, { 
                    action: 'showNotification', 
                    message: 'Необходимо настроить API ключи для исправления текста', 
                    type: 'error' 
                });
                return { success: false, error: 'No API keys found' };
            }

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
            const correctedText = await this.correctTextWithAI(allText, apiKeys[0]);

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
    
    // Получение API ключей (заглушка для демонстрации)
    async getApiKeys() {
        try {
            const result = await chrome.storage.sync.get(['textCorrectionApiKeys']);
            return result.textCorrectionApiKeys || [];
        } catch (error) {
            console.error('Ошибка получения API ключей:', error);
            return [];
        }
    }
    
    // Исправление текста с помощью ИИ (упрощенная версия)
    async correctTextWithAI(text, apiKey) {
        try {
            // Здесь должен быть реальный вызов к API ИИ
            // Для демонстрации возвращаем простую обработку
            
            // Простая обработка: убираем лишние пробелы и исправляем некоторые ошибки
            let correctedText = text
                .replace(/\s+/g, ' ') // убираем множественные пробелы
                .replace(/\s+([.,:;!?])/g, '$1') // убираем пробелы перед знаками препинания
                .replace(/([.!?])\s*([а-яё])/gi, '$1 $2') // добавляем пробел после точки
                .trim();
            
            // Имитация задержки API
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            return correctedText;
        } catch (error) {
            console.error('Ошибка вызова ИИ:', error);
            return `Ошибка API: ${error.message}`;
        }
    }
}

// Создаем экземпляр класса при загрузке
const chatMonitor = new ChatMonitorBackground();