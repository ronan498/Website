const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname)));

// Game rooms storage
const rooms = new Map();

// Questions for the game
const questions = [
    { forPlayer: "What's your favorite movie?", forGuesser: "What's their favorite movie?" },
    { forPlayer: "What's your dream vacation destination?", forGuesser: "What's their dream vacation destination?" },
    { forPlayer: "What's your favorite food?", forGuesser: "What's their favorite food?" },
    { forPlayer: "What's your biggest fear?", forGuesser: "What's their biggest fear?" },
    { forPlayer: "What's your favorite song right now?", forGuesser: "What's their favorite song right now?" },
    { forPlayer: "If you could have any superpower, what would it be?", forGuesser: "What superpower would they want?" },
    { forPlayer: "What's your favorite memory of us?", forGuesser: "What's their favorite memory of you two?" },
    { forPlayer: "What's something you've always wanted to try?", forGuesser: "What's something they've always wanted to try?" },
    { forPlayer: "What's your comfort show?", forGuesser: "What's their comfort show?" },
    { forPlayer: "What makes you happiest?", forGuesser: "What makes them happiest?" },
    { forPlayer: "What's your favorite season?", forGuesser: "What's their favorite season?" },
    { forPlayer: "What's your love language?", forGuesser: "What's their love language?" },
    { forPlayer: "What's your ideal date night?", forGuesser: "What's their ideal date night?" },
    { forPlayer: "What's a song that reminds you of us?", forGuesser: "What song reminds them of you two?" },
    { forPlayer: "What's your guilty pleasure?", forGuesser: "What's their guilty pleasure?" }
];

// Fake answers for mixing
const fakeAnswers = {
    movie: ["The Notebook", "Titanic", "Inception", "Avengers", "Harry Potter", "The Lion King", "Frozen", "Interstellar"],
    destination: ["Paris", "Tokyo", "Maldives", "New York", "Bali", "Iceland", "Hawaii", "Italy"],
    food: ["Pizza", "Sushi", "Pasta", "Tacos", "Ice Cream", "Chocolate", "Burgers", "Thai Food"],
    fear: ["Spiders", "Heights", "Dark", "Failure", "Being alone", "Public speaking", "Deep water", "Losing loved ones"],
    superpower: ["Flying", "Invisibility", "Time travel", "Mind reading", "Super strength", "Teleportation", "Healing", "Super speed"],
    generic: ["Something sweet", "Quality time", "Adventures", "Cozy nights in", "Music", "Nature", "Art", "Movies", "Reading", "Traveling", "Cooking", "Dancing", "Gaming", "Photography"]
};

