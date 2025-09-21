// Content script для мониторинга чатов
(function() {
    'use strict';
    
    // Проверяем валидность контекста расширения при загрузке
    function checkExtensionContext() {
        if (!chrome.runtime || !chrome.runtime.id) {
            console.warn('Content: Контекст расширения недействителен при загрузке');
            return false;
        }
        return true;
    }
    
    // Безопасный вызов chrome.runtime.sendMessage с проверкой контекста
    function safeSendMessage(message, callback) {
        if (!checkExtensionContext()) {
            console.warn('Content: Пропуск sendMessage из-за недействительного контекста');
            if (callback) callback({ error: 'Extension context invalidated' });
            return;
        }
        
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('Content: Runtime lastError:', chrome.runtime.lastError.message);
                    if (callback) callback({ error: chrome.runtime.lastError.message });
                } else {
                    if (callback) callback(response);
                }
            });
        } catch (error) {
            console.warn('Content: Ошибка sendMessage:', error.message);
            if (callback) callback({ error: error.message });
        }
    }
    
    let isMonitoring = false;
    let chatMonitorInterval = null;
    
    // Функция для парсинга времени из HTML
    function parseMessageTime(timeString) {
        // Предполагаем формат времени "21.09.2025 10:20:06"
        const match = timeString.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            const [, day, month, year, hour, minute, second] = match;
            return new Date(year, month - 1, day, hour, minute, second);
        }
        
        // Альтернативный формат - только время "10:20"
        const timeMatch = timeString.match(/(\d{2}):(\d{2})/);
        if (timeMatch) {
            const [, hour, minute] = timeMatch;
            const now = new Date();
            const messageTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
            return messageTime;
        }
        
        return null;
    }
    
    // Функция для извлечения информации о чатах
    function extractChatInfo() {
        const chats = [];
        
        try {
            // Ищем карточки чатов по ID паттерну name_XXXXXX
            const chatElements = document.querySelectorAll('td[id^="name_"]');
            
            console.log(`Найдено карточек чатов: ${chatElements.length}`);
            
            for (const chatElement of chatElements) {
                // Извлекаем ID чата из атрибута id
                const idMatch = chatElement.id.match(/name_(\d+)/);
                if (!idMatch) continue;
                
                const chatId = idMatch[1];
                const chatText = chatElement.textContent || chatElement.innerText;
                
                // Определяем статус чата (прикрепленный или нет)
                // Если нет специального индикатора, считаем все чаты неприкрепленными
                const isPinned = false; // Можно адаптировать под конкретную логику
                
                // Извлекаем время последнего сообщения из конца текста
                const timeMatch = chatText.match(/(\d{1,2}):(\d{2})$/);
                let lastMessageTime = null;
                
                if (timeMatch) {
                    const [, hour, minute] = timeMatch;
                    const now = new Date();
                    
                    // Создаем время сообщения для сегодняшней даты
                    lastMessageTime = new Date(
                        now.getFullYear(), 
                        now.getMonth(), 
                        now.getDate(), 
                        parseInt(hour), 
                        parseInt(minute)
                    );
                    
                    // Если время больше текущего, значит это было вчера
                    if (lastMessageTime > now) {
                        lastMessageTime.setDate(lastMessageTime.getDate() - 1);
                    }
                }
                
                const chatInfo = {
                    id: chatId,
                    isPinned: isPinned,
                    lastMessageTime: lastMessageTime,
                    url: window.location.href,
                    element: chatElement,
                    text: chatText
                };
                
                chats.push(chatInfo);
                
                // Проверяем время и выделяем красным если нужно
                if (lastMessageTime) {
                    const now = new Date();
                    const timeDiff = now - lastMessageTime;
                    const minutesDiff = Math.floor(timeDiff / (1000 * 60));
                    
                    console.log(`Чат ${chatId}: последнее сообщение ${minutesDiff} минут назад`);
                    
                    // Если прошло 18 или больше минут, выделяем красным
                    if (minutesDiff >= 18) {
                        chatElement.style.backgroundColor = '#ffebee';
                        chatElement.style.borderLeft = '4px solid #f44336';
                        chatElement.style.color = '#d32f2f';
                        
                        console.log(`Чат ${chatId} выделен красным - ${minutesDiff} минут неактивности`);
                    } else {
                        // Сбрасываем стили если время еще не истекло
                        chatElement.style.backgroundColor = '';
                        chatElement.style.borderLeft = '';
                        chatElement.style.color = '';
                    }
                }
            }
            
            console.log('Найденные чаты:', chats);
            return chats;
            
        } catch (error) {
            console.error('Ошибка при извлечении информации о чатах:', error);
            return [];
        }
    }
    
    // Функция для проверки времени неактивности
    function checkChatActivity() {
        const chats = extractChatInfo();
        const now = new Date();
        const eighteenMinutesInMs = 18 * 60 * 1000; // 18 минут в миллисекундах
        
        for (const chat of chats) {
            // Проверяем только неприкрепленные чаты
            if (!chat.isPinned && chat.lastMessageTime) {
                const timeDiff = now - chat.lastMessageTime;
                const minutesDiff = Math.floor(timeDiff / 60000);
                
                if (timeDiff >= eighteenMinutesInMs) {
                    // Отправляем сообщение в background script для уведомления
                    safeSendMessage({
                        type: 'CHAT_NEEDS_CLOSING',
                        chatId: chat.id,
                        timeSinceLastMessage: minutesDiff,
                        url: chat.url
                    });
                    
                    console.log(`Чат ${chat.id} неактивен ${minutesDiff} минут - отправлено уведомление`);
                }
            }
        }
    }
    
    // Функция для начала мониторинга
    function startMonitoring() {
        if (isMonitoring) return;
        
        console.log('Начинаем мониторинг чатов...');
        isMonitoring = true;
        
        // Проверяем каждые 30 секунд
        chatMonitorInterval = setInterval(() => {
            checkChatActivity();
            updateChatHighlighting(); // Обновляем подсветку чатов
        }, 30000);
        
        // Первоначальная проверка
        checkChatActivity();
        updateChatHighlighting();
    }
    
    // Функция для обновления визуального выделения чатов
    function updateChatHighlighting() {
        const chatElements = document.querySelectorAll('td[id^="name_"]');
        const now = new Date();
        
        for (const chatElement of chatElements) {
            const chatText = chatElement.textContent || chatElement.innerText;
            const timeMatch = chatText.match(/(\d{1,2}):(\d{2})$/);
            
            if (timeMatch) {
                const [, hour, minute] = timeMatch;
                const lastMessageTime = new Date(
                    now.getFullYear(), 
                    now.getMonth(), 
                    now.getDate(), 
                    parseInt(hour), 
                    parseInt(minute)
                );
                
                // Если время больше текущего, значит это было вчера
                if (lastMessageTime > now) {
                    lastMessageTime.setDate(lastMessageTime.getDate() - 1);
                }
                
                const timeDiff = now - lastMessageTime;
                const minutesDiff = Math.floor(timeDiff / (1000 * 60));
                
                // Если прошло 18 или больше минут, выделяем красным
                if (minutesDiff >= 18) {
                    chatElement.style.backgroundColor = '#ffebee';
                    chatElement.style.borderLeft = '4px solid #f44336';
                    chatElement.style.color = '#d32f2f';
                    chatElement.style.fontWeight = 'bold';
                } else {
                    // Сбрасываем стили если время еще не истекло
                    chatElement.style.backgroundColor = '';
                    chatElement.style.borderLeft = '';
                    chatElement.style.color = '';
                    chatElement.style.fontWeight = '';
                }
            }
        }
    }
    
    // Функция для остановки мониторинга
    function stopMonitoring() {
        if (!isMonitoring) return;
        
        console.log('Останавливаем мониторинг чатов...');
        isMonitoring = false;
        
        if (chatMonitorInterval) {
            clearInterval(chatMonitorInterval);
            chatMonitorInterval = null;
        }
    }
    
    // Слушатель сообщений от background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch (request.type) {
            case 'START_MONITORING':
                startMonitoring();
                sendResponse({ success: true });
                break;
                
            case 'STOP_MONITORING':
                stopMonitoring();
                sendResponse({ success: true });
                break;
                
            case 'GET_CHAT_INFO':
                const chatInfo = extractChatInfo();
                sendResponse({ chats: chatInfo });
                break;
                
            default:
                sendResponse({ error: 'Unknown message type' });
        }
    });
    
    // Слушатель сообщений для исправления текста
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch (request.action) {
            case 'getAllTextFromActiveElement':
                console.log('Content script: запрос получения текста из активного элемента');
                const text = getAllTextFromActiveElement();
                console.log('Content script: найден текст длиной:', text.length, 'символов');
                sendResponse({ text });
                break;
                
            case 'replaceAllTextInActiveElement':
                const success = replaceAllTextInActiveElement(request.newText);
                sendResponse({ success });
                break;
                
            case 'showNotification':
                showNotification(request.message, request.type);
                sendResponse({ success: true });
                break;
                
            default:
                // Не отвечаем, чтобы не конфликтовать с другими обработчиками
                break;
        }
    });
    
    // Автоматически начинаем мониторинг при загрузке страницы
    // Проверяем, содержит ли страница элементы чатов
    function detectChatInterface() {
        const chatElements = document.querySelectorAll('.panel-heading');
        const hasChats = Array.from(chatElements).some(el => 
            el.textContent.includes('Диалог прикреплен') || 
            el.textContent.includes('Диалог не прикреплен')
        );
        
        if (hasChats) {
            console.log('Обнаружен интерфейс чатов, начинаем мониторинг');
            startMonitoring();
        }
    }
    
    // Наблюдатель за изменениями в DOM
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                // Проверяем, добавились ли новые элементы чатов
                detectChatInterface();
            }
        });
    });
    
    // Начинаем наблюдение за изменениями
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Первоначальная проверка интерфейса
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', detectChatInterface);
    } else {
        detectChatInterface();
    }
    
    // Функции для работы с текстом
    
    // Получить весь текст из активного элемента
    function getAllTextFromActiveElement() {
        const activeElement = document.activeElement;
        console.log('Активный элемент:', activeElement ? activeElement.tagName : 'нет');
        
        if (activeElement && (activeElement.tagName === 'TEXTAREA' || 
            (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
            console.log('Найден активный текстовый элемент с текстом:', activeElement.value.length, 'символов');
            return activeElement.value;
        }
        
        // Если активного текстового элемента нет, ищем основные текстовые поля
        const textareas = document.querySelectorAll('textarea');
        const textInputs = document.querySelectorAll('input[type="text"]');
        
        console.log('Найдено textarea:', textareas.length, ', text inputs:', textInputs.length);
        
        if (textareas.length > 0) {
            console.log('Используем первый textarea с текстом:', textareas[0].value.length, 'символов');
            return textareas[0].value;
        }
        
        if (textInputs.length > 0) {
            console.log('Используем первый text input с текстом:', textInputs[0].value.length, 'символов');
            return textInputs[0].value;
        }
        
        console.log('Текстовые элементы не найдены');
        return '';
    }
    
    // Заменить весь текст в активном элементе
    function replaceAllTextInActiveElement(newText) {
        const activeElement = document.activeElement;
        
        if (activeElement && (activeElement.tagName === 'TEXTAREA' || 
            (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
            activeElement.value = newText;
            
            // Генерируем событие input для обновления
            const event = new Event('input', { bubbles: true });
            activeElement.dispatchEvent(event);
            
            return true;
        }
        
        // Если активного текстового элемента нет, ищем основные текстовые поля
        const textareas = document.querySelectorAll('textarea');
        const textInputs = document.querySelectorAll('input[type="text"]');
        
        if (textareas.length > 0) {
            textareas[0].value = newText;
            const event = new Event('input', { bubbles: true });
            textareas[0].dispatchEvent(event);
            return true;
        }
        
        if (textInputs.length > 0) {
            textInputs[0].value = newText;
            const event = new Event('input', { bubbles: true });
            textInputs[0].dispatchEvent(event);
            return true;
        }
        
        return false;
    }
    
    // Показать уведомление на странице
    function showNotification(message, type = 'info') {
        // Создаем стили для уведомления
        const style = document.createElement('style');
        style.textContent = `
            .chat-monitor-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                border-radius: 6px;
                color: white;
                font-family: Arial, sans-serif;
                font-size: 14px;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transition: all 0.3s ease;
            }
            .chat-monitor-notification.info { background-color: #2196F3; }
            .chat-monitor-notification.success { background-color: #4CAF50; }
            .chat-monitor-notification.error { background-color: #f44336; }
            .chat-monitor-notification.fadeout {
                opacity: 0;
                transform: translateX(100%);
            }
        `;
        
        if (!document.querySelector('#chat-monitor-styles')) {
            style.id = 'chat-monitor-styles';
            document.head.appendChild(style);
        }
        
        // Создаем элемент уведомления
        const notification = document.createElement('div');
        notification.className = `chat-monitor-notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Убираем уведомление через 3 секунды
        setTimeout(() => {
            notification.classList.add('fadeout');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
    
    // Добавляем кнопку "Исправить" рядом с кнопкой "Шаблоны"
    function addCorrectButton() {
        // Ищем кнопку "Шаблоны"
        const templateButton = document.querySelector('button[onclick*="popup_templates"]');
        
        if (templateButton && !document.querySelector('#correct-text-button')) {
            // Создаем кнопку "Исправить"
            const correctButton = document.createElement('button');
            correctButton.id = 'correct-text-button';
            correctButton.className = 'btn-tab-enabled req-form-input';
            correctButton.style.whiteSpace = 'nowrap';
            correctButton.style.marginLeft = '5px';
            correctButton.textContent = 'Исправить';
            
            correctButton.onclick = async function() {
                console.log('Content: Кнопка исправления нажата');
                
                try {
                    // Проверяем, доступен ли контекст расширения
                    if (!chrome.runtime || !chrome.runtime.id) {
                        console.warn('Content: Контекст расширения недействителен, перезагрузите страницу');
                        alert('⚠️ Контекст расширения недействителен.\n\nПерезагрузите страницу для корректной работы расширения.');
                        return;
                    }
                    
                    // Сначала пробуем получить API ключ из кода
                    let apiKey = null;
                    
                    if (typeof getGeminiApiKey === 'function') {
                        apiKey = getGeminiApiKey();
                        console.log('Content: API ключ из кода:', apiKey ? 'найден' : 'не найден');
                    }
                    
                    // Если в коде нет, пробуем через runtime (с проверкой ошибок)
                    if (!apiKey) {
                        try {
                            const apiKeyResponse = await new Promise((resolve, reject) => {
                                safeSendMessage({ type: 'GET_API_KEY' }, (response) => {
                                    if (response?.error) {
                                        reject(new Error(response.error));
                                    } else {
                                        resolve(response);
                                    }
                                });
                            });
                            apiKey = apiKeyResponse?.apiKey;
                            console.log('Content: API ключ из runtime:', apiKey ? 'найден' : 'не найден');
                        } catch (runtimeError) {
                            console.warn('Content: Ошибка runtime API:', runtimeError.message);
                            // Продолжаем без runtime API
                        }
                    }
                    
                    if (!apiKey) {
                        alert('❌ API ключ не найден!\n\nВы можете:\n1. Настроить ключ в панели расширения\n2. Или отредактировать файл api-config.js\n3. Если ошибка повторяется - перезагрузите страницу');
                        return;
                    }
                    
                    // Отправляем запрос на исправление с API ключом (с проверкой ошибок)
                    try {
                        await new Promise((resolve, reject) => {
                            safeSendMessage({ 
                                type: 'CORRECT_ALL_TEXT',
                                apiKey: apiKey 
                            }, (response) => {
                                if (response?.error) {
                                    reject(new Error(response.error));
                                } else {
                                    console.log('Content: Ответ на исправление:', response);
                                    if (response && response.success) {
                                        console.log('Content: Текст успешно исправлен');
                                        resolve(response);
                                    } else {
                                        console.error('Content: Ошибка исправления текста:', response?.error);
                                        reject(new Error(response?.error || 'Неизвестная ошибка'));
                                    }
                                }
                            });
                        });
                    } catch (correctionError) {
                        console.error('Content: Ошибка исправления:', correctionError.message);
                        alert('Ошибка исправления: ' + correctionError.message + '\n\nЕсли ошибка повторяется - перезагрузите страницу.');
                    }
                } catch (error) {
                    console.error('Content: Общая ошибка:', error);
                    alert('Общая ошибка: ' + error.message + '\n\nПерезагрузите страницу и попробуйте снова.');
                }
            };
            
            // Вставляем кнопку рядом с кнопкой "Шаблоны"
            templateButton.parentNode.insertBefore(correctButton, templateButton.nextSibling);
        }
    }
    
    // Пытаемся добавить кнопку при загрузке
    addCorrectButton();
    
    // Автоматически запускаем мониторинг при загрузке страницы
    setTimeout(() => {
        startMonitoring();
        console.log('Автоматический запуск мониторинга чатов');
    }, 2000); // Задержка 2 секунды для полной загрузки страницы
    
    // Наблюдаем за изменениями DOM для добавления кнопки на динамически загружаемые страницы
    const buttonObserver = new MutationObserver(() => {
        addCorrectButton();
    });
    
    buttonObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    
})();