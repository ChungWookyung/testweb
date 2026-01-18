const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = 3000;
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper to initialize Gemini SDK
const getGeminiModel = () => {
    if (!GEMINI_API_KEY) throw new Error("API Key missing");
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
};

// Read API Key from api.txt (prevents hardcoding)
let GEMINI_API_KEY = "";
try {
    const apiPth = path.join(__dirname, 'api.txt');
    if (fs.existsSync(apiPth)) {
        GEMINI_API_KEY = fs.readFileSync(apiPth, 'utf-8').trim();
        console.log("API Key loaded successfully.");
    } else {
        console.warn("Warning: api.txt not found. Gemini features will not work.");
    }
} catch (error) {
    console.error("Failed to read api.txt:", error);
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint to fetch Google News RSS
// Proxy endpoint to fetch Google News RSS or Custom RSS
app.get('/api/news', (req, res) => {
    const query = req.query.q || 'Artificial Intelligence';
    const region = req.query.region || 'jp';
    const customUrl = req.query.url; // Support custom URL

    let url = '';

    if (customUrl) {
        url = customUrl;
    } else if (region === 'us') {
        // English (US)
        url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    } else {
        // Japanese (Default)
        url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
    }

    const { URL } = require('url'); // Ensure URL module is available

    // Helper to request with potential redirect handling (simple version)
    // Detailed scraper fetchUrlText is overkill for RSS which usually is simpler, but let's use https.get directly first.
    // However, CEPR might need headers or handle redirects.

    // Using a simple fetch implementation for RSS
    const protocol = url.startsWith('https') ? https : require('http');

    protocol.get(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AI-News-Bot/1.0)' // Identification
        }
    }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
            // If Custom URL, we might need to filter for AI keywords manually if requested
            if (customUrl) {
                // Determine if we should filter (implied "AI info extraction" from user request)
                // We will do simplistic text filtering on the XML string since we don't have an XML parser on server easily reachable without adding deps (cheerio/xml2js).
                // But replacing data effectively without parsing is hard.
                // Actually, the user wants "AI related info".
                // Let's rely on Client Side filtering?
                // No, user said "Extract and display".

                // Let's do a simple regex filter on <item> blocks if it's XML.
                // This is a bit "hacky" but works given we are sending XML to client.

                // 1. Split by <item>
                const parts = data.split('<item>');
                if (parts.length > 1) {
                    const header = parts[0];
                    const items = parts.slice(1);

                    const aiKeywords = /AI|Artificial Intelligence|Machine Learning|Deep Learning|Neural|LLM|GPT|Gemini|Claude|Intelligence|Robotics|Data Science|Algorithm/i;

                    const filteredItems = items.filter(item => {
                        // Check title and description
                        return aiKeywords.test(item);
                    });

                    // Reassemble
                    // Note: This relies on standard RSS structure. 
                    // If filteredItems is empty, it might return empty RSS.

                    // Clean up the last item closing tag if split casually?
                    // split('<item>') keeps the content. The last part usually has </channel></rss> at the end.
                    // Actually, <item> is the start.
                    // simpler: just pass raw data and let client/script.js sort it?
                    // Client-side filtering is easier to maintain and strictly strictly strictly strictly better here given no XML parser.
                    // But user said "Extract" (抽出). 
                    // I will pass ALL data to client, but add a filtered flag? 
                    // OR, I'll allow client to receive all and script.js acts as the intelligence layer.
                    // Wait, if the RSS is huge and non-AI is 99%, it's wasteful.
                    // But CEPR RSS shouldn't be massive.

                    // Let's pass raw data (proxy) and handle logic in script.js which has DOMParser.
                    // It is safer.
                }

                res.set('Content-Type', 'application/xml');
                res.send(data);
            });
    }).on("error", (err) => {
        console.log("Error: " + err.message);
        res.status(500).send("Error fetching news");
    });
});

