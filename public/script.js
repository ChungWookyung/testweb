document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const newsGrid = document.getElementById('news-grid');
    const currentTopicLabel = document.getElementById('current-topic');
    const categoryItems = document.querySelectorAll('.categories li');

    // ... (rest is same) ...

    // Default topic
    let currentTopic = '人工知能';
    let currentRegion = 'jp';

    // Initial Fetch
    fetchNews(currentTopic, currentRegion);

    // Event Listeners
    searchBtn.addEventListener('click', () => handleSearch());
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Sidebar Toggle Logic
    // Sidebar Toggle Logic (Updated for Nested Structure)
    const sectionTitles = document.querySelectorAll('.section-title');
    sectionTitles.forEach(title => {
        title.addEventListener('click', () => {
            const section = title.parentElement;
            // Toggle all categories lists within this section
            const categories = section.querySelectorAll('.categories');
            categories.forEach(cat => cat.classList.toggle('collapsed'));

            // Toggle title arrow
            title.classList.toggle('collapsed');
        });
    });

    categoryItems.forEach(item => {
        item.addEventListener('click', () => {
            categoryItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const topic = item.getAttribute('data-query');
            const region = item.getAttribute('data-region') || 'jp';
            const type = item.getAttribute('data-type');
            const customUrl = item.getAttribute('data-url');
            const noFilter = item.getAttribute('data-no-filter') === 'true';

            currentTopic = topic;
            currentRegion = region;

            const regionLabel = region === 'us' ? ' (World)' : '';
            currentTopicLabel.textContent = topic + regionLabel;

            // Clear search (visual)
            searchInput.value = '';

            fetchNews(topic, region, type, customUrl, noFilter);
        });
    });

    // ... (rest) ...

    function handleSearch() {
        const query = searchInput.value.trim();
        if (query) {
            currentTopic = query;
            currentTopicLabel.textContent = `検索: ${query}`;
            categoryItems.forEach(i => i.classList.remove('active'));
            fetchNews(query, currentRegion); // Default fetch
        }
    }

    // State for pagination
    let allCurrentItems = [];
    let displayedCount = 0;
    const ITEMS_PER_PAGE = 10;

    // Helper to fetch RSS items (Reusable)
    async function fetchRSSItems(query, region, type, customUrl, noFilter = false) {
        let apiUrl = `/api/news?q=${encodeURIComponent(query)}&region=${region}`;
        if (type === 'custom' && customUrl) {
            apiUrl += `&url=${encodeURIComponent(customUrl)}`;
        }

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');

        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        let items = Array.from(xmlDoc.querySelectorAll('item'));

        // Custom Source Filtering
        if (type === 'custom' && !noFilter) {
            const aiKeywords = /AI|Artificial Intelligence|Machine Learning|Deep Learning|Neural|LLM|GPT|Gemini|Claude|Intelligence|Robotics|Data Science|Algorithm|Economist|Technology|Innovation|Digital/i;
            items = items.filter(item => {
                const title = item.querySelector('title')?.textContent || '';
                const desc = item.querySelector('description')?.textContent || '';
                const content = title + " " + desc;
                return aiKeywords.test(content);
            });
        }
        return items;
    }

    async function fetchNews(query, region = 'jp', type = 'normal', customUrl = null, noFilter = false) {
        showLoading();

        try {
            const items = await fetchRSSItems(query, region, type, customUrl, noFilter);

            // 1. Sort by Date Descending
            items.sort((a, b) => {
                const pubDateA = a.querySelector('pubDate')?.textContent;
                const pubDateB = b.querySelector('pubDate')?.textContent;
                if (!pubDateA) return 1;
                if (!pubDateB) return -1;
                return new Date(pubDateB) - new Date(pubDateA);
            });

            // Store for pagination
            allCurrentItems = items;
            displayedCount = 0;

            // Initial Render
            newsGrid.innerHTML = '';
            renderNextBatch();

        } catch (error) {
            console.error('Error fetching news:', error);
            newsGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; color: #ef4444;">
                    <h3>ニュースの取得に失敗しました</h3>
                    <p>接続を確認して、もう一度お試しください。</p>
                </div>
            `;
        }
    }

    function renderNextBatch() {
        const nextItems = allCurrentItems.slice(displayedCount, displayedCount + ITEMS_PER_PAGE);

        if (nextItems.length === 0 && displayedCount === 0) {
            newsGrid.innerHTML = '<p style="text-align: center; grid-column: 1/-1;">ニュースが見つかりませんでした。</p>';
            return;
        }

        renderNewsBatch(nextItems);
        displayedCount += nextItems.length;

        // Manage Load More Button
        manageLoadMoreButton();
    }

    function manageLoadMoreButton() {
        // Remove existing button if any
        const existingBtn = document.getElementById('load-more-btn');
        if (existingBtn) existingBtn.remove(); // We will re-append it at the bottom

        // Check if we have more items to show
        if (displayedCount < allCurrentItems.length) {
            const btnContainer = document.createElement('div');
            btnContainer.id = 'load-more-btn';
            btnContainer.className = 'load-more-container'; // For styling
            btnContainer.style.gridColumn = "1 / -1";
            btnContainer.style.textAlign = "center";
            btnContainer.style.marginTop = "20px";

            btnContainer.innerHTML = `
                <button class="load-more-btn">
                    More <span class="material-icons-round" style="font-size: 1.2em; vertical-align: bottom;">expand_more</span>
                </button>
            `;

            btnContainer.querySelector('button').onclick = () => {
                // Remove button logic is handled inside manageLoadMoreButton call at end of renderNextBatch
                renderNextBatch();
            };

            newsGrid.appendChild(btnContainer);
        }
    }

    function renderNewsBatch(items) {
        items.forEach(item => {
            try {
                const title = item.querySelector('title').textContent;
                const link = item.querySelector('link').textContent;
                const pubDate = item.querySelector('pubDate').textContent;
                const descriptionRaw = item.querySelector('description').textContent;

                // Parse Source
                let source = "Googleニュース";
                const sourceTag = item.querySelector('source');
                if (sourceTag) {
                    source = sourceTag.textContent;
                }

                // Clean description
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = descriptionRaw;
                let description = tempDiv.textContent || tempDiv.innerText || '';
                description = description.replace(/\s+/g, ' ').trim();

                // Clean title
                let cleanTitle = title;
                const hyphenIndex = title.lastIndexOf(' - ');
                if (hyphenIndex > 0) cleanTitle = title.substring(0, hyphenIndex);

                const card = document.createElement('div');
                card.className = 'card';
                card.onclick = () => window.open(link, '_blank');

                const dateObj = new Date(pubDate);
                // 2. Relative Time Display
                const relativeTime = getRelativeTime(dateObj);
                const dateStr = dateObj.toLocaleDateString('ja-JP', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                const totalIndex = allCurrentItems.indexOf(item);
                const summaryId = `summary-${totalIndex}`;

                // ALWAYS Auto Summary
                const summaryHtml = `
                    <h4>AI要約 (生成中...)</h4>
                    <div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
                `;

                card.innerHTML = `
                    <div class="card-main">
                        <div class="card-meta">
                           <span class="card-date">${dateStr}</span>
                           <span class="card-relative-time">${relativeTime}</span>
                        </div>
                        <h3>${title}</h3>
                        <div class="card-source">${source}</div>
                    </div>
                    <div class="card-summary" id="${summaryId}">
                        ${summaryHtml}
                    </div>
                `;

                newsGrid.appendChild(card);

                // Auto trigger summary for EVERY item
                fetchSummary(link, cleanTitle, description, summaryId);

            } catch (e) {
                console.warn('Error parsing item', e);
            }
        });
    }

    function getRelativeTime(date) {
        const now = new Date();
        const diff = now - date; // milliseconds
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const weeks = Math.floor(days / 7);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);

        if (minutes < 60) {
            return `${minutes}分前`;
        } else if (hours < 24) {
            return `${hours}時間前`;
        } else if (days < 7) {
            return `${days}日前`;
        } else if (days < 30) {
            return `${weeks}週間前`;
        } else if (days < 365) {
            return `${months}か月前`;
        } else {
            return `${years}年前`;
        }
    }

    async function fetchSummary(url, title, description, elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;

        try {
            // Delay to avoid hitting rate limits instantly
            await new Promise(r => setTimeout(r, Math.random() * 2000));

            const res = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, title, description })
            });

            if (!res.ok) throw new Error('API Error');
            const data = await res.json();

            if (data.summary) {
                element.innerHTML = `
                    <h4>AI要約</h4>
                    <p>${data.summary}</p>
                `;
            } else {
                throw new Error('No summary');
            }

        } catch (e) {
            console.warn('Summary failed', e);
            // Fallback to RSS description
            element.innerHTML = `
                <h4>要約 (AI生成失敗)</h4>
                <p>${description}</p>
            `;
        }
    }

    function showLoading() {
        newsGrid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>紙面を更新中...</p>
            </div>
        `;
    }

    // New Function: Check for Updates in Background
    async function checkTopicUpdates() {
        const categories = document.querySelectorAll('.categories li');
        const now = new Date();
        const oneDayMs = 24 * 60 * 60 * 1000;

        for (const item of categories) {
            const query = item.getAttribute('data-query');
            const region = item.getAttribute('data-region') || 'jp';
            const type = item.getAttribute('data-type');
            const customUrl = item.getAttribute('data-url');
            const noFilter = item.getAttribute('data-no-filter') === 'true';

            // Skip current active topic to avoid double fetch if just loaded? 
            // Better to show the count anyway for consistency.

            try {
                // Gentle delay between requests to avoid 429
                await new Promise(resolve => setTimeout(resolve, 800));

                const items = await fetchRSSItems(query, region, type, customUrl, noFilter);

                let newCount = 0;
                items.forEach(article => {
                    const pubDateNode = article.querySelector('pubDate');
                    if (pubDateNode) {
                        const date = new Date(pubDateNode.textContent);
                        if (!isNaN(date) && (now - date) < oneDayMs) {
                            newCount++;
                        }
                    }
                });

                if (newCount > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'update-count';
                    badge.innerHTML = `+${newCount}`;
                    item.appendChild(badge);
                }

            } catch (err) {
                console.warn(`Update check failed for ${query}`, err);
            }
        }
    }

    // Call update check after initial load
    setTimeout(checkTopicUpdates, 2000);
});