// Generate room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Get fake answers based on question
function getFakeAnswers(question, correctAnswer, count = 3) {
    let pool = fakeAnswers.generic;
    
    if (question.toLowerCase().includes('movie')) pool = fakeAnswers.movie;
    else if (question.toLowerCase().includes('vacation') || question.toLowerCase().includes('destination')) pool = fakeAnswers.destination;
    else if (question.toLowerCase().includes('food')) pool = fakeAnswers.food;
    else if (question.toLowerCase().includes('fear')) pool = fakeAnswers.fear;
    else if (question.toLowerCase().includes('superpower')) pool = fakeAnswers.superpower;
    
    // Filter out correct answer and get random fakes
    const filteredPool = pool.filter(a => a.toLowerCase() !== correctAnswer.toLowerCase());
    const shuffled = filteredPool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create room
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        const room = {
            code: roomCode,
            players: [{
                id: socket.id,
                name: data.playerName,
                ready: false,
                score: 0
            }],
            gameState: 'waiting',
            currentRound: 0,
            questions: [],
            answers: {},
            guesses: {}
        };
        
        rooms.set(roomCode, room);
        socket.join(roomCode);
        
        socket.emit('roomCreated', {
            roomCode: roomCode,
            playerId: socket.id,
            players: room.players
        });
        
        console.log('Room created:', roomCode);
    });

    // Join room
    socket.on('joinRoom', (data) => {
        const room = rooms.get(data.roomCode);
        
        if (!room) {
            socket.emit('error', { message: 'Room not found!' });
            return;
        }
        
        if (room.players.length >= 2) {
            socket.emit('error', { message: 'Room is full!' });
            return;
        }
        
        if (room.gameState !== 'waiting') {
            socket.emit('error', { message: 'Game already in progress!' });
            return;
        }
        
        room.players.push({
            id: socket.id,
            name: data.playerName,
            ready: false,
            score: 0
        });
        
        socket.join(data.roomCode);
        
        socket.emit('roomJoined', {
            roomCode: data.roomCode,
            playerId: socket.id,
            players: room.players
        });
        
        socket.to(data.roomCode).emit('playerJoined', {
            players: room.players
        });
        
        console.log('Player joined room:', data.roomCode);
    });

    // Player ready
    socket.on('playerReady', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.ready = data.ready;
        }
        
        io.to(data.roomCode).emit('playerReadyUpdate', {
            players: room.players
        });
        
        // Check if both players are ready
        if (room.players.length === 2 && room.players.every(p => p.ready)) {
            startGame(data.roomCode);
        }
    });

    // Start game
    function startGame(roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        room.gameState = 'playing';
        room.currentRound = 0;
        room.players.forEach(p => p.score = 0);
        
        // Fisher-Yates shuffle for unbiased randomization
        const shuffled = [...questions];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        room.questions = shuffled.slice(0, 5);
        
        io.to(roomCode).emit('gameStarting', {
            totalRounds: room.questions.length
        });
        
        // Start first round after a short delay
        setTimeout(() => startRound(roomCode), 1500);
    }

    // Start round
    function startRound(roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        room.currentRound++;
        room.answers = {};
        room.guesses = {};
        
        const question = room.questions[room.currentRound - 1];
        
        // Send question to all players
        io.to(roomCode).emit('questionPhase', {
            round: room.currentRound,
            question: question.forPlayer,
            timeLimit: 30
        });
        
        // Auto-proceed after timeout
        room.roundTimeout = setTimeout(() => {
            // Submit empty answers for players who didn't answer
            room.players.forEach(p => {
                if (!room.answers[p.id]) {
                    room.answers[p.id] = '(No answer)';
                }
            });
            startGuessPhase(roomCode);
        }, 32000);
    }

    // Submit answer
    socket.on('submitAnswer', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room) return;
        
        room.answers[socket.id] = data.answer;
        
        // Check if both answered
        if (Object.keys(room.answers).length === 2) {
            clearTimeout(room.roundTimeout);
            startGuessPhase(data.roomCode);
        }
    });

    // Start guess phase
    function startGuessPhase(roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        const question = room.questions[room.currentRound - 1];
        
        // Send guess phase to each player
        room.players.forEach(player => {
            const partner = room.players.find(p => p.id !== player.id);
            const correctAnswer = room.answers[partner.id];
            const fakes = getFakeAnswers(question.forPlayer, correctAnswer, 3);
            
            const allAnswers = [correctAnswer, ...fakes];
            
            io.to(player.id).emit('guessPhase', {
                question: question.forGuesser,
                answers: allAnswers,
                timeLimit: 20
            });
        });
        
        // Auto-proceed after timeout
        room.guessTimeout = setTimeout(() => {
            // Submit wrong guesses for players who didn't guess
            room.players.forEach(p => {
                if (!room.guesses[p.id]) {
                    room.guesses[p.id] = '(No guess)';
                }
            });
            endRound(roomCode);
        }, 22000);
    }

    // Submit guess
    socket.on('submitGuess', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room) return;
        
        room.guesses[socket.id] = data.guess;
        
        // Check if both guessed
        if (Object.keys(room.guesses).length === 2) {
            clearTimeout(room.guessTimeout);
            endRound(data.roomCode);
        }
    });

    // End round
    function endRound(roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        const isLastRound = room.currentRound >= room.questions.length;
        
        // Calculate results for each player
        room.players.forEach(player => {
            const partner = room.players.find(p => p.id !== player.id);
            const playerGuess = room.guesses[player.id];
            const partnerAnswer = room.answers[partner.id];
            const isCorrect = playerGuess && partnerAnswer && 
                playerGuess.toLowerCase().trim() === partnerAnswer.toLowerCase().trim();
            
            if (isCorrect) {
                player.score++;
            }
            
            const partnerGuess = room.guesses[partner.id];
            const playerAnswer = room.answers[player.id];
            const partnerCorrect = partnerGuess && playerAnswer && 
                partnerGuess.toLowerCase().trim() === playerAnswer.toLowerCase().trim();
            
            io.to(player.id).emit('roundResult', {
                yourResult: { correct: isCorrect, guess: playerGuess },
                partnerResult: { correct: partnerCorrect, guess: partnerGuess },
                yourAnswer: playerAnswer,
                partnerAnswer: partnerAnswer,
                isLastRound: isLastRound
            });
        });
        
        // Next round or end game
        setTimeout(() => {
            if (isLastRound) {
                endGame(roomCode);
            } else {
                startRound(roomCode);
            }
        }, 4000);
    }

    // End game
    function endGame(roomCode) {
        const room = rooms.get(roomCode);
        if (!room) return;
        
        room.gameState = 'finished';
        
        const results = room.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score
        }));
        
        io.to(roomCode).emit('gameOver', { results });
    }

    // Play again
    socket.on('playAgain', (data) => {
        const room = rooms.get(data.roomCode);
        if (!room) return;
        
        room.gameState = 'waiting';
        room.players.forEach(p => {
            p.ready = false;
            p.score = 0;
        });
        
        io.to(data.roomCode).emit('playerReadyUpdate', {
            players: room.players
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Find and clean up rooms
        for (const [code, room] of rooms.entries()) {
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                
                if (room.players.length === 0) {
                    clearTimeout(room.roundTimeout);
                    clearTimeout(room.guessTimeout);
                    rooms.delete(code);
                    console.log('Room deleted:', code);
                } else {
                    room.gameState = 'waiting';
                    room.players.forEach(p => p.ready = false);
                    io.to(code).emit('playerLeft', { players: room.players });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Love Quiz server running at http://localhost:${PORT}`);
    console.log(`📱 Open http://localhost:${PORT}/games.html to play!`);
});
