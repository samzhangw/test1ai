/**
 * ============================================
 * AI Web Worker (ai-worker.js)
 * * 包含所有 AI 運算邏輯
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

const MAX_SEARCH_DEPTH = 30; 
const TIME_LIMIT_MS = 2500;

// 評估分數權重
const HEURISTIC_WIN_SCORE = 1000000;
const HEURISTIC_SQUARE_VALUE = 1000;
const HEURISTIC_CRITICAL_MOVE_PENALTY = 800; 
const HEURISTIC_MINOR_MOVE_PENALTY = 150; 

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
    
    // 取得棋盤尺寸並產生 aiDots
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
    const difficulty = settings.difficulty || 'minimax'; // 預設為智能
    
    let bestMove;

    // 【策略選擇邏輯】
    if (difficulty === 'greedy') {
        // 簡單模式：只用貪婪啟發式
        bestMove = findBestMoveHeuristic(availableMoves);
    } else {
        // 困難模式：使用 Minimax
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
 * 策略 1: 淺層啟發式搜尋 (1-ply) - 簡單模式用
 */
function findBestMoveHeuristic(availableMoves, linesObj = aiLines, squaresObj = aiSquares) {
    if (availableMoves.length === 0) return null;
    
    let winningMoves = [];
    let safeMoves = [];
    let minorUnsafeMoves = [];
    let criticalUnsafeMoves = [];
    
    // 1. 評估所有 "dot-pair" 移動
    for (const move of availableMoves) {
        let squaresCompleted = 0;
        let isCritical = false; // 會製造出 3 邊
        let isMinor = false;    // 會製造出 2 邊
        
        let uniqueAdjacentSquares = new Set();

        // 檢查此 move 包含的所有 segments
        for (const segment of move.segments) {
            const adjacentSquares = getAdjacentSquares(segment.id, squaresObj);
            adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
        }

        for (const sq of uniqueAdjacentSquares) {
            if (sq.filled) continue;
            
            // 模擬畫上 *所有* segments 後的狀態
            let sidesAfterMove = 0;
            sq.lineKeys.forEach(key => {
                if (linesObj[key].players.length > 0) {
                    sidesAfterMove++;
                } else if (move.segments.some(seg => seg.id === key)) {
                    sidesAfterMove++;
                }
            });

            if (sidesAfterMove === 4) {
                squaresCompleted++;
            } else if (sidesAfterMove === 3) {
                isCritical = true;
            } else if (sidesAfterMove === 2) {
                isMinor = true;
            }
        }
        
        const moveInfo = { move, squaresCompleted, isCritical, isMinor };
        
        if (squaresCompleted > 0) winningMoves.push(moveInfo);
        else if (isCritical) criticalUnsafeMoves.push(moveInfo);
        else if (isMinor) minorUnsafeMoves.push(moveInfo);
        else safeMoves.push(moveInfo);
    }
    
    let bestDotMove;
    
    // 2. 根據優先級選擇 (隨機性增加變化)
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
    } else {
        return null; 
    }

    if (!bestDotMove) return null;
    return { dotA: bestDotMove.dotA, dotB: bestDotMove.dotB };
}

