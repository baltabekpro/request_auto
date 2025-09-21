// Content script для мониторинга чатов
(function() {
    'use strict';
    
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
            // Поиск панелей чатов по структуре HTML
            const chatPanels = document.querySelectorAll('.panel-heading');
            
            for (const panel of chatPanels) {
                const text = panel.textContent || panel.innerText;
                
                // Поиск ID чата и статуса прикрепления
                const chatIdMatch = text.match(/(\d+)\s*\|\s*(.*?)\s*\|/);
                if (chatIdMatch) {
                    const chatId = chatIdMatch[1];
                    const statusText = chatIdMatch[2];
                    const isPinned = statusText.includes('прикреплен');
                    
                    // Поиск последнего сообщения для этого чата
                    let lastMessageTime = null;
                    
                    // Ищем элементы с временными метками рядом с этой панелью
                    const parentElement = panel.closest('div') || panel.parentElement;
                    if (parentElement) {
                        // Поиск временных меток в соседних элементах
                        const timeElements = parentElement.querySelectorAll('div[style*="padding: 5px"]');
                        
                        for (const timeElement of timeElements) {
                            const timeText = timeElement.textContent || timeElement.innerText;
                            const parsedTime = parseMessageTime(timeText);
                            if (parsedTime && (!lastMessageTime || parsedTime > lastMessageTime)) {
                                lastMessageTime = parsedTime;
                            }
                        }
                        
                        // Альтернативный поиск в элементах td
                        const tdElements = parentElement.querySelectorAll('td');
                        for (const td of tdElements) {
                            const timeMatch = td.textContent.match(/(\d{1,2}):(\d{2})$/);
                            if (timeMatch) {
                                const [, hour, minute] = timeMatch;
                                const now = new Date();
                                const messageTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
                                if (!lastMessageTime || messageTime > lastMessageTime) {
                                    lastMessageTime = messageTime;
                                }
                            }
                        }
                    }
                    
                    chats.push({
                        id: chatId,
                        isPinned: isPinned,
                        lastMessageTime: lastMessageTime,
                        url: window.location.href
                    });
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
        const twentyMinutesInMs = 20 * 60 * 1000; // 20 минут в миллисекундах
        
        for (const chat of chats) {
            // Проверяем только неприкрепленные чаты
            if (!chat.isPinned && chat.lastMessageTime) {
                const timeDiff = now - chat.lastMessageTime;
                
                if (timeDiff >= twentyMinutesInMs) {
                    // Отправляем сообщение в background script
                    chrome.runtime.sendMessage({
                        type: 'CHAT_NEEDS_CLOSING',
                        chatId: chat.id,
                        timeSinceLastMessage: Math.floor(timeDiff / 60000), // в минутах
                        url: chat.url
                    });
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
        chatMonitorInterval = setInterval(checkChatActivity, 30000);
        
        // Первоначальная проверка
        checkChatActivity();
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
                const text = getAllTextFromActiveElement();
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
        
        if (activeElement && (activeElement.tagName === 'TEXTAREA' || 
            (activeElement.tagName === 'INPUT' && activeElement.type === 'text'))) {
            return activeElement.value;
        }
        
        // Если активного текстового элемента нет, ищем основные текстовые поля
        const textareas = document.querySelectorAll('textarea');
        const textInputs = document.querySelectorAll('input[type="text"]');
        
        if (textareas.length > 0) {
            return textareas[0].value;
        }
        
        if (textInputs.length > 0) {
            return textInputs[0].value;
        }
        
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
            
            correctButton.onclick = function() {
                chrome.runtime.sendMessage({ type: 'CORRECT_ALL_TEXT' }, (response) => {
                    if (response && response.success) {
                        console.log('Текст успешно исправлен');
                    } else {
                        console.error('Ошибка исправления текста:', response?.error);
                    }
                });
            };
            
            // Вставляем кнопку рядом с кнопкой "Шаблоны"
            templateButton.parentNode.insertBefore(correctButton, templateButton.nextSibling);
        }
    }
    
    // Пытаемся добавить кнопку при загрузке
    addCorrectButton();
    
    // Наблюдаем за изменениями DOM для добавления кнопки на динамически загружаемые страницы
    const buttonObserver = new MutationObserver(() => {
        addCorrectButton();
    });
    
    buttonObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
    
})();