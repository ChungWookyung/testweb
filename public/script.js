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

    // ... (rest) ...

    categoryItems.forEach(item => {
        item.addEventListener('click', () => {
            categoryItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const topic = item.getAttribute('data-query');
            const region = item.getAttribute('data-region') || 'jp';

            currentTopic = topic;
            currentRegion = region;

            const regionLabel = region === 'us' ? ' (World)' : '';
            currentTopicLabel.textContent = topic + regionLabel;

            fetchNews(topic, region);
        });
    });

    // ... (rest) ...

    function handleSearch() {
        const query = searchInput.value.trim();
        if (query) {
            currentTopic = query;
            currentTopicLabel.textContent = `検索: ${query}`;
            categoryItems.forEach(i => i.classList.remove('active'));
            fetchNews(query, currentRegion); // Use current region logic or default? Default to JP for search maybe, or keep current.
        }
    }

    async function fetchNews(query, region = 'jp') {
        showLoading();

        try {
            const response = await fetch(`/api/news?q=${encodeURIComponent(query)}&region=${region}`);
            // ... (rest same) ...
            if (!response.ok) throw new Error('Network response was not ok');

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

            const items = Array.from(xmlDoc.querySelectorAll('item'));

            // Store for ranking usage
            allNewsItems = items;

            renderNews(items);

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

    function renderNews(items) {
        newsGrid.innerHTML = '';

        if (items.length === 0) {
            newsGrid.innerHTML = '<p style="text-align: center; grid-column: 1/-1;">ニュースが見つかりませんでした。</p>';
            return;
        }

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
                // Clean description (Fix: Do not remove anchor nodes, just get text)
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = descriptionRaw;
                // Just get text content, which strips tags but keeps text
                let description = tempDiv.textContent || tempDiv.innerText || '';
                // Clean up whitespace
                description = description.replace(/\s+/g, ' ').trim();

                // Clean title (remove source suffix if present for better AI context)
                let cleanTitle = title;
                const hyphenIndex = title.lastIndexOf(' - ');
                if (hyphenIndex > 0) cleanTitle = title.substring(0, hyphenIndex);

                const card = document.createElement('div');
                card.className = 'card';
                card.onclick = () => window.open(link, '_blank');

                const dateObj = new Date(pubDate);
                const dateStr = dateObj.toLocaleDateString('ja-JP', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                // Check for image enclosure (optional enhancement, but keeping simple for now)
                // New Split Layout
                const index = items.indexOf(item);
                const summaryId = `summary-${index}`;
                const isAutoSummary = index < 5;

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
                        <div class="card-date">${dateStr}</div>
                        <h3>${title}</h3> <!-- Display full title in UI -->
                        <div class="card-source">${source}</div>
                    </div>
                    <div class="card-summary" id="${summaryId}">
                        ${summaryHtml}
                    </div>
                `;

                newsGrid.appendChild(card);

                // Trigger Async Summary ONLY for first 5
                if (isAutoSummary) {
                    fetchSummary(link, cleanTitle, description, summaryId);
                }

            } catch (e) {
                console.warn('Error parsing item', e);
            }
        });
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
        rankingList.innerHTML = `
            <div style="padding: 2rem; text-align: center;">
                <div class="spinner" style="width:24px; height:24px; border-width:2px; margin: 0 auto 10px;"></div>
                <div style="font-size:0.8rem; color:#666;">エコノミストAIが分析中...</div>
            </div>
        `;

        const now = new Date();

        // 1. Filter Items by Date
        const filteredItems = items.filter(item => {
            const pubDate = new Date(item.querySelector('pubDate').textContent);
            const diffTime = Math.abs(now - pubDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (period === 'today') return diffDays <= 1;
            if (period === 'week') return diffDays <= 7;
            if (period === 'month') return diffDays <= 30;
            return true;
        });

        if (filteredItems.length === 0) {
            rankingList.innerHTML = '<li style="padding:1rem; color:#666; font-size:0.8rem;">該当する記事がありません</li>';
            return;
        }

        // 2. Prepare Payload (Limit to top 20 candidates to rank)
        const candidates = filteredItems.slice(0, 20).map((item, index) => {
            const title = item.querySelector('title').textContent;
            return { id: index, title: title }; // Using index in filtered array as ID
        });

        try {
            // 3. Call AI Ranking API
            const response = await fetch('/api/rank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: candidates })
            });

            if (!response.ok) throw new Error("Ranking failed");

            const data = await response.json();
            const rankedIds = data.rankedIds || [];

            // 4. Sort items based on returned IDs
            // If ID not in list, put at bottom
            const sortedItems = [];
            rankedIds.forEach(id => {
                if (filteredItems[id]) {
                    sortedItems.push(filteredItems[id]);
                }
            });

            // Fill remaining if less than 5 returned (though prompt asks for 5)
            // or if API failed to return valid IDs. 
            // Also ensure we have unique items.
            const seenLinks = new Set(sortedItems.map(i => i.querySelector('link').textContent));
            filteredItems.forEach(item => {
                const link = item.querySelector('link').textContent;
                if (!seenLinks.has(link) && sortedItems.length < 5) {
                    sortedItems.push(item);
                }
            });

            // 5. Render Top 5
            rankingList.innerHTML = '';
            sortedItems.slice(0, 5).forEach((item) => {
                const title = item.querySelector('title').textContent;
                const link = item.querySelector('link').textContent;

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
            console.error("Ranking Error", e);
            // Fallback: Date Based (original logic)
            rankingList.innerHTML = '';
            filteredItems.slice(0, 5).forEach((item) => {
                const title = item.querySelector('title').textContent;
                const link = item.querySelector('link').textContent;
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
