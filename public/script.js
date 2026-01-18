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
    const sectionTitles = document.querySelectorAll('.section-title');
    sectionTitles.forEach(title => {
        title.addEventListener('click', () => {
            // Find the next sibling UL
            const list = title.nextElementSibling;
            if (list && list.classList.contains('categories')) {
                list.classList.toggle('collapsed');
                title.classList.toggle('collapsed');
            }
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

            currentTopic = topic;
            currentRegion = region;

            const regionLabel = region === 'us' ? ' (World)' : '';
            currentTopicLabel.textContent = topic + regionLabel;

            // Clear search (visual)
            searchInput.value = '';

            fetchNews(topic, region, type, customUrl);
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
    const ITEMS_PER_PAGE = 20;

    async function fetchNews(query, region = 'jp', type = 'normal', customUrl = null) {
        showLoading();

        try {
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

            // Custom Source Filtering (Client-side AI Filter for CEPR etc)
            if (type === 'custom') {
                const aiKeywords = /AI|Artificial Intelligence|Machine Learning|Deep Learning|Neural|LLM|GPT|Gemini|Claude|Intelligence|Robotics|Data Science|Algorithm|Economist|Technology|Innovation|Digital/i;
                // Expanded keywords slightly for "CEPR" context which is economic, so "Technology/Innovation" might be relevant overlap.
                // User said "AI related", sticking mainly to AI but being slightly permissive.

                items = items.filter(item => {
                    const title = item.querySelector('title')?.textContent || '';
                    const desc = item.querySelector('description')?.textContent || '';
                    const content = title + " " + desc;
                    return aiKeywords.test(content);
                });

                if (items.length === 0 && Array.from(xmlDoc.querySelectorAll('item')).length > 0) {
                    // If we filtered everything out, maybe show a message?
                    // For now, let it fall through to "No news found".
                }
            }

            // 1. Sort by Date Descending (Newest first)
            items.sort((a, b) => {
                const pubDateA = a.querySelector('pubDate')?.textContent;
                const pubDateB = b.querySelector('pubDate')?.textContent;
                if (!pubDateA) return 1;
                if (!pubDateB) return -1;
                return new Date(pubDateB) - new Date(pubDateA);
            });

            // Store for ranking usage
            allNewsItems = items;

            // Store for pagination
            allCurrentItems = items;
            displayedCount = 0;

            // Initial Render
            newsGrid.innerHTML = ''; // Clear existing
            renderNextBatch();

            // Render default ranking (Today)
            const activeTab = document.querySelector('.tab-btn.active');
            const period = activeTab ? activeTab.getAttribute('data-period') : 'today';
            renderRanking(items, period);

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

                // Check used ID for summary to be unique based on global link or title hash ideally, 
                // but simple index in batch + offset is okay? No, index in allCurrentItems is better.
                const totalIndex = allCurrentItems.indexOf(item);
                const summaryId = `summary-${totalIndex}`;
                // Auto summary only for the very first 5 items globally
                const isAutoSummary = totalIndex < 5;

                let summaryHtml = '';
                if (isAutoSummary) {
                    summaryHtml = `
                        <h4>AI要約 (生成中...)</h4>
                        <div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
                    `;
                } else {
                    summaryHtml = `
                        <button class="ai-summary-btn" onclick="requestSummary(event, '${link}', '${cleanTitle.replace(/'/g, "\\'")}', '${description.replace(/'/g, "\\'")}', '${summaryId}')">
                            <span class="material-icons" style="font-size:16px; vertical-align:middle;">auto_awesome</span>
                            AIで要約する
                        </button>
                    `;
                }

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

                if (isAutoSummary) {
                    fetchSummary(link, cleanTitle, description, summaryId);
                }

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

    async function renderRanking(items, period) {
        if (!rankingList) return;

        rankingList.innerHTML = `
            <div style="padding: 2rem; text-align: center;">
                <div class="spinner" style="width:24px; height:24px; border-width:2px; margin: 0 auto 10px;"></div>
                <div style="font-size:0.8rem; color:#666;">エコノミストAIが分析中...</div>
            </div>
        `;

        try {
            const now = new Date();

            // 1. Filter Items by Date
            const filteredItems = items.filter(item => {
                try {
                    const pubDateNode = item.querySelector('pubDate');
                    if (!pubDateNode) return false;

                    const pubDate = new Date(pubDateNode.textContent);
                    if (isNaN(pubDate.getTime())) return false; // Invalid Date

                    const diffTime = Math.abs(now - pubDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (period === 'today') return diffDays <= 1;
                    if (period === 'week') return diffDays <= 7;
                    if (period === 'month') return diffDays <= 30;
                    return true;
                } catch (err) {
                    console.warn("Date parse error", err);
                    return false;
                }
            });

            if (filteredItems.length === 0) {
                // Fallback: If no items match "Today", try showing general top items or message
                // For now, consistent message
                rankingList.innerHTML = '<li style="padding:1rem; color:#666; font-size:0.8rem;">期間内の記事が見つかりませんでした</li>';
                return;
            }

            // 2. Prepare Payload (Limit to top 20 candidates to rank)
            const candidates = filteredItems.slice(0, 20).map((item, index) => {
                const titleNode = item.querySelector('title');
                const title = titleNode ? titleNode.textContent : "No Title";
                return { id: index, title: title }; // Using index in filtered array as ID
            });

            // 3. Call AI Ranking API
            let rankedIds = [];
            try {
                const response = await fetch('/api/rank', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: candidates })
                });

                if (!response.ok) throw new Error("Ranking request failed");
                const data = await response.json();
                rankedIds = data.rankedIds || [];
            } catch (apiError) {
                console.warn("Ranking API failed, falling back to date order", apiError);
                // Fallback to empty array to trigger client-side fallback logic below
            }

            // 4. Sort items based on returned IDs
            const sortedItems = [];
            if (rankedIds.length > 0) {
                rankedIds.forEach(id => {
                    if (filteredItems[id]) {
                        sortedItems.push(filteredItems[id]);
                    }
                });
            } else {
                // If API failed or returned explicit empty, use filteredItems as is (Date sorted usually)
                // Filtered items are already in RSS order (Date Descending usually)
                sortedItems.push(...filteredItems.slice(0, 5));
            }

            // Fill remaining if needed (deduplication)
            const seenLinks = new Set(sortedItems.map(i => i.querySelector('link') ? i.querySelector('link').textContent : ""));
            filteredItems.forEach(item => {
                const link = item.querySelector('link') ? item.querySelector('link').textContent : "";
                if (!seenLinks.has(link) && sortedItems.length < 5) {
                    sortedItems.push(item);
                }
            });

            // 5. Render Top 5
            rankingList.innerHTML = '';
            sortedItems.slice(0, 5).forEach((item) => {
                const titleNode = item.querySelector('title');
                const linkNode = item.querySelector('link');

                const title = titleNode ? titleNode.textContent : "無題";
                const link = linkNode ? linkNode.textContent : "#";

                let cleanTitle = title;
                const hyphenIndex = title.lastIndexOf(' - ');
                if (hyphenIndex > 0) cleanTitle = title.substring(0, hyphenIndex);

                const li = document.createElement('li');
                li.className = 'ranking-item';
                li.onclick = () => window.open(link, '_blank');

                li.innerHTML = `
                    <div class="ranking-rank"></div>
                    <div class="ranking-content">
                        <div class="ranking-title">${cleanTitle}</div>
                    </div>
                `;
                rankingList.appendChild(li);
            });

        } catch (e) {
            console.error("Critical Ranking Render Error", e);
            rankingList.innerHTML = '<li style="padding:1rem; color:#ef4444; font-size:0.8rem;">ランキング読み込みエラー</li>';
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

    // Expose requestSummary to window so onclick can see it
    window.requestSummary = (event, link, title, desc, id) => {
        event.stopPropagation(); // Prevent card click

        const element = document.getElementById(id);
        if (element) {
            element.innerHTML = `
                <h4>AI要約 (生成中...)</h4>
                <div class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></div>
            `;
            fetchSummary(link, title, desc, id);
        }
    };
});
