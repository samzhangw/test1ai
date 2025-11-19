/**
 * ============================================
 * AI Web Worker (ai-worker.js) - 智能邏輯修正版
 * * 修正：AI 不再主動送分 (修復評估函數視角錯誤)
 * * 修正：正確識別 3 邊格對不同玩家的價值
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

// 棋盤尺寸與點
let gridRows;
let gridCols;
let aiDots = [];

// 預先排序 Key
let sortedLineKeys = [];

// AI 效能與快取
let transpositionTable = new Map();
let ttHits = 0; 

// 搜尋設定
const MAX_SEARCH_DEPTH = 30; 
const TIME_LIMIT_MS = 1000; 

// 評估分數權重 (大幅調整以修正送分行為)
const HEURISTIC_WIN_SCORE = 10000000;
const HEURISTIC_SQUARE_VALUE = 5000;
// 關鍵修正：送給對手 3 邊格的懲罰必須 > 得分價值，讓 AI 覺得「送分比沒得分還慘」
const HEURISTIC_GIVE_AWAY_PENALTY = 8000; 
const HEURISTIC_TAKE_SCORE_BONUS = 1000; 

// --- Web Worker 入口 ---
self.onmessage = function (e) {
    const { gameState, settings } = e.data;

    // 1. 初始化
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

    // 2. 決定策略
    const availableMoves = getAvailableMoves();
    const difficulty = settings.difficulty || 'minimax'; 
    
    let bestMove;

    if (difficulty === 'greedy') {
        bestMove = findBestMoveHeuristic(availableMoves);
    } else {
        bestMove = findBestMoveMinimaxIterative(availableMoves);
    }
    
    // 3. 傳回結果
    if (bestMove && bestMove.dotA && bestMove.dotB) {
        self.postMessage({
            type: 'bestMoveFound',
            dotA: bestMove.dotA,
            dotB: bestMove.dotB
        });
    } else {
        self.postMessage({ type: 'noMoveFound' });
    }
};

/**
 * 策略 1: 貪婪啟發式 (簡單)
 */
function findBestMoveHeuristic(availableMoves, linesObj = aiLines, squaresObj = aiSquares) {
    if (availableMoves.length === 0) return null;
    
    let winningMoves = [];
    let safeMoves = [];
    let badMoves = []; // 送分步
    
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
            else if (sidesAfterMove === 3) isBad = true; // 下完變 3 邊 = 送分
        }
        
        const moveInfo = { move, squaresCompleted };
        
        if (squaresCompleted > 0) winningMoves.push(moveInfo);
        else if (!isBad) safeMoves.push(moveInfo);
        else badMoves.push(moveInfo);
    }
    
    // 優先級：得分 > 安全 > 爛步
    if (winningMoves.length > 0) {
        // 貪婪吃分
        const maxScore = Math.max(...winningMoves.map(m => m.squaresCompleted));
        const best = winningMoves.filter(m => m.squaresCompleted === maxScore);
        return { ...best[Math.floor(Math.random() * best.length)].move };
    } 
    if (safeMoves.length > 0) {
        return { ...safeMoves[Math.floor(Math.random() * safeMoves.length)].move };
    }
    if (badMoves.length > 0) {
        return { ...badMoves[Math.floor(Math.random() * badMoves.length)].move };
    }
    return { ...availableMoves[0] };
}

// --- 策略 2: Minimax (智能) ---
function findBestMoveMinimaxIterative(availableMoves) {
    const startTime = performance.now();
    let maxDepth = Math.min(MAX_SEARCH_DEPTH, availableMoves.length);
    
    let overallBestMove = null; 
    
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
        
        if (currentDepth > 1 && (performance.now() - startTime > TIME_LIMIT_MS)) break; 
        
        let currentBestMovesForThisDepth = []; 
        let currentBestScoreForThisDepth = -Infinity;
        
        const linesCopy = deepCopy(aiLines);
        const squaresCopy = deepCopy(aiSquares);
        const scoresCopy = deepCopy(aiScores);
        
        // 排序並分類移動
        const sortedMoves = sortMovesForMinimax(availableMoves, linesCopy, squaresCopy);
        
        // 【優化】過濾移動
        // 1. 如果有得分步，只看得分步 (貪婪剪枝)
        // 2. 如果沒有得分步，只看安全步
        // 3. 如果只有爛步，才看爛步
        let movesToSearch = [];
        const scoring = sortedMoves.filter(m => getMoveType(m, linesCopy, squaresCopy) === 'scoring');
        const safe = sortedMoves.filter(m => getMoveType(m, linesCopy, squaresCopy) === 'safe');
        
        if (scoring.length > 0) movesToSearch = scoring;
        else if (safe.length > 0) movesToSearch = safe;
        else movesToSearch = sortedMoves; // 被迫送分，從爛步裡挑最好的

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
        } else {
             break; 
        }
    } 

    if (!overallBestMove) {
        // 降級處理
        return findBestMoveHeuristic(availableMoves);
    }

    return { dotA: overallBestMove.dotA, dotB: overallBestMove.dotB }; 
}

