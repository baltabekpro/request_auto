// Конфигурация API ключей
// ИНСТРУКЦИЯ: Вставьте ваш Gemini API ключ между кавычками ниже

const API_CONFIG = {
    // Вставьте сюда ваш Gemini API ключ:
    GEMINI_API_KEY: "ВСТАВЬТЕ_ВАШ_API_КЛЮЧ_СЮДА",
    
    // Настройки (не изменяйте)
    API_URL: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent",
    VERSION: "1.0"
};

// Функция для получения API ключа
function getGeminiApiKey() {
    const key = API_CONFIG.GEMINI_API_KEY;
    
    if (!key || key === "ВСТАВЬТЕ_ВАШ_API_КЛЮЧ_СЮДА") {
        console.error("❌ API ключ не настроен! Отредактируйте файл api-config.js");
        return null;
    }
    
    if (key.length < 30) {
        console.error("❌ API ключ слишком короткий! Проверьте правильность ключа.");
        return null;
    }
    
    console.log("✅ API ключ найден, длина:", key.length, "символов");
    return key;
}

// Экспорт для использования в других файлах
if (typeof window !== 'undefined') {
    window.getGeminiApiKey = getGeminiApiKey;
    window.API_CONFIG = API_CONFIG;
}