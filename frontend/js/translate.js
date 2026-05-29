// frontend/js/translate.js - Language persistence across all pages

// Hide Google Translate's ugly UI
const hideGoogleStyles = `
    <style>
        .goog-te-banner-frame.skiptranslate,
        .goog-te-banner-frame,
        .goog-te-balloon-frame,
        .goog-te-tooltip,
        .goog-te-menu-frame,
        .skiptranslate,
        iframe.skiptranslate,
        .goog-te-gadget {
            display: none !important;
            visibility: hidden !important;
            height: 0 !important;
            width: 0 !important;
            overflow: hidden !important;
        }
        body {
            top: 0px !important;
            position: relative !important;
        }
        
        /* Your custom translate button style */
        .translate-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: rgba(17, 82, 212, 0.15);
            border: 1px solid rgba(17, 82, 212, 0.3);
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 13px;
            font-weight: 500;
            color: #e2e8f0;
        }
        .translate-btn:hover {
            background: rgba(17, 82, 212, 0.3);
            border-color: rgba(17, 82, 212, 0.5);
        }
        .translate-btn i {
            width: 18px;
            height: 18px;
        }
        @media (max-width: 640px) {
            .translate-btn span {
                display: none;
            }
            .translate-btn {
                padding: 8px 10px;
            }
        }
    </style>
`;

document.head.insertAdjacentHTML('beforeend', hideGoogleStyles);

// Add hidden Google Translate element
const googleDiv = document.createElement('div');
googleDiv.id = 'google_translate_element';
googleDiv.style.display = 'none';
document.body.appendChild(googleDiv);

// Get saved language preference
let savedLanguage = localStorage.getItem('preferredLanguage') || 'en';
let isTranslating = false;

// Initialize Google Translate
window.googleTranslateElementInit = function() {
    new google.translate.TranslateElement({
        pageLanguage: 'en',
        includedLanguages: 'en,es',
        autoDisplay: false
    }, 'google_translate_element');
    
    // Wait for widget to load
    setTimeout(() => {
        const select = document.querySelector('.goog-te-combo');
        if (select) {
            // Apply saved language preference
            if (savedLanguage === 'es') {
                select.value = 'es';
                select.dispatchEvent(new Event('change'));
                updateButtonUI('es');
            } else {
                updateButtonUI('en');
            }
        }
        
        // Hide Google's UI elements
        document.querySelectorAll('.goog-te-gadget, .goog-te-banner-frame').forEach(el => {
            if (el) el.style.display = 'none';
        });
        document.body.style.top = '0px';
    }, 500);
};

// Update button UI based on language
function updateButtonUI(lang) {
    const buttons = document.querySelectorAll('.translate-btn');
    buttons.forEach(btn => {
        const span = btn.querySelector('.lang-text');
        const icon = btn.querySelector('.lang-icon');
        if (span) {
            span.textContent = lang === 'es' ? 'Español' : 'English';
        }
        if (icon) {
            if (lang === 'es') {
                icon.innerHTML = '<i data-lucide="globe" class="w-4 h-4"></i>';
            } else {
                icon.innerHTML = '<i data-lucide="languages" class="w-4 h-4"></i>';
            }
        }
    });
    
    if (typeof lucide !== 'undefined') {
        setTimeout(() => lucide.createIcons(), 100);
    }
}

// Toggle language function (called when button is clicked)
window.toggleLanguage = function() {
    if (isTranslating) return;
    isTranslating = true;
    
    const select = document.querySelector('.goog-te-combo');
    if (!select) {
        setTimeout(() => {
            isTranslating = false;
            window.toggleLanguage();
        }, 500);
        return;
    }
    
    // Get current language from select or saved preference
    let currentLang = savedLanguage;
    
    if (currentLang === 'en') {
        // Switch to Spanish
        select.value = 'es';
        savedLanguage = 'es';
        updateButtonUI('es');
    } else {
        // Switch to English
        select.value = 'en';
        savedLanguage = 'en';
        updateButtonUI('en');
    }
    
    // Trigger translation
    select.dispatchEvent(new Event('change'));
    
    // Save preference
    localStorage.setItem('preferredLanguage', savedLanguage);
    
    // Hide popups that appear after translation
    setTimeout(() => {
        const popups = document.querySelectorAll('.goog-te-balloon-frame, .goog-te-tooltip');
        popups.forEach(p => {
            if (p) p.style.display = 'none';
        });
        document.body.style.top = '0px';
        isTranslating = false;
    }, 500);
};

// Keep hiding Google popups (they keep trying to appear)
setInterval(() => {
    const popups = document.querySelectorAll('.goog-te-balloon-frame, .goog-te-tooltip, iframe.skiptranslate');
    popups.forEach(p => {
        if (p) p.style.display = 'none';
    });
    if (document.body && document.body.style.top !== '0px') {
        document.body.style.top = '0px';
    }
}, 2000);

// Load Google Translate API
const googleScript = document.createElement('script');
googleScript.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
document.head.appendChild(googleScript);