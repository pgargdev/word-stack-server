// server.js (Production Ready)
// This is the backend for the Word Stack Builder Daily Challenge.

// 1. Import necessary packages
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const seedrandom = require('seedrandom');
const { Pool } = require('pg'); // Import the pg library
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Ensure node-fetch is imported correctly

// API Configuration
const RAPIDAPI_KEY = '74ec17ba35msh4eb1b447a986a98p13b04cjsn6c5c6e75e29b';
const RAPIDAPI_HOST = 'wordsapiv1.p.rapidapi.com';
const API_TIMEOUT = 2000; // 2 seconds

// 2. Initialize the Express app and Database Pool
const app = express();
const PORT = process.env.PORT || 3000; // Render provides the PORT env var

// Create a new Pool instance.
// The 'pg' library will automatically use the DATABASE_URL environment
// variable if it's available, which is perfect for Render.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Required for connecting to Neon
    }
});

// Function to create the database table if it doesn't exist
const createTable = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS scores (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            score INTEGER NOT NULL,
            date DATE NOT NULL
        );
    `;
    try {
        await pool.query(createTableQuery);
        console.log('"scores" table is ready.');
    } catch (err) {
        console.error('Error creating table', err.stack);
    }
};

// Call the function to ensure table exists when the server starts
createTable();


// 3. Load and Prepare Game Data
let comprehensiveDict = new Set();
try {
    const wordsData = fs.readFileSync('./all_words.json', 'utf8');
    const words = JSON.parse(wordsData);
    comprehensiveDict = new Set(words.map(w => w.toLowerCase()));
    console.log(`Dictionary loaded successfully with ${comprehensiveDict.size} words.`);
} catch (error) {
    console.error('Failed to load dictionary file (all_words.json).', error);
    process.exit(1);
}


// 4. Ported Game Logic (No changes here)
const VOWELS = "AEIOU";
const CONSONANTS = "BCDFGHIJKLMNPQRSTVWXYZ";

function canMakeWord(word, letters) {
    let tempLetters = [...letters];
    for (const char of word.toUpperCase()) {
        const index = tempLetters.indexOf(char);
        if (index === -1) return false;
        tempLetters.splice(index, 1);
    }
    return true;
}

function generateLetters(rng) {
    let currentLetters = [];
    const vowelCount = Math.floor(rng() * 3) + 3;
    for (let i = 0; i < vowelCount; i++) currentLetters.push(VOWELS[Math.floor(rng() * VOWELS.length)]);
    for (let i = 0; i < 9 - vowelCount; i++) currentLetters.push(CONSONANTS[Math.floor(rng() * CONSONANTS.length)]);
    for (let i = currentLetters.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [currentLetters[i], currentLetters[j]] = [currentLetters[j], currentLetters[i]];
    }
    return currentLetters;
}

function isDailySetValid(letters) {
    for (const word of comprehensiveDict) {
        if (word.length >= 5 && canMakeWord(word, letters)) return true;
    }
    console.log("Generated set was invalid, trying next seed.");
    return false;
}

function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

// 5. Middleware Setup
app.use(cors());
app.use(express.json());

// 6. API Endpoints (Updated for PostgreSQL)

app.get('/', (req, res) => {
  res.send('Word Stack Daily Challenge Server is running!');
});

app.get('/api/daily-challenge', (req, res) => {
    const seed = getTodayDateString();
    let dailyLetters;
    let attempts = 0;
    do {
        const rng = seedrandom(seed + attempts);
        dailyLetters = generateLetters(rng);
        attempts++;
    } while (!isDailySetValid(dailyLetters) && attempts < 10);
    res.json({ letters: dailyLetters });
});

app.get('/api/daily-challenge/leaderboard', async (req, res) => {
    const today = getTodayDateString();
    // PostgreSQL uses $1, $2, etc. for placeholders
    const sql = `SELECT name, score FROM scores WHERE date = $1 ORDER BY score DESC LIMIT 20`;
    try {
        const { rows } = await pool.query(sql, [today]);
        res.json(rows);
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Failed to retrieve leaderboard.' });
    }
});

app.get('/api/ai-words', (req, res) => {
    const { letters } = req.query;
    if (!letters) return res.status(400).json({ error: 'Letters are required.' });

    const aiWords = [];
    for (const word of comprehensiveDict) {
        if (canMakeWord(word, letters.split(''))) {
            aiWords.push(word);
        }
    }
    res.json({ words: aiWords });
});

async function fetchWithFallback(word) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    // --- Attempt 1: dictionaryapi.dev ---
    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            const firstMeaning = data[0].meanings[0];
            return {
                success: true,
                word: data[0].word,
                partOfSpeech: firstMeaning.partOfSpeech,
                definition: firstMeaning.definitions[0].definition
            };
        }
    } catch (error) {
        clearTimeout(timeoutId);
        console.warn(`dictionaryapi.dev failed for "${word}". Trying RapidAPI.`, error.name === 'AbortError' ? 'Timeout' : error);
    }

    // --- Attempt 2: RapidAPI (Fallback) ---
    try {
        console.log(`[RapidAPI] Attempting to fetch definition for "${word}"`);
        const response = await fetch(`https://wordsapiv1.p.rapidapi.com/words/${word}/definitions`, {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': RAPIDAPI_KEY,
                'X-RapidAPI-Host': RAPIDAPI_HOST
            }
        });
        if (response.ok) {
            const data = await response.json();
            console.log(`[RapidAPI] Successfully fetched data for "${word}":`, data);
            if (data.definitions && data.definitions.length > 0) {
                return {
                    success: true,
                    word: data.word,
                    partOfSpeech: data.definitions[0].partOfSpeech,
                    definition: data.definitions[0].definition
                };
            }
        }
    } catch (error) {
        console.error(`RapidAPI fallback also failed for "${word}".`, error);
    }

    return { success: false, error: "Both APIs failed to provide a definition." };
}


