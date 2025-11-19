/**
 * ============================================
 * AI Web Worker (ai-worker.js) - 無限時間版
 * * 移除時間限制，AI 會運算到指定深度 (MAX_SEARCH_DEPTH) 或解完殘局
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

// AI 效能與快取
let transpositionTable = new Map();
let ttHits = 0; 

// 搜尋深度 (注意：因為移除了時間限制，在遊戲初期深度設太高會算很久)
// 建議：如果覺得太慢，可以將此值調小 (例如 4-6)
const MAX_SEARCH_DEPTH = 30; 

// 評估分數權重
const HEURISTIC_WIN_SCORE = 10000000;
const HEURISTIC_SQUARE_VALUE = 5000;
const HEURISTIC_CRITICAL_MOVE_PENALTY = 800; 
const HEURISTIC_MINOR_MOVE_PENALTY = 200; 

// --- Web Worker 入口 ---
self.onmessage = function (e) {
    const { gameState, settings } = e.data;

    // 1. 初始化 AI 的內部狀態
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

    transpositionTable.clear(); 
    ttHits = 0;

    // 2. 決定 AI 策略
    const availableMoves = getAvailableMoves();
    const difficulty = settings.difficulty || 'minimax'; 
    
    let bestMove;

    if (difficulty === 'greedy') {
        // 簡單模式：只用貪婪啟發式 (運算極快)
        bestMove = findBestMoveHeuristic(availableMoves);
    } else {
        // 困難模式：使用 Minimax (無時間限制，運算較久但最強)
        bestMove = findBestMoveMinimaxIterative(availableMoves);
    }
    
    // 3. 傳回找到的最佳移動
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
 * 策略 1: 淺層啟發式搜尋 (簡單模式)
 */
function findBestMoveHeuristic(availableMoves, linesObj = aiLines, squaresObj = aiSquares) {
    if (availableMoves.length === 0) return null;
    
    let winningMoves = [];
    let safeMoves = [];
    let minorUnsafeMoves = [];
    let criticalUnsafeMoves = [];
    
    for (const move of availableMoves) {
        let squaresCompleted = 0;
        let isCritical = false; 
        let isMinor = false;    
        
        let uniqueAdjacentSquares = new Set();

        for (const segment of move.segments) {
            const adjacentSquares = getAdjacentSquares(segment.id, squaresObj);
            adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
        }

        for (const sq of uniqueAdjacentSquares) {
            if (sq.filled) continue;
            let sidesAfterMove = 0;
            sq.lineKeys.forEach(key => {
                if (linesObj[key].players.length > 0) {
                    sidesAfterMove++;
                } else if (move.segments.some(seg => seg.id === key)) {
                    sidesAfterMove++;
                }
            });

            if (sidesAfterMove === 4) squaresCompleted++;
            else if (sidesAfterMove === 3) isCritical = true;
            else if (sidesAfterMove === 2) isMinor = true;
        }
        
        const moveInfo = { move, squaresCompleted, isCritical, isMinor };
        
        if (squaresCompleted > 0) winningMoves.push(moveInfo);
        else if (isCritical) criticalUnsafeMoves.push(moveInfo);
        else if (isMinor) minorUnsafeMoves.push(moveInfo);
        else safeMoves.push(moveInfo);
    }
    
    let bestDotMove;
    
    if (winningMoves.length > 0) {
        const maxScore = Math.max(...winningMoves.map(m => m.squaresCompleted));
        const bestWinningMoves = winningMoves.filter(m => m.squaresCompleted === maxScore);
        bestDotMove = bestWinningMoves[Math.floor(Math.random() * bestWinningMoves.length)].move;

    } else if (safeMoves.length > 0) {
        bestDotMove = safeMoves[Math.floor(Math.random() * safeMoves.length)].move;
        
    } else if (minorUnsafeMoves.length > 0) {
        bestDotMove = minorUnsafeMoves[Math.floor(Math.random() * minorUnsafeMoves.length)].move;
        
    } else if (criticalUnsafeMoves.length > 0) {
        bestDotMove = criticalUnsafeMoves[Math.floor(Math.random() * criticalUnsafeMoves.length)].move;
        
    } else if (availableMoves.length > 0) {
        bestDotMove = availableMoves[0];
    }
    
    return bestDotMove ? { dotA: bestDotMove.dotA, dotB: bestDotMove.dotB } : null;
}

