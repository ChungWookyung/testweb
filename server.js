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

// Helper to fetch text from URL (Improved implementation)
const fetchUrlText = (url) => {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : require('http');
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3'
            }
        };

        const req = protocol.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Follow redirect
                fetchUrlText(res.headers.location).then(resolve).catch(reject);
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                // Identify paragraphs
                const pTags = data.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);

                let text = "";
                if (pTags && pTags.length > 0) {
                    // Extract text from P tags
                    text = pTags.map(p => {
                        return p.replace(/<[^>]+>/g, "").trim(); // Remove tags inside p
                    }).join("\n");
                } else {
                    // Fallback to naive stripping if no p tags found (rare but possible)
                    text = data.replace(/<script[^>]*>([\s\S]*?)<\/script>/gmi, "")
                        .replace(/<style[^>]*>([\s\S]*?)<\/style>/gmi, "")
                        .replace(/<[^>]+>/g, " ")
                        .trim();
                }

                // Clean up whitespace
                text = text.replace(/\s+/g, " ").trim();
                resolve(text);
            });
        });
        req.on('error', (e) => resolve("")); // Resolve empty on error to fallback
        req.setTimeout(8000, () => {
            req.abort();
            resolve("");
        });
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