// --- 策略 2: Minimax (迭代加深版) - 智能模式用 ---
function findBestMoveMinimaxIterative(availableMoves) {
    const startTime = performance.now();
    let maxDepth = Math.min(MAX_SEARCH_DEPTH, availableMoves.length);
    
    let overallBestMove = null; 
    
    // 1. 迭代加深迴圈
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
        
        if (currentDepth > 1 && (performance.now() - startTime > TIME_LIMIT_MS)) {
            break; 
        }
        
        let currentBestMovesForThisDepth = []; 
        let currentBestScoreForThisDepth = -Infinity;
        
        const linesCopy = deepCopy(aiLines);
        const squaresCopy = deepCopy(aiSquares);
        const scoresCopy = deepCopy(aiScores);
        const sortedMoves = sortMovesForMinimax(availableMoves, linesCopy, squaresCopy);

        // 2. 根節點移動迴圈
        for (const move of sortedMoves) { 
            
            if (performance.now() - startTime > TIME_LIMIT_MS) {
                break;
            }

            const undoData = makeMove(move.segments, playerAINumber, linesCopy, squaresCopy, scoresCopy);
            
            let score;
            if (undoData.scoredCount > 0 && scoreAndGoRule) {
                // 根節點：AI 得分後繼續下，不反轉分數，傳入 true 表示保持 AI 視角
                score = minimax(currentDepth, -Infinity, Infinity, true, true, linesCopy, squaresCopy, scoresCopy, startTime); 
            } else {
                // 根節點：沒得分換對手，反轉分數
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

        if (performance.now() - startTime > TIME_LIMIT_MS) {
            break;
        }

        if (currentBestMovesForThisDepth.length > 0) {
            overallBestMove = currentBestMovesForThisDepth[Math.floor(Math.random() * currentBestMovesForThisDepth.length)];
        } else {
             break; 
        }
    } 

    if (!overallBestMove) {
        // 萬一沒找到 (例如瞬間超時)，退回啟發式
        const heuristicMove = findBestMoveHeuristic(availableMoves);
        if (heuristicMove) return heuristicMove;
        
        if (availableMoves.length > 0) {
            return { dotA: availableMoves[0].dotA, dotB: availableMoves[0].dotB };
        }
        return null;
    }

    return { dotA: overallBestMove.dotA, dotB: overallBestMove.dotB }; 
}

/**
 * Minimax 核心函式 (修正版)
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

    // 2. 終止條件
    const availableMoves = getAvailableMoves(linesState); 
    if (depth === 0 || availableMoves.length === 0) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }

    // 3. 遞迴搜尋
    let bestValue = -Infinity; 
    const sortedMoves = (depth > 4) ? sortMovesForMinimax(availableMoves, linesState, squaresState) : availableMoves;

    for (const move of sortedMoves) { 
        const currentPlayerToMove = isMaxPlayer ? playerAINumber : playerOpponentNumber;
        
        const undoData = makeMove(move.segments, currentPlayerToMove, linesState, squaresState, scoresState);
        
        let value;
        if (undoData.scoredCount > 0 && scoreAndGoRule) {
            // 【關鍵修正】：得分後繼續下，仍然是同一個玩家 (isMaxPlayer 不變)
            // 因此不需要加負號，也不需要交換 alpha/beta
            // 我們希望最大化「自己」在下一層的分數
            value = minimax(depth, alpha, beta, isMaxPlayer, true, linesState, squaresState, scoresState, startTime);
        } else {
            // 沒得分，換對手下 (!isMaxPlayer)
            // 標準 NegaMax：數值反轉，區間反轉 (-beta, -alpha)
            value = -minimax(depth - 1, -beta, -alpha, !isMaxPlayer, false, linesState, squaresState, scoresState, startTime);
        }

        undoMove(undoData, linesState, squaresState, scoresState); 
        
        bestValue = Math.max(bestValue, value);
        alpha = Math.max(alpha, bestValue);

        if (alpha >= beta) {
            break; // Beta Cutoff
        }
    }
    
    // 4. 存入置換表
    transpositionTable.set(boardHash, { score: bestValue, depth: depth });

    return bestValue;
}

// 評估函式
function evaluateState(linesState, squaresState, scoresState, isMaxPlayer) {
    const myScore = isMaxPlayer ? scoresState[playerAINumber] : scoresState[playerOpponentNumber];
    const oppScore = isMaxPlayer ? scoresState[playerOpponentNumber] : scoresState[playerAINumber];
    let heuristicScore = (myScore - oppScore) * HEURISTIC_SQUARE_VALUE;
    
    // 如果遊戲結束，給予絕對勝利分數
    if (myScore + oppScore === squaresState.length) {
         return heuristicScore + (myScore > oppScore ? HEURISTIC_WIN_SCORE : -HEURISTIC_WIN_SCORE);
    }
    
    // 評估盤面危險度/機會
    let safeMoves = 0;
    let minorUnsafeMoves = 0;
    let criticalUnsafeMoves = []; 
    for (const sq of squaresState) {
        if (sq.filled) continue;
        const sides = getSidesDrawn(sq, linesState);
        if (sides === 3) {
            // 3 邊格對當前玩家是好機會 (可以得分)
            heuristicScore += HEURISTIC_CRITICAL_MOVE_PENALTY; 
            const criticalLineId = sq.lineKeys.find(key => linesState[key].players.length === 0);
            if (criticalLineId) criticalUnsafeMoves.push(criticalLineId);
        } else if (sides === 2) {
            // 2 邊格是危險的 (下了變 3 邊)
            heuristicScore -= HEURISTIC_MINOR_MOVE_PENALTY;
            minorUnsafeMoves++;
        } else {
            safeMoves++;
        }
    }
    
    // 如果只剩下危險步，計算連鎖反應損失
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
             // 預測會失去多少分
             heuristicScore -= minChain * HEURISTIC_SQUARE_VALUE;
        }
    }
    return heuristicScore;
}


// 排序函式 (優化 Alpha-Beta 剪枝效率)
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
                if (linesState[key].players.length > 0) {
                    sidesAfterMove++;
                } 
                else if (move.segments.some(seg => seg.id === key)) {
                    sidesAfterMove++;
                }
            });
            
            if (sidesAfterMove === 4) {
                priority += 10000; // 能得分最高優先
            } else if (sidesAfterMove === 3) {
                priority -= 100;   // 給對手製造得分機會最低優先
            } else if (sidesAfterMove === 2) {
                priority -= 10;    // 製造 2 邊次低優先
            } else {
                priority += 1;     // 安全步
            }
        }
        
        // 優先選沒人畫過的線
        if (move.segments.every(seg => seg.players.length === 0)) {
             priority += 5;
        }

        return { move, priority };
    }).sort((a, b) => b.priority - a.priority)
      .map(item => item.move);
}


// --- 遊戲狀態模擬函式 (Worker 內部) ---

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
        if (pIndex > -1) {
            linesState[segmentId].players.splice(pIndex, 1);
        }
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
    
    if (dr !== 0 && dc !== 0) {
        return [];
    }

    while (r !== dotB.r || c !== dotB.c) {
        let next_r = r + dr;
        let next_c = c + dc;
        let segmentId = null;

        if (dr === 0) { 
            segmentId = `H_${r},${Math.min(c, next_c)}`;
        } else if (dc === 0) { 
            segmentId = `V_${Math.min(r, next_r)},${c}`;
        }

        if (segmentId && linesObj[segmentId]) {
            segments.push(linesObj[segmentId]);
        }
        r = next_r;
        c = next_c;
    }
    return segments;
}


function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function calculateChainReaction(aiSacrificeSegment, linesState, squaresState) {
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
        
        if (sidesDrawn === 3) {
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
