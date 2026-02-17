const API_URL = 'https://fortnite-api.com/v2/shop';
const SEARCH_API = 'https://fortnite-api.com/v2/cosmetics/br/search/all';
const VBUCKS_ICON = 'https://fortnite-api.com/images/vbucks.png';
const ICON = 'https://fortnite-api.com/images/vbucks.png';

let fullShopData = null;
let currentFilter = 'all';
let searchQuery = '';

// Wishlist now stores full objects: { id, name, images, rarity, type, set, introduction, shopHistory }
let wishlist = JSON.parse(localStorage.getItem('fn_wishlist_v2') || '[]');

// Migration for old ID-only wishlist
if (localStorage.getItem('fn_wishlist')) {
    localStorage.removeItem('fn_wishlist');
}

async function init() {
    const container = document.getElementById('shop-container');
    const dateEl = document.getElementById('shop-date');
    const searchInput = document.getElementById('search-input');
    const globalSearchInput = document.getElementById('global-search-input');
    const filterBtns = document.querySelectorAll('.filter-btn');

    // Search listeners
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        applyFilters();
    });

    globalSearchInput.addEventListener('input', debounce((e) => {
        searchGlobalItems(e.target.value);
    }, 500));

    // Filter tab listeners
    filterBtns.forEach(btn => {
        btn.onclick = () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            applyFilters();
        };
    });

    try {
        const response = await fetch(API_URL);
        const data = await response.json();

        if (data.status !== 200) throw new Error('API Error');

        fullShopData = data.data;

        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = new Date(fullShopData.date).toLocaleDateString(undefined, options);

        applyFilters();
        startCountdown();
        checkInstallPrompt();

    } catch (error) {
        console.error(error);
        container.innerHTML = `<div class="error-container" style="text-align:center; padding: 40px;"><p class="error">Failed to load shop. Please try again later.</p><small>${error.message}</small></div>`;
    }
}

function applyFilters() {
    if (!fullShopData) return;

    let filtered = [];

    if (currentFilter === 'all') {
        filtered = [...fullShopData.entries];
    } else if (currentFilter === 'new') {
        filtered = fullShopData.entries.filter(entry => entry.new === true);
    } else if (currentFilter === 'leaving') {
        filtered = fullShopData.entries.filter(entry => (entry.layout && entry.layout.name && entry.layout.name.toLowerCase().includes('leaving')));
    } else if (currentFilter === 'wishlist') {
        // Special mapping for wishlist to support out-of-shop items
        filtered = wishlist.map(item => {
            // Check if this item is currently in the shop
            const inShopEntry = fullShopData.entries.find(e => {
                const di = getDisplayItem(e);
                return di && di.id === item.id;
            });

            if (inShopEntry) return inShopEntry;

            // If not in shop, return a mock entry wrapper for the renderer
            return {
                isOutOfShop: true,
                finalPrice: 'N/A',
                items: [item], // Original item data
                brItems: [item] // Fallback for getDisplayItem
            };
        });
    } else if (currentFilter === 'longest') {
        filtered = [...fullShopData.entries].sort((a, b) => {
            const itemA = getDisplayItem(a);
            const itemB = getDisplayItem(b);
            const dateA = (itemA && itemA.shopHistory) ? new Date(itemA.shopHistory[itemA.shopHistory.length - 2] || 0) : new Date(0);
            const dateB = (itemB && itemB.shopHistory) ? new Date(itemB.shopHistory[itemB.shopHistory.length - 2] || 0) : new Date(0);
            return dateA - dateB;
        });
    } else if (currentFilter === 'best') {
        filtered = [...fullShopData.entries].sort((a, b) => b.finalPrice - a.finalPrice);
    } else if (currentFilter === 'different') {
        filtered = fullShopData.entries.filter(entry => entry.layoutId !== 'regular');
    }

    const term = searchQuery.toLowerCase().trim();
    if (term) {
        filtered = filtered.filter(entry => {
            const displayItem = getDisplayItem(entry);
            if (!displayItem) return false;
            const name = (displayItem.name || displayItem.title || "").toLowerCase();
            const section = (entry.layout && entry.layout.name || "").toLowerCase();
            return name.includes(term) || section.includes(term);
        });
    }

    renderShop(filtered);
}

