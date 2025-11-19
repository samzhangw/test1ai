/**
 * ============================================
 * AI Web Worker (ai-worker.js) - 極速優化版
 * * 包含：預先排序優化、安全步剪枝、1秒時間限制
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

// 【優化 1】預先計算的排序 Key，加速 Hash
let sortedLineKeys = [];

// AI 效能與快取
let transpositionTable = new Map();
let ttHits = 0; 

// 搜尋設定
const MAX_SEARCH_DEPTH = 30; 
const TIME_LIMIT_MS = 1000; // 【優化 3】限制 1 秒，保證流暢度

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

    // 【優化 1】預先排序 Key
    sortedLineKeys = Object.keys(aiLines).sort();

    transpositionTable.clear(); 
    ttHits = 0;

    // 2. 決定 AI 策略
    const availableMoves = getAvailableMoves();
    const difficulty = settings.difficulty || 'minimax'; 
    
    let bestMove;

    if (difficulty === 'greedy') {
        // 簡單模式：貪婪啟發式
        bestMove = findBestMoveHeuristic(availableMoves);
    } else {
        // 困難模式：Minimax (含優化)
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

// --- 策略 2: Minimax (迭代加深 + 時間限制) ---
function findBestMoveMinimaxIterative(availableMoves) {
    const startTime = performance.now();
    let maxDepth = Math.min(MAX_SEARCH_DEPTH, availableMoves.length);
    
    let overallBestMove = null; 
    
    // 1. 迭代加深
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
        
        // 時間檢查
        if (currentDepth > 1 && (performance.now() - startTime > TIME_LIMIT_MS)) {
            break; 
        }
        
        let currentBestMovesForThisDepth = []; 
        let currentBestScoreForThisDepth = -Infinity;
        
        const linesCopy = deepCopy(aiLines);
        const squaresCopy = deepCopy(aiSquares);
        const scoresCopy = deepCopy(aiScores);
        
        // 排序
        const sortedMoves = sortMovesForMinimax(availableMoves, linesCopy, squaresCopy);

        // 【優化 2】根節點剪枝：如果有得分步，只算得分步
        // 這能避免 AI 在有一堆得分機會時還浪費時間去算其他步
        const scoringMoves = sortedMoves.filter(m => isScoringMove(m, linesCopy, squaresCopy));
        const movesToSearch = scoringMoves.length > 0 ? scoringMoves : sortedMoves;

        // 2. 根節點移動迴圈
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
        const heuristicMove = findBestMoveHeuristic(availableMoves);
        if (heuristicMove) return heuristicMove;
        if (availableMoves.length > 0) return { dotA: availableMoves[0].dotA, dotB: availableMoves[0].dotB };
        return null;
    }

    return { dotA: overallBestMove.dotA, dotB: overallBestMove.dotB }; 
}

/**
 * Minimax 核心函式 (含剪枝優化)
 */
function minimax(depth, alpha, beta, isMaxPlayer, isChainMove, linesState, squaresState, scoresState, startTime) {
    
    // 每 1000 次檢查一次時間，減少開銷
    if ((ttHits % 1000 === 0) && (performance.now() - startTime > TIME_LIMIT_MS)) {
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

    // 【優化 2 核心】：安全步剪枝 (Safe Move Pruning)
    // 如果存在「安全步」(不下成3邊) 或 「得分步」，則只搜尋這些步。
    // 只有在被迫時 (Loony Moves)，才搜尋所有步 (包含送分步)。
    const sortedMoves = sortMovesForMinimax(availableMoves, linesState, squaresState);
    
    // 分類移動
    let scoring = [];
    let safe = [];
    let bad = [];

    for (const m of sortedMoves) {
        const type = getMoveType(m, linesState, squaresState);
        if (type === 'scoring') scoring.push(m);
        else if (type === 'safe') safe.push(m);
        else bad.push(m);
    }

    // 決定要搜尋哪些移動
    let movesToSearch;
    if (scoring.length > 0) {
        movesToSearch = scoring; // 有分必拿 (貪婪策略在這種遊戲通常是最佳解)
    } else if (safe.length > 0) {
        movesToSearch = safe;    // 有安全步就只走安全步，絕不自殺
    } else {
        movesToSearch = bad;     // 沒辦法了，只能從爛步中選一個傷害最小的
    }

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

        if (alpha >= beta) {
            break; 
        }
    }
    
    transpositionTable.set(boardHash, { score: bestValue, depth: depth });
    return bestValue;
}

// 輔助：判斷移動類型
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
    if (maxSides === 3) return 'bad'; // 讓對手能得分
    return 'safe'; // 0, 1, 2 邊
}

function isScoringMove(move, linesState, squaresState) {
    return getMoveType(move, linesState, squaresState) === 'scoring';
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
        // 簡單的優先級計算，詳細邏輯已移至 getMoveType 進行剪枝
        const type = getMoveType(move, linesState, squaresState);
        if (type === 'scoring') priority = 100;
        else if (type === 'safe') priority = 10;
        else priority = -100;
        
        // 優先選沒人畫過的線 (美觀)
        if (move.segments.every(seg => seg.players.length === 0)) priority += 1;

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

// 【優化 1】使用預先排序的 Key 加速
function getBoardHash(linesObj) {
    let hash = '';
    // sortedLineKeys 在 init 時產生
    for (const id of sortedLineKeys) {
        // 如果線被畫了，加入 '1' 或 '2' (雖然邏輯上只關心有沒有畫，但玩家資訊可能有用)
        // 簡化：只記錄 "有畫/沒畫" 對於置換表通常足夠且更通用，但這裡保留玩家資訊以防萬一
        const pLen = linesObj[id].players.length;
        hash += pLen > 0 ? '1' : '0'; // 簡化 Hash，只看線條是否存在，能增加 Cache 命中率
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
