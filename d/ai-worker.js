/**
 * ============================================
 * AI Web Worker (ai-worker.js)
 * * 包含所有 AI 運算邏輯:
 * 1. Minimax 演算法 (NegaMax 變體)
 * 2. 帶有時間限制的 迭代加深 (Iterative Deepening)
 * 3. 置換表 (Transposition Table)
 * 4. 根據規則切換策略的 啟發式評估 (Heuristic)
 * 5. 靜態搜尋 (Quiescence Search) - 整合於啟發函數中
 * 6. 支援「得分後再走一步」的 Minimax
 * 7. (**** 新功能 ****) 策略隨機性 (在多個最佳解中隨機選取)
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

// AI 效能與快取
let transpositionTable = new Map();
let ttHits = 0; 

const MAX_SEARCH_DEPTH = 22;
const TIME_LIMIT_MS = 2500;

const HEURISTIC_WIN_SCORE = 1000000;
const HEURISTIC_SQUARE_VALUE = 1000;
const HEURISTIC_CRITICAL_MOVE_PENALTY = 500;
const HEURISTIC_MINOR_MOVE_PENALTY = 50;

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
    transpositionTable.clear(); 
    ttHits = 0;

    // 2. 決定 AI 策略
    const availableMoves = getAvailableMoves();
    let bestMove;

    if (maxLineLength > 1 || availableMoves.length > 24) {
        bestMove = findBestMoveHeuristic(availableMoves);
    } else {
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

// --- 策略 1: 淺層啟發式搜尋 (1-ply) ---
function findBestMoveHeuristic(availableMoves) {
    if (availableMoves.length === 0) return null;
    
    let winningMoves = [];
    let safeMoves = [];
    let minorUnsafeMoves = [];
    let criticalUnsafeMoves = [];
    
    // 【修改】: 啟發式搜尋也需要隨機性
    
    // 1. 評估所有移動
    for (const move of availableMoves) {
        let squaresCompleted = 0;
        let isCritical = false;
        let isMinor = false;
        
        const adjacentSquares = getAdjacentSquares(move.id);
        
        for (const sq of adjacentSquares) {
            if (sq.filled) continue;
            const sides = getSidesDrawn(sq); 
            if (sides === 3) { squaresCompleted++; }
            else if (sides === 2) { isCritical = true; }
            else if (sides === 1) { isMinor = true; }
        }
        
        const moveInfo = { segment: move, squaresCompleted, isCritical, isMinor };
        
        if (squaresCompleted > 0) winningMoves.push(moveInfo);
        else if (isCritical) criticalUnsafeMoves.push(moveInfo);
        else if (isMinor) minorUnsafeMoves.push(moveInfo);
        else safeMoves.push(moveInfo);
    }
    
    let segmentToDraw;
    
    // 2. 根據優先級選擇
    if (winningMoves.length > 0) {
        // 選能拿最多分的
        const maxScore = Math.max(...winningMoves.map(m => m.squaresCompleted));
        const bestWinningMoves = winningMoves.filter(m => m.squaresCompleted === maxScore);
        segmentToDraw = bestWinningMoves[Math.floor(Math.random() * bestWinningMoves.length)].segment;

    } else if (safeMoves.length > 0) {
        // 隨機選一個安全的
        segmentToDraw = safeMoves[Math.floor(Math.random() * safeMoves.length)].segment;
        
    } else if (minorUnsafeMoves.length > 0) {
        // 隨機選一個次要風險的
        segmentToDraw = minorUnsafeMoves[Math.floor(Math.random() * minorUnsafeMoves.length)].segment;
        
    } else if (criticalUnsafeMoves.length > 0) {
        // 找出導致最短連鎖的犧牲
        let bestSacrifices = [];
        let minChain = Infinity;
        for (const move of criticalUnsafeMoves) {
            const chainLength = calculateChainReaction(move.segment, aiLines, aiSquares);
            if (chainLength < minChain) {
                minChain = chainLength;
                bestSacrifices = [move.segment];
            } else if (chainLength === minChain) {
                bestSacrifices.push(move.segment);
            }
        }
        segmentToDraw = bestSacrifices[Math.floor(Math.random() * bestSacrifices.length)];
        
    } else {
        segmentToDraw = availableMoves[0];
    }

    if (!segmentToDraw) return null;
    return { dotA: segmentToDraw.p1, dotB: segmentToDraw.p2 };
}

// --- 【已修改】策略 2: Minimax (迭代加深版) ---
function findBestMoveMinimaxIterative(availableMoves) {
    const startTime = performance.now();
    let maxDepth = Math.min(MAX_SEARCH_DEPTH, availableMoves.length);
    
    let overallBestMove = null; // 儲存上一個「已完成」深度的最佳解
    
    // 1. 迭代加深迴圈
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
        
        if (currentDepth > 1 && (performance.now() - startTime > TIME_LIMIT_MS)) {
            break; 
        }
        
        // 【修改】: 儲存 *所有* 最佳移動
        let currentBestMovesForThisDepth = []; 
        let currentBestScoreForThisDepth = -Infinity;
        
        const linesCopy = deepCopy(aiLines);
        const squaresCopy = deepCopy(aiSquares);
        const scoresCopy = deepCopy(aiScores);
        // (我們在第一層深度後，可以根據上一層的 'overallBestMove' 來做排序優化，但目前保持簡單)
        const sortedMoves = sortMovesForMinimax(availableMoves, linesCopy, squaresCopy);

        // 2. 根節點移動迴圈
        for (const move of sortedMoves) {
            
            if (performance.now() - startTime > TIME_LIMIT_MS) {
                break;
            }

            const undoData = makeMove(move, playerAINumber, linesCopy, squaresCopy, scoresCopy);
            
            let score;
            if (undoData.scoredCount > 0 && scoreAndGoRule) {
                score = minimax(currentDepth, -Infinity, Infinity, true, true, linesCopy, squaresCopy, scoresCopy, startTime);
            } else {
                score = -minimax(currentDepth - 1, -Infinity, Infinity, false, false, linesCopy, squaresCopy, scoresCopy, startTime);
            }
            
            undoMove(move, undoData, linesCopy, squaresCopy, scoresCopy);
            
            // 【修改】: 儲存所有平手的最佳移動
            if (score > currentBestScoreForThisDepth) {
                currentBestScoreForThisDepth = score;
                currentBestMovesForThisDepth = [move]; // 找到 *更* 好的，重設
            } else if (score === currentBestScoreForThisDepth) {
                currentBestMovesForThisDepth.push(move); // 找到 *一樣* 好的，加入
            }
        } // 結束根節點移動

        if (performance.now() - startTime > TIME_LIMIT_MS) {
            // 這一層沒跑完，不儲存結果，使用上一層的 `overallBestMove`
            break;
        }

        // 【修改】: 如果這一層完整跑完了
        if (currentBestMovesForThisDepth.length > 0) {
            // 從所有最佳解中 *隨機* 挑一個，作為這一層的答案
            overallBestMove = currentBestMovesForThisDepth[Math.floor(Math.random() * currentBestMovesForThisDepth.length)];
        } else {
             break; // 沒找到移動
        }

    } // 結束迭代加深

    if (!overallBestMove) {
        return findBestMoveHeuristic(availableMoves);
    }

    return { dotA: overallBestMove.p1, dotB: overallBestMove.p2 };
}


/**
 * Minimax 核心函式 (NegaMax 變體)
 * (此函式不變)
 */