function renderShop(entries) {
    const container = document.getElementById('shop-container');
    container.innerHTML = '';

    if (currentFilter === 'wishlist' && entries.length === 0) {
        container.innerHTML = `
            <div class="empty-wishlist">
                <p style="color:rgba(255,255,255,0.4)">Your wishlist is empty.</p>
                <button class="primary-btn" onclick="openSearchModal()">Add Cosmetics</button>
            </div>
        `;
        return;
    }

    if (entries.length === 0) {
        container.innerHTML = '<div class="no-results" style="text-align:center; padding: 80px 20px; color: rgba(255,255,255,0.4);">No items found.</div>';
        return;
    }

    // Special Elevation for "All" tab
    if (currentFilter === 'all' && !searchQuery) {
        const wishlistedInShop = entries.filter(e => {
            const di = getDisplayItem(e);
            return di && wishlist.some(w => w.id === di.id);
        });

        if (wishlistedInShop.length > 0) {
            renderSection('Your Favorites', wishlistedInShop, container, true);
        }
    }

    const sections = {};
    entries.forEach(entry => {
        let sectionName = (entry.layout && entry.layout.name) || (entry.layout && entry.layout.category) || 'Featured';
        if (entry.isOutOfShop) sectionName = 'Currently Out of Shop';

        if (!sections[sectionName]) sections[sectionName] = [];
        sections[sectionName].push(entry);
    });

    // Special order for wishlist sections
    const sectionOrder = Object.keys(sections);
    if (currentFilter === 'wishlist') {
        sectionOrder.sort((a, b) => (a === 'Currently Out of Shop' ? 1 : -1));
    }

    sectionOrder.forEach(sectionName => {
        renderSection(sectionName, sections[sectionName], container);
    });

    if (currentFilter === 'wishlist') {
        const btnContainer = document.createElement('div');
        btnContainer.style.textAlign = 'center';
        btnContainer.style.padding = '20px';
        btnContainer.innerHTML = `<button class="primary-btn" onclick="openSearchModal()">Add More Items</button>`;
        container.appendChild(btnContainer);
    }
}

function renderSection(name, entries, parent, isElevation = false) {
    const section = document.createElement('section');
    section.className = isElevation ? 'shop-section favorites-section' : 'shop-section';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = name;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'items-grid';

    entries.forEach((entry, index) => {
        const displayItem = getDisplayItem(entry);
        if (displayItem) {
            const card = createItemCard(entry, displayItem, index);
            grid.appendChild(card);
        }
    });

    if (grid.children.length > 0) {
        section.appendChild(grid);
        parent.appendChild(section);
    }
}

function getDisplayItem(entry) {
    if (entry.brItems && entry.brItems.length > 0) return entry.brItems[0];
    if (entry.tracks && entry.tracks.length > 0) return entry.tracks[0];
    if (entry.instruments && entry.instruments.length > 0) return entry.instruments[0];
    if (entry.cars && entry.cars.length > 0) return entry.cars[0];
    if (entry.legoKits && entry.legoKits.length > 0) return entry.legoKits[0];
    if (entry.items && entry.items.length > 0) return entry.items[0]; // Support for mock entries
    return null;
}

