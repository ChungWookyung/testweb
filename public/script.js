document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const newsGrid = document.getElementById('news-grid');
    const currentTopicLabel = document.getElementById('current-topic');
    const categoryItems = document.querySelectorAll('.categories li');

    // Default topic (Japanese)
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
            // Update active state
            categoryItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Search
            const topic = item.getAttribute('data-query');
            currentTopic = topic;
            currentTopicLabel.textContent = topic;
            fetchNews(topic);
        });
    });

    function handleSearch() {
        const query = searchInput.value.trim();
        if (query) {
            currentTopic = query;
            currentTopicLabel.textContent = `検索: ${query}`;
            // Reset active categories
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

            const items = xmlDoc.querySelectorAll('item');
            renderNews(items);

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

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = descriptionRaw;
                const description = tempDiv.textContent || tempDiv.innerText || '';

                const card = document.createElement('div');
                card.className = 'card';
                // Make entire card clickable
                card.onclick = () => window.open(link, '_blank');

                // Format Date (Japanese format)
                const dateObj = new Date(pubDate);
                const dateStr = dateObj.toLocaleDateString('ja-JP', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                card.innerHTML = `
                    <div class="card-content">
                        <div class="card-date">${dateStr}</div>
                        <h3>${title}</h3>
                        <p>${description}</p>
                    </div>
                `;

                newsGrid.appendChild(card);
            } catch (e) {
                console.warn('Error parsing item', e);
            }
        });
    }

    function showLoading() {
        newsGrid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>最新ニュースを取得中...</p>
            </div>
        `;
    }
});
