/**
 * ============================================
 * AI Web Worker (ai-worker.js)
 * * 包含所有 AI 運算 lógica:
 * 1. Minimax 演算法 (NegaMax 變體)
 * 2. 帶有時間限制的 迭代加深 (Iterative Deepening)
 * 3. 置換表 (Transposition Table)
 * 4. 根據規則切換策略的 啟發式評估 (Heuristic)
 * 5. 靜態搜尋 (Quiescence Search) - 整合於啟發函數中
 * 6. 支援「得分後再走一步」的 Minimax
 * 7. (**** 新功能 ****) 策略隨機性 (在多個最佳解中隨機選取)
 * * 【已修改】
 * 8. 支援 maxLineLength > 1 的 Minimax
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

// 【新增】棋盤尺寸與點
let gridRows;
let gridCols;
let aiDots = [];

// AI 效能與快取
let transpositionTable = new Map();
let ttHits = 0; 

// 【智能強化 3】: 允許 AI 在殘局時看得更遠
const MAX_SEARCH_DEPTH = 30; // (原為 22)
const TIME_LIMIT_MS = 2500;

// 【智能強化 2】: 大幅提高懲罰，讓 AI 更謹慎
const HEURISTIC_WIN_SCORE = 1000000;
const HEURISTIC_SQUARE_VALUE = 1000;
const HEURISTIC_CRITICAL_MOVE_PENALTY = 800; // (原為 500)
const HEURISTIC_MINOR_MOVE_PENALTY = 150; // (原為 50)

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
    
    // 【新增】取得棋盤尺寸並產生 aiDots
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
    const availableMoves = getAvailableMoves(); // 參數現在是全域的
    
    let bestMove;

    // 【貪婪模式修改】:
    // 強制 AI 永遠使用「啟發式(貪婪)」搜尋，
    // 禁用 Minimax (findBestMoveMinimaxIterative)。
    bestMove = findBestMoveHeuristic(availableMoves);
    
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
 * 【已修改】
 * 策略 1: 淺層啟發式搜尋 (1-ply)
 * - 現在接收 {dotA, dotB, segments} 格式的 moves
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

        // 檢查此 move 包含的所有 1-length segments
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
                    // 這是此 move 會畫上的線
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
    
    // 2. 根據優先級選擇
    if (winningMoves.length > 0) {
        // 選能拿最多分的
        const maxScore = Math.max(...winningMoves.map(m => m.squaresCompleted));
        const bestWinningMoves = winningMoves.filter(m => m.squaresCompleted === maxScore);
        bestDotMove = bestWinningMoves[Math.floor(Math.random() * bestWinningMoves.length)].move;

    } else if (safeMoves.length > 0) {
        // 隨機選一個安全的
        bestDotMove = safeMoves[Math.floor(Math.random() * safeMoves.length)].move;
        
    } else if (minorUnsafeMoves.length > 0) {
        // 隨機選一個次要風險的
        bestDotMove = minorUnsafeMoves[Math.floor(Math.random() * minorUnsafeMoves.length)].move;
        
    } else if (criticalUnsafeMoves.length > 0) {
        // 【簡化】: 多格連線的連鎖計算太複雜，暫時先隨機選一個
        bestDotMove = criticalUnsafeMoves[Math.floor(Math.random() * criticalUnsafeMoves.length)].move;
        
    } else if (availableMoves.length > 0) {
        bestDotMove = availableMoves[0];
    } else {
        return null; // 真的沒地方走了
    }

    if (!bestDotMove) return null;
    return { dotA: bestDotMove.dotA, dotB: bestDotMove.dotB };
}

// --- 【已修改】策略 2: Minimax (迭代加深版) ---
/**
 * 【重構 5 & 最終修正】
 * Minimax 迭代加深
 * - 呼叫新的 makeMove/undoMove
 * - 修正 Score-Go 邏輯 (移除根節點的負號)
 */
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
        for (const move of sortedMoves) { // 'move' is {dotA, dotB, segments}
            
            if (performance.now() - startTime > TIME_LIMIT_MS) {
                break;
            }

            const undoData = makeMove(move.segments, playerAINumber, linesCopy, squaresCopy, scoresCopy);
            
            let score;
            if (undoData.scoredCount > 0 && scoreAndGoRule) {
                // 【最終修正】: 根節點在 AI 連續出招時，不應否定分數 (因為 minimax 已回傳 AI 視角的分數)
                score = minimax(currentDepth, -Infinity, Infinity, true, true, linesCopy, squaresCopy, scoresCopy, startTime); // <-- 移除負號
            } else {
                score = -minimax(currentDepth - 1, -Infinity, Infinity, false, false, linesCopy, squaresCopy, scoresCopy, startTime);
            }
            
            undoMove(undoData, linesCopy, squaresCopy, scoresCopy); // 'move' 不再需要
            
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
        // 如果 Minimax 找不到 (例如超時)，退回啟發式
        const heuristicMove = findBestMoveHeuristic(availableMoves);
        if (heuristicMove) return heuristicMove;
        
        // 如果連啟發式都找不到，隨便給一個
        if (availableMoves.length > 0) {
            return { dotA: availableMoves[0].dotA, dotB: availableMoves[0].dotB };
        }
        return null;
    }

    return { dotA: overallBestMove.dotA, dotB: overallBestMove.dotB }; // <-- 這裡回傳的格式正確
}


