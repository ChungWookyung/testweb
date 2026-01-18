document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const newsGrid = document.getElementById('news-grid');
    const currentTopicLabel = document.getElementById('current-topic');
    const categoryItems = document.querySelectorAll('.categories li');

    // Ranking elements
    const rankingList = document.getElementById('ranking-list');
    const rankingTabs = document.querySelectorAll('.tab-btn');
    let allNewsItems = []; // Store fetched items for ranking filtering

    // Default topic
    let currentTopic = '人工知能';

    // Initial Fetch
    fetchNews(currentTopic);

    // Event Listeners
    searchBtn.addEventListener('click', () => handleSearch());
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    categoryItems.forEach(item => {
        item.addEventListener('click', () => {
            categoryItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const topic = item.getAttribute('data-query');
            currentTopic = topic;
            currentTopicLabel.textContent = topic;
            fetchNews(topic);
        });
    });

    // Ranking Tab Click
    rankingTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            rankingTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const period = tab.getAttribute('data-period');
            // Update ranking list based on period using cached items
            renderRanking(allNewsItems, period);
        });
    });

    function handleSearch() {
        const query = searchInput.value.trim();
        if (query) {
            currentTopic = query;
            currentTopicLabel.textContent = `検索: ${query}`;
            categoryItems.forEach(i => i.classList.remove('active'));
            fetchNews(query);
        }
    }

    async function fetchNews(query) {
        showLoading();

        try {
            const response = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
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
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = descriptionRaw;
                // Remove existing "View full coverage" links often found in Google RSS
                const anchors = tempDiv.querySelectorAll('a');
                anchors.forEach(a => a.remove());
                let description = tempDiv.textContent || tempDiv.innerText || '';
                if (description.length > 100) description = description.substring(0, 100) + '...';

                const card = document.createElement('div');
                card.className = 'card';
                card.onclick = () => window.open(link, '_blank');

                const dateObj = new Date(pubDate);
                const dateStr = dateObj.toLocaleDateString('ja-JP', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                // Check for image enclosure (optional enhancement, but keeping simple for now)
                // New Split Layout
                card.innerHTML = `
                    <div class="card-main">
                        <div class="card-date">${dateStr}</div>
                        <h3>${title}</h3>
                        <div class="card-source">${source}</div>
                    </div>
                    <div class="card-summary">
                        <h4>記事の要約</h4>
                        <p>${description}</p>
                    </div>
                `;

                newsGrid.appendChild(card);
            } catch (e) {
                console.warn('Error parsing item', e);
            }
        });
    }

    function renderRanking(items, period) {
        rankingList.innerHTML = '';
        const now = new Date();

        // Filter Items by Date
        const filteredItems = items.filter(item => {
            const pubDate = new Date(item.querySelector('pubDate').textContent);
            const diffTime = Math.abs(now - pubDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (period === 'today') return diffDays <= 1; // within 24h
            if (period === 'week') return diffDays <= 7;
            if (period === 'month') return diffDays <= 30;
            return true;
        });

        // Use top 5 of filtered items
        const topItems = filteredItems.slice(0, 5);

        if (topItems.length === 0) {
            rankingList.innerHTML = '<li style="padding:1rem; color:#666; font-size:0.8rem;">該当する記事がありません</li>';
            return;
        }

        topItems.forEach((item) => {
            const title = item.querySelector('title').textContent;
            const link = item.querySelector('link').textContent;

            // Clean title (remove source suffix often added by Google like " - Media Name")
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

    function showLoading() {
        newsGrid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>紙面を更新中...</p>
            </div>
        `;
    }
});
