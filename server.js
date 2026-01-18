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
            // Custom URL handling is done via proxying raw data.
            // Client-side script.js handles the AI keyword filtering for custom sources.

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

        // Generate content
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ summary: text });
    } catch (e) {
        console.error("Summary failed DETAILS:", JSON.stringify(e, null, 2)); // Log full object
        console.error("Summary failed MSG:", e.message);

        // Return detailed error to client for debugging (remove in prod)
        res.status(500).json({ error: "Summary generation failed", details: e.message });
    }
});

// Ranking Endpoint using Gemini SDK


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