function createItemCard(entry, item, index) {
    const card = document.createElement('div');
    card.className = 'item-card';
    if (entry.isOutOfShop) card.style.opacity = '0.7';

    const rarity = item.rarity ? (item.rarity.value || item.rarity.displayValue).toLowerCase() : 'common';
    const rarityColor = `var(--rarity-${rarity})`;
    const imageUrl = (item.images && (item.images.icon || item.images.featured || item.images.smallIcon || item.images.large)) || item.albumArt;

    const isWishlisted = wishlist.some(w => w.id === item.id);

    card.innerHTML = `
        <div class="item-image-container">
            ${isWishlisted ? '<div class="wishlist-badge">★</div>' : ''}
            <div class="rarity-bg" style="background: ${rarityColor}"></div>
            <img src="${imageUrl}" alt="${item.name || item.title}" loading="lazy">
        </div>
        <div class="item-info">
            <div class="item-name">${item.name || item.title}</div>
            <div class="item-details">
                <div class="price">
                    ${entry.isOutOfShop ? '<span style="font-size:0.7rem; color:rgba(255,255,255,0.4)">NOT IN SHOP</span>' : `
                        <img src="${VBUCKS_ICON}" class="vbucks-icon">
                        ${entry.finalPrice}
                    `}
                </div>
                <div class="rarity-pill" style="background: ${rarityColor}">${rarity}</div>
            </div>
        </div>
    `;

    card.onclick = () => openModal(entry, item);
    return card;
}