function minimax(depth, alpha, beta, isMaxPlayer, isChainMove, linesState, squaresState, scoresState, startTime) {
    
    if (depth > 0 && (performance.now() - startTime > TIME_LIMIT_MS)) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }

    // 1. 置換表
    const boardHash = getBoardHash(linesState);
    if (transpositionTable.has(boardHash)) {
        const cached = transpositionTable.get(boardHash);
        if (cached.depth >= depth) {
            ttHits++;
            return cached.score;
        }
    }

    // 2. 終止
    const availableMoves = getAvailableMoves(linesState);
    if (depth === 0 || availableMoves.length === 0) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }

    // 3. 遞迴
    let bestValue = -Infinity; 
    const sortedMoves = (depth > 4) ? sortMovesForMinimax(availableMoves, linesState, squaresState) : availableMoves;

    for (const move of sortedMoves) {
        const currentPlayerToMove = isMaxPlayer ? playerAINumber : playerOpponentNumber;
        
        const undoData = makeMove(move, currentPlayerToMove, linesState, squaresState, scoresState);
        
        let value;
        if (undoData.scoredCount > 0 && scoreAndGoRule) {
            value = minimax(depth, alpha, beta, isMaxPlayer, true, linesState, squaresState, scoresState, startTime);
        } else {
            value = -minimax(depth - 1, -beta, -alpha, !isMaxPlayer, false, linesState, squaresState, scoresState, startTime);
        }

        undoMove(move, undoData, linesState, squaresState, scoresState);
        
        bestValue = Math.max(bestValue, value);
        alpha = Math.max(alpha, bestValue);

        if (alpha >= beta) {
            break; // Beta 剪枝
        }
    }
    
    // 4. 存入置換表
    transpositionTable.set(boardHash, { score: bestValue, depth: depth });

    return bestValue;
}

