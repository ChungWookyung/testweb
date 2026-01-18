const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = 3000;

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
app.get('/api/news', (req, res) => {
    const query = req.query.q || 'Artificial Intelligence';
    const region = req.query.region || 'jp';

    let url = '';

    if (region === 'us') {
        // English (US)
        url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    } else {
        // Japanese (Default)
        url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
    }

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

// Summarize Endpoint using Gemini API (Inference Mode)
app.post('/api/summarize', express.json(), async (req, res) => {
    const { url, title, description } = req.body;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server Configuration Error: API Key missing" });
    }

    console.log(`[Gemini] Requesting summary for: ${title}`);

    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;
        // Changed prompt to request 50-100 characters
        const prompt = `以下のニュースタイトルの内容を推測し、**50文字以上100文字未満の日本語**で簡潔に解説してください。\n\nニュースタイトル: ${title}\n補足情報: ${description}\n\n出力例: AI技術は新薬開発のスピードを劇的に向上させ、開発コストの大幅な削減に寄与しています。これにより、これまで治療法がなかった疾患への画期的なアプローチが期待されています。`;
        const payload = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

        const geminiReq = https.request(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (geminiRes) => {
            let data = '';
            geminiRes.on('data', c => data += c);
            geminiRes.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
                        res.json({ summary: json.candidates[0].content.parts[0].text });
                    } else {
                        res.status(500).json({ error: "No summary", details: json });
                    }
                } catch (e) { res.status(500).json({ error: "Parse error" }); }
            });
        });
        geminiReq.on('error', e => res.status(500).json({ error: "Network error" }));
        geminiReq.write(payload);
        geminiReq.end();
    } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// Ranking Endpoint
app.post('/api/rank', express.json(), async (req, res) => {
    const { items } = req.body;

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server Configuration Error: API Key missing" });
    }

    console.log(`[Gemini] Ranking ${items.length} items...`);

    // Helper function to call Gemini API
    const callGeminiRanking = (model) => {
        return new Promise((resolve, reject) => {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
            const itemsList = items.map(item => `ID:${item.id} Title:${item.title}`).join('\n');
            const prompt = `あなたはチーフエコノミストです。以下のニュース記事リストを、エコノミストの視点で「市場や経済への影響が大きい順」にランク付けし、上位5つのIDをJSON配列で返してください。
理由などは不要です。純粋なJSON配列のみを返してください。例: [10, 2, 5, 8, 1]

ニュースリスト:
${itemsList}`;

            const payload = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

            const req = https.request(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`API Error: ${res.statusCode} ${data}`));
                    } else {
                        resolve(data);
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.write(payload);
            req.end();
        });
    };

    try {
        // Try requested "gemini-2.5-flash-lite" first
        console.log("Attempting ranking with gemini-2.5-flash-lite...");
        let data = await callGeminiRanking('gemini-2.5-flash-lite').catch(async (e) => {
            console.warn(`gemini-2.5-flash-lite failed (${e.message}). Falling back to gemini-1.5-flash.`);
            return await callGeminiRanking('gemini-1.5-flash');
        });

        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
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
