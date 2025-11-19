/**
 * ============================================
 * AI Web Worker (ai-worker.js) - 勝率預估版
 * ============================================
 */

// --- Worker 狀態變數 ---
let aiLines = {};
let aiSquares = [];
let aiScores = { 1: 0, 2: 0 };
let playerAINumber;
let playerOpponentNumber;
let scoreAndGoRule = true;
let maxLineLength = 1;

let gridRows;
let gridCols;
let aiDots = [];
let sortedLineKeys = [];

let transpositionTable = new Map();
let ttHits = 0; 

const MAX_SEARCH_DEPTH = 30; 
const TIME_LIMIT_MS = 1000; 

const HEURISTIC_WIN_SCORE = 10000000;
const HEURISTIC_SQUARE_VALUE = 5000;
const HEURISTIC_CRITICAL_MOVE_PENALTY = 800; 
const HEURISTIC_MINOR_MOVE_PENALTY = 200; 
const HEURISTIC_CHAIN_BONUS = 500;

self.onmessage = function (e) {
    const { type, gameState, settings } = e.data;

    aiLines = gameState.lines;
    aiSquares = gameState.squares;
    aiScores = { 1: gameState.scores[1], 2: gameState.scores[2] };
    playerAINumber = gameState.currentPlayer;
    playerOpponentNumber = (playerAINumber === 1) ? 2 : 1;
    scoreAndGoRule = settings.scoreAndGo;
    maxLineLength = settings.maxLineLength;
    
    gridRows = gameState.gridRows;
    gridCols = gameState.gridCols;
    aiDots = [];
    for (let r = 0; r < gridRows; r++) {
        aiDots[r] = [];
        for (let c = 0; c < gridCols; c++) {
            aiDots[r][c] = { r: r, c: c };
        }
    }

    sortedLineKeys = Object.keys(aiLines).sort();
    transpositionTable.clear(); 
    ttHits = 0;

    const availableMoves = getAvailableMoves();
    const difficulty = settings.difficulty || 'minimax'; 
    
    let bestResult;

    if (difficulty === 'greedy') {
        // 簡單模式通常不回傳勝率，或者給一個預設值
        const move = findBestMoveHeuristic(availableMoves);
        // 簡單評估當前盤面以給出 rough estimate
        const roughScore = evaluateState(aiLines, aiSquares, aiScores, true);
        bestResult = { ...move, score: roughScore };
    } else {
        bestResult = findBestMoveMinimaxIterative(availableMoves);
    }
    
    if (bestResult && bestResult.dotA && bestResult.dotB) {
        // 計算勝率
        const winRate = calculateWinProbability(bestResult.score);

        if (type === 'findHint') {
            self.postMessage({
                type: 'hintFound',
                dotA: bestResult.dotA,
                dotB: bestResult.dotB,
                winRate: winRate // 提示也回傳勝率
            });
        } else {
            self.postMessage({
                type: 'bestMoveFound',
                dotA: bestResult.dotA,
                dotB: bestResult.dotB,
                winRate: winRate // 回傳勝率
            });
        }
    } else {
        self.postMessage({ type: 'noMoveFound' });
    }
};

// 【新增】將分數轉換為勝率 (Sigmoid 變體)
function calculateWinProbability(score) {
    // 1. 極大值/極小值直接鎖定
    if (score >= HEURISTIC_WIN_SCORE / 2) return 100;
    if (score <= -HEURISTIC_WIN_SCORE / 2) return 0;
    
    // 2. 3邊格優勢轉換 (每一個3邊格約 800分)
    // 3. 格子差距轉換 (每一格 5000分)
    // 使用 Sigmoid 函數將分數映射到 0-1，然後轉為百分比
    // 參數 k 控制曲線的陡峭程度。HEURISTIC_SQUARE_VALUE = 5000
    // 希望領先 1 格 (5000分) 時勝率約為 60-70%
    
    const k = 0.00015; 
    const probability = 1 / (1 + Math.exp(-k * score));
    
    return Math.round(probability * 100);
}

