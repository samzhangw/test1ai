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
    const exportCsvButton = document.getElementById('export-csv-button');
    const aiThinkingIndicator = document.getElementById('ai-thinking-indicator');
    
    const gameModeSelect = document.getElementById('game-mode');
    const startPlayerSelect = document.getElementById('start-player');
    const boardRowsInput = document.getElementById('board-rows');
    const boardColsInput = document.getElementById('board-cols');
    const lineLengthInput = document.getElementById('line-length');
    const scoreAgainModeSelect = document.getElementById('score-again-mode');
    
    // 【新增】AI 難度選擇
    const aiDifficultySelect = document.getElementById('ai-difficulty');

    // 批次處理 UI 元素
    const batchControls = document.getElementById('batch-controls');
    const startBatchButton = document.getElementById('start-batch-button');
    const stopBatchButton = document.getElementById('stop-batch-button');
    const batchGamesInput = document.getElementById('batch-games-input');
    const batchStatus = document.getElementById('batch-status');
    const progressBarInner = document.getElementById('progress-bar-inner');

    // AI Web Worker
    let aiWorker;
    if (window.Worker) {
        aiWorker = new Worker('ai-worker.js');
        aiWorker.onmessage = handleWorkerMessage;
        aiWorker.onerror = handleWorkerError;
    } else {
        console.error("您的瀏覽器不支援 Web Workers，AI 將無法運作。");
        alert("您的瀏覽器不支援 Web Workers，AI 將無法運作。");
    }


    // 遊戲設定
    let gridRows = 4;
    let gridCols = 4;
    let maxLineLength = 1;
    const DOT_SPACING = 100;
    const PADDING = 50;
    
    const DOT_RADIUS = 10; 
    const LINE_WIDTH = 8;
    const CLICK_TOLERANCE_DOT = 20;

    // 配色方案：Modern Frost Light Theme
    const PLAYER_COLORS = {
        1: { line: '#3b82f6', fill: 'rgba(59, 130, 246, 0.2)', text: '#2563eb' },
        2: { line: '#f43f5e', fill: 'rgba(244, 63, 94, 0.2)', text: '#e11d48' },
    };
    
    const DEFAULT_LINE_COLOR = '#cbd5e1';
    const DOT_COLOR = '#475569';
    const DOT_TEXT_COLOR = '#ffffff';

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
    
    let moveHistory = [];
    let turnCounter = 1;

    // 動畫相關變數
    let ANIMATION_DURATION = 500;
    let animationStartTime = 0;
    let isAnimating = false;
    let currentDotRadius = DOT_RADIUS;

    // 批次處理狀態
    let batchZip;
    let isBatchRunning = false;
    let totalGamesToRun = 0;
    let currentGameNumber = 1;


    // --- AI Worker 訊息處理 ---
    
    function handleWorkerMessage(e) {
        const { type, dotA, dotB } = e.data;
        
        aiThinkingIndicator.classList.add('hidden');

        if (type === 'bestMoveFound') {
            const mainDotA = dots[dotA.r][dotA.c];
            const mainDotB = dots[dotB.r][dotB.c];
            executeAIMove(mainDotA, mainDotB);
        } else if (type === 'noMoveFound') {
            console.warn("AI Worker 回報找不到移動。");
            switchPlayer();
            if (!isAnimating && !isBatchRunning) canvas.style.pointerEvents = 'auto';
        }
    }

    function handleWorkerError(error) {
        console.error("AI Worker 發生錯誤:", error.message, error);
        aiThinkingIndicator.classList.add('hidden');
        
        if (isBatchRunning) {
            alert("AI 運算時發生嚴重錯誤，批次處理已終止。");
            stopBatchProcess();
        } else {
            alert("AI 運算時發生嚴重錯誤，請重設遊戲。");
        }
    }


    // --- 遊戲核心函式 ---

    function initGame() {
        if (isBatchRunning) {
            gameMode = 'cvc';
            gameModeSelect.value = 'cvc';
            ANIMATION_DURATION = 0; 
            
            const percent = (Math.max(0, currentGameNumber - 1) / totalGamesToRun) * 100;
            const percentText = document.getElementById('percent-text');
            if(percentText) percentText.textContent = Math.round(percent) + '%';
            progressBarInner.style.width = `${percent}%`;

        } else {
            gameMode = gameModeSelect.value;
            ANIMATION_DURATION = 500;
        }

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
        
        scoreAndGo = (scoreAgainModeSelect && scoreAgainModeSelect.value === 'yes');
        
        const startPlayerSetting = (startPlayerSelect && startPlayerSelect.value) ? startPlayerSelect.value : 'random';
        
        if (startPlayerSetting === 'player1') {
            currentPlayer = 1;
        } else if (startPlayerSetting === 'player2') {
            currentPlayer = 2;
        } else { 
            currentPlayer = Math.random() < 0.5 ? 1 : 2;
        }

        scores = { 1: 0, 2: 0 };
        dots = [];
        lines = {};
        squares = [];
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        gameOverMessage.classList.add('hidden');
        aiThinkingIndicator.classList.add('hidden');
        moveHistory = [];
        turnCounter = 1;

        const numKey = [
            [1, 2], 
            [4, 3] 
        ];

        for (let r = 0; r < gridRows; r++) {
            dots[r] = [];
            for (let c = 0; c < gridCols; c++) {
                dots[r][c] = {
                    x: c * DOT_SPACING + PADDING,
                    y: r * DOT_SPACING + PADDING,
                    r: r, c: c,
                    number: numKey[r % 2][c % 2] 
                };
            }
        }

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

        isAnimating = true;
        animationStartTime = 0;
        currentDotRadius = 0;
        canvas.style.pointerEvents = 'none';
        
        if (isBatchRunning || ANIMATION_DURATION === 0) {
            isAnimating = false;
            currentDotRadius = DOT_RADIUS;
            drawCanvasInternal(); 
            if (gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2)) {
                 checkAndTriggerAIMove();
            }
        } else {
            requestAnimationFrame(animationLoop);
        }
    }
    
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

    function drawCanvas() {
        if (isAnimating) return; 
        currentDotRadius = DOT_RADIUS; 
        drawCanvasInternal();
    }

    function drawCanvasInternal() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        squares.forEach(sq => {
            if (sq.filled) {
                ctx.fillStyle = PLAYER_COLORS[sq.player].fill;
                const radius = 16; 
                ctx.beginPath();
                ctx.roundRect(sq.x + 6, sq.y + 6, sq.size - 12, sq.size - 12, radius);
                ctx.fill();
                
                ctx.fillStyle = PLAYER_COLORS[sq.player].text;
                ctx.font = 'bold 36px "Space Grotesk", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                let playerLabel;
                if (gameMode === 'cvc') {
                    playerLabel = (sq.player === 1) ? "C1" : "C2";
                } else if (gameMode === 'pvc') {
                    playerLabel = (sq.player === 1) ? "P1" : "AI";
                } else {
                    playerLabel = "P" + sq.player;
                }
                
                ctx.fillText(playerLabel, sq.x + sq.size / 2, sq.y + sq.size / 2);
            }
        });

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
                ctx.setLineDash([4, 8]);
                ctx.stroke();
            } 
            else {
                ctx.setLineDash([]);
                ctx.lineCap = 'round';
                ctx.lineWidth = LINE_WIDTH;

                if (hasP1 && !hasP2) {
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x, line.p1.y);
                    ctx.lineTo(line.p2.x, line.p2.y);
                    ctx.strokeStyle = PLAYER_COLORS[1].line;
                    ctx.stroke();
                } else if (!hasP1 && hasP2) {
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x, line.p1.y);
                    ctx.lineTo(line.p2.x, line.p2.y);
                    ctx.strokeStyle = PLAYER_COLORS[2].line;
                    ctx.stroke();
                } else if (hasP1 && hasP2) {
                    let dx = line.p2.x - line.p1.x;
                    let dy = line.p2.y - line.p1.y;
                    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                    const norm_x = -dy / len;
                    const norm_y = dx / len;
                    const offset = LINE_WIDTH / 2 + 1;
                    
                    ctx.beginPath();
                    ctx.moveTo(line.p1.x - norm_x * offset, line.p1.y - norm_y * offset);
                    ctx.lineTo(line.p2.x - norm_x * offset, line.p2.y - norm_y * offset);
                    ctx.strokeStyle = PLAYER_COLORS[1].line;
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(line.p1.x + norm_x * offset, line.p1.y + norm_y * offset);
                    ctx.lineTo(line.p2.x + norm_x * offset, line.p2.y + norm_y * offset);
                    ctx.strokeStyle = PLAYER_COLORS[2].line;
                    ctx.stroke();
                }
            }
        }

        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                ctx.beginPath();
                ctx.arc(dots[r][c].x, dots[r][c].y, currentDotRadius, 0, 2 * Math.PI);
                ctx.fillStyle = DOT_COLOR;
                ctx.fill();

                const dotNumber = dots[r][c].number;
                if (dotNumber) {
                    const fontSize = Math.max(8, Math.floor(currentDotRadius * 1.1)); 
                    ctx.font = `bold ${fontSize}px var(--font-body, sans-serif)`;
                    ctx.fillStyle = DOT_TEXT_COLOR; 
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(dotNumber, dots[r][c].x, dots[r][c].y + 1); 
                }
            }
        }
        
        [selectedDot1, selectedDot2].forEach(dot => {
            if (dot) {
                ctx.beginPath();
                ctx.arc(dot.x, dot.y, DOT_RADIUS + 6, 0, 2 * Math.PI);
                ctx.strokeStyle = PLAYER_COLORS[currentPlayer].line;
                ctx.lineWidth = 2;
                ctx.setLineDash([3, 3]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });
    }

    function handleCanvasClick(e) {
        if (isAnimating || isBatchRunning || gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2) || !actionBar.classList.contains('hidden')) {
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

    function cancelLine() {
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        drawCanvas();
    }


    // ----- 輔助函式 -----

    function getCanvasAsPNGDataURL() {
        const originalRadius = currentDotRadius;
        const originalAnimating = isAnimating;
        
        isAnimating = false;
        currentDotRadius = DOT_RADIUS;
        drawCanvasInternal(); 

        const dataUrl = canvas.toDataURL('image/png');

        if (!isBatchRunning) {
            currentDotRadius = originalRadius;
            isAnimating = originalAnimating;
            if (!isAnimating) {
                drawCanvas();
            }
        }
        
        return dataUrl;
    }

    function downloadPNG() {
        const dataUrl = getCanvasAsPNGDataURL();
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'dots-and-boxes-board.png'; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    function generateCSVString() {
        if (moveHistory.length === 0) {
            return null;
        }
        const p1Name = getPlayerName(1);
        const p2Name = getPlayerName(2);
        const headers = `Turn,Player,Move (From R_C),Scored,${p1Name} Score,${p2Name} Score`;
        let csvContent = headers + "\n";
        moveHistory.forEach(move => {
            const row = [
                move.turn,
                move.player,
                `"${move.move}"`,
                move.scored,
                move.scoreP1,
                move.scoreP2
            ].join(",");
            csvContent += row + "\n";
        });
        
        const winnerMessage = getWinnerMessage();
        csvContent += `\nResult,${winnerMessage}\n`;
        
        return csvContent;
    }

    function downloadCSV() {
        const csvContent = generateCSVString();
        if (csvContent === null) {
            return;
        }
        
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
    
    function getPlayerName(playerNumber) {
        if (gameMode === 'cvc') {
            return (playerNumber === 1) ? "電腦 1" : "電腦 2";
        } else if (gameMode === 'pvc') {
            return (playerNumber === 1) ? "玩家 1" : "電腦";
        } else {
            return (playerNumber === 1) ? "玩家 1" : "玩家 2";
        }
    }
    
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

        try {
            const pngDataURL = getCanvasAsPNGDataURL();
            const pngBase64 = pngDataURL.split(',')[1];

            if (pngBase64) {
                if (isBatchRunning && batchZip) {
                    const stepNumber = moveHistory.length;
                    const stepFileName = `step_${String(stepNumber).padStart(3, '0')}.png`;
                    batchZip.file(`game_${currentGameNumber}/steps/${stepFileName}`, pngBase64, { base64: true });
                
                } else if (!isBatchRunning) {
                    moveData.pngBase64 = pngBase64; 
                }
            }
        } catch (e) {
            console.error(`在遊戲 ${currentGameNumber} 步驟 ${moveHistory.length} 儲存 PNG 時發生錯誤:`, e);
        }

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

            if (dr === 0) {
                segmentId = `H_${r},${Math.min(c, next_c)}`;
            } else if (dc === 0) {
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
        const player1Name = getPlayerName(1);
        const player2Name = getPlayerName(2);
        
        player1ScoreBox.innerHTML = `<div class="p-label">${player1Name}</div><span>${scores[1]}</span>`;
        player2ScoreBox.innerHTML = `<div class="p-label">${player2Name}</div><span>${scores[2]}</span>`;

        if (currentPlayer === 1) {
            player1ScoreBox.classList.add('active');
            player2ScoreBox.classList.remove('active', 'player2');
        } else {
            player1ScoreBox.classList.remove('active');
            player2ScoreBox.classList.add('active', 'player2');
        }
    }

    function getWinnerMessage() {
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
        return winnerMessage;
    }

    function endGame() {
        aiThinkingIndicator.classList.add('hidden');
        
        if (isBatchRunning) {
            const csvData = generateCSVString();
            if (csvData) {
                batchZip.file(`game_${currentGameNumber}/history.csv`, "\uFEFF" + csvData);
            }

            currentGameNumber++;

            if (currentGameNumber <= totalGamesToRun) {
                setTimeout(initGame, 20); 
            } else {
                batchStatus.querySelector('p').textContent = `已完成 ${totalGamesToRun} 場遊戲！`;
                progressBarInner.style.width = `100%`;
                downloadBatchZip();
                stopBatchProcess();
            }

        } else {
            const winnerMessage = getWinnerMessage();
            winnerText.textContent = winnerMessage;
            gameOverMessage.classList.remove('hidden');
            actionBar.classList.add('hidden');
            canvas.style.pointerEvents = 'auto';

            if (moveHistory.length > 0) {
                downloadCSV();
                downloadStepsZip(); 
            }
        }
    }
    
    // --- AI 相關函式 ---

    function checkAndTriggerAIMove() {
        if ((gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2)) && !isGameOver() && !isAnimating) {
            
            if (!isBatchRunning) {
                canvas.style.pointerEvents = 'none';
                actionBar.classList.add('hidden');
                
                aiThinkingIndicator.classList.remove('hidden');
            }
            
            const gameState = {
                lines: JSON.parse(JSON.stringify(lines)),
                squares: JSON.parse(JSON.stringify(squares)),
                scores: { ...scores },
                currentPlayer: currentPlayer,
                gridRows: gridRows,
                gridCols: gridCols
            };
            
            // 【修改】將難度設定傳給 Worker
            const settings = {
                scoreAndGo: scoreAndGo,
                maxLineLength: maxLineLength,
                difficulty: aiDifficultySelect.value // 傳遞難度
            };

            if (aiWorker) {
                 aiWorker.postMessage({ 
                    type: 'startSearch', 
                    gameState: gameState, 
                    settings: settings 
                });
            } else {
                console.error("AI Worker 尚未初始化!");
                if (!isBatchRunning) aiThinkingIndicator.classList.add('hidden');
            }
            
        } else {
            if (!isBatchRunning && (gameMode === 'pvp' || (gameMode === 'pvc' && currentPlayer === 1))) {
                    canvas.style.pointerEvents = 'auto';
            }
        }
    }

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
        
        if (!isBatchRunning) {
            drawCanvas();
        }
        updateUI();

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
                if (!isAnimating && !isBatchRunning) { 
                    canvas.style.pointerEvents = 'auto';
                }
            }
        }
    }

    // --- 批次處理函式 ---

    function startBatchProcess() {
        if (typeof JSZip === 'undefined') {
            alert('錯誤：JSZip 庫未載入。無法執行批次處理。');
            return;
        }

        const games = parseInt(batchGamesInput.value, 10);
        if (isNaN(games) || games <= 0 || games > 1000) {
            alert('請輸入有效的場次 (1 ~ 1000)。');
            return;
        }

        isBatchRunning = true;
        totalGamesToRun = games;
        currentGameNumber = 1;
        batchZip = new JSZip();

        document.body.classList.add('batch-running');
        batchStatus.classList.remove('hidden');
        progressBarInner.style.width = '0%';
        
        gameOverMessage.classList.add('hidden');

        initGame();
    }

    function stopBatchProcess(downloadPartial = false) {
        isBatchRunning = false;
        
        document.body.classList.remove('batch-running');
        batchStatus.classList.add('hidden');
        progressBarInner.style.width = '0%';

        if (downloadPartial && batchZip) {
            console.log("下載部分結果...");
            downloadBatchZip("partial-batch-results.zip");
        }
        
        batchZip = null;
        totalGamesToRun = 0;
        currentGameNumber = 1;

        setTimeout(initGame, 100);
    }

    function downloadBatchZip(filename = "cvc-batch-results.zip") {
        if (!batchZip) return;

        batchZip.generateAsync({ type: "blob" })
            .then(function(content) {
                const link = document.createElement('a');
                const url = URL.createObjectURL(content);
                link.setAttribute('href', url);
                link.setAttribute('download', filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            });
    }

    function downloadStepsZip() {
        if (typeof JSZip === 'undefined') {
            console.error('錯誤：JSZip 庫未載入。無法下載步驟 PNG。');
            return;
        }
        if (moveHistory.length === 0 || !moveHistory[0].pngBase64) {
            console.warn("沒有可下載的步驟 PNG (可能尚未儲存)。");
            return;
        }

        const zip = new JSZip();
        const stepsFolder = zip.folder("steps"); 

        moveHistory.forEach((move, index) => {
            if (move.pngBase64) {
                const stepNumber = index + 1;
                const stepFileName = `step_${String(stepNumber).padStart(3, '0')}.png`;
                stepsFolder.file(stepFileName, move.pngBase64, { base64: true });
            }
        });

        const filename = "dots-and-boxes-steps.zip";
        
        zip.generateAsync({ type: "blob" })
            .then(function(content) {
                const link = document.createElement('a');
                const url = URL.createObjectURL(content);
                link.setAttribute('href', url);
                link.setAttribute('download', filename);
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            });
    }


    // --- 綁定所有事件 ---
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        handleCanvasClick(e);
    });
    
    resetButton.addEventListener('click', initGame);
    
    exportPngButton.addEventListener('click', downloadPNG);
    exportCsvButton.addEventListener('click', downloadCSV);
    
    confirmLineButton.addEventListener('click', confirmLine);
    cancelLineButton.addEventListener('click', cancelLine);
    
    function handleGameModeChange() {
        gameMode = gameModeSelect.value;
        updateUI();
        if (!isGameOver()) {
            checkAndTriggerAIMove();
        }
    }
    gameModeSelect.addEventListener('change', handleGameModeChange);
    
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
    if (startPlayerSelect) {
        startPlayerSelect.addEventListener('change', initGame);
    }

    startBatchButton.addEventListener('click', startBatchProcess);
    stopBatchButton.addEventListener('click', () => {
        if (confirm('您確定要停止批次處理嗎？目前已完成的結果將會被打包下載。')) {
            stopBatchProcess(true);
        }
    });

    initGame();
});
