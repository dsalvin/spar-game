import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';

// Using the user-provided Firebase configuration
const appId = "1:940315975648:web:8ecef283a456ed7952d585"; // User's specific appId
const firebaseConfig = {
    apiKey: "AIzaSyDNKADpY1RIoStJVsmhs5AMa73fPTiecEg",
    authDomain: "spar-84a09.firebaseapp.com",
    projectId: "spar-84a09",
    storageBucket: "spar-84a09.firebasestorage.app",
    messagingSenderId: "940315975648",
    appId: "1:940315975648:web:8ecef283a456ed7952d585",
    measurementId: "G-ZH67RY18JV"
};
const initialAuthToken = null; // Not used in local setup

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Card suits and ranks for deck generation
const SUITS = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6']; // Ace to 6

// Card rank values for comparison (higher value means higher rank)
const CARD_RANK_VALUES = {
    'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6
};

// Map suit codes to Unicode symbols
const SUIT_SYMBOLS = {
    'H': '♥', // Hearts
    'D': '♦', // Diamonds
    'C': '♣', // Clubs
    'S': '♠'  // Spades
};

// Function to create a standard 35-card deck for Spar
const createDeck = () => {
    let deck = [];
    for (let suit of SUITS) {
        for (let rank of RANKS) {
            // Exclude Ace of Spades
            if (rank === 'A' && suit === 'S') {
                continue;
            }
            deck.push(`${suit}${rank}`); // e.g., "H7", "SK"
        }
    }
    return deck;
};

// Function to shuffle a deck
const shuffleDeck = (deck) => {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]]; // Swap
    }
    return deck;
};

// Function to get the rank of a card (e.g., 'A' from 'HA')
const getCardRank = (card) => card.substring(1);

// Function to get the suit of a card (e.g., 'H' from 'HA')
const getSuit = (card) => card.substring(0, 1);

// Function to determine the winner of a trick
const determineTrickWinner = (trick, leadSuit) => {
    let winningCard = null;
    let winningPlayerId = null;
    let highestRankValue = -1;

    // Iterate through cards played in the trick
    for (const { playerId, card } of trick) {
        const cardSuit = getSuit(card);
        const cardRank = getCardRank(card);
        const rankValue = CARD_RANK_VALUES[cardRank];

        // Only consider cards that follow the lead suit, or if no card has been set as winning yet
        if (cardSuit === leadSuit) {
            if (rankValue > highestRankValue) {
                highestRankValue = rankValue;
                winningCard = card;
                winningPlayerId = playerId;
            }
        }
    }
    return { winningPlayerId, winningCard };
};

// Function to calculate points based on the winning card of the last trick
const calculateScore = (winningCard) => {
    const rank = getCardRank(winningCard);
    switch (rank) {
        case '6': return 3;
        case '7': return 2;
        case '8':
        case '9':
        case '10':
        case 'J':
        case 'Q':
        case 'K':
        case 'A': return 1;
        default: return 0;
    }
};