// ... (findBestMoveHeuristic 保持不變) ...
function findBestMoveHeuristic(availableMoves, linesObj = aiLines, squaresObj = aiSquares) {
    if (availableMoves.length === 0) return null;
    let winningMoves = [];
    let safeMoves = [];
    let badMoves = []; 
    for (const move of availableMoves) {
        let squaresCompleted = 0;
        let isBad = false;    
        let uniqueAdjacentSquares = new Set();
        for (const segment of move.segments) {
            const adjacentSquares = getAdjacentSquares(segment.id, squaresObj);
            adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
        }
        for (const sq of uniqueAdjacentSquares) {
            if (sq.filled) continue;
            let sidesAfterMove = 0;
            sq.lineKeys.forEach(key => {
                if (linesObj[key].players.length > 0) sidesAfterMove++;
                else if (move.segments.some(seg => seg.id === key)) sidesAfterMove++;
            });
            if (sidesAfterMove === 4) squaresCompleted++;
            else if (sidesAfterMove === 3) isBad = true; 
        }
        const moveInfo = { move, squaresCompleted };
        if (squaresCompleted > 0) winningMoves.push(moveInfo);
        else if (!isBad) safeMoves.push(moveInfo);
        else badMoves.push(moveInfo);
    }
    if (winningMoves.length > 0) {
        const maxScore = Math.max(...winningMoves.map(m => m.squaresCompleted));
        const best = winningMoves.filter(m => m.squaresCompleted === maxScore);
        return { ...best[Math.floor(Math.random() * best.length)].move };
    } 
    if (safeMoves.length > 0) return { ...safeMoves[Math.floor(Math.random() * safeMoves.length)].move };
    if (badMoves.length > 0) return { ...badMoves[Math.floor(Math.random() * badMoves.length)].move };
    return { ...availableMoves[0] };
}

// 【修改】回傳結構包含 score
function findBestMoveMinimaxIterative(availableMoves) {
    const startTime = performance.now();
    let maxDepth = Math.min(MAX_SEARCH_DEPTH, availableMoves.length);
    
    let overallBestMove = null; 
    let overallBestScore = -Infinity;
    
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
        if (currentDepth > 1 && (performance.now() - startTime > TIME_LIMIT_MS)) break; 
        
        let currentBestMovesForThisDepth = []; 
        let currentBestScoreForThisDepth = -Infinity;
        
        const linesCopy = deepCopy(aiLines);
        const squaresCopy = deepCopy(aiSquares);
        const scoresCopy = deepCopy(aiScores);
        
        const sortedMoves = sortMovesForMinimax(availableMoves, linesCopy, squaresCopy);
        
        let movesToSearch = [];
        const scoring = sortedMoves.filter(m => getMoveType(m, linesCopy, squaresCopy) === 'scoring');
        const safe = sortedMoves.filter(m => getMoveType(m, linesCopy, squaresCopy) === 'safe');
        
        if (scoring.length > 0) movesToSearch = scoring;
        else if (safe.length > 0) movesToSearch = safe;
        else movesToSearch = sortedMoves; 

        for (const move of movesToSearch) { 
            if (performance.now() - startTime > TIME_LIMIT_MS) {
                if (currentBestMovesForThisDepth.length > 0) break;
            }

            const undoData = makeMove(move.segments, playerAINumber, linesCopy, squaresCopy, scoresCopy);
            
            let score;
            if (undoData.scoredCount > 0 && scoreAndGoRule) {
                score = minimax(currentDepth, -Infinity, Infinity, true, true, linesCopy, squaresCopy, scoresCopy, startTime); 
            } else {
                score = -minimax(currentDepth - 1, -Infinity, Infinity, false, false, linesCopy, squaresCopy, scoresCopy, startTime);
            }
            
            undoMove(undoData, linesCopy, squaresCopy, scoresCopy); 
            
            if (score > currentBestScoreForThisDepth) {
                currentBestScoreForThisDepth = score;
                currentBestMovesForThisDepth = [move]; 
            } else if (score === currentBestScoreForThisDepth) {
                currentBestMovesForThisDepth.push(move); 
            }
        } 

        if (currentBestMovesForThisDepth.length > 0) {
            overallBestMove = currentBestMovesForThisDepth[Math.floor(Math.random() * currentBestMovesForThisDepth.length)];
            overallBestScore = currentBestScoreForThisDepth;
        } else {
             break; 
        }
    } 

    if (!overallBestMove) {
        // 降級處理
        const move = findBestMoveHeuristic(availableMoves);
        return move ? { ...move, score: 0 } : null;
    }

    return { dotA: overallBestMove.dotA, dotB: overallBestMove.dotB, score: overallBestScore }; 
}

// ... (minimax, getMoveType, evaluateState, sortMovesForMinimax, getAvailableMoves, getSidesDrawn, getAdjacentSquares, getBoardHash, makeMove, undoMove, getSegmentsForLine, deepCopy 保持不變) ...