/**
 * Minimax 核心
 */
function minimax(depth, alpha, beta, isMaxPlayer, isChainMove, linesState, squaresState, scoresState, startTime) {
    
    if ((ttHits % 500 === 0) && (performance.now() - startTime > TIME_LIMIT_MS)) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }

    const boardHash = getBoardHash(linesState);
    if (transpositionTable.has(boardHash)) {
        const cached = transpositionTable.get(boardHash);
        if (cached.depth >= depth) {
            ttHits++;
            return cached.score;
        }
    }

    const availableMoves = getAvailableMoves(linesState); 
    if (depth === 0 || availableMoves.length === 0) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }

    // 內部層級也應用同樣的過濾邏輯
    const sortedMoves = sortMovesForMinimax(availableMoves, linesState, squaresState);
    let movesToSearch = [];
    const scoring = sortedMoves.filter(m => getMoveType(m, linesState, squaresState) === 'scoring');
    const safe = sortedMoves.filter(m => getMoveType(m, linesState, squaresState) === 'safe');
    
    // 這裡可以寬鬆一點，如果是 Max 層 (AI)，絕對優先得分
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

// --- 評估與輔助 ---

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


// 【關鍵修正】評估函數
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
            // 這是一個「懸空」的分數 (差一邊)
            if (isMaxPlayer) {
                // 如果現在輪到 AI (Max) 下，這分是 AI 的，太棒了！
                heuristicScore += HEURISTIC_TAKE_SCORE_BONUS; 
            } else {
                // 【修正】如果現在輪到對手下 (Min 節點)，這分會被對手拿走，超級大災難！
                // 懲罰必須 > 1個格子的價值，這樣 AI 才會覺得「送分」比「沒得分」還慘
                heuristicScore -= HEURISTIC_GIVE_AWAY_PENALTY;
            }
        } 
        // 移除 2 邊格的懲罰，因為那只是普通的安全步，不需要過度懲罰
        // 讓 minimax 透過搜尋深度自己去發現會不會變成 3 邊
    }
    
    return heuristicScore;
}

function sortMovesForMinimax(moves, linesState, squaresState) {
    return moves.map(move => { 
        let priority = 0;
        const type = getMoveType(move, linesState, squaresState);
        
        if (type === 'scoring') priority = 1000;
        else if (type === 'safe') priority = 100;
        else priority = -100; 
        
        if (move.segments.every(seg => seg.players.length === 0)) priority += 1;

        return { move, priority };
    }).sort((a, b) => b.priority - a.priority)
      .map(item => item.move);
}


// --- 基礎輔助函式 (無變更) ---

function getAvailableMoves(linesObj = aiLines, dots = aiDots, rows = gridRows, cols = gridCols, lineLength = maxLineLength) {
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

function getSidesDrawn(square, linesObj = aiLines) {
    let sides = 0;
    for (const key of square.lineKeys) {
        if (linesObj[key] && linesObj[key].players.length > 0) sides++;
    }
    return sides;
}

function getAdjacentSquares(lineId, squaresArr = aiSquares) {
    return squaresArr.filter(sq => sq.lineKeys.includes(lineId));
}

function getBoardHash(linesObj) {
    let hash = '';
    for (const id of sortedLineKeys) {
        const pLen = linesObj[id].players.length;
        hash += pLen > 0 ? '1' : '0'; 
    }
    return hash;
}

function makeMove(moveSegments, player, linesState, squaresState, scoresState) {
    const undoData = {
        player: player, 
        scoredCount: 0,
        filledSquares: [], 
        segmentsChanged: []  
    };
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
                sq.filled = true;
                sq.player = player;
                scoresState[player]++;
                undoData.scoredCount++;
                undoData.filledSquares.push(sq); 
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
            if (stateSquare) {
                scoresState[player]--;
                stateSquare.filled = false;
                stateSquare.player = null;
            }
        }
    }
}

function getSegmentsForLine(dotA, dotB, linesObj = aiLines) {
    const segments = [];
    const dr = Math.sign(dotB.r - dotA.r);
    const dc = Math.sign(dotB.c - dotA.c);
    let r = dotA.r;
    let c = dotA.c;
    if (dr !== 0 && dc !== 0) return [];
    while (r !== dotB.r || c !== dotB.c) {
        let next_r = r + dr;
        let next_c = c + dc;
        let segmentId = null;
        if (dr === 0) segmentId = `H_${r},${Math.min(c, next_c)}`;
        else if (dc === 0) segmentId = `V_${Math.min(r, next_r)},${c}`;
        if (segmentId && linesObj[segmentId]) segments.push(linesObj[segmentId]);
        r = next_r;
        c = next_c;
    }
    return segments;
}

function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}
