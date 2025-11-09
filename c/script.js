document.addEventListener('DOMContentLoaded', () => {
    // 取得 HTML 元素
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const player1ScoreBox = document.getElementById('player1-score');
    const player2ScoreBox = document.getElementById('player2-score');
    const gameOverMessage = document.getElementById('game-over-message');
    const winnerText = document.getElementById('winner-text');
    const confirmLineButton = document.getElementById('confirm-line-button');
    const cancelLineButton = document.getElementById('cancel-line-button');
    const actionBar = document.getElementById('action-bar');
    const resetButton = document.getElementById('reset-button');
    const exportPngButton = document.getElementById('export-png-button');
    // 【新增】匯出 CSV 按鈕
    const exportCsvButton = document.getElementById('export-csv-button');
    
    const gameModeSelect = document.getElementById('game-mode');
    const boardRowsInput = document.getElementById('board-rows');
    const boardColsInput = document.getElementById('board-cols');
    const lineLengthInput = document.getElementById('line-length');
    const scoreAgainModeSelect = document.getElementById('score-again-mode');

    // 遊戲設定
    let gridRows = 4;
    let gridCols = 4;
    let maxLineLength = 1;
    const DOT_SPACING = 100;
    const PADDING = 50;
    const DOT_RADIUS = 6;
    const LINE_WIDTH = 8;
    const CLICK_TOLERANCE_DOT = 15;

    // 玩家顏色
    const PLAYER_COLORS = {
        1: { line: '#3b82f6', fill: 'rgba(59, 130, 246, 0.3)' },
        2: { line: '#ef4444', fill: 'rgba(239, 68, 68, 0.3)' },
    };
    const DEFAULT_LINE_COLOR = '#bbbbbb';

    // 遊戲狀態
    let currentPlayer = 1;
    let scores = { 1: 0, 2: 0 };
    let dots = [];
    let lines = {};
    let squares = [];
    let totalSquares = (gridRows - 1) * (gridCols - 1);
    
    let selectedDot1 = null;
    let selectedDot2 = null;
    let gameMode = 'pvp';
    let scoreAndGo = true;
    
    // 【新增】對戰紀錄
    let moveHistory = [];
    let turnCounter = 1;

    // 動畫相關變數
    const ANIMATION_DURATION = 500;
    let animationStartTime = 0;
    let isAnimating = false;
    let currentDotRadius = DOT_RADIUS;

    // 初始化遊戲
    function initGame() {
        // ( ... 讀取設定 ... )
        const desiredRows = parseInt(boardRowsInput && boardRowsInput.value ? boardRowsInput.value : '4', 10);
        const desiredCols = parseInt(boardColsInput && boardColsInput.value ? boardColsInput.value : '4', 10);
        gridRows = Math.max(2, Math.min(12, isNaN(desiredRows) ? 4 : desiredRows));
        gridCols = Math.max(2, Math.min(12, isNaN(desiredCols) ? 4 : desiredCols));
        if (boardRowsInput && boardRowsInput.value != String(gridRows)) boardRowsInput.value = String(gridRows);
        if (boardColsInput && boardColsInput.value != String(gridCols)) boardColsInput.value = String(gridCols);
        const desiredLength = parseInt(lineLengthInput && lineLengthInput.value ? lineLengthInput.value : '1', 10);
        const maxAllowedLength = Math.max(gridRows - 1, gridCols - 1);
        maxLineLength = Math.max(1, Math.min(maxAllowedLength, isNaN(desiredLength) ? 1 : desiredLength));
        if (lineLengthInput && lineLengthInput.value != String(maxLineLength)) {
            lineLengthInput.value = String(maxLineLength);
            lineLengthInput.max = maxAllowedLength;
        }
        const canvasWidth = (gridCols - 1) * DOT_SPACING + PADDING * 2;
        const canvasHeight = (gridRows - 1) * DOT_SPACING + PADDING * 2;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        gameMode = gameModeSelect.value;
        scoreAndGo = (scoreAgainModeSelect && scoreAgainModeSelect.value === 'yes');
        
        if (gameMode === 'pvc' || gameMode === 'cvc') {
            currentPlayer = Math.random() < 0.5 ? 1 : 2;
        } else {
            currentPlayer = 1;
        }
        
        scores = { 1: 0, 2: 0 };
        dots = [];
        lines = {};
        squares = [];
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        gameOverMessage.classList.add('hidden');
        
        // 【新增】重設對戰紀錄
        moveHistory = [];
        turnCounter = 1;

        // 1. 產生點
        for (let r = 0; r < gridRows; r++) {
            dots[r] = [];
            for (let c = 0; c < gridCols; c++) {
                dots[r][c] = {
                    x: c * DOT_SPACING + PADDING,
                    y: r * DOT_SPACING + PADDING,
                    r: r, c: c
                };
            }
        }

        // 2. 產生線段
        lines = {};
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                if (c < gridCols - 1) {
                    const id = `H_${r},${c}`;
                    lines[id] = { p1: dots[r][c], p2: dots[r][c + 1], players: [], id: id };
                }
                if (r < gridRows - 1) {
                    const id = `V_${r},${c}`;
                    lines[id] = { p1: dots[r][c], p2: dots[r + 1][c], players: [], id: id };
                }
            }
        }

        // 3. 產生正方形
        squares = [];
        for (let r = 0; r < gridRows - 1; r++) {
            for (let c = 0; c < gridCols - 1; c++) {
                const h1 = `H_${r},${c}`;
                const h2 = `H_${r + 1},${c}`;
                const v1 = `V_${r},${c}`;
                const v2 = `V_${r},${c + 1}`;
                squares.push({
                    lineKeys: [h1, h2, v1, v2],
                    x: dots[r][c].x,
                    y: dots[r][c].y,
                    size: DOT_SPACING,
                    filled: false, 
                    player: null
                });
            }
        }
        totalSquares = squares.length;
        
        updateUI();

        // 啟動開始動畫
        isAnimating = true;
        animationStartTime = 0;
        currentDotRadius = 0;
        canvas.style.pointerEvents = 'none';
        
        requestAnimationFrame(animationLoop);
    }
    
    // 遊戲開始動畫迴圈
    function animationLoop(timestamp) {
        if (animationStartTime === 0) {
            animationStartTime = timestamp;
        }
        
        const elapsed = timestamp - animationStartTime;
        let progress = Math.min(elapsed / ANIMATION_DURATION, 1);
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        
        currentDotRadius = DOT_RADIUS * easedProgress;

        drawCanvasInternal();

        if (progress < 1) {
            requestAnimationFrame(animationLoop);
        } else {
            isAnimating = false;
            currentDotRadius = DOT_RADIUS;
            animationStartTime = 0;
            
            if (gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2)) {
                 checkAndTriggerAIMove();
            } else {
                canvas.style.pointerEvents = 'auto';
            }
        }
    }

    // drawCanvas 的包裝函式
    function drawCanvas() {
        if (isAnimating) return; 
        currentDotRadius = DOT_RADIUS; 
        drawCanvasInternal();
    }

    // 內部繪製函式
    function drawCanvasInternal() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. 繪製已完成的正方形 (填色)
        squares.forEach(sq => {
            if (sq.filled) {
                ctx.fillStyle = PLAYER_COLORS[sq.player].fill;
                ctx.fillRect(sq.x, sq.y, sq.size, sq.size);
                
                ctx.fillStyle = PLAYER_COLORS[sq.player].line;
                ctx.font = 'bold 48px var(--font-main, sans-serif)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                let playerLabel;
                if (gameMode === 'cvc') {
                    playerLabel = (sq.player === 1) ? "C1" : "C2";
                } else if (gameMode === 'pvc') {
                    playerLabel = (sq.player === 1) ? "1" : "C";
                } else {
                    playerLabel = sq.player;
                }
                
                ctx.fillText(playerLabel, sq.x + sq.size / 2, sq.y + sq.size / 2 + 5);
            }
        });

        // 2. 繪製所有線條 (H 和 V)
        for (const id in lines) {
            const line = lines[id];
            
            const hasP1 = line.players.includes(1);
            const hasP2 = line.players.includes(2);

            if (!hasP1 && !hasP2) {
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = DEFAULT_LINE_COLOR;
                ctx.lineWidth = 2;
                ctx.setLineDash([2, 4]);
                ctx.stroke();
            } else if (hasP1 && !hasP2) {
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = PLAYER_COLORS[1].line;
                ctx.lineWidth = LINE_WIDTH;
                ctx.stroke();
            } else if (!hasP1 && hasP2) {
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = PLAYER_COLORS[2].line;
                ctx.lineWidth = LINE_WIDTH;
                ctx.stroke();
            } else if (hasP1 && hasP2) {
                let dx = line.p2.x - line.p1.x;
                let dy = line.p2.y - line.p1.y;
                const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const norm_x = -dy / len;
                const norm_y = dx / len;
                const offsetX = norm_x * (LINE_WIDTH / 4);
                const offsetY = norm_y * (LINE_WIDTH / 4);
                const halfWidth = LINE_WIDTH / 2;
                ctx.beginPath();
                ctx.moveTo(line.p1.x - offsetX, line.p1.y - offsetY);
                ctx.lineTo(line.p2.x - offsetX, line.p2.y - offsetY);
                ctx.strokeStyle = PLAYER_COLORS[1].line;
                ctx.lineWidth = halfWidth;
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(line.p1.x + offsetX, line.p1.y + offsetY);
                ctx.lineTo(line.p2.x + offsetX, line.p2.y + offsetY);
                ctx.strokeStyle = PLAYER_COLORS[2].line;
                ctx.lineWidth = halfWidth;
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // 3. 繪製所有的點
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                ctx.beginPath();
                ctx.arc(dots[r][c].x, dots[r][c].y, currentDotRadius, 0, 2 * Math.PI);
                ctx.fillStyle = '#34495e';
                ctx.fill();
            }
        }
        
        // 4. 高亮顯示被選中的點
        [selectedDot1, selectedDot2].forEach(dot => {
            if (dot) {
                ctx.beginPath();
                ctx.arc(dot.x, dot.y, DOT_RADIUS + 3, 0, 2 * Math.PI);
                ctx.strokeStyle = PLAYER_COLORS[currentPlayer].line;
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        });
    }

    // 點擊/觸控畫布
    function handleCanvasClick(e) {
        if (isAnimating || gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2) || !actionBar.classList.contains('hidden')) {
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let clientX, clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        const mouseX = (clientX - rect.left) * scaleX;
        const mouseY = (clientY - rect.top) * scaleY;
        const clickedDot = findNearestDot(mouseX, mouseY);
        if (!clickedDot) {
            if (selectedDot1) {
                cancelLine();
            }
            return;
        }
        if (selectedDot1 === null) {
            selectedDot1 = clickedDot;
        } else if (selectedDot2 === null) {
            if (clickedDot === selectedDot1) {
                selectedDot1 = null;
            } else {
                const dr = Math.abs(selectedDot1.r - clickedDot.r);
                const dc = Math.abs(selectedDot1.c - clickedDot.c);
                const lineLength = Math.max(dr, dc);
                
                if (!isValidLine(selectedDot1, clickedDot)) {
                    if (dr !== 0 && dc !== 0) {
                        alert("無效的線條 (只能畫橫線或直線)");
                    } else if (lineLength !== maxLineLength) {
                        alert(`連線長度必須剛好等於 ${maxLineLength} (目前選擇的長度為 ${lineLength})`);
                    }
                    selectedDot1 = null;
                } else {
                    selectedDot2 = clickedDot;
                    actionBar.classList.remove('hidden');
                }
            }
        }
        drawCanvas();
    }

    // "確認連線" 按鈕的函式
    function confirmLine() {
        if (!selectedDot1 || !selectedDot2) return;
        const dotA = selectedDot1;
        const dotB = selectedDot2;

        if (!isValidLine(dotA, dotB)) {
            const dr = Math.abs(dotA.r - dotB.r);
            const dc = Math.abs(dotA.c - dotB.c);
            const lineLength = Math.max(dr, dc);
            if (dr !== 0 && dc !== 0) {
                alert("無效的線條 (只能畫橫線或直線)");
            } else if (lineLength !== maxLineLength) {
                alert(`連線長度必須剛好等於 ${maxLineLength} (目前選擇的長度為 ${lineLength})`);
            }
            cancelLine();
            return;
        }

        const segments = getSegmentsForLine(dotA, dotB);
        if (segments.length === 0) {
            alert("無效的路徑");
            cancelLine();
            return;
        }

        const newSegments = segments.filter(seg => seg.players.length === 0);
        
        if (newSegments.length === 0) {
            const alreadyDrawnBySelf = segments.every(seg => seg.players.includes(currentPlayer));
            if (alreadyDrawnBySelf) {
                alert("這條線您已經完全畫過了，必須包含至少一個未畫過的虛線格。");
            } else {
                alert("這條線必須包含至少一個未畫過的虛線格才能繪製（可以重疊已畫過的線段）。");
            }
            cancelLine();
            return;
        }

        segments.forEach(seg => {
            if (!seg.players.includes(currentPlayer)) {
                seg.players.push(currentPlayer);
            }
        });
        
        let scoredThisTurn = false;
        let totalFilledSquares = 0;
        
        squares.forEach(sq => {
            if (!sq.filled) {
                const isComplete = sq.lineKeys.every(key => lines[key] && lines[key].players.length > 0);
                
                if (isComplete) {
                    sq.filled = true;
                    sq.player = currentPlayer;
                    scores[currentPlayer]++;
                    scoredThisTurn = true;
                }
            }
            if (sq.filled) totalFilledSquares++;
        });

        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        
        drawCanvas();
        updateUI();

        // 【新增】紀錄這一步
        logMove(dotA, dotB, scoredThisTurn);

        if (totalFilledSquares === totalSquares) {
            endGame();
            return;
        }

        if (scoredThisTurn && scoreAndGo) {
            if (!isAnimating) canvas.style.pointerEvents = 'auto';
        } else {
            switchPlayer();
            checkAndTriggerAIMove();
        }
    }

    // "取消選取" 按鈕的函式
    function cancelLine() {
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        drawCanvas();
    }


    // ----- 輔助函式 -----

    // 【新增】匯出 PNG 函式
    function exportCanvasAsPNG() {
        const originalRadius = currentDotRadius;
        const originalAnimating = isAnimating;
        
        isAnimating = false;
        currentDotRadius = DOT_RADIUS;
        drawCanvasInternal(); 

        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'dots-and-boxes-board.png'; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        currentDotRadius = originalRadius;
        isAnimating = originalAnimating;
        if (!isAnimating) {
             drawCanvas();
        }
    }
    
    // 【新增】匯出 CSV 紀錄函式
    function exportHistoryToCSV() {
        if (moveHistory.length === 0) {
            alert("目前沒有任何對戰紀錄。");
            return;
        }

        // 取得 P1 和 P2 的名稱
        const p1Name = getPlayerName(1);
        const p2Name = getPlayerName(2);

        const headers = `Turn,Player,Move (From R_C),Scored,${p1Name} Score,${p2Name} Score`;
        let csvContent = headers + "\n";

        moveHistory.forEach(move => {
            const row = [
                move.turn,
                move.player,
                `"${move.move}"`, // 加上引號以防萬一
                move.scored,
                move.scoreP1,
                move.scoreP2
            ].join(",");
            csvContent += row + "\n";
        });

        // 建立 Blob 並觸發下載
        // 加入 \uFEFF (BOM) 確保 Excel 能正確讀取 UTF-8
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', 'dots-and-boxes-history.csv');
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // 【新增】取得玩家名稱的輔助函式
    function getPlayerName(playerNumber) {
        if (gameMode === 'cvc') {
            return (playerNumber === 1) ? "電腦 1" : "電腦 2";
        } else if (gameMode === 'pvc') {
            return (playerNumber === 1) ? "玩家 1" : "電腦";
        } else {
            return (playerNumber === 1) ? "玩家 1" : "玩家 2";
        }
    }
    
    // 【新增】紀錄每一步的函式
    function logMove(dotA, dotB, scored) {
        const moveData = {
            turn: turnCounter,
            player: getPlayerName(currentPlayer),
            move: `(${dotA.r},${dotA.c}) to (${dotB.r},${dotB.c})`,
            scored: scored ? "Yes" : "No",
            scoreP1: scores[1],
            scoreP2: scores[2]
        };
        moveHistory.push(moveData);
        
        // 只有在沒有得分或規則不允許連續時才增加回合數
        if (!(scored && scoreAndGo)) {
             turnCounter++;
        }
    }


    function isGameOver() {
        return !gameOverMessage.classList.contains('hidden');
    }

    function findNearestDot(mouseX, mouseY) {
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const dot = dots[r][c];
                const distSq = (mouseX - dot.x) ** 2 + (mouseY - dot.y) ** 2;
                if (distSq < CLICK_TOLERANCE_DOT ** 2) {
                    return dot;
                }
            }
        }
        return null;
    }

    function isValidLine(dotA, dotB) {
        if (!dotA || !dotB) return false;
        const dr = Math.abs(dotA.r - dotB.r);
        const dc = Math.abs(dotA.c - dotB.c);
        if (!(dr === 0 || dc === 0)) {
            return false;
        }
        const lineLength = Math.max(dr, dc);
        if (lineLength !== maxLineLength) {
            return false;
        }
        return true;
    }

    function getSegmentsForLine(dotA, dotB) {
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

            if (dr === 0) { // 橫線
                segmentId = `H_${r},${Math.min(c, next_c)}`;
            } else if (dc === 0) { // 直線
                segmentId = `V_${Math.min(r, next_r)},${c}`;
            }

            if (segmentId && lines[segmentId]) {
                segments.push(lines[segmentId]);
            } else {
                console.log("找不到線段 ID (或路徑無效):", segmentId);
            }
            r = next_r;
            c = next_c;
        }
        return segments;
    }

    function switchPlayer() {
        currentPlayer = (currentPlayer === 1) ? 2 : 1;
        updateUI();
    }

    function updateUI() {
        // 【修改】使用 getPlayerName 輔助函式
        const player1Name = getPlayerName(1);
        const player2Name = getPlayerName(2);
        
        player1ScoreBox.innerHTML = `${player1Name}: <span id="score1">${scores[1]}</span>`;
        player2ScoreBox.innerHTML = `${player2Name}: <span id="score2">${scores[2]}</span>`;

        if (currentPlayer === 1) {
            player1ScoreBox.classList.add('active');
            player2ScoreBox.classList.remove('active', 'player2');
        } else {
            player1ScoreBox.classList.remove('active');
            player2ScoreBox.classList.add('active', 'player2');
        }
    }

    function endGame() {
        // 【修改】使用 getPlayerName 輔助函式
        const player1Name = getPlayerName(1);
        const player2Name = getPlayerName(2);

        let winnerMessage = "";
        if (scores[1] > scores[2]) {
            winnerMessage = `${player1Name} 獲勝！`;
        } else if (scores[2] > scores[1]) {
            winnerMessage = `${player2Name} 獲勝！`;
        } else {
            winnerMessage = "平手！";
        }
        
        winnerText.textContent = winnerMessage;
        gameOverMessage.classList.remove('hidden');
        actionBar.classList.add('hidden');
        canvas.style.pointerEvents = 'auto';
    }
    
    // --- AI 相關函式 ---
    // ( ... checkAndTriggerAIMove, calculateChainReaction, aiMove ... )
    // ( ... findBestLongLineMove, evaluateMove ... )

    function checkAndTriggerAIMove() {
        if ((gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2)) && !isGameOver() && !isAnimating) {
            canvas.style.pointerEvents = 'none';
            actionBar.classList.add('hidden');
            
            const aiDelay = (gameMode === 'cvc') ? 200 : 600;
            
            setTimeout(() => {
                aiMove();
            }, aiDelay);
        } else {
            if (gameMode === 'pvp' || (gameMode === 'pvc' && currentPlayer === 1)) {
                    canvas.style.pointerEvents = 'auto';
            }
        }
    }

    function calculateChainReaction(aiSacrificeSegment) {
        let totalChainLength = 0;
        const simulatedDrawnLines = new Set();
        simulatedDrawnLines.add(aiSacrificeSegment.id); 
        const startingBoxes = [];
        for (const sq of squares) {
            if (sq.filled || !sq.lineKeys.includes(aiSacrificeSegment.id)) {
                continue;
            }
            let sidesDrawn = 0;
            sq.lineKeys.forEach(key => {
                if (lines[key].players.length > 0) sidesDrawn++;
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
                for (const adjacentSq of squares) {
                    const adjacentBoxId = adjacentSq.lineKeys.join(',');
                    if (adjacentSq === currentBox || adjacentSq.filled || processedBoxes.has(adjacentBoxId)) {
                        continue;
                    }
                    if (adjacentSq.lineKeys.includes(lineKey)) {
                        let adjacentSidesDrawn = 0;
                        let fourthSide = null;
                        for (const adjKey of adjacentSq.lineKeys) {
                            if (lines[adjKey].players.length > 0 || simulatedDrawnLines.has(adjKey)) {
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

    function aiMove() {
        if (maxLineLength > 1) {
            const longLineMove = findBestLongLineMove();
            if (longLineMove) {
                executeAIMove(longLineMove.dotA, longLineMove.dotB);
                return;
            } else {
                if (!isGameOver()) switchPlayer();
                if (gameMode === 'cvc') checkAndTriggerAIMove();
                return;
            }
        }
        let availableSegments = [];
        for (const id in lines) {
            if (lines[id].players.length === 0) {
                availableSegments.push(lines[id]);
            }
        }
        if (availableSegments.length === 0) {
            if (!isGameOver()) switchPlayer();
            if (gameMode === 'cvc') checkAndTriggerAIMove();
            return;
        }
        let winningMoves = [];
        let safeMoves = [];
        let minorUnsafeMoves = [];
        let criticalUnsafeMoves = [];
        for (const segment of availableSegments) {
            let squaresCompleted = 0;
            let isCritical = false;
            let isMinor = false;
            let riskScore = 0;
            let potentialSquares = 0;
            squares.forEach(sq => {
                if (sq.filled || !sq.lineKeys.includes(segment.id)) {
                    return; 
                }
                let sidesDrawn = 0;
                sq.lineKeys.forEach(key => {
                    if (key !== segment.id && lines[key].players.length > 0) {
                        sidesDrawn++;
                    }
                });
                if (sidesDrawn === 3) {
                    squaresCompleted++;
                } else if (sidesDrawn === 2) {
                    isCritical = true;
                    riskScore += 10;
                } else if (sidesDrawn === 1) {
                    isMinor = true;
                    riskScore += 2;
                } else {
                    potentialSquares += 0.3;
                }
            });
            const moveInfo = { segment, squaresCompleted, riskScore, potentialSquares };
            if (squaresCompleted > 0) {
                winningMoves.push(moveInfo);
            } else if (isCritical) {
                criticalUnsafeMoves.push(moveInfo);
            } else if (isMinor) {
                minorUnsafeMoves.push(moveInfo);
            } else {
                safeMoves.push(moveInfo);
            }
        }
        let segmentToDraw;
        if (winningMoves.length > 0) {
            winningMoves.sort((a, b) => {
                if (b.squaresCompleted !== a.squaresCompleted) {
                    return b.squaresCompleted - a.squaresCompleted;
                }
                return a.riskScore - b.riskScore;
            });
            segmentToDraw = winningMoves[0].segment;
        } else if (safeMoves.length > 0) {
            safeMoves.sort((a, b) => b.potentialSquares - a.potentialSquares);
            segmentToDraw = safeMoves[0].segment;
        } else if (minorUnsafeMoves.length > 0) {
            minorUnsafeMoves.sort((a, b) => a.riskScore - b.riskScore);
            segmentToDraw = minorUnsafeMoves[0].segment;
        } else if (criticalUnsafeMoves.length > 0) {
            let bestSacrifice = null;
            let minChain = Infinity;
            for (const move of criticalUnsafeMoves) {
                const simulatedChainLength = calculateChainReaction(move.segment);
                if (simulatedChainLength < minChain) {
                    minChain = simulatedChainLength;
                    bestSacrifice = move.segment;
                }
            }
            segmentToDraw = bestSacrifice;
        } else {
            segmentToDraw = availableSegments[Math.floor(Math.random() * availableSegments.length)];
        }
        if (!segmentToDraw) {
                if (!isGameOver()) switchPlayer();
                if (gameMode === 'cvc') checkAndTriggerAIMove();
                return;
        }
        const dotA = segmentToDraw.p1;
        const dotB = segmentToDraw.p2;
        executeAIMove(dotA, dotB);
    }
    
    function findBestLongLineMove() {
        let winningMoves = [];
        let safeMoves = [];
        let unsafeMoves = [];
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const dotA = dots[r][c];
                if (c + maxLineLength < gridCols) {
                    const dotB = dots[r][c + maxLineLength];
                    evaluateMove(dotA, dotB, winningMoves, safeMoves, unsafeMoves);
                }
                if (r + maxLineLength < gridRows) {
                    const dotB = dots[r + maxLineLength][c];
                    evaluateMove(dotA, dotB, winningMoves, safeMoves, unsafeMoves);
                }
            }
        }
        if (winningMoves.length > 0) {
            winningMoves.sort((a, b) => {
                if (b.squaresCompleted !== a.squaresCompleted) return b.squaresCompleted - a.squaresCompleted;
                if (b.defensiveValue !== a.defensiveValue) return b.defensiveValue - a.defensiveValue;
                if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
                if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
                return b.totalNewSegments - a.totalNewSegments;
            });
            return winningMoves[0];
        } else if (safeMoves.length > 0) {
            safeMoves.sort((a, b) => {
                if (b.defensiveValue !== a.defensiveValue) return b.defensiveValue - a.defensiveValue;
                if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
                if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
                if (b.potentialSquares !== a.potentialSquares) return b.potentialSquares - a.potentialSquares;
                if (b.totalNewSegments !== a.totalNewSegments) return b.totalNewSegments - a.totalNewSegments;
                return b.controlArea - a.controlArea;
            });
            return safeMoves[0];
        } else if (unsafeMoves.length > 0) {
            unsafeMoves.sort((a, b) => {
                if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
                if (a.riskScore !== b.riskScore) return a.riskScore - b.riskScore;
                if (a.chainRisk !== b.chainRisk) return a.chainRisk - b.chainRisk;
                if (b.defensiveValue !== a.defensiveValue) return b.defensiveValue - a.defensiveValue;
                return b.potentialSquares - a.potentialSquares;
            });
            return unsafeMoves[0];
        }
        return null;
    }
    
    function evaluateMove(dotA, dotB, winningMoves, safeMoves, unsafeMoves) {
        if (!isValidLine(dotA, dotB)) return;
        const segments = getSegmentsForLine(dotA, dotB);
        if (segments.length === 0) return;
        const newSegments = segments.filter(seg => seg.players.length === 0);
        if (newSegments.length === 0) return;
        let squaresCompleted = 0;
        let isUnsafe = false;
        let totalNewSegments = newSegments.length;
        let potentialSquares = 0;
        let riskScore = 0;
        let chainRisk = 0;
        let defensiveValue = 0;
        let controlArea = 0;
        const affectedSquares = new Set();
        segments.forEach(seg => {
            squares.forEach(sq => {
                if (!sq.filled && sq.lineKeys.includes(seg.id)) {
                    affectedSquares.add(sq);
                }
            });
        });
        affectedSquares.forEach(sq => {
            let sidesBeforeMove = 0;
            let sidesAfterMove = 0;
            let newSegmentsInSquare = 0;
            sq.lineKeys.forEach(key => {
                const line = lines[key];
                if (line.players.length > 0) {
                    sidesBeforeMove++;
                    sidesAfterMove++;
                } else if (segments.some(seg => seg.id === key)) {
                    sidesAfterMove++;
                    if (newSegments.some(seg => seg.id === key)) {
                        newSegmentsInSquare++;
                    }
                }
            });
            controlArea++;
            if (sidesBeforeMove === 3 && newSegmentsInSquare > 0) {
                squaresCompleted++;
                defensiveValue += 30;
            } else if (sidesBeforeMove === 2 && newSegmentsInSquare > 0 && sidesAfterMove === 3) {
                riskScore += 20;
                isUnsafe = true;
                chainRisk += 5;
            } else if (sidesBeforeMove === 1 && newSegmentsInSquare > 0 && sidesAfterMove === 2) {
                riskScore += 3;
                isUnsafe = true;
            } else if (sidesBeforeMove === 0 && newSegmentsInSquare > 0 && sidesAfterMove === 1) {
                potentialSquares += 0.2;
            }
        });
        const move = { 
            dotA, dotB, squaresCompleted, isUnsafe, totalNewSegments,
            potentialSquares, riskScore: riskScore + chainRisk, chainRisk,
            defensiveValue, controlArea,
            totalScore: squaresCompleted * 50 + defensiveValue - (riskScore + chainRisk * 2) + potentialSquares * 0.5
        };
        if (squaresCompleted > 0) {
            winningMoves.push(move);
        } else if (isUnsafe) {
            unsafeMoves.push(move);
        } else {
            safeMoves.push(move);
        }
    }
    
    // 執行 AI 移動
    function executeAIMove(dotA, dotB) {
        if (!isValidLine(dotA, dotB)) {
            console.warn("AI 嘗試繪製無效連線，已阻止");
            if (!isGameOver()) switchPlayer();
            if (gameMode === 'cvc') checkAndTriggerAIMove();
            return;
        }
        
        const segments = getSegmentsForLine(dotA, dotB);
        if (segments.length === 0) {
            if (!isGameOver()) switchPlayer();
            if (gameMode === 'cvc') checkAndTriggerAIMove();
            return;
        }

        const newSegments = segments.filter(seg => seg.players.length === 0);
        
        if (newSegments.length === 0) {
            if (!isGameOver()) switchPlayer();
            if (gameMode === 'cvc') checkAndTriggerAIMove();
            return;
        }

        segments.forEach(seg => {
            if (!seg.players.includes(currentPlayer)) {
                seg.players.push(currentPlayer);
            }
        });
        
        let scoredThisTurn = false;
        let totalFilledSquares = 0;
        
        squares.forEach(sq => {
            if (!sq.filled) {
                const isComplete = sq.lineKeys.every(key => lines[key] && lines[key].players.length > 0);
                
                if (isComplete) {
                    sq.filled = true;
                    sq.player = currentPlayer;
                    scores[currentPlayer]++;
                    scoredThisTurn = true;
                }
            }
            if (sq.filled) totalFilledSquares++;
        });
        
        drawCanvas();
        updateUI();

        // 【新增】紀錄這一步
        logMove(dotA, dotB, scoredThisTurn);

        if (totalFilledSquares === totalSquares) {
            endGame();
            return;
        }

        if (scoredThisTurn && scoreAndGo) {
            checkAndTriggerAIMove();
        } else {
            switchPlayer();
            if (gameMode === 'cvc') {
                checkAndTriggerAIMove();
            } else {
                if (!isAnimating) {
                    canvas.style.pointerEvents = 'auto';
                }
            }
        }
    }

    // --- 結束 AI 相關函式 ---


    // 綁定所有事件
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        handleCanvasClick(e);
    });
    
    resetButton.addEventListener('click', initGame);
    exportPngButton.addEventListener('click', exportCanvasAsPNG);
    // 【新增】匯出 CSV 事件
    exportCsvButton.addEventListener('click', exportHistoryToCSV);
    
    confirmLineButton.addEventListener('click', confirmLine);
    cancelLineButton.addEventListener('click', cancelLine);
    gameModeSelect.addEventListener('change', initGame);
    
    if (boardRowsInput) {
        boardRowsInput.addEventListener('change', initGame);
        boardRowsInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') initGame(); });
    }
    if (boardColsInput) {
        boardColsInput.addEventListener('change', initGame);
        boardColsInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') initGame(); });
    }
    if (lineLengthInput) {
        lineLengthInput.addEventListener('change', initGame);
        lineLengthInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') initGame(); });
    }
    if (scoreAgainModeSelect) {
        scoreAgainModeSelect.addEventListener('change', initGame);
    }

    // 啟動遊戲
    initGame();
});