// Main App Component
function App() {
    const [currentUser, setCurrentUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [playerName, setPlayerName] = useState('');
    const [currentRoomId, setCurrentRoomId] = useState(null);
    const [gameRoom, setGameRoom] = useState(null);
    const [message, setMessage] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [modalContent, setModalContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [gameTargetScore, setGameTargetScore] = useState(10); // New state for target score
    const [chatMessages, setChatMessages] = useState([]); // State for chat messages
    const [newChatMessage, setNewChatMessage] = useState(''); // State for new chat message input
    const [joinRoomIdInput, setJoinRoomIdInput] = useState('');

    const playerRef = useRef(null); // Ref to store player data for quick access
    const chatContainerRef = useRef(null); // Ref for scrolling chat messages
    const lastTrickMessageRef = useRef('');

    // Firebase Authentication and User ID setup
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setCurrentUser(user);
                setUserId(user.uid);
            } else {
                // Sign in anonymously if no user is authenticated
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (error) {
                    console.error("Error signing in:", error);
                    setMessage("Failed to sign in. Please try again.");
                }
            }
            setIsLoading(false); // Authentication process completed
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    useEffect(() => {
      if (!gameRoom?.lastTrickMessage) return;

      // Only show if it's a new message
      if (lastTrickMessageRef.current !== gameRoom.lastTrickMessage) {
        lastTrickMessageRef.current = gameRoom.lastTrickMessage;

        showMessageModal(gameRoom.lastTrickMessage);

        // Optionally trigger new round if roundWinnerId is set
        setTimeout(() => {
          if (gameRoom.roundWinnerId) {
            startNewRound(gameRoom.roundWinnerId);
          }
        }, 2000);
      }
    }, [gameRoom?.lastTrickMessage]);



    // Effect to set up real-time listener for the current game room
    useEffect(() => {
        let unsubscribeRoom = null;
        let unsubscribeChat = null;

        if (currentRoomId && userId) {
            const roomDocRef = doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId);
            unsubscribeRoom = onSnapshot(roomDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    const roomData = docSnap.data();
                    setGameRoom(roomData);
                    // Update playerRef for quick access to current player's data
                    playerRef.current = roomData.players.find(p => p.id === userId);
                    // Handle game state changes and display messages
                    updateGameMessages(roomData);
                } else {
                    setGameRoom(null);
                    setCurrentRoomId(null);
                    setMessage("The game room no longer exists.");
                }
            }, (error) => {
                console.error("Error fetching room data:", error);
                setMessage("Error loading game room.");
            });

            // Set up real-time listener for chat messages
            const chatCollectionRef = collection(db, `artifacts/${appId}/public/data/sparRooms/${currentRoomId}/chatMessages`);
            unsubscribeChat = onSnapshot(chatCollectionRef, (snapshot) => {
                const messages = snapshot.docs.map(doc => doc.data()).sort((a, b) => a.timestamp - b.timestamp);
                setChatMessages(messages);
            }, (error) => {
                console.error("Error fetching chat messages:", error);
            });
        } else {
            setGameRoom(null); // Clear game room if not in one
            setChatMessages([]); // Clear chat messages
        }

        return () => {
            if (unsubscribeRoom) {
                unsubscribeRoom();
            }
            if (unsubscribeChat) {
                unsubscribeChat();
            }
        };
    }, [currentRoomId, userId]); // Re-run when currentRoomId or userId changes

    // Scroll to bottom of chat messages when new messages arrive
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatMessages]);

    // Function to display modal messages
    const showMessageModal = (content) => {
        setModalContent(content);
        setShowModal(true);
    };

    // Function to update game messages based on room state
    const updateGameMessages = (roomData) => {
        if (!roomData) return;

        const currentPlayer = roomData.players.find(p => p.id === roomData.currentPlayerId);
        const localPlayer = roomData.players.find(p => p.id === userId);

        if (roomData.status === 'waiting') {
            setMessage(`Waiting for players. Room ID: ${roomData.id}. Players: ${roomData.players.length}/7. Share this ID with friends!`);
            if (roomData.players.length >= 2 && roomData.players[0].id === userId) {
                setMessage(prev => prev + " You can start the game.");
            }
        } else if (roomData.status === 'playing') {
            if (roomData.currentPlayerId === userId) {
                setMessage("It's your turn!");
            } else {
                setMessage(`Waiting for ${currentPlayer?.name}'s turn.`);
            }
            if (roomData.currentTrick.length > 0) {
                const lastPlayed = roomData.currentTrick[roomData.currentTrick.length - 1];
                const playerWhoPlayed = roomData.players.find(p => p.id === lastPlayed.playerId);
                setMessage(prev => `${playerWhoPlayed?.name} played ${lastPlayed.card}. ${prev}`);
            }
        } else if (roomData.status === 'round_end') {
            const winner = roomData.players.find(p => p.id === roomData.roundWinnerId);
            showMessageModal(`${winner?.name} won the round! Starting next round...`);
        } else if (roomData.status === 'game_end') {
            const winner = roomData.players.find(p => p.id === roomData.gameWinnerId);
            showMessageModal(`${winner?.name} won the game!`);
        }
    };

    // Function to create a new game room
    const createRoom = async () => {
        if (!playerName) {
            showMessageModal("Please enter your name to create a room.");
            return;
        }
        if (!userId) {
            showMessageModal("Authentication not ready. Please wait.");
            return;
        }
        if (gameTargetScore < 1) {
            showMessageModal("Target score must be at least 1.");
            return;
        }

        setIsLoading(true);
        try {
            // Generate a simple room ID
            const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
            const roomDocRef = doc(db, `artifacts/${appId}/public/data/sparRooms`, newRoomId);

            const initialPlayer = { id: userId, name: playerName, score: 0, hand: [] };

            await setDoc(roomDocRef, {
                id: newRoomId,
                status: 'waiting',
                players: [initialPlayer],
                dealerId: userId, // First player is the initial dealer
                currentPlayerId: userId, // First player leads first trick
                currentTrick: [],
                leadSuit: null,
                trickCount: 0,
                roundWinnerId: null,
                gameWinnerId: null,
                gameTargetScore: gameTargetScore, // Use the user-defined target score
                lastTrickWinningCard: null, // To store the card that won the last trick for scoring
                lastTrickWinnerId: null, // To store the player who won the last trick for scoring
            });
            setCurrentRoomId(newRoomId);
            setMessage(`Room created! ID: ${newRoomId}. Waiting for players...`);
        } catch (error) {
            console.error("Error creating room:", error);
            showMessageModal("Failed to create room. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Function to join an existing game room
    const joinRoom = async (roomIdToJoin) => {
        if (!playerName) {
            showMessageModal("Please enter your name to join a room.");
            return;
        }
        if (!userId) {
            showMessageModal("Authentication not ready. Please wait.");
            return;
        }
        if (!roomIdToJoin) {
            showMessageModal("Please enter a Room ID.");
            return;
        }

        setIsLoading(true);
        try {
            const roomDocRef = doc(db, `artifacts/${appId}/public/data/sparRooms`, roomIdToJoin);
            const docSnap = await getDoc(roomDocRef);

            if (docSnap.exists()) {
                const roomData = docSnap.data();
                if (roomData.players.length >= 7) {
                    showMessageModal("Room is full (max 7 players).");
                    return;
                }
                if (roomData.players.some(p => p.id === userId)) {
                    showMessageModal("You are already in this room.");
                    setCurrentRoomId(roomIdToJoin);
                    return;
                }
                if (roomData.status !== 'waiting') {
                    showMessageModal("Game has already started in this room.");
                    return;
                }

                const updatedPlayers = [...roomData.players, { id: userId, name: playerName, score: 0, hand: [] }];
                await updateDoc(roomDocRef, { players: updatedPlayers });
                setCurrentRoomId(roomIdToJoin);
                setMessage(`Joined room ${roomIdToJoin}.`);
            } else {
                showMessageModal("Room not found.");
            }
        } catch (error) {
            console.error("Error joining room:", error);
            showMessageModal("Failed to join room. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Function to start the game (only callable by the first player in the room)
    const startGame = async () => {
        if (!gameRoom || gameRoom.status !== 'waiting') {
            showMessageModal("Game cannot be started.");
            return;
        }
        if (gameRoom.players.length < 2) {
            showMessageModal("Need at least 2 players to start the game.");
            return;
        }
        if (gameRoom.players[0].id !== userId) {
            showMessageModal("Only the first player in the room can start the game.");
            return;
        }

        setIsLoading(true);
        try {
            let deck = createDeck();
            deck = shuffleDeck(deck);

            const updatedPlayers = gameRoom.players.map(player => ({
                id: player.id,
                name: player.name,
                score: player.score, // ✅ preserve score
                hand: [] // only clear hand
            }));

            const numPlayers = updatedPlayers.length;
            const cardsPerPlayer = 5;

            // Deal cards: 3 cards then 2 cards
            for (let i = 0; i < cardsPerPlayer; i++) {
                for (let j = 0; j < numPlayers; j++) {
                    if (deck.length > 0) {
                        updatedPlayers[j].hand.push(deck.pop());
                    }
                }
            }

            // Determine who leads the first trick of the round (player left of dealer)
            const dealerIndex = updatedPlayers.findIndex(p => p.id === gameRoom.dealerId);
            const firstPlayerIndex = (dealerIndex + 1) % numPlayers;
            const firstPlayerToLeadId = updatedPlayers[firstPlayerIndex].id;

            await updateDoc(doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId), {
                status: 'playing',
                players: updatedPlayers,
                currentTrick: [],
                leadSuit: null,
                trickCount: 0,
                currentPlayerId: firstPlayerToLeadId,
                roundWinnerId: null,
                lastTrickWinningCard: null,
                lastTrickWinnerId: null,
            });
            setMessage("Game started! Cards dealt.");
        } catch (error) {
            console.error("Error starting game:", error);
            showMessageModal("Failed to start game. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Function to play a card
    const playCard = async (card) => {
        
        if (!gameRoom || gameRoom.status !== 'playing' || gameRoom.currentPlayerId !== userId) {
            showMessageModal("It's not your turn or the game is not active.");
            return;
        }

        const localPlayer = gameRoom.players.find(p => p.id === userId);
        if (!localPlayer || !localPlayer.hand.includes(card)) {
            showMessageModal("You don't have that card or it's invalid.");
            return;
        }

        const cardSuit = getSuit(card);
        const currentLeadSuit = gameRoom.leadSuit;
        const playerHandSuits = localPlayer.hand.map(c => getSuit(c));

        // Rule: Players must follow suit if possible
        if (currentLeadSuit && cardSuit !== currentLeadSuit && playerHandSuits.includes(currentLeadSuit)) {
            showMessageModal(`You must play a ${SUIT_SYMBOLS[currentLeadSuit]} card if you have one.`);
            return;
        }

        setIsLoading(true);
        try {
            // Remove card from player's hand
            const updatedPlayers = gameRoom.players.map(p =>
                p.id === userId ? { ...p, hand: p.hand.filter(c => c !== card) } : p
            );

            const newCurrentTrick = [...gameRoom.currentTrick, { playerId: userId, card }];
            let newLeadSuit = currentLeadSuit || cardSuit; // Set lead suit if it's the first card of the trick

            let nextPlayerId = null;
            let newTrickCount = gameRoom.trickCount;
            let newRoundWinnerId = gameRoom.roundWinnerId;
            let newLastTrickWinningCard = gameRoom.lastTrickWinningCard;
            let newLastTrickWinnerId = gameRoom.lastTrickWinnerId;
            let newGameStatus = gameRoom.status;
            let newGameWinnerId = gameRoom.gameWinnerId;

            // Check if trick is complete
            if (newCurrentTrick.length === updatedPlayers.length) {
                // Trick is complete, determine winner
                const { winningPlayerId, winningCard } = determineTrickWinner(newCurrentTrick, newLeadSuit);
                showMessageModal(`${updatedPlayers.find(p => p.id === winningPlayerId)?.name} wins the trick with ${winningCard}!`);

                newTrickCount++;
                nextPlayerId = winningPlayerId; // Winner of the trick leads the next

                // If it's the last trick (5th trick)
                if (newTrickCount === 5) {
                  const points = calculateScore(winningCard);
                  const updatedPlayersAfterScoring = updatedPlayers.map(p =>
                      p.id === winningPlayerId ? { ...p, score: p.score + points } : p
                  );

                  newRoundWinnerId = winningPlayerId;
                  newLastTrickWinningCard = winningCard;
                  newLastTrickWinnerId = winningPlayerId;

                  const gameWinner = updatedPlayersAfterScoring.find(p => p.score >= gameRoom.gameTargetScore);
                  if (gameWinner) {
                      newGameStatus = 'game_end';
                      newGameWinnerId = gameWinner.id;
                      showMessageModal(`${gameWinner.name} reached ${gameWinner.score} points and won the game!`);
                  } else {
                      newGameStatus = 'round_end';
                      showMessageModal(`Round over! ${updatedPlayers.find(p => p.id === winningPlayerId)?.name} won the last trick with ${winningCard} and scored ${points} points.`);
                  }

                  const trickWinner = updatedPlayers.find(p => p.id === winningPlayerId);
                  const winner = updatedPlayers.find(p => p.id === winningPlayerId);
                  const winnerName = winner?.name || 'Someone';
                  // ✅ Don't clear currentTrick yet — let it show in the UI
                  await updateDoc(doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId), {
                      status: newGameStatus,
                      players: updatedPlayersAfterScoring,
                      // Leave currentTrick alone so users can see the last play
                      leadSuit: null,
                      trickCount: 0,
                      currentPlayerId: newGameStatus === 'game_end' ? null : winningPlayerId,
                      roundWinnerId: newRoundWinnerId,
                      gameWinnerId: newGameWinnerId,
                      lastTrickWinningCard: newLastTrickWinningCard,
                      lastTrickWinnerId: newLastTrickWinnerId,
                      lastTrickMessage: `${winnerName} won the trick with ${winningCard}`,
                  });

                  // ✅ After a delay, start the new round (which clears currentTrick)
                  if (newGameStatus !== 'game_end') {
                      setTimeout(() => startNewRound(newRoundWinnerId), 3000); // 3 sec delay to show the trick
                  }

                } else {
                    const winner = updatedPlayers.find(p => p.id === winningPlayerId);
                    const winnerName = winner?.name || 'Someone';
                    // Trick complete, but not last trick of round
                    await updateDoc(doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId), {
                        players: updatedPlayers,
                        currentTrick: [], // Reset trick
                        leadSuit: null, // Reset lead suit
                        trickCount: newTrickCount,
                        currentPlayerId: nextPlayerId, // Winner of trick leads next
                        lastTrickMessage: `${winnerName} won the trick with ${winningCard}`,
                    });
                }
            } else {
                // Trick not complete, move to next player
                const currentPlayerIndex = updatedPlayers.findIndex(p => p.id === userId);
                const nextPlayerIndex = (currentPlayerIndex + 1) % updatedPlayers.length;
                nextPlayerId = updatedPlayers[nextPlayerIndex].id;

                await updateDoc(doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId), {
                    players: updatedPlayers,
                    currentTrick: newCurrentTrick,
                    leadSuit: newLeadSuit,
                    currentPlayerId: nextPlayerId,
                });
            }
        } catch (error) {
            console.error("Error playing card:", error);
            showMessageModal("Failed to play card. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Function to start a new round
    const startNewRound = async (newDealerId) => {
    if (!currentRoomId) return;

    setIsLoading(true);
    try {
        // ✅ Fetch the latest room data from Firestore
        const roomDocRef = doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId);
        const docSnap = await getDoc(roomDocRef);

        if (!docSnap.exists()) {
            console.error("Room no longer exists.");
            return;
        }

        const latestRoomData = docSnap.data();

        let deck = createDeck();
        deck = shuffleDeck(deck);

        const updatedPlayers = latestRoomData.players.map(player => ({
            id: player.id,
            name: player.name,
            score: player.score, // ✅ Preserve the correct score
            hand: []
        }));

        const numPlayers = updatedPlayers.length;
        const cardsPerPlayer = 5;

        for (let i = 0; i < cardsPerPlayer; i++) {
            for (let j = 0; j < numPlayers; j++) {
                if (deck.length > 0) {
                    updatedPlayers[j].hand.push(deck.pop());
                }
            }
        }

        const dealerIndex = updatedPlayers.findIndex(p => p.id === newDealerId);
        const firstPlayerIndex = (dealerIndex + 1) % numPlayers;
        const firstPlayerToLeadId = updatedPlayers[firstPlayerIndex].id;

        await updateDoc(roomDocRef, {
            status: 'playing',
            players: updatedPlayers,
            dealerId: newDealerId,
            currentPlayerId: firstPlayerToLeadId,
            currentTrick: [],
            leadSuit: null,
            trickCount: 0,
            roundWinnerId: null,
            lastTrickWinningCard: null,
            lastTrickWinnerId: null,
        });

        setMessage("New round started! Cards dealt.");
    } catch (error) {
        console.error("Error starting new round:", error);
        showMessageModal("Failed to start new round. Please try again.");
    } finally {
        setIsLoading(false);
    }
};


    // Function to reset the game (for the room creator)
    const resetGame = async () => {
        if (!gameRoom || gameRoom.players[0].id !== userId) {
            showMessageModal("Only the room creator can reset the game.");
            return;
        }

        setIsLoading(true);
        try {
            const initialPlayers = gameRoom.players.map(p => ({ ...p, score: 0, hand: [] }));
            await updateDoc(doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId), {
                status: 'waiting',
                players: initialPlayers,
                dealerId: userId,
                currentPlayerId: userId,
                currentTrick: [],
                leadSuit: null,
                trickCount: 0,
                roundWinnerId: null,
                gameWinnerId: null,
                lastTrickWinningCard: null,
                lastTrickWinnerId: null,
                gameTargetScore: 10, // Reset target score to default
            });
            setMessage("Game reset. Waiting for players to start a new game.");
        } catch (error) {
            console.error("Error resetting game:", error);
            showMessageModal("Failed to reset game. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Function to leave the current room
    const leaveRoom = async () => {
        if (!currentRoomId || !userId) return;

        setIsLoading(true);
        try {
            const roomDocRef = doc(db, `artifacts/${appId}/public/data/sparRooms`, currentRoomId);
            const docSnap = await getDoc(roomDocRef);

            if (docSnap.exists()) {
                const roomData = docSnap.data();
                const updatedPlayers = roomData.players.filter(p => p.id !== userId);

                if (updatedPlayers.length === 0) {
                    // If no players left, delete the room
                    await deleteDoc(roomDocRef);
                } else {
                    // Update room with remaining players
                    // If the leaving player was the dealer or current player, reassign
                    let newDealerId = roomData.dealerId;
                    let newCurrentPlayerId = roomData.currentPlayerId;

                    if (roomData.dealerId === userId) {
                        newDealerId = updatedPlayers[0].id; // Assign first remaining player as new dealer
                    }
                    if (roomData.currentPlayerId === userId) {
                        newCurrentPlayerId = updatedPlayers[0].id; // Assign first remaining player as next player
                    }

                    await updateDoc(roomDocRef, {
                        players: updatedPlayers,
                        dealerId: newDealerId,
                        currentPlayerId: newCurrentPlayerId
                    });
                }
            }
            setCurrentRoomId(null);
            setGameRoom(null);
            setMessage("You have left the room.");
        } catch (error) {
            console.error("Error leaving room:", error);
            showMessageModal("Failed to leave room. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Function to send a chat message
    const sendChatMessage = async () => {
        if (!currentRoomId || !userId || !newChatMessage.trim()) {
            return; // Don't send empty messages
        }

        const chatCollectionRef = collection(db, `artifacts/${appId}/public/data/sparRooms/${currentRoomId}/chatMessages`);
        const localPlayerName = playerName || `User-${userId.substring(0, 4)}`;

        try {
            await addDoc(chatCollectionRef, {
                senderId: userId,
                senderName: localPlayerName,
                message: newChatMessage.trim(),
                timestamp: Date.now(),
            });
            setNewChatMessage(''); // Clear input field
        } catch (error) {
            console.error("Error sending chat message:", error);
            showMessageModal("Failed to send message.");
        }
    };

    // Helper component for rendering a single card
    const Card = ({ card, onClick, disabled, isPlayedCard = false, className = '' }) => {
        const suit = getSuit(card);
        const rank = getCardRank(card);
        const isRed = suit === 'H' || suit === 'D';
        const suitSymbol = SUIT_SYMBOLS[suit];

        return (
            <button
              onClick={onClick}
              disabled={disabled}
              className={`
                  bg-white text-gray-900 rounded-lg shadow-md text-center font-bold
                  transform transition-transform duration-200 ease-in-out
                  ${isPlayedCard ? 'w-24 h-32 p-2 text-3xl' : 'w-20 h-28 p-1 text-xl hover:scale-105'}
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'}
                  ${isRed ? 'text-red-600' : 'text-gray-900'}
                  flex flex-col justify-between items-center
                  border border-gray-400
                  ${className} // ✅ apply extra styling here
              `}
          >

                <span className="text-xl">{rank}</span>
                <span className={`text-4xl ${isRed ? 'text-red-600' : 'text-gray-900'}`}>{suitSymbol}</span>
                <span className="text-xl transform rotate-180">{rank}</span> {/* Flipped rank for top-right */}
            </button>
        );
    };


    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
                <div className="text-2xl font-bold">Loading...</div>
            </div>
        );
    }

    // Render the lobby or game board based on currentRoomId
    return (
        <div className="min-h-screen bg-gray-900 text-white font-inter flex flex-col items-center justify-center p-4">
            {/* Modal for messages */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm w-full text-center border border-gray-700">
                        <p className="text-lg mb-4">{modalContent}</p>
                        <button
                            onClick={() => setShowModal(false)}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <h1 className="text-5xl font-extrabold mb-8 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                Spar Card Game
            </h1>

            {/* Current User Info */}
            <div className="bg-gray-800 p-4 rounded-lg shadow-lg mb-6 w-full max-w-md text-center border border-gray-700">
                <p className="text-lg font-semibold">Your User ID: <span className="text-purple-300 break-all">{userId}</span></p>
                {playerName && <p className="text-lg font-semibold">Your Name: <span className="text-pink-300">{playerName}</span></p>}
            </div>

            {!currentRoomId ? (
                // Lobby View
                <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md border border-gray-700">
                    <h2 className="text-3xl font-bold mb-6 text-center text-blue-400">Join or Create Room</h2>
                    <div className="mb-4">
                        <label htmlFor="playerName" className="block text-gray-300 text-sm font-bold mb-2">Your Name:</label>
                        <input
                            type="text"
                            id="playerName"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            placeholder="Enter your name"
                            className="shadow appearance-none border border-gray-600 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700"
                        />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="gameTargetScore" className="block text-gray-300 text-sm font-bold mb-2">Target Score:</label>
                        <input
                            type="number"
                            id="gameTargetScore"
                            value={gameTargetScore}
                            onChange={(e) => setGameTargetScore(parseInt(e.target.value) || 0)}
                            min="1"
                            placeholder="Enter target score (e.g., 10)"
                            className="shadow appearance-none border border-gray-600 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700"
                        />
                    </div>
                    <button
                        onClick={createRoom}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg mb-4 transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                    >
                        Create New Room
                    </button>
                    <div className="flex items-center my-4">
                        <hr className="flex-grow border-gray-700" />
                        <span className="px-3 text-gray-400">OR</span>
                        <hr className="flex-grow border-gray-700" />
                    </div>
                    <div className="mb-4">
                        <label htmlFor="roomId" className="block text-gray-300 text-sm font-bold mb-2">Join Room ID:</label>
                        <input
                          type="text"
                          id="roomId"
                          value={joinRoomIdInput}
                          onChange={(e) => setJoinRoomIdInput(e.target.value.toUpperCase())}
                          placeholder="Enter Room ID"
                          className="shadow appearance-none border border-gray-600 rounded-lg w-full py-3 px-4 text-gray-200 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-700"
                      />

                    </div>
                    <button
                        onClick={() => joinRoom(joinRoomIdInput)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                    >
                        Join Room
                    </button>
                </div>
            ) : (
                // Game Board View
                <div className="w-full max-w-6xl bg-gray-800 p-6 rounded-lg shadow-xl border border-gray-700 flex flex-col lg:flex-row items-start lg:items-stretch gap-6">
                    {/* Game Area */}
                    <div className="flex-grow flex flex-col items-center w-full lg:w-2/3">
                        <h2 className="text-3xl font-bold mb-4 text-center text-blue-400">Room: {gameRoom?.id}</h2>
                        <p className="text-lg mb-4 text-center text-gray-300">{message}</p>

                        {/* Players & Scores */}
                        <div className="w-full mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {gameRoom?.players.map(player => (
                                <div
                                    key={player.id}
                                    className={`p-3 rounded-lg shadow-md flex items-center justify-between text-lg font-semibold
                                        ${player.id === userId ? 'bg-purple-700 border-purple-500' : 'bg-gray-700 border-gray-600'}
                                        ${gameRoom.currentPlayerId === player.id ? 'ring-4 ring-yellow-400' : ''}`}
                                >
                                    <span className="flex-grow truncate">{player.name} {player.id === userId && "(You)"}</span>
                                    <span className="ml-2 text-xl text-yellow-300">{player.score} pts</span>
                                    {gameRoom.dealerId === player.id && (
                                        <span className="ml-2 text-sm text-green-300">(Dealer)</span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Current Trick Area */}
                        <div className="bg-gray-700 p-5 rounded-lg shadow-inner mb-6 w-full max-w-xl min-h-[180px] flex flex-wrap justify-center items-center gap-4 border border-gray-600">
                          <div className="w-full flex flex-wrap justify-center gap-4">
                            {
                              (() => {
                                // 🧠 Compute winning card before rendering
                                let currentWinningCardId = null;
                                if (gameRoom?.currentTrick?.length > 0 && gameRoom?.leadSuit) {
                                  const { winningCard } = determineTrickWinner(gameRoom.currentTrick, gameRoom.leadSuit);
                                  currentWinningCardId = winningCard;
                                }

                                // 🎴 If trick in progress, render cards
                                if (gameRoom?.currentTrick?.length > 0) {
                                  return gameRoom.currentTrick.map((playedCard, index) => {
                                    const player = gameRoom.players.find(p => p.id === playedCard.playerId);
                                    const isWinningCard = playedCard.card === currentWinningCardId;

                                    return (
                                      <div key={index} className="flex flex-col items-center">
                                        <span className="text-sm text-gray-300 mb-1">{player?.name}</span>
                                        <Card
                                          card={playedCard.card}
                                          isPlayedCard={true}
                                          onClick={() => {}}
                                          disabled={true}
                                          className={isWinningCard ? 'ring-2 ring-yellow-400' : ''}
                                        />
                                      </div>
                                    );
                                  });
                                }

                                // 💤 No cards played yet
                                return (
                                  <p className="text-gray-400 text-lg">No cards played yet in this trick.</p>
                                );
                              })()
                            }
                          </div>
                        </div>



                        {/* Player Hand */}
                        {playerRef.current && playerRef.current.hand && (
                            <div className="bg-gray-700 p-4 rounded-lg shadow-inner mb-6 w-full max-w-xl border border-gray-600">
                                <h3 className="text-xl font-bold mb-3 text-center text-purple-300">Your Hand:</h3>
                                <div className="flex flex-wrap justify-center gap-3">
                                    {playerRef.current.hand.sort((a, b) => {
                                        // Sort cards by suit then by rank for better display
                                        const suitA = getSuit(a);
                                        const suitB = getSuit(b);
                                        const rankA = CARD_RANK_VALUES[getCardRank(a)];
                                        const rankB = CARD_RANK_VALUES[getCardRank(b)];

                                        if (suitA !== suitB) {
                                            return SUITS.indexOf(suitA) - SUITS.indexOf(suitB);
                                        }
                                        return rankB - rankA; // Descending rank
                                    }).map(card => (
                                        <Card
                                            key={card}
                                            card={card}
                                            onClick={() => playCard(card)}
                                            disabled={gameRoom.currentPlayerId !== userId || gameRoom.status !== 'playing'}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Game Controls */}
                        <div className="flex flex-wrap justify-center gap-4 mt-4">
                            {gameRoom?.status === 'waiting' && gameRoom.players[0]?.id === userId && (
                                <button
                                    onClick={startGame}
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                                >
                                    Start Game
                                </button>
                            )}
                            {gameRoom?.status === 'game_end' && gameRoom.players[0]?.id === userId && (
                                <button
                                    onClick={resetGame}
                                    className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                                >
                                    Reset Game
                                </button>
                            )}
                            <button
                                onClick={leaveRoom}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                            >
                                Leave Room
                            </button>
                        </div>
                    </div>

                    {/* Chat Area */}
                    <div className="w-full lg:w-1/3 bg-gray-700 p-4 rounded-lg shadow-inner border border-gray-600 flex flex-col">
                        <h3 className="text-xl font-bold mb-3 text-center text-blue-300">Room Chat</h3>
                        <div ref={chatContainerRef} className="flex-grow overflow-y-auto mb-4 p-2 bg-gray-800 rounded-md max-h-64 lg:max-h-[calc(100vh-300px)]">
                            {chatMessages.length === 0 ? (
                                <p className="text-gray-400 text-sm">No messages yet.</p>
                            ) : (
                                chatMessages.map((msg, index) => (
                                    <div key={index} className="mb-1 text-sm">
                                        <span className="font-semibold text-purple-300">{msg.senderName}: </span>
                                        <span className="text-gray-200">{msg.message}</span>
                                        <span className="text-xs text-gray-500 ml-2">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex">
                            <input
                                type="text"
                                value={newChatMessage}
                                onChange={(e) => setNewChatMessage(e.target.value)}
                                onKeyPress={(e) => { if (e.key === 'Enter') sendChatMessage(); }}
                                placeholder="Type your message..."
                                className="flex-grow shadow appearance-none border border-gray-600 rounded-l-lg py-2 px-3 text-gray-200 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-900"
                            />
                            <button
                                onClick={sendChatMessage}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r-lg transition duration-200 ease-in-out"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