/**
 * 啟發式評估函式 (Heuristic Evaluation)
 * (此函式不變)
 */
function evaluateState(linesState, squaresState, scoresState, isMaxPlayer) {
    const myScore = isMaxPlayer ? scoresState[playerAINumber] : scoresState[playerOpponentNumber];
    const oppScore = isMaxPlayer ? scoresState[playerOpponentNumber] : scoresState[playerAINumber];
    let heuristicScore = (myScore - oppScore) * HEURISTIC_SQUARE_VALUE;
    if (myScore + oppScore === aiSquares.length) {
         return heuristicScore + (myScore > oppScore ? HEURISTIC_WIN_SCORE : -HEURISTIC_WIN_SCORE);
    }
    let safeMoves = 0;
    let minorUnsafeMoves = 0;
    let criticalUnsafeMoves = []; 
    for (const sq of squaresState) {
        if (sq.filled) continue;
        const sides = getSidesDrawn(sq, linesState);
        if (sides === 3) {
            heuristicScore -= HEURISTIC_CRITICAL_MOVE_PENALTY;
            const criticalLineId = sq.lineKeys.find(key => linesState[key].players.length === 0);
            if (criticalLineId) criticalUnsafeMoves.push(criticalLineId);
        } else if (sides === 2) {
            heuristicScore -= HEURISTIC_MINOR_MOVE_PENALTY;
            minorUnsafeMoves++;
        } else {
            safeMoves++;
        }
    }
    if (safeMoves === 0 && minorUnsafeMoves === 0 && criticalUnsafeMoves.length > 0) {
        let minChain = Infinity;
        const uniqueCriticalLines = [...new Set(criticalUnsafeMoves)];
        for (const lineId of uniqueCriticalLines) {
            const chainLength = calculateChainReaction(linesState[lineId], linesState, squaresState);
            if (chainLength < minChain) {
                minChain = chainLength;
            }
        }
        if (minChain < Infinity) {
             heuristicScore -= minChain * HEURISTIC_SQUARE_VALUE;
        }
    }
    return heuristicScore;
}


// --- Minimax 輔助函式 (排序) ---
// (此函式不變)
function sortMovesForMinimax(moves, linesState, squaresState) {
    return moves.map(move => {
        let priority = 0;
        const adjacentSquares = getAdjacentSquares(move.id, squaresState);
        for (const sq of adjacentSquares) {
            if (sq.filled) continue;
            const sides = getSidesDrawn(sq, linesState);
            if (sides === 3) priority = 100;
            else if (sides === 2) priority = -100;
            else if (sides === 1) priority = -10;
            else priority = 10;
        }
        return { move, priority };
    }).sort((a, b) => b.priority - a.priority)
      .map(item => item.move);
}