/**
 * 【重構 6 & Score-Go 修正 2】
 * Minimax 核心函式 (NegaMax 變體)
 * - 呼叫新的 makeMove/undoMove
 * - 修正 Score-Go 邏輯 (加入負號並反轉 alpha/beta)
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
    // 【修改】
    const availableMoves = getAvailableMoves(linesState); // 這裡會自動取得標準 DotMove 格式
    if (depth === 0 || availableMoves.length === 0) {
        return evaluateState(linesState, squaresState, scoresState, isMaxPlayer);
    }

    // 3. 遞迴
    let bestValue = -Infinity; 
    const sortedMoves = (depth > 4) ? sortMovesForMinimax(availableMoves, linesState, squaresState) : availableMoves;

    for (const move of sortedMoves) { // 'move' is {dotA, dotB, segments}
        const currentPlayerToMove = isMaxPlayer ? playerAINumber : playerOpponentNumber;
        
        const undoData = makeMove(move.segments, currentPlayerToMove, linesState, squaresState, scoresState);
        
        let value;
        if (undoData.scoredCount > 0 && scoreAndGoRule) {
            // 【Score-Go 修正 2】: NegaMax 遞迴必須*永遠*反轉 alpha/beta 並*永遠*否定回傳值
            value = -minimax(depth, -beta, -alpha, isMaxPlayer, true, linesState, squaresState, scoresState, startTime);
        } else {
            value = -minimax(depth - 1, -beta, -alpha, !isMaxPlayer, false, linesState, squaresState, scoresState, startTime);
        }

        undoMove(undoData, linesState, squaresState, scoresState); // 'move' 不再需要
        
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
 * 【Score-Go 修正 3】
 * 啟發式評估函式 (Heuristic Evaluation)
 * - 3 邊格是「獎勵」，不是「懲罰」
 */
