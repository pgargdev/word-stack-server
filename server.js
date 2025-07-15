// server.js (Production Ready)
// This is the backend for the Word Stack Builder Daily Challenge.

// 1. Import necessary packages
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const seedrandom = require('seedrandom');
const { Pool } = require('pg'); // Import the pg library

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

app.post('/api/daily-challenge/score', async (req, res) => {
    const { name, foundWords } = req.body;
    if (!name || !Array.isArray(foundWords)) {
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
        const lowerCaseWord = word.toLowerCase();
        if (comprehensiveDict.has(lowerCaseWord) && canMakeWord(lowerCaseWord, dailyLetters) && !validatedWords.has(lowerCaseWord)) {
            serverCalculatedScore += lowerCaseWord.length;
            validatedWords.add(lowerCaseWord);
        }
    }

    const today = getTodayDateString();
    const sql = `INSERT INTO scores (name, score, date) VALUES ($1, $2, $3)`;
    try {
        await pool.query(sql, [name, serverCalculatedScore, today]);
        console.log(`A new score has been added: ${name} - ${serverCalculatedScore}`);
        res.status(201).json({ success: true, validatedScore: serverCalculatedScore });
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Failed to save score.' });
    }
});

// 7. Start the Server
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