// --- 遊戲狀態模擬函式 (Worker 內部) ---

function getAvailableMoves(linesObj = aiLines) {
    const moves = [];
    for (const id in linesObj) {
        if (linesObj[id].players.length === 0) {
            moves.push(linesObj[id]);
        }
    }
    return moves;
}

function getSidesDrawn(square, linesObj = aiLines) {
    let sides = 0;
    for (const key of square.lineKeys) {
        if (linesObj[key] && linesObj[key].players.length > 0) {
            sides++;
        }
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

/**
 * 【已修正】模擬下棋
 */
function makeMove(segment, player, linesState, squaresState, scoresState) {
    const undoData = {
        player: player, 
        scoredCount: 0,
        filledSquares: []
    };
    if (!linesState[segment.id].players.includes(player)) {
        linesState[segment.id].players.push(player);
    }
    const adjacentSquares = getAdjacentSquares(segment.id, squaresState);
    for (const sq of adjacentSquares) {
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

/**
 * 【已修正】模擬撤銷下棋
 */
function undoMove(segment, undoData, linesState, squaresState, scoresState) {
    const player = undoData.player;
    const pIndex = linesState[segment.id].players.indexOf(player);
    if (pIndex > -1) {
        linesState[segment.id].players.splice(pIndex, 1);
    }
    
    if (undoData.scoredCount > 0) {
        for (const sq of undoData.filledSquares) {
            const player = sq.player;
            scoresState[player]--;
            sq.filled = false;
            sq.player = null;
        }
    }
}

// 深度複製
function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// (來自 script.js) 的連鎖計算函式
function calculateChainReaction(aiSacrificeSegment, linesState, squaresState) {
    // (此函式不變)
    let totalChainLength = 0;
    const simulatedDrawnLines = new Set();
    simulatedDrawnLines.add(aiSacrificeSegment.id);
    const startingBoxes = [];
    for (const sq of squaresState) {
        if (sq.filled || !sq.lineKeys.includes(aiSacrificeSegment.id)) {
            continue;
        }
        let sidesDrawn = 0;
        sq.lineKeys.forEach(key => {
            if (linesState[key].players.length > 0) sidesDrawn++;
        });
        if (sidesDrawn === 2) {
            startingBoxes.push(sq);
        }
    }
    const boxQueue = [...startingBoxes];
    const processedBoxes = new Set(startingBoxes.map(sq => sq.lineKeys.join(',')));
    while (boxQueue.length > 0) {
        const currentBox = boxQueue.shift();
        totalChainLength++;
        currentBox.lineKeys.forEach(key => simulatedDrawnLines.add(key));
        for (const lineKey of currentBox.lineKeys) {
            for (const adjacentSq of squaresState) {
                const adjacentBoxId = adjacentSq.lineKeys.join(',');
                if (adjacentSq === currentBox || adjacentSq.filled || processedBoxes.has(adjacentBoxId)) {
                    continue;
                }
                if (adjacentSq.lineKeys.includes(lineKey)) {
                    let adjacentSidesDrawn = 0;
                    let fourthSide = null;
                    for (const adjKey of adjacentSq.lineKeys) {
                        if (linesState[adjKey].players.length > 0 || simulatedDrawnLines.has(adjKey)) {
                            adjacentSidesDrawn++;
                        } else {
                            fourthSide = adjKey;
                        }
                    }
                    if (adjacentSidesDrawn === 3 && fourthSide !== null) {
                        boxQueue.push(adjacentSq);
                        processedBoxes.add(adjacentBoxId);
                    }
                }
            }
        }
    }
    return totalChainLength;
}