// --- 策略 2: Minimax (迭代加深版 - 無時間限制) ---
function findBestMoveMinimaxIterative(availableMoves) {
    // 移除了 startTime 和時間檢查
    let maxDepth = Math.min(MAX_SEARCH_DEPTH, availableMoves.length);
    
    let overallBestMove = null; 
    
    // 1. 迭代加深
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
        
        let currentBestMovesForThisDepth = []; 
        let currentBestScoreForThisDepth = -Infinity;
        
        const linesCopy = deepCopy(aiLines);
        const squaresCopy = deepCopy(aiSquares);
        const scoresCopy = deepCopy(aiScores);
        
        // 強制排序
        const sortedMoves = sortMovesForMinimax(availableMoves, linesCopy, squaresCopy);

        // 2. 根節點移動迴圈
        for (const move of sortedMoves) { 

            const undoData = makeMove(move.segments, playerAINumber, linesCopy, squaresCopy, scoresCopy);
            
            let score;
            // 呼叫 minimax 時不再傳遞 startTime
            if (undoData.scoredCount > 0 && scoreAndGoRule) {
                // 得分繼續：保持視角 (True)
                score = minimax(currentDepth, -Infinity, Infinity, true, true, linesCopy, squaresCopy, scoresCopy); 
            } else {
                // 換人：反轉視角 (False)
                score = -minimax(currentDepth - 1, -Infinity, Infinity, false, false, linesCopy, squaresCopy, scoresCopy);
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
        }
    } 

    if (!overallBestMove) {
        const heuristicMove = findBestMoveHeuristic(availableMoves);
        if (heuristicMove) return heuristicMove;
        if (availableMoves.length > 0) return { dotA: availableMoves[0].dotA, dotB: availableMoves[0].dotB };
        return null;
    }

    return { dotA: overallBestMove.dotA, dotB: overallBestMove.dotB }; 
}

/**
 * Minimax 核心函式 (無時間限制)
 */
function minimax(depth, alpha, beta, isMaxPlayer, isChainMove, linesState, squaresState, scoresState) {
    
    // 移除了時間檢查

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

    let bestValue = -Infinity; 
    const sortedMoves = sortMovesForMinimax(availableMoves, linesState, squaresState);

    for (const move of sortedMoves) { 
        const currentPlayerToMove = isMaxPlayer ? playerAINumber : playerOpponentNumber;
        
        const undoData = makeMove(move.segments, currentPlayerToMove, linesState, squaresState, scoresState);
        
        let value;
        if (undoData.scoredCount > 0 && scoreAndGoRule) {
            // 得分：同玩家繼續，不反轉
            value = minimax(depth, alpha, beta, isMaxPlayer, true, linesState, squaresState, scoresState);
        } else {
            // 換人：反轉
            value = -minimax(depth - 1, -beta, -alpha, !isMaxPlayer, false, linesState, squaresState, scoresState);
        }

        undoMove(undoData, linesState, squaresState, scoresState); 
        
        bestValue = Math.max(bestValue, value);
        alpha = Math.max(alpha, bestValue);

        if (alpha >= beta) {
            break; 
        }
    }
    
    transpositionTable.set(boardHash, { score: bestValue, depth: depth });
    return bestValue;
}

// 評估函式
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
            heuristicScore += HEURISTIC_CRITICAL_MOVE_PENALTY; 
        } else if (sides === 2) {
            heuristicScore -= HEURISTIC_MINOR_MOVE_PENALTY;
        }
    }
    
    return heuristicScore;
}

// 排序函式
function sortMovesForMinimax(moves, linesState, squaresState) {
    return moves.map(move => { 
        let priority = 0;
        let uniqueAdjacentSquares = new Set();
        
        for (const seg of move.segments) {
            const adjacentSquares = getAdjacentSquares(seg.id, squaresState);
            adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
        }

        for (const sq of uniqueAdjacentSquares) {
            if (sq.filled) continue;
            
            let sidesAfterMove = 0;
            sq.lineKeys.forEach(key => {
                if (linesState[key].players.length > 0) sidesAfterMove++;
                else if (move.segments.some(seg => seg.id === key)) sidesAfterMove++;
            });
            
            if (sidesAfterMove === 4) {
                priority += 100000; 
            } else if (sidesAfterMove === 3) {
                priority -= 1000;   
            } else if (sidesAfterMove === 2) {
                priority -= 50;     
            } else {
                priority += 10;     
            }
        }
        
        if (move.segments.every(seg => seg.players.length === 0)) {
             priority += 5;
        }

        return { move, priority };
    }).sort((a, b) => b.priority - a.priority)
      .map(item => item.move);
}


// --- 輔助函式 ---

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
    const sortedKeys = Object.keys(linesObj).sort();
    for (const id of sortedKeys) {
        hash += linesObj[id].players.length;
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
