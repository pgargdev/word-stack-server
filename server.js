// server.js
// This is the backend for the Word Stack Builder Daily Challenge.

// 1. Import necessary packages
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const seedrandom = require('seedrandom');
const sqlite3 = require('sqlite3').verbose(); // Use verbose mode for more detailed logs

// 2. Initialize the Express app and Database
const app = express();
const PORT = 3000;
const db = new sqlite3.Database('./leaderboard.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create the scores table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            score INTEGER NOT NULL,
            date TEXT NOT NULL
        )`);
    }
});


// 3. Load and Prepare Game Data
let comprehensiveDict = new Set();
try {
    const wordsData = fs.readFileSync('./all_words.json', 'utf8');
    const words = JSON.parse(wordsData);
    comprehensiveDict = new Set(words.map(w => w.toLowerCase()));
    console.log(`Dictionary loaded successfully with ${comprehensiveDict.size} words.`);
} catch (error) {
    console.error('Failed to load dictionary file (all_words.json). Make sure it exists in the same directory as the server.', error);
    process.exit(1);
}


// 4. Ported Game Logic from Frontend
const VOWELS = "AEIOU";
const CONSONANTS = "BCDFGHIJKLMNPQRSTVWXYZ";

function canMakeWord(word, letters) {
    let tempLetters = [...letters];
    for (const char of word.toUpperCase()) {
        const index = tempLetters.indexOf(char);
        if (index === -1) {
            return false;
        }
        tempLetters.splice(index, 1);
    }
    return true;
}

function generateLetters(rng) {
    let currentLetters = [];
    const vowelCount = Math.floor(rng() * 3) + 3;
    for (let i = 0; i < vowelCount; i++) {
        currentLetters.push(VOWELS[Math.floor(rng() * VOWELS.length)]);
    }
    for (let i = 0; i < 9 - vowelCount; i++) {
        currentLetters.push(CONSONANTS[Math.floor(rng() * CONSONANTS.length)]);
    }
    
    for (let i = currentLetters.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [currentLetters[i], currentLetters[j]] = [currentLetters[j], currentLetters[i]];
    }
    
    return currentLetters;
}

function isDailySetValid(letters) {
    for (const word of comprehensiveDict) {
        if (word.length >= 5 && canMakeWord(word, letters)) {
            return true;
        }
    }
    console.log("Generated set was invalid, trying next seed.");
    return false;
}

// Helper function to get today's date string
function getTodayDateString() {
    return new Date().toISOString().slice(0, 10);
}

// 5. Middleware Setup
app.use(cors());
app.use(express.json());

// 6. API Endpoints

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

    console.log(`Generated daily letters for ${seed}: ${dailyLetters.join(', ')}`);
    res.json({ letters: dailyLetters });
});

// GET /api/daily-challenge/leaderboard
// Fetches today's leaderboard from the database.
app.get('/api/daily-challenge/leaderboard', (req, res) => {
    const today = getTodayDateString();
    const sql = `SELECT name, score FROM scores WHERE date = ? ORDER BY score DESC LIMIT 20`;

    db.all(sql, [today], (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).json({ error: 'Failed to retrieve leaderboard.' });
            return;
        }
        res.json(rows);
    });
});

// POST /api/daily-challenge/score
// Validates and submits a score to the database.
app.post('/api/daily-challenge/score', (req, res) => {
    const { name, foundWords } = req.body;

    // Basic validation
    if (!name || !Array.isArray(foundWords)) {
        return res.status(400).json({ error: 'Invalid data. Name and foundWords are required.' });
    }

    // --- Server-Side Validation ---
    // 1. Regenerate today's letters to validate against.
    const seed = getTodayDateString();
    let dailyLetters;
    let attempts = 0;
    do {
        const rng = seedrandom(seed + attempts);
        dailyLetters = generateLetters(rng);
        attempts++;
    } while (!isDailySetValid(dailyLetters) && attempts < 10);

    // 2. Calculate the score on the server to prevent cheating.
    let serverCalculatedScore = 0;
    const validatedWords = new Set();

    for (const word of foundWords) {
        const lowerCaseWord = word.toLowerCase();
        // Check if word is valid, can be made, and hasn't been counted yet
        if (
            lowerCaseWord.length >= 3 &&
            comprehensiveDict.has(lowerCaseWord) &&
            canMakeWord(lowerCaseWord, dailyLetters) &&
            !validatedWords.has(lowerCaseWord)
        ) {
            serverCalculatedScore += lowerCaseWord.length;
            validatedWords.add(lowerCaseWord);
        }
    }

    // 3. Insert the validated score into the database.
    const today = getTodayDateString();
    const sql = `INSERT INTO scores (name, score, date) VALUES (?, ?, ?)`;
    
    db.run(sql, [name, serverCalculatedScore, today], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Failed to save score.' });
        }
        console.log(`A new score has been added with ID ${this.lastID}: ${name} - ${serverCalculatedScore}`);
        res.status(201).json({ success: true, validatedScore: serverCalculatedScore });
    });
});


// 7. Start the Server
app.listen(PORT, () => {
  console.log(`Server is listening on http://localhost:${PORT}`);
});