function minimax(depth, alpha, beta, isMaxPlayer, isChainMove, linesState, squaresState, scoresState, startTime) {
    if ((ttHits % 500 === 0) && (performance.now() - startTime > TIME_LIMIT_MS)) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }
    const boardHash = getBoardHash(linesState);
    if (transpositionTable.has(boardHash)) {
        const cached = transpositionTable.get(boardHash);
        if (cached.depth >= depth) { ttHits++; return cached.score; }
    }
    const availableMoves = getAvailableMoves(linesState); 
    if (depth === 0 || availableMoves.length === 0) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }
    const sortedMoves = sortMovesForMinimax(availableMoves, linesState, squaresState);
    let movesToSearch = [];
    const scoring = sortedMoves.filter(m => getMoveType(m, linesState, squaresState) === 'scoring');
    const safe = sortedMoves.filter(m => getMoveType(m, linesState, squaresState) === 'safe');
    if (isMaxPlayer && scoring.length > 0) movesToSearch = scoring;
    else if (safe.length > 0) movesToSearch = safe;
    else movesToSearch = sortedMoves;
    let bestValue = -Infinity; 
    for (const move of movesToSearch) { 
        const currentPlayerToMove = isMaxPlayer ? playerAINumber : playerOpponentNumber;
        const undoData = makeMove(move.segments, currentPlayerToMove, linesState, squaresState, scoresState);
        let value;
        if (undoData.scoredCount > 0 && scoreAndGoRule) {
            value = minimax(depth, alpha, beta, isMaxPlayer, true, linesState, squaresState, scoresState, startTime);
        } else {
            value = -minimax(depth - 1, -beta, -alpha, !isMaxPlayer, false, linesState, squaresState, scoresState, startTime);
        }
        undoMove(undoData, linesState, squaresState, scoresState); 
        bestValue = Math.max(bestValue, value);
        alpha = Math.max(alpha, bestValue);
        if (alpha >= beta) break; 
    }
    transpositionTable.set(boardHash, { score: bestValue, depth: depth });
    return bestValue;
}

function getMoveType(move, linesState, squaresState) {
    let uniqueAdjacentSquares = new Set();
    for (const seg of move.segments) {
        const adjacentSquares = getAdjacentSquares(seg.id, squaresState);
        adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
    }
    let maxSides = 0;
    for (const sq of uniqueAdjacentSquares) {
        if (sq.filled) continue;
        let sidesAfterMove = 0;
        sq.lineKeys.forEach(key => {
            if (linesState[key].players.length > 0) sidesAfterMove++;
            else if (move.segments.some(seg => seg.id === key)) sidesAfterMove++;
        });
        if (sidesAfterMove > maxSides) maxSides = sidesAfterMove;
    }
    if (maxSides === 4) return 'scoring';
    if (maxSides === 3) return 'bad'; 
    return 'safe';
}

function evaluateState(linesState, squaresState, scoresState, isMaxPlayer) {
    const myScore = isMaxPlayer ? scoresState[playerAINumber] : scoresState[playerOpponentNumber];
    const oppScore = isMaxPlayer ? scoresState[playerOpponentNumber] : scoresState[playerAINumber];
    let heuristicScore = (myScore - oppScore) * HEURISTIC_SQUARE_VALUE;
    if (myScore + oppScore === squaresState.length) {
         return heuristicScore + (myScore > oppScore ? HEURISTIC_WIN_SCORE : -HEURISTIC_WIN_SCORE);
    }
    for (const sq of squaresState) {
        if (sq.filled) continue;
        const sides = getSidesDrawn(sq, linesState);
        if (sides === 3) {
            if (isMaxPlayer) heuristicScore += HEURISTIC_CRITICAL_MOVE_PENALTY; 
            else heuristicScore -= 2000; 
        } else if (sides === 2) {
            heuristicScore -= HEURISTIC_MINOR_MOVE_PENALTY;
        }
    }
    return heuristicScore;
}

function sortMovesForMinimax(moves, linesState, squaresState) {
    return moves.map(move => { 
        let priority = 0;
        let uniqueAdjacentSquares = new Set();
        for (const seg of move.segments) {
            const adjacentSquares = getAdjacentSquares(seg.id, squaresState);
            adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
        }
        let createsThreeSided = false;
        let createsTwoSided = false;
        let isScoring = false;
        for (const sq of uniqueAdjacentSquares) {
            if (sq.filled) continue;
            let sidesAfterMove = 0;
            sq.lineKeys.forEach(key => {
                if (linesState[key].players.length > 0) sidesAfterMove++;
                else if (move.segments.some(seg => seg.id === key)) sidesAfterMove++;
            });
            if (sidesAfterMove === 4) isScoring = true;
            else if (sidesAfterMove === 3) createsThreeSided = true;
            else if (sidesAfterMove === 2) createsTwoSided = true;
        }
        if (isScoring) {
            priority += 100000; 
            if (createsThreeSided) priority += 5000; 
            if (createsTwoSided) priority -= 2000;
        } 
        else if (createsThreeSided) priority -= 10000; 
        else if (createsTwoSided) priority -= 100; 
        else priority += 10; 
        if (move.segments.every(seg => seg.players.length === 0)) priority += 1;
        return { move, priority };
    }).sort((a, b) => b.priority - a.priority).map(item => item.move);
}