function evaluateState(linesState, squaresState, scoresState, isMaxPlayer) {
    const myScore = isMaxPlayer ? scoresState[playerAINumber] : scoresState[playerOpponentNumber];
    const oppScore = isMaxPlayer ? scoresState[playerOpponentNumber] : scoresState[playerAINumber];
    let heuristicScore = (myScore - oppScore) * HEURISTIC_SQUARE_VALUE;
    
    // 【狀態污染 BUG 修正】: 使用傳入的 'squaresState.length'
    if (myScore + oppScore === squaresState.length) {
         return heuristicScore + (myScore > oppScore ? HEURISTIC_WIN_SCORE : -HEURISTIC_WIN_SCORE);
    }
    
    let safeMoves = 0;
    let minorUnsafeMoves = 0;
    let criticalUnsafeMoves = []; 
    for (const sq of squaresState) {
        if (sq.filled) continue;
        const sides = getSidesDrawn(sq, linesState);
        if (sides === 3) {
            // 【Score-Go 修正 3】: 3 邊格是得分機會，應為「獎勵」
            heuristicScore += HEURISTIC_CRITICAL_MOVE_PENALTY; // (原為 -=)
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


/**
 * 【最終修正】
 * Minimax 輔助函式 (排序)
 * - 'moves' 是一個 { dotA, dotB, segments } 陣列
 * - 修正排序邏輯，確保正確評估得分
 */
function sortMovesForMinimax(moves, linesState, squaresState) {
    return moves.map(move => { // move is { dotA, dotB, segments }
        let priority = 0;
        let uniqueAdjacentSquares = new Set();
        
        // 1. 找到此移動碰到的所有方塊
        for (const seg of move.segments) {
            const adjacentSquares = getAdjacentSquares(seg.id, squaresState);
            adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
        }

        // 2. 評估移動後的局勢
        for (const sq of uniqueAdjacentSquares) {
            if (sq.filled) continue;
            
            // 【修正邏輯】: 我們必須檢查這個方格在移動後的*真實*邊數
            
            let sidesAfterMove = 0;
            sq.lineKeys.forEach(key => {
                // 檢查是否是「已存在的邊」
                if (linesState[key].players.length > 0) {
                    sidesAfterMove++;
                } 
                // 檢查是否是「這次移動會畫上的邊」
                else if (move.segments.some(seg => seg.id === key)) {
                    sidesAfterMove++;
                }
            });
            
            // 根據移動*後*的真實狀態來賦予優先級
            if (sidesAfterMove === 4) {
                priority += 10000; // 得分 = 極高優先
            } else if (sidesAfterMove === 3) {
                priority -= 100; // 製造 3 邊 = 低優先
            } else if (sidesAfterMove === 2) {
                priority -= 10; // 製造 2 邊 = 稍低優先
            } else {
                priority += 1; // 安全
            }
        }
        
        // 優先選擇「全新」的線 (沒有重疊對手或自己的線)
        if (move.segments.every(seg => seg.players.length === 0)) {
             priority += 5;
        }

        return { move, priority };
    }).sort((a, b) => b.priority - a.priority)
      .map(item => item.move);
}


// --- 遊戲狀態模擬函式 (Worker 內部) ---

/**
 * 【重構 2】
 * 根據 maxLineLength 產生可行的移動
 * - *所有* 策略都回傳 {dotA, dotB, segments} 格式
 */
function getAvailableMoves(linesObj = aiLines, dots = aiDots, rows = gridRows, cols = gridCols, lineLength = maxLineLength) {
    const moves = [];
    
    if (lineLength === 1) {
        // Minimax 策略: 傳回 1-length segments (但包裝成標準 DotMove 格式)
        for (const id in linesObj) {
            if (linesObj[id].players.length === 0) {
                const seg = linesObj[id];
                // 將單一 segment 包裝成 "DotMove" 格式
                moves.push({ dotA: seg.p1, dotB: seg.p2, segments: [seg] });
            }
        }
        
    } else {
        // Heuristic 策略: D {dotA, dotB, segments}
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const dotA = dots[r][c];

                // 1. 檢查水平 (往右)
                if (c + lineLength < cols) {
                    const dotB = dots[r][c + lineLength];
                    const segments = getSegmentsForLine(dotA, dotB, linesObj);
                    // 檢查是否至少有一條線是新的
                    if (segments.length > 0 && segments.some(seg => seg.players.length === 0)) {
                        moves.push({ dotA, dotB, segments });
                    }
                }
                
                // 2. 檢查垂直 (往下)
                if (r + lineLength < rows) {
                    const dotB = dots[r + lineLength][c];
                    const segments = getSegmentsForLine(dotA, dotB, linesObj);
                    // 檢查是否至少有一條線是新的
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

/**
 * 【重構 3】模擬下棋
 * - 現在 'moveSegments' 是一個 segment 陣列
 */
function makeMove(moveSegments, player, linesState, squaresState, scoresState) {
    const undoData = {
        player: player, 
        scoredCount: 0,
        filledSquares: [], // 記下哪些方塊被填滿
        segmentsChanged: []  // 記下哪些線段被繪製
    };

    let uniqueAdjacentSquares = new Set();

    // 1. 繪製所有線段
    for (const segment of moveSegments) {
        if (!linesState[segment.id].players.includes(player)) {
            linesState[segment.id].players.push(player);
            undoData.segmentsChanged.push(segment.id); // 記錄被改變的線
        }
        
        // 收集所有鄰近的方塊，稍後檢查
        const adjacentSquares = getAdjacentSquares(segment.id, squaresState);
        adjacentSquares.forEach(sq => uniqueAdjacentSquares.add(sq));
    }

    // 2. 檢查所有受影響的方塊是否得分
    for (const sq of uniqueAdjacentSquares) {
        if (!sq.filled) {
            const sides = getSidesDrawn(sq, linesState);
            if (sides === 4) {
                sq.filled = true;
                sq.player = player;
                scoresState[player]++;
                undoData.scoredCount++;
                undoData.filledSquares.push(sq); // 記錄被填滿的方塊
            }
        }
    }
    
    return undoData;
}

/**
 * 【重構 4】模擬撤銷下棋
 * - 現在只接收 undoData
 */
function undoMove(undoData, linesState, squaresState, scoresState) {
    const player = undoData.player;
    
    // 1. 擦除線段
    for (const segmentId of undoData.segmentsChanged) {
        const pIndex = linesState[segmentId].players.indexOf(player);
        if (pIndex > -1) {
            linesState[segmentId].players.splice(pIndex, 1);
        }
    }
    
    // 2. 恢復方塊
    if (undoData.scoredCount > 0) {
        for (const sq of undoData.filledSquares) {
            // 在 deepCopy 的世界裡，我們需要找到 'squaresState' 中對應的方塊
            const stateSquare = squaresState.find(s => s.lineKeys[0] === sq.lineKeys[0] && s.lineKeys[1] === sq.lineKeys[1]);
            if (stateSquare) {
                scoresState[player]--;
                stateSquare.filled = false;
                stateSquare.player = null;
            }
        }
    }
}

/**
 * 【新增】
 * (複製自 script.js)
 * 取得 dotA 和 dotB 之間的所有 1-length 線段
 */
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

        if (dr === 0) { // 水平
            segmentId = `H_${r},${Math.min(c, next_c)}`;
        } else if (dc === 0) { // 垂直
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


// 深度複製
function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/**
 * 【連鎖反應修正】
 * (來自 script.js) 的連鎖計算函式
 */
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
        
        // 【連鎖反應修正】: 連鎖反應的起點是 3 邊格，不是 2 邊格
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