// Helper to fetch text from URL (Improved implementation with logging)
const fetchUrlText = (url) => {
    return new Promise((resolve, reject) => {
        console.log(`[Scraper] Fetching: ${url}`);

        const tryFetch = (currentUrl, redirectCount = 0) => {
            if (redirectCount > 5) {
                console.log(`[Scraper] Too many redirects for ${url}`);
                resolve("");
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : require('http');
            const options = {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            };

            const req = protocol.get(currentUrl, options, (res) => {
                // Handle Redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const nextUrl = new URL(res.headers.location, currentUrl).toString();
                    console.log(`[Scraper] Redirect (${res.statusCode}) to: ${nextUrl}`);
                    tryFetch(nextUrl, redirectCount + 1);
                    return;
                }

                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    console.log(`[Scraper] Fetched ${currentUrl} - Status: ${res.statusCode}, Size: ${data.length}`);

                    // Identify paragraphs
                    const pTags = data.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);

                    let text = "";
                    if (pTags && pTags.length > 0) {
                        text = pTags.map(p => {
                            return p.replace(/<[^>]+>/g, "").trim();
                        }).join("\n");
                    } else {
                        // Fallback
                        text = data.replace(/<script[^>]*>([\s\S]*?)<\/script>/gmi, "")
                            .replace(/<style[^>]*>([\s\S]*?)<\/style>/gmi, "")
                            .replace(/<[^>]+>/g, " ")
                            .trim();
                    }

                    text = text.replace(/\s+/g, " ").trim();
                    console.log(`[Scraper] Extracted text length: ${text.length}`);
                    resolve(text);
                });
            });

            req.on('error', (e) => {
                console.error(`[Scraper] Error: ${e.message}`);
                resolve("");
            });

            req.setTimeout(8000, () => {
                req.abort();
                console.log(`[Scraper] Timeout`);
                resolve("");
            });
        };

        tryFetch(url);
    });
};

// Summarize Endpoint using Gemini API (Inference Mode)
app.post('/api/summarize', express.json(), async (req, res) => {
    const { url, title, description } = req.body;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server Configuration Error: API Key missing" });
    }

    console.log(`[Gemini] Requesting summary for: ${title}`);

    try {
        const model = getGeminiModel();
        const prompt = `以下のニュースタイトルの内容を推測し、**50文字以上100文字未満の日本語**で簡潔に解説してください。\n\nニュースタイトル: ${title}\n補足情報: ${description}\n\n出力例: AI技術は新薬開発のスピードを劇的に向上させ、開発コストの大幅な削減に寄与しています。これにより、これまで治療法がなかった疾患への画期的なアプローチが期待されています。`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ summary: text });
    } catch (e) {
        console.error("Summary failed:", e);
        res.status(500).json({ error: "Server error", details: e.message });
    }
});

// Ranking Endpoint using Gemini SDK
app.post('/api/rank', express.json(), async (req, res) => {
    const { items } = req.body;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server Configuration Error: API Key missing" });
    }

    console.log(`[Gemini] Ranking ${items.length} items...`);

    try {
        const model = getGeminiModel();
        const itemsList = items.map(item => `ID:${item.id} Title:${item.title}`).join('\n');
        const prompt = `あなたはチーフエコノミストです。以下のニュース記事リストを、エコノミストの視点で「市場や経済への影響が大きい順」にランク付けし、上位5つのIDをJSON配列で返してください。
理由などは不要です。純粋なJSON配列のみを返してください。例: [10, 2, 5, 8, 1]

ニュースリスト:
${itemsList}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (text) {
            const match = text.match(/\[.*\]/s);
            if (match) {
                const rankedIds = JSON.parse(match[0]);
                console.log(`[Gemini] Ranked IDs: ${rankedIds}`);
                res.json({ rankedIds });
            } else {
                throw new Error("No JSON array found in response");
            }
        } else {
            res.status(500).json({ error: "No ranking generated" });
        }

    } catch (e) {
        console.error("Ranking failed completely:", e);
        res.status(500).json({ error: "Server error", details: e.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