function getAvailableMoves(linesObj, dots, rows, cols, lineLength) {
    const moves = [];
    if (lineLength === 1) {
        for (const id in linesObj) {
            if (linesObj[id].players.length === 0) {
                const seg = linesObj[id];
                moves.push({ dotA: seg.p1, dotB: seg.p2, segments: [seg] });
            }
        }
    } else {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const dotA = dots[r][c];
                if (c + lineLength < cols) {
                    const dotB = dots[r][c + lineLength];
                    const segments = getSegmentsForLine(dotA, dotB, linesObj);
                    if (segments.length > 0 && segments.some(seg => seg.players.length === 0)) {
                        moves.push({ dotA, dotB, segments });
                    }
                }
                if (r + lineLength < rows) {
                    const dotB = dots[r + lineLength][c];
                    const segments = getSegmentsForLine(dotA, dotB, linesObj);
                    if (segments.length > 0 && segments.some(seg => seg.players.length === 0)) {
                        moves.push({ dotA, dotB, segments });
                    }
                }
            }
        }
    }
    return moves;
}
function getSidesDrawn(square, linesObj) {
    let sides = 0;
    for (const key of square.lineKeys) {
        if (linesObj[key] && linesObj[key].players.length > 0) sides++;
    }
    return sides;
}
function getAdjacentSquares(lineId, squaresArr) { return squaresArr.filter(sq => sq.lineKeys.includes(lineId)); }
function getBoardHash(linesObj) {
    let hash = '';
    for (const id of sortedLineKeys) {
        const pLen = linesObj[id].players.length;
        hash += pLen > 0 ? '1' : '0'; 
    }
    return hash;
}
function makeMove(moveSegments, player, linesState, squaresState, scoresState) {
    const undoData = { player, scoredCount: 0, filledSquares: [], segmentsChanged: [] };
    let uniqueAdjacentSquares = new Set();
    for (const segment of moveSegments) {
        if (!linesState[segment.id].players.includes(player)) {
            linesState[segment.id].players.push(player);
            undoData.segmentsChanged.push(segment.id); 
        }
        const adjacentSquares = getAdjacentSquares(segment.id, squaresState);
        adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
    }
    for (const sq of uniqueAdjacentSquares) {
        if (!sq.filled) {
            const sides = getSidesDrawn(sq, linesState);
            if (sides === 4) {
                sq.filled = true; sq.player = player; scoresState[player]++;
                undoData.scoredCount++; undoData.filledSquares.push(sq); 
            }
        }
    }
    return undoData;
}
function undoMove(undoData, linesState, squaresState, scoresState) {
    const player = undoData.player;
    for (const segmentId of undoData.segmentsChanged) {
        const pIndex = linesState[segmentId].players.indexOf(player);
        if (pIndex > -1) linesState[segmentId].players.splice(pIndex, 1);
    }
    if (undoData.scoredCount > 0) {
        for (const sq of undoData.filledSquares) {
            const stateSquare = squaresState.find(s => s.lineKeys[0] === sq.lineKeys[0] && s.lineKeys[1] === sq.lineKeys[1]);
            if (stateSquare) { scoresState[player]--; stateSquare.filled = false; stateSquare.player = null; }
        }
    }
}
function getSegmentsForLine(dotA, dotB, linesObj) {
    const segments = [];
    const dr = Math.sign(dotB.r - dotA.r);
    const dc = Math.sign(dotB.c - dotA.c);
    let r = dotA.r; let c = dotA.c;
    if (dr !== 0 && dc !== 0) return [];
    while (r !== dotB.r || c !== dotB.c) {
        let next_r = r + dr; let next_c = c + dc;
        let segmentId = null;
        if (dr === 0) segmentId = `H_${r},${Math.min(c, next_c)}`;
        else if (dc === 0) segmentId = `V_${Math.min(r, next_r)},${c}`;
        if (segmentId && linesObj[segmentId]) segments.push(linesObj[segmentId]);
        r = next_r; c = next_c;
    }
    return segments;
}
function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }
