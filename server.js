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
    return genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
};

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const Parser = require('rss-parser');

// Read Email Config
let EMAIL_CONFIG = null;
try {
    const configPath = path.join(__dirname, 'email_config.json');
    if (fs.existsSync(configPath)) {
        EMAIL_CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else {
        console.warn("Warning: email_config.json not found. Email features will not work.");
    }
} catch (error) {
    console.error("Failed to read email_config.json:", error);
}

// Read Mailing List
const getMailingList = () => {
    try {
        const listPath = path.join(__dirname, 'mail-list.txt');
        if (fs.existsSync(listPath)) {
            return fs.readFileSync(listPath, 'utf-8')
                .split('\n')
                .map(email => email.trim())
                .filter(email => email && email.includes('@')); // Simple validation
        }
    } catch (error) {
        console.error("Failed to read mail-list.txt:", error);
    }
    return [];
};

// Daily News Email Task
const sendDailyNewsEmail = async () => {
    console.log("Starting daily news email task...");

    if (!EMAIL_CONFIG || !EMAIL_CONFIG.auth || !EMAIL_CONFIG.auth.user) {
        console.error("Email configuration missing. Skipping task.");
        return;
    }

    if (!GEMINI_API_KEY) {
        console.error("Gemini API Key missing. Skipping task.");
        return;
    }

    const recipients = getMailingList();
    if (recipients.length === 0) {
        console.warn("No recipients found in mail-list.txt. Skipping task.");
        return;
    }

    try {
        // 1. Fetch News (Japan Economy context)
        const parser = new Parser();
        // search for "日本 経済" (Japan Economy) to ensure relevance for economists
        const feedUrl = 'https://news.google.com/rss/search?q=%E6%97%A5%E6%9C%AC%20%E7%BB%8F%E6%B5%8E&hl=ja&gl=JP&ceid=JP:ja';
        const feed = await parser.parseURL(feedUrl);

        // 2. Filter for "New!" (Last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const newArticles = feed.items.filter(item => {
            const pubDate = new Date(item.pubDate);
            return pubDate >= oneDayAgo;
        });

        if (newArticles.length === 0) {
            console.log("No new articles found in the last 24 hours.");
            return;
        }

        console.log(`Found ${newArticles.length} new articles.`);

        // 3. Select Top 5 & Summarize via Gemini
        const model = getGeminiModel();

        // Prepare list for prompt (Title + Link + Snippet if available)
        const articlesListText = newArticles.map((item, index) => {
            return `${index + 1}. ${item.title}`;
        }).join('\n');

        const prompt = `
あなたは優秀な経済アナリストのアシスタントです。
以下のニュース記事リスト（過去24時間以内）から、**エコノミストにとって最も重要で注目すべき5つのニュース**を選出してください。

選出した各ニュースについて、以下の形式で出力してください：
1. ニュースのタイトル
2. そのニュースの要約（日本語、50〜100文字程度）

ニュースリスト:
${articlesListText}
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const emailBodyContent = response.text();

        // 4. Send Email
        const transporter = nodemailer.createTransport({
            service: EMAIL_CONFIG.service,
            auth: EMAIL_CONFIG.auth
        });

        const mailOptions = {
            from: EMAIL_CONFIG.auth.user,
            bcc: recipients, // Use BCC to hide recipients from each other
            subject: `【日刊】エコノミスト向け重要ニュースまとめ (${new Date().toLocaleDateString('ja-JP')})`,
            text: `おはようございます。\n\n本日のエコノミスト向け重要ニュースをお届けします。\n\n${emailBodyContent}\n\n---\nAI News Bot`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);

    } catch (error) {
        console.error("Error in daily news email task:", error);
    }
};

// Schedule task for 8:00 AM JST
// Cron syntax: Second Minute Hour Day Month DayOfWeek
cron.schedule('0 0 8 * * *', () => {
    console.log("Running scheduled task: Daily News Email");
    sendDailyNewsEmail();
}, {
    timezone: "Asia/Tokyo"
});

// Test endpoint to trigger email manually (for verification)
app.post('/api/test-email', async (req, res) => {
    console.log("Manual trigger of daily news email...");
    try {
        await sendDailyNewsEmail();
        res.json({ message: "Email task triggered. Check server logs for details." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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

// Simple in-memory cache
const newsCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

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

    // Check Cache
    const cacheKey = url;
    if (newsCache.has(cacheKey)) {
        const cached = newsCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_DURATION) {
            console.log(`[Cache] Hit for: ${url}`);
            res.set('Content-Type', 'application/xml');
            return res.send(cached.data);
        }
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

            // Save to Cache
            newsCache.set(cacheKey, {
                timestamp: Date.now(),
                data: data
            });

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

// Persistent Summary Cache
const SUMMARY_CACHE_FILE = path.join(__dirname, 'summary_cache.json');
let summaryCache = {};

// Load cache from disk
try {
    if (fs.existsSync(SUMMARY_CACHE_FILE)) {
        summaryCache = JSON.parse(fs.readFileSync(SUMMARY_CACHE_FILE, 'utf-8'));
        console.log(`[Cache] Loaded ${Object.keys(summaryCache).length} summaries from disk.`);
    }
} catch (e) {
    console.error("Failed to load summary cache:", e);
}

// Helper to save cache
const saveSummaryCache = () => {
    try {
        fs.writeFileSync(SUMMARY_CACHE_FILE, JSON.stringify(summaryCache, null, 2));
    } catch (e) {
        console.error("Failed to save summary cache:", e);
    }
};

// Summarize Endpoint using Gemini API (Inference Mode)
app.post('/api/summarize', express.json(), async (req, res) => {
    const { url, title, description } = req.body;

    // Check Cache first (Use URL as key, fallback to title if needed)
    const cacheKey = url || title;
    if (summaryCache[cacheKey]) {
        console.log(`[Summary Cache] Hit for: ${title}`);
        return res.json({ summary: summaryCache[cacheKey] });
    }

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

        // Save to Cache
        if (text) {
            summaryCache[cacheKey] = text;
            saveSummaryCache(); // Persist immediately
        }

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