async function validateWordWithAPI(word) {
    const result = await fetchWithFallback(word);
    if (!result.success) {
        console.log(`Invalid word: ${word} - Reason: Not found in any external API.`);
    }
    return result.success;
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

async function fetchWordMeaningFromServer(word) {
    const result = await fetchWithFallback(word);
    const safeWord = escapeHtml(word);

    if (result.success) {
        return `<div class="mb-3"><h4 class="text-lg font-bold text-amber-400 capitalize">${escapeHtml(result.word)}</h4><p class="text-slate-300 italic text-sm">(${escapeHtml(result.partOfSpeech)}) ${escapeHtml(result.definition)}</p></div>`;
    } else {
        console.error("Server error fetching definition for", word, result.error);
        return `<div class="mb-3"><h4 class="text-lg font-bold text-amber-400 capitalize">${safeWord}</h4><p class="text-slate-300 italic text-sm">Could not fetch definition.</p></div>`;
    }
}

app.post('/api/daily-challenge/score', async (req, res) => {
    const { name, foundWords } = req.body;
    if (!name || !Array.isArray(foundWords)) {
        return res.status(400).json({ error: 'Invalid data.' });
    }

    // Add a limit to prevent DoS attacks from very large payloads.
    const MAX_WORDS = 200; 
    if (foundWords.length > MAX_WORDS) {
        return res.status(400).json({ error: `Submission limited to ${MAX_WORDS} words.` });
    }

    const safeName = escapeHtml(name.trim());
    if (safeName.length === 0) {
        return res.status(400).json({ error: 'Invalid data.' });
    }

    const seed = getTodayDateString();
    let dailyLetters;
    let attempts = 0;
    do {
        const rng = seedrandom(seed + attempts);
        dailyLetters = generateLetters(rng);
        attempts++;
    } while (!isDailySetValid(dailyLetters) && attempts < 10);

    let serverCalculatedScore = 0;
    const validatedWords = new Set();
    for (const word of foundWords) {
        // Ensure the item is a string before processing
        if (typeof word !== 'string') {
            continue;
        }
        const lowerCaseWord = word.toLowerCase();
        let isValid = false;

        if (comprehensiveDict.has(lowerCaseWord)) {
            isValid = true; // Word is valid in the local dictionary
        } else {
            isValid = await validateWordWithAPI(lowerCaseWord); // Validate using external API
        }

        if (!isValid) continue; // Skip invalid words
        if (!canMakeWord(lowerCaseWord, dailyLetters)) {
            console.log(`Invalid word: ${lowerCaseWord} - Reason: Cannot be formed using daily letters.`);
            continue;
        }
        if (validatedWords.has(lowerCaseWord)) {
            console.log(`Invalid word: ${lowerCaseWord} - Reason: Duplicate word.`);
            continue;
        }

        serverCalculatedScore += lowerCaseWord.length;
        validatedWords.add(lowerCaseWord);
    }

    // Fetch meanings for validated words
    const meaningsHtml = await Promise.all(
        Array.from(validatedWords).map(word => fetchWordMeaningFromServer(word))
    );

    const today = getTodayDateString();
    const sql = `INSERT INTO scores (name, score, date) VALUES ($1, $2, $3)`;
    try {
        await pool.query(sql, [safeName, serverCalculatedScore, today]);
        console.log(`A new score has been added: ${safeName} - ${serverCalculatedScore}`);
        res.status(201).json({
            success: true,
            validatedScore: serverCalculatedScore,
            meanings: meaningsHtml.join('')
        });
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Failed to save score.' });
    }
});

// 7. Start the Server
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
