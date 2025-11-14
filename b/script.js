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
    const boardRowsInput = document.getElementById('board-rows');
    const boardColsInput = document.getElementById('board-cols');
    const lineLengthInput = document.getElementById('line-length');
    const scoreAgainModeSelect = document.getElementById('score-again-mode');

    // 【新增】批次處理 UI 元素
    const batchControls = document.getElementById('batch-controls');
    const startBatchButton = document.getElementById('start-batch-button');
    const stopBatchButton = document.getElementById('stop-batch-button');
    const batchGamesInput = document.getElementById('batch-games-input');
    const batchStatus = document.getElementById('batch-status');
    const progressBarInner = document.getElementById('progress-bar-inner');
    const gameControls = document.getElementById('game-controls');

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
    
    // 【修改】為了顯示數字，將點的半徑和點擊範圍調大
    const DOT_RADIUS = 12; // (原為 6)
    const LINE_WIDTH = 8;
    const CLICK_TOLERANCE_DOT = 18; // (原為 15)

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
    
    let moveHistory = [];
    let turnCounter = 1;

    // 動畫相關變數
    let ANIMATION_DURATION = 500; // 【修改】從 const 改為 let
    let animationStartTime = 0;
    let isAnimating = false;
    let currentDotRadius = DOT_RADIUS;

    // 【新增】批次處理狀態
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
            // 批次模式: 強制設定並跳過動畫
            gameMode = 'cvc';
            gameModeSelect.value = 'cvc';
            ANIMATION_DURATION = 0; // 跳過動畫
            
            // 更新狀態
            const percent = (Math.max(0, currentGameNumber - 1) / totalGamesToRun) * 100;
            batchStatus.querySelector('p').textContent = `處理中... (遊戲 ${currentGameNumber} / ${totalGamesToRun})`;
            progressBarInner.style.width = `${percent}%`;

        } else {
            // 正常模式: 讀取 UI
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
        aiThinkingIndicator.classList.add('hidden');
        moveHistory = [];
        turnCounter = 1;

        // 【修改】為點分配 1-4 的數字 (固定順時針)
        // 建立 2x2 查找表
        // (r,c) = 1, (r,c+1) = 2
        // (r+1,c) = 4, (r+1,c+1) = 3
        const numKey = [
            [1, 2], // 對應 r % 2 == 0
            [4, 3]  // 對應 r % 2 == 1
        ];

        // 1. 產生點
        for (let r = 0; r < gridRows; r++) {
            dots[r] = [];
            for (let c = 0; c < gridCols; c++) {
                dots[r][c] = {
                    x: c * DOT_SPACING + PADDING,
                    y: r * DOT_SPACING + PADDING,
                    r: r, c: c,
                    number: numKey[r % 2][c % 2] // 【修改】分配固定的數字
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

        isAnimating = true;
        animationStartTime = 0;
        currentDotRadius = 0;
        canvas.style.pointerEvents = 'none';
        
        if (isBatchRunning || ANIMATION_DURATION === 0) {
            // 【修改】批次模式: 跳過動畫
            isAnimating = false;
            currentDotRadius = DOT_RADIUS;
            drawCanvasInternal(); // 直接畫最終畫面
            // 手動觸發 AI
            if (gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2)) {
                 checkAndTriggerAIMove();
            }
        } else {
            // 正常模式: 播放動畫
            requestAnimationFrame(animationLoop);
        }
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

                // 【新增】繪製點上的數字
                const dotNumber = dots[r][c].number;
                if (dotNumber) {
                    // 根據點的半徑動態調整字體大小
                    const fontSize = Math.max(8, Math.floor(currentDotRadius * 1.1)); 
                    ctx.font = `bold ${fontSize}px var(--font-main, sans-serif)`;
                    ctx.fillStyle = '#ffffff'; // 白色文字
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    // 輕微 Y 軸偏移，使其在視覺上更置中
                    ctx.fillText(dotNumber, dots[r][c].x, dots[r][c].y + 1); 
                }
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

    /**
     * 【重構】
     * 產生 PNG 的 data URL (用於批次處理)
     */
    function getCanvasAsPNGDataURL() {
        const originalRadius = currentDotRadius;
        const originalAnimating = isAnimating;
        
        isAnimating = false;
        currentDotRadius = DOT_RADIUS;
        drawCanvasInternal(); // 強制繪製最終畫面

        const dataUrl = canvas.toDataURL('image/png');

        // 恢復原始狀態，避免閃爍 (如果不是在批次中)
        if (!isBatchRunning) {
            currentDotRadius = originalRadius;
            isAnimating = originalAnimating;
            if (!isAnimating) {
                drawCanvas();
            }
        }
        
        return dataUrl;
    }

    /**
     * 【重構】
     * 觸發單一 PNG 下載
     */
    function downloadPNG() {
        const dataUrl = getCanvasAsPNGDataURL();
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'dots-and-boxes-board.png'; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    /**
     * 【重構】
     * 產生 CSV 內容字串 (用於批次處理)
     */
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
        
        // 【新增】加入遊戲結果
        const winnerMessage = getWinnerMessage();
        csvContent += `\nResult,${winnerMessage}\n`;
        
        return csvContent;
    }

    /**
     * 【重構】
     * 觸發單一 CSV 下載
     */
    function downloadCSV() {
        const csvContent = generateCSVString();
        if (csvContent === null) {
            // 【修改】 移除 alert，避免在自動下載時跳出
            // alert("目前沒有任何對戰紀錄。"); 
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
    
    /**
     * 【修改】
     * 記錄移動，並在批次模式下儲存每一步的 PNG
     * 【修改 2】: 在「正常模式」下也儲存 PNG (到 moveHistory 物件中)
     */
    function logMove(dotA, dotB, scored) {
        const moveData = {
            turn: turnCounter,
            player: getPlayerName(currentPlayer),
            move: `(${dotA.r},${dotA.c}) to (${dotB.r},${dotB.c})`,
            scored: scored ? "Yes" : "No",
            scoreP1: scores[1],
            scoreP2: scores[2]
            // pngBase64 將在下面添加
        };
        moveHistory.push(moveData); // 先推入

        // --- 【修改】 無論是否批次，都嘗試產生 PNG ---
        try {
            const pngDataURL = getCanvasAsPNGDataURL();
            const pngBase64 = pngDataURL.split(',')[1];

            if (pngBase64) {
                if (isBatchRunning && batchZip) {
                    // --- 批次模式: 存入 ZIP ---
                    const stepNumber = moveHistory.length;
                    const stepFileName = `step_${String(stepNumber).padStart(3, '0')}.png`;
                    batchZip.file(`game_${currentGameNumber}/steps/${stepFileName}`, pngBase64, { base64: true });
                
                } else if (!isBatchRunning) {
                    // --- 正常模式: 存入 moveHistory 供稍後下載 ---
                    moveData.pngBase64 = pngBase64; // 將 PNG 附加到剛剛推入的物件中
                }
            }
        } catch (e) {
            console.error(`在遊戲 ${currentGameNumber} 步驟 ${moveHistory.length} 儲存 PNG 時發生錯誤:`, e);
        }
        // --- 【修改結束】 ---

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

    /**
     * 【已修改】
     * 遊戲結束函式
     * 【修改】：在正常模式下自動下載 CSV 和 步驟PNG ZIP
     */
    function endGame() {
        aiThinkingIndicator.classList.add('hidden');
        
        if (isBatchRunning) {
            // --- 批次模式 ---
            
            // 1. 產生 CSV 內容
            const csvData = generateCSVString();
            if (csvData) {
                batchZip.file(`game_${currentGameNumber}/history.csv`, "\uFEFF" + csvData);
            }

            // 2. (每一步的 PNG 已經在 logMove 中儲存了)

            // 3. 推進
            currentGameNumber++;

            if (currentGameNumber <= totalGamesToRun) {
                // 執行下一場
                setTimeout(initGame, 20); // 短暫延遲以釋放 UI 執行緒
            } else {
                // 全部完成了
                batchStatus.querySelector('p').textContent = `已完成 ${totalGamesToRun} 場遊戲！`;
                progressBarInner.style.width = `100%`;
                downloadBatchZip();
                stopBatchProcess();
            }

        } else {
            // --- 正常模式 ---
            const winnerMessage = getWinnerMessage();
            winnerText.textContent = winnerMessage;
            gameOverMessage.classList.remove('hidden');
            actionBar.classList.add('hidden');
            canvas.style.pointerEvents = 'auto';

            // --- 【修改】 分出勝負時自動下載 CSV 和 PNG Zip ---
            if (moveHistory.length > 0) {
                downloadCSV();
                downloadStepsZip(); // 【新增】
            }
            // --- 【修改結束】 ---
        }
    }
    
    // --- AI 相關函式 ---

    /**
     * 【已修改】
     * 觸發 AI 運算，並顯示「運算中」
     */
    function checkAndTriggerAIMove() {
        if ((gameMode === 'cvc' || (gameMode === 'pvc' && currentPlayer === 2)) && !isGameOver() && !isAnimating) {
            
            if (!isBatchRunning) {
                canvas.style.pointerEvents = 'none';
                actionBar.classList.add('hidden');
                
                aiThinkingIndicator.classList.remove('hidden');
                if (currentPlayer === 2) {
                    aiThinkingIndicator.classList.add('player2');
                } else {
                    aiThinkingIndicator.classList.remove('player2');
                }
            }
            
            const gameState = {
                lines: JSON.parse(JSON.stringify(lines)),
                squares: JSON.parse(JSON.stringify(squares)),
                scores: { ...scores },
                currentPlayer: currentPlayer,
                gridRows: gridRows,
                gridCols: gridCols
            };
            
            const settings = {
                scoreAndGo: scoreAndGo,
                maxLineLength: maxLineLength
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

    /**
     * 【保留】
     * 執行 AI 移動 (由 Worker 觸發)
     */
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
            checkAndTriggerAIMove(); // AI 得分，繼續
        } else {
            switchPlayer();
            if (gameMode === 'cvc') {
                checkAndTriggerAIMove(); // CVC，換下一個 AI
            } else {
                if (!isAnimating && !isBatchRunning) { // PVC，換玩家
                    canvas.style.pointerEvents = 'auto';
                }
            }
        }
    }

    // --- 【新增】 批次處理函式 ---

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

        // 鎖定 UI
        document.body.classList.add('batch-running');
        batchStatus.classList.remove('hidden');
        progressBarInner.style.width = '0%';
        
        // 確保遊戲結束畫面是隱藏的
        gameOverMessage.classList.add('hidden');

        // 開始第一場
        initGame();
    }

    function stopBatchProcess(downloadPartial = false) {
        isBatchRunning = false;
        
        // 解鎖 UI
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

        // 重設遊戲到初始狀態
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

    /**
     * 【新增】
     * 下載「單場」遊戲的所有步驟 PNG (打包成 ZIP)
     */
    function downloadStepsZip() {
        if (typeof JSZip === 'undefined') {
            console.error('錯誤：JSZip 庫未載入。無法下載步驟 PNG。');
            return;
        }
        // 檢查第一步是否有 pngBase64
        if (moveHistory.length === 0 || !moveHistory[0].pngBase64) {
            console.warn("沒有可下載的步驟 PNG (可能尚未儲存)。");
            return;
        }

        const zip = new JSZip();
        const stepsFolder = zip.folder("steps"); // 在 zip 中建立一個 'steps' 資料夾

        moveHistory.forEach((move, index) => {
            if (move.pngBase64) {
                const stepNumber = index + 1;
                const stepFileName = `step_${String(stepNumber).padStart(3, '0')}.png`;
                // 將 base64 存入 'steps' 資料夾
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
    
    // 【修改】
    exportPngButton.addEventListener('click', downloadPNG);
    exportCsvButton.addEventListener('click', downloadCSV);
    
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

    // 【新增】 批次處理事件
    startBatchButton.addEventListener('click', startBatchProcess);
    stopBatchButton.addEventListener('click', () => {
        if (confirm('您確定要停止批次處理嗎？目前已完成的結果將會被打包下載。')) {
            stopBatchProcess(true); // true = 下載部分結果
        }
    });

    // 啟動遊戲
    initGame();
});
