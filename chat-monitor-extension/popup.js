// Popup script для управления расширением
class ChatMonitorPopup {
    constructor() {
        this.settings = {
            enabled: true,
            notificationInterval: 20,
            soundEnabled: true,
            apiKey: ''
        };
        
        this.stats = {
            activeNotifications: 0,
            notifiedChatsCount: 0,
            isEnabled: true
        };
        
        this.init();
    }
    
    async init() {
        // Загружаем настройки и статистику
        await this.loadSettings();
        await this.loadStats();
        
        // Настраиваем обработчики событий
        this.setupEventListeners();
        
        // Обновляем интерфейс
        this.updateUI();
        
        console.log('Chat Monitor Popup инициализирован');
    }
    
    async loadSettings() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
            if (response && response.settings) {
                this.settings = response.settings;
            }
            
            // Загружаем API ключ из хранилища
            const apiKeyData = await chrome.storage.sync.get(['apiKey']);
            if (apiKeyData.apiKey) {
                this.settings.apiKey = apiKeyData.apiKey;
            }
        } catch (error) {
            console.error('Ошибка загрузки настроек:', error);
        }
    }
    
    async loadStats() {
        try {
            // Получаем статистику от background script
            const response = await chrome.runtime.sendMessage({ type: 'GET_STATISTICS' });
            if (response && response.stats) {
                this.stats = response.stats;
            }
            
            // Получаем информацию о текущей вкладке
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                const chatInfoResponse = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CHAT_INFO' });
                if (chatInfoResponse && chatInfoResponse.chats) {
                    this.currentChats = chatInfoResponse.chats;
                }
            }
        } catch (error) {
            console.error('Ошибка загрузки статистики:', error);
        }
    }
    
    setupEventListeners() {
        // Переключатель мониторинга
        const monitoringToggle = document.getElementById('monitoringToggle');
        monitoringToggle.addEventListener('click', () => {
            this.toggleMonitoring();
        });
        
        // Переключатель звука
        const soundToggle = document.getElementById('soundToggle');
        soundToggle.addEventListener('click', () => {
            this.toggleSound();
        });
        
        // Поле интервала
        const intervalInput = document.getElementById('intervalInput');
        intervalInput.addEventListener('change', (e) => {
            this.updateInterval(parseInt(e.target.value));
        });
        
        // Кнопки действий
        document.getElementById('testBtn').addEventListener('click', () => {
            this.testNotification();
        });
        
        document.getElementById('clearBtn').addEventListener('click', () => {
            this.clearNotifications();
        });
        
        document.getElementById('correctBtn').addEventListener('click', () => {
            this.correctText();
        });
        
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.refresh();
        });
        
        // API ключ кнопки
        document.getElementById('saveApiBtn').addEventListener('click', () => {
            this.saveApiKey();
        });
        
        document.getElementById('testApiBtn').addEventListener('click', () => {
            this.testApiKey();
        });
    }
    
    async toggleMonitoring() {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        this.updateUI();
        
        // Показываем превью уведомления при включении
        if (this.settings.enabled) {
            this.showNotificationPreview();
        } else {
            this.hideNotificationPreview();
        }
    }
    
    async toggleSound() {
        this.settings.soundEnabled = !this.settings.soundEnabled;
        await this.saveSettings();
        this.updateUI();
    }
    
    async updateInterval(newInterval) {
        if (newInterval >= 5 && newInterval <= 60) {
            this.settings.notificationInterval = newInterval;
            await this.saveSettings();
        }
    }
    
    async saveSettings() {
        try {
            await chrome.runtime.sendMessage({
                type: 'UPDATE_SETTINGS',
                settings: this.settings
            });
        } catch (error) {
            console.error('Ошибка сохранения настроек:', error);
        }
    }
    
    updateUI() {
        // Обновляем статус
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const monitoringToggle = document.getElementById('monitoringToggle');
        const soundToggle = document.getElementById('soundToggle');
        const intervalInput = document.getElementById('intervalInput');
        
        if (this.settings.enabled) {
            statusDot.className = 'status-dot active';
            statusText.textContent = 'Мониторинг активен';
            monitoringToggle.classList.add('active');
        } else {
            statusDot.className = 'status-dot inactive';
            statusText.textContent = 'Мониторинг отключен';
            monitoringToggle.classList.remove('active');
        }
        
        // Звуковые уведомления
        if (this.settings.soundEnabled) {
            soundToggle.classList.add('active');
        } else {
            soundToggle.classList.remove('active');
        }
        
        // Интервал
        intervalInput.value = this.settings.notificationInterval;
        
        // Статистика
        document.getElementById('activeChats').textContent = this.stats.activeNotifications || 0;
        
        // Количество отслеживаемых вкладок (примерное)
        const monitoredTabs = this.currentChats ? 1 : 0;
        document.getElementById('monitoredTabs').textContent = monitoredTabs;
        
        // API ключ
        const apiKeyInput = document.getElementById('apiKeyInput');
        if (this.settings.apiKey) {
            apiKeyInput.value = this.settings.apiKey;
            apiKeyInput.placeholder = '••••••••••••••••••••';
        }
    }
    
    showNotificationPreview() {
        const preview = document.getElementById('previewNotification');
        preview.classList.remove('hidden');
        
        // Автоматически скрываем через 3 секунды
        setTimeout(() => {
            this.hideNotificationPreview();
        }, 3000);
    }
    
    hideNotificationPreview() {
        const preview = document.getElementById('previewNotification');
        preview.classList.add('hidden');
    }
    
    async saveApiKey() {
        const apiKeyInput = document.getElementById('apiKeyInput');
        const apiKey = apiKeyInput.value.trim();
        const statusElement = document.getElementById('apiStatus');
        
        try {
            if (!apiKey) {
                this.showApiStatus('Пожалуйста, введите API ключ', 'error');
                return;
            }
            
            // Сохраняем в storage
            await chrome.storage.sync.set({ apiKey: apiKey });
            this.settings.apiKey = apiKey;
            
            this.showApiStatus('API ключ успешно сохранен', 'success');
            
            // Обновляем placeholder
            apiKeyInput.placeholder = '••••••••••••••••••••';
            
        } catch (error) {
            console.error('Ошибка сохранения API ключа:', error);
            this.showApiStatus('Ошибка сохранения API ключа', 'error');
        }
    }
    
    async testApiKey() {
        const apiKey = this.settings.apiKey || document.getElementById('apiKeyInput').value.trim();
        const statusElement = document.getElementById('apiStatus');
        
        if (!apiKey) {
            this.showApiStatus('Сначала введите и сохраните API ключ', 'error');
            return;
        }
        
        try {
            this.showApiStatus('Проверка API ключа...', '');
            
            // Простой тест запрос к API (можно адаптировать под конкретный API)
            const testPrompt = 'Проверка подключения';
            const response = await this.makeApiRequest(apiKey, testPrompt);
            
            if (response && response.success) {
                this.showApiStatus('API ключ работает корректно', 'success');
            } else {
                this.showApiStatus('Ошибка: неверный API ключ или проблема с сервисом', 'error');
            }
            
        } catch (error) {
            console.error('Ошибка тестирования API:', error);
            this.showApiStatus('Ошибка подключения к API сервису', 'error');
        }
    }
    
    async makeApiRequest(apiKey, prompt) {
        // Здесь реализуется запрос к конкретному API (OpenAI, Claude, etc.)
        // Пример для OpenAI API:
        
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 10
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                return { success: true, data };
            } else {
                return { success: false, error: response.statusText };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    showApiStatus(message, type) {
        const statusElement = document.getElementById('apiStatus');
        statusElement.textContent = message;
        statusElement.className = `api-status ${type}`;
        statusElement.classList.remove('hidden');
        
        // Автоматически скрываем через 5 секунд
        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 5000);
    }
    
    async testNotification() {
        try {
            // Создаем тестовое уведомление
            await chrome.notifications.create('test_notification', {
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: '🧪 Тестовое уведомление',
                message: 'Chat Monitor работает корректно!\\nЭто тестовое уведомление для проверки функциональности.'
            });
            
            // Показываем превью
            this.showNotificationPreview();
            
            console.log('Тестовое уведомление отправлено');
        } catch (error) {
            console.error('Ошибка отправки тестового уведомления:', error);
        }
    }
    
    async clearNotifications() {
        try {
            // Очищаем все уведомления
            await chrome.runtime.sendMessage({ type: 'CLEAR_NOTIFICATIONS' });
            
            // Получаем все активные уведомления и закрываем их
            const notifications = await chrome.notifications.getAll();
            for (const notificationId in notifications) {
                await chrome.notifications.clear(notificationId);
            }
            
            // Обновляем статистику
            await this.loadStats();
            this.updateUI();
            
            console.log('Уведомления очищены');
        } catch (error) {
            console.error('Ошибка очистки уведомлений:', error);
        }
    }
    
    async correctText() {
        try {
            // Отправляем команду на исправление текста
            const response = await chrome.runtime.sendMessage({ type: 'CORRECT_ALL_TEXT' });
            
            if (response && response.success) {
                console.log('Текст успешно исправлен');
                // Можно добавить визуальную обратную связь
            } else {
                console.error('Ошибка исправления текста:', response?.error);
            }
        } catch (error) {
            console.error('Ошибка отправки команды исправления текста:', error);
        }
    }
    
    async refresh() {
        try {
            // Перезагружаем настройки и статистику
            await this.loadSettings();
            await this.loadStats();
            this.updateUI();
            
            // Получаем информацию о чатах с текущей страницы
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                try {
                    await chrome.tabs.sendMessage(tab.id, { type: 'START_MONITORING' });
                } catch (error) {
                    console.log('Content script не загружен на текущей странице');
                }
            }
            
            console.log('Данные обновлены');
        } catch (error) {
            console.error('Ошибка обновления:', error);
        }
    }
    
    // Метод для получения информации о чатах с активной вкладки
    async getChatInfoFromActiveTab() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return null;
            
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CHAT_INFO' });
            return response ? response.chats : null;
        } catch (error) {
            console.error('Ошибка получения информации о чатах:', error);
            return null;
        }
    }
}

// Инициализируем popup при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    new ChatMonitorPopup();
});