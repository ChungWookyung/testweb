const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint to fetch Google News RSS
app.get('/api/news', (req, res) => {
    const query = req.query.q || 'Artificial Intelligence';
    // Google News RSS URL (Japanese)
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;

    https.get(url, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
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

// Summarize Endpoint using Gemini API
app.post('/api/summarize', express.json(), async (req, res) => {
    const { url, title, description } = req.body;
    const GEMINI_API_KEY = "AIzaSyA2H6e4JwBbLzTmqg-Gev0QuSTpMl3WHMY"; // Hardcoded as requested

    try {
        // 1. Fetch content (Try to get article body, fallback to description)
        let articleText = await fetchUrlText(url);

        // Validation: If text is too short or empty, use the provided description + title
        if (!articleText || articleText.length < 200) {
            articleText = `Title: ${title}\nDescription: ${description}`;
        } else {
            // Truncate to avoid token limits (approx 10000 chars)
            articleText = articleText.substring(0, 10000);
        }

        // 2. Call Gemini API
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const prompt = `以下のニュース記事の内容を、日本語で200文字以内に要約してください。重要なポイントを簡潔にまとめてください。\n\n記事本文:\n${articleText}`;

        const payload = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }]
        });

        const geminiReq = https.request(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (geminiRes) => {
            let data = '';
            geminiRes.on('data', (chunk) => { data += chunk; });
            geminiRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
                        const summary = json.candidates[0].content.parts[0].text;
                        res.json({ summary: summary });
                    } else {
                        // If blocked or error
                        res.status(500).json({ error: "No summary generated", details: json });
                    }
                } catch (e) {
                    res.status(500).json({ error: "Failed to parse Gemini response" });
                }
            });
        });

        geminiReq.on('error', (e) => {
            console.error(e);
            res.status(500).json({ error: "Gemini API request failed" });
        });

        geminiReq.write(payload);
        geminiReq.end();

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