function openModal(entry, item) {
    const modal = document.getElementById('item-modal');
    const modalBody = document.getElementById('modal-body');

    const rarity = item.rarity ? (item.rarity.value || item.rarity.displayValue).toLowerCase() : 'common';
    const rarityColor = `var(--rarity-${rarity})`;
    const imageUrl = (item.images && (item.images.featured || item.images.icon || item.images.large)) || item.albumArt;

    // Last Seen Logic
    let lastSeenText = '';
    const history = item.shopHistory || [];

    if (history.length > 1) {
        // Most recent appearance BEFORE today (if in shop)
        const lastAppearance = history[history.length - (entry.isOutOfShop ? 1 : 2)];
        const lastDate = new Date(lastAppearance);
        const today = new Date();
        const diffDays = Math.floor(Math.abs(today - lastDate) / (1000 * 60 * 60 * 24));

        if (diffDays === 0 && !entry.isOutOfShop) {
            lastSeenText = 'New Today';
        } else {
            lastSeenText = `${diffDays} Days Ago`;
        }
    } else {
        lastSeenText = entry.isOutOfShop ? 'Released Once' : 'New Release';
    }

    const isWishlisted = wishlist.some(w => w.id === item.id);

    modalBody.innerHTML = `
        <div class="modal-hero">
            <div class="rarity-bg" style="background: ${rarityColor}; opacity: 0.15"></div>
            <img src="${imageUrl}" alt="${item.name || item.title}">
        </div>
        <div class="modal-info">
            <div style="display:flex; justify-content:space-between; align-items:start;">
                <div class="modal-rarity-text" style="color: ${rarityColor}">${rarity} ${item.type ? item.type.displayValue : ''}</div>
                <button id="wishlist-btn" class="filter-btn ${isWishlisted ? 'active' : ''}" style="margin:0; padding:4px 12px;">
                    ${isWishlisted ? '★ In Wishlist' : '☆ Favorite'}
                </button>
            </div>
            <h2 class="modal-title">${item.name || item.title}</h2>
            <div class="price-row">
                ${entry.isOutOfShop ? '<span style="color:rgba(255,255,255,0.4)">Out of Shop</span>' : `
                    <img src="${VBUCKS_ICON}">
                    ${entry.finalPrice}
                `}
            </div>
            
            <div style="margin: 20px 0;">
                <p class="modal-description">${item.description || 'No description available.'}</p>
            </div>

            <div class="modal-stats">
                <div class="stat-item">
                    <span class="stat-label">Last Seen</span>
                    <span class="stat-value">${lastSeenText} ${entry.isOutOfShop ? '' : '• In Shop'}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Part Of</span>
                    <span class="stat-value">${(item.set && item.set.text) || 'No Set'}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Introduced</span>
                    <span class="stat-value">${item.introduction ? item.introduction.text : 'Unknown'}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Total Reveals</span>
                    <span class="stat-value">${history.length}</span>
                </div>
            </div>
        </div>
    `;

    document.getElementById('wishlist-btn').onclick = () => toggleWishlist(item);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

async function searchGlobalItems(query) {
    const resultsContainer = document.getElementById('global-search-results');
    if (!query || query.length < 3) {
        resultsContainer.innerHTML = '';
        return;
    }

    resultsContainer.innerHTML = '<div style="text-align:center; padding: 20px;">Searching...</div>';

    try {
        const response = await fetch(`${SEARCH_API}?name=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.status !== 200) {
            resultsContainer.innerHTML = '<div style="color:rgba(255,255,255,0.4); text-align:center;">No items found.</div>';
            return;
        }

        const results = data.data.slice(0, 20);
        resultsContainer.innerHTML = '';

        results.forEach(item => {
            const isWishlisted = wishlist.some(w => w.id === item.id);
            const div = document.createElement('div');
            div.className = 'global-result-item';
            div.innerHTML = `
                <img src="${item.images.smallIcon || item.images.icon}" alt="">
                <div class="global-result-info">
                    <div class="global-result-name">${item.name}</div>
                    <div class="global-result-meta">${item.type.displayValue} • ${item.rarity.displayValue}</div>
                </div>
                <button class="add-btn ${isWishlisted ? 'active' : ''}" onclick="event.stopPropagation(); handleWishlistBtnClick(this, '${item.id}')">
                    ${isWishlisted ? 'Added' : 'Add'}
                </button>
            `;

            // Re-fetch full data if clicked to show modal (for shopHistory)
            div.onclick = () => {
                openModal({ isOutOfShop: true, finalPrice: '?' }, item);
            };

            // Attach item data for the toggle
            div.dataset.item = JSON.stringify(item);
            resultsContainer.appendChild(div);
        });

    } catch (e) {
        resultsContainer.innerHTML = '<div class="error">Search failed.</div>';
    }
}

function handleWishlistBtnClick(btn, id) {
    const itemData = JSON.parse(btn.closest('.global-result-item').dataset.item);
    toggleWishlist(itemData, btn);
}

function toggleWishlist(item, btnElement = null) {
    const index = wishlist.findIndex(w => w.id === item.id);
    if (index > -1) {
        wishlist.splice(index, 1);
        if (btnElement) {
            btnElement.classList.remove('active');
            btnElement.textContent = 'Add';
        }
    } else {
        // Store the full item object
        wishlist.push(item);
        if (btnElement) {
            btnElement.classList.add('active');
            btnElement.textContent = 'Added';
        }
    }
    localStorage.setItem('fn_wishlist_v2', JSON.stringify(wishlist));

    const modalBtn = document.getElementById('wishlist-btn');
    if (modalBtn) {
        const isNowWishlisted = wishlist.some(w => w.id === item.id);
        modalBtn.classList.toggle('active', isNowWishlisted);
        modalBtn.textContent = isNowWishlisted ? '★ In Wishlist' : '☆ Favorite';
    }

    applyFilters();
}

function openSearchModal() {
    document.getElementById('search-modal').classList.add('active');
    document.getElementById('global-search-input').focus();
    document.body.style.overflow = 'hidden';
}

function closeSearchModal() {
    document.getElementById('search-modal').classList.remove('active');
    if (!document.getElementById('item-modal').classList.contains('active')) {
        document.body.style.overflow = '';
    }
}

function closeModal() {
    document.getElementById('item-modal').classList.remove('active');
    document.body.style.overflow = '';
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function startCountdown() {
    const timerEl = document.getElementById('timer');
    function update() {
        const now = new Date();
        const nextReset = new Date(now);
        nextReset.setUTCHours(24, 0, 0, 0);
        const diff = nextReset - now;
        const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        if (timerEl) timerEl.textContent = `${h}:${m}:${s}`;
        if (diff <= 0) init();
    }
    setInterval(update, 1000);
    update();
}

function checkInstallPrompt() {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !isStandalone) {
        const prompt = document.getElementById('ios-prompt');
        setTimeout(() => { if (prompt) prompt.classList.remove('hidden'); }, 3000);
        const closeBtn = document.getElementById('close-prompt');
        if (closeBtn) closeBtn.onclick = () => prompt.classList.add('hidden');
    }
}

init();
