// Модуль для работы с конфигурацией API ключа
class ConfigManager {
    constructor() {
        this.configUrl = chrome.runtime.getURL('config.json');
        this.cachedConfig = null;
    }

    // Загрузка конфигурации из файла
    async loadConfig() {
        try {
            const response = await fetch(this.configUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            this.cachedConfig = await response.json();
            return this.cachedConfig;
        } catch (error) {
            console.error('Ошибка загрузки конфигурации:', error);
            return { geminiApiKey: '', version: '1.0', lastUpdated: '' };
        }
    }

    // Получение API ключа
    async getApiKey() {
        try {
            // Сначала пробуем из кэша
            if (this.cachedConfig && this.cachedConfig.geminiApiKey) {
                return this.cachedConfig.geminiApiKey;
            }

            // Загружаем из файла
            const config = await this.loadConfig();
            return config.geminiApiKey || '';
        } catch (error) {
            console.error('Ошибка получения API ключа:', error);
            
            // Фоллбэк к chrome.storage
            try {
                const result = await chrome.storage.sync.get(['apiKey']);
                return result.apiKey || '';
            } catch (storageError) {
                console.error('Ошибка fallback chrome.storage:', storageError);
                return '';
            }
        }
    }

    // Сохранение API ключа
    async saveApiKey(apiKey) {
        try {
            // Сохраняем в chrome.storage как основной способ
            await chrome.storage.sync.set({ apiKey: apiKey });
            
            // Обновляем кэш
            if (!this.cachedConfig) {
                this.cachedConfig = await this.loadConfig();
            }
            this.cachedConfig.geminiApiKey = apiKey;
            this.cachedConfig.lastUpdated = new Date().toISOString();
            
            console.log('API ключ сохранен в storage');
            return true;
        } catch (error) {
            console.error('Ошибка сохранения API ключа:', error);
            return false;
        }
    }

    // Проверка наличия API ключа
    async hasApiKey() {
        const apiKey = await this.getApiKey();
        return !!(apiKey && apiKey.trim());
    }

    // Очистка API ключа
    async clearApiKey() {
        try {
            await chrome.storage.sync.remove(['apiKey']);
            if (this.cachedConfig) {
                this.cachedConfig.geminiApiKey = '';
                this.cachedConfig.lastUpdated = new Date().toISOString();
            }
            return true;
        } catch (error) {
            console.error('Ошибка очистки API ключа:', error);
            return false;
        }
    }
}

// Экспортируем для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConfigManager;
} else {
    window.ConfigManager = ConfigManager;
}