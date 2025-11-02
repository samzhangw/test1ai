document.addEventListener('DOMContentLoaded', () => {
    // 取得 HTML 元素 (與前一版相同)
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
    const gameModeSelect = document.getElementById('game-mode');
    const boardRowsInput = document.getElementById('board-rows');
    const boardColsInput = document.getElementById('board-cols');

    // 遊戲設定 (與前一版相同)
    let gridRows = 4;
    let gridCols = 4;
    const DOT_SPACING = 100;
    const PADDING = 50;
    const DOT_RADIUS = 6;
    const LINE_WIDTH = 8;
    const CLICK_TOLERANCE_DOT = 15;

    // 玩家顏色 (與前一版相同)
    const PLAYER_COLORS = {
        1: { line: '#3498db', fill: 'rgba(52, 152, 219, 0.3)' },
        2: { line: '#e74c3c', fill: 'rgba(231, 76, 60, 0.3)' },
    };
    const DEFAULT_LINE_COLOR = '#bbbbbb';

    // 遊戲狀態 (與前一版相同)
    let currentPlayer = 1;
    let scores = { 1: 0, 2: 0 };
    let dots = [];
    let lines = {};
    let squares = [];
    let totalSquares = (gridRows - 1) * (gridCols - 1);
    
    let selectedDot1 = null;
    let selectedDot2 = null;
    let gameMode = 'pvp';
    
    // --- 【新增】動畫相關變數 ---
    const ANIMATION_DURATION = 500; // 動畫持續時間 (毫秒)
    let animationStartTime = 0;
    let isAnimating = false;
    let currentDotRadius = DOT_RADIUS; // 動態的點半徑
    // --- 【新增結束】 ---

    // 初始化遊戲
    function initGame() {
        // 讀取並限制列數與欄數
        const desiredRows = parseInt(boardRowsInput && boardRowsInput.value ? boardRowsInput.value : '4', 10);
        const desiredCols = parseInt(boardColsInput && boardColsInput.value ? boardColsInput.value : '4', 10);
        gridRows = Math.max(2, Math.min(12, isNaN(desiredRows) ? 4 : desiredRows));
        gridCols = Math.max(2, Math.min(12, isNaN(desiredCols) ? 4 : desiredCols));
        if (boardRowsInput && boardRowsInput.value != String(gridRows)) boardRowsInput.value = String(gridRows);
        if (boardColsInput && boardColsInput.value != String(gridCols)) boardColsInput.value = String(gridCols);

        const canvasWidth = (gridCols - 1) * DOT_SPACING + PADDING * 2;
        const canvasHeight = (gridRows - 1) * DOT_SPACING + PADDING * 2;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        
        gameMode = gameModeSelect.value;
        
        // --- 【修改】 --- (與前一版相同)
        if (gameMode === 'pvc') {
            currentPlayer = Math.random() < 0.5 ? 1 : 2;
        } else {
            currentPlayer = 1;
        }
        // --- 【修改結束】 ---
        
        scores = { 1: 0, 2: 0 };
        dots = [];
        lines = {};
        squares = [];
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        gameOverMessage.classList.add('hidden');
        // canvas.style.pointerEvents = 'auto'; // 【修改】由動畫狀態控制

        // 1. 產生點 (與前一版相同)
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

        // 2. 產生線段 (與前一版相同)
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

        // 3. 產生正方形 (與前一版相同)
        squares = [];
        for (let r = 0; r < gridRows - 1; r++) {
            for (let c = 0; c < gridCols - 1; c++) {
                const h1 = `H_${r},${c}`;   // 上
                const h2 = `H_${r + 1},${c}`; // 下
                const v1 = `V_${r},${c}`;   // 左
                const v2 = `V_${r},${c + 1}`; // 右
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
        // drawCanvas(); // 【移除】原始的繪製呼叫

        // --- 【新增】啟動開始動畫 ---
        isAnimating = true;
        animationStartTime = 0; // 讓 animationLoop 自己設定
        currentDotRadius = 0; // 從 0 開始
        canvas.style.pointerEvents = 'none'; // 動畫期間禁止點擊
        
        requestAnimationFrame(animationLoop);
        // --- 【新增結束】 ---


        // 【移除】這段程式碼，它會被移到 animationLoop 的結尾
        // if (gameMode === 'pvc' && currentPlayer === 2) {
        //     checkAndTriggerAIMove();
        // }
    }
    
    // --- 【新增】遊戲開始動畫迴圈 ---
    function animationLoop(timestamp) {
        if (animationStartTime === 0) {
            animationStartTime = timestamp;
        }
        
        const elapsed = timestamp - animationStartTime;
        let progress = Math.min(elapsed / ANIMATION_DURATION, 1);
        
        // 使用 Easing 函式 (easeOutCubic) 讓動畫更流暢
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        
        // 更新當前的點半徑
        currentDotRadius = DOT_RADIUS * easedProgress;

        // 呼叫*內部*繪製函式
        drawCanvasInternal();

        if (progress < 1) {
            // 動畫尚未結束，繼續下一幀
            requestAnimationFrame(animationLoop);
        } else {
            // 動畫結束
            isAnimating = false;
            currentDotRadius = DOT_RADIUS; // 確保半徑為最終值
            animationStartTime = 0; // 重設
            
            // 恢復畫布點擊
            // (但 AI 回合時仍需保持 disabled)
            if (gameMode === 'pvp' || (gameMode === 'pvc' && currentPlayer === 1)) {
                    canvas.style.pointerEvents = 'auto';
            }

            // 【移動】原本在 initGame 結尾的 AI 檢查
            if (gameMode === 'pvc' && currentPlayer === 2) {
                checkAndTriggerAIMove();
            }
        }
    }
    // --- 【新增結束】 ---

    // --- 【新增】drawCanvas 的包裝函式 ---
    // 這個函式是給遊戲邏輯 (如 click, confirmLine) 呼叫的
    function drawCanvas() {
        // 如果開場動畫正在播放，不允許遊戲邏輯的繪製請求
        if (isAnimating) return; 
        
        // 確保使用標準的點半徑
        currentDotRadius = DOT_RADIUS; 
        drawCanvasInternal();
    }
    // --- 【新增結束】 ---

    // 【修改】將原 drawCanvas 重新命名為 drawCanvasInternal
    function drawCanvasInternal() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 1. 繪製已完成的正方形 (填色) (與前一版相同)
        squares.forEach(sq => {
            if (sq.filled) {
                ctx.fillStyle = PLAYER_COLORS[sq.player].fill;
                ctx.fillRect(sq.x, sq.y, sq.size, sq.size);
                
                ctx.fillStyle = PLAYER_COLORS[sq.player].line;
                ctx.font = 'bold 48px var(--font-main, sans-serif)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const playerLabel = (gameMode === 'pvc' && sq.player === 2) ? "C" : sq.player;
                ctx.fillText(playerLabel, sq.x + sq.size / 2, sq.y + sq.size / 2 + 5);
            }
        });

        // 2. 繪製所有線條 (H 和 V) (與前一版相同)
        for (const id in lines) {
            const line = lines[id];
            
            const hasP1 = line.players.includes(1);
            const hasP2 = line.players.includes(2);

            if (!hasP1 && !hasP2) {
                // 1. 虛線 (未畫)
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = DEFAULT_LINE_COLOR;
                ctx.lineWidth = 2;
                ctx.setLineDash([2, 4]);
                ctx.stroke();

            } else if (hasP1 && !hasP2) {
                // 2. 只有 P1 (全寬)
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = PLAYER_COLORS[1].line;
                ctx.lineWidth = LINE_WIDTH;
                ctx.stroke();
                
            } else if (!hasP1 && hasP2) {
                // 3. 只有 P2 (全寬)
                ctx.beginPath();
                ctx.moveTo(line.p1.x, line.p1.y);
                ctx.lineTo(line.p2.x, line.p2.y);
                ctx.strokeStyle = PLAYER_COLORS[2].line;
                ctx.lineWidth = LINE_WIDTH;
                ctx.stroke();

            } else if (hasP1 && hasP2) {
                // 4. 重疊 (P1 和 P2 都有)
                let dx = line.p2.x - line.p1.x;
                let dy = line.p2.y - line.p1.y;
                const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const norm_x = -dy / len;
                const norm_y = dx / len;

                const offsetX = norm_x * (LINE_WIDTH / 4);
                const offsetY = norm_y * (LINE_WIDTH / 4);
                const halfWidth = LINE_WIDTH / 2;

                // 繪製 玩家 1 (偏移 -)
                ctx.beginPath();
                ctx.moveTo(line.p1.x - offsetX, line.p1.y - offsetY);
                ctx.lineTo(line.p2.x - offsetX, line.p2.y - offsetY);
                ctx.strokeStyle = PLAYER_COLORS[1].line;
                ctx.lineWidth = halfWidth;
                ctx.stroke();

                // 繪製 玩家 2 (偏移 +)
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
                // --- 【修改】使用動態半徑 ---
                ctx.arc(dots[r][c].x, dots[r][c].y, currentDotRadius, 0, 2 * Math.PI);
                // --- 【修改結束】 ---
                ctx.fillStyle = '#34495e';
                ctx.fill();
            }
        }
        
        // 4. 高亮顯示被選中的點 (與前一版相同)
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
        // --- 【修改】加入 isAnimating 檢查 ---
        if (isAnimating || (gameMode === 'pvc' && currentPlayer === 2) || !actionBar.classList.contains('hidden')) {
        // --- 【修改結束】 ---
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
                selectedDot2 = clickedDot;
                actionBar.classList.remove('hidden');
            }
        }
        drawCanvas(); // 呼叫包裝函式
    }

    // "確認連線" 按鈕的函式 (與前一版相同)
    function confirmLine() {
        if (!selectedDot1 || !selectedDot2) return;
        const dotA = selectedDot1;
        const dotB = selectedDot2;

        if (!isValidLine(dotA, dotB)) {
            alert("無效的線條 (只能畫橫線或直線)");
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
                    alert("這條線您已經畫過了。");
            } else {
                    alert("這條線必須包含至少一段*全新*的線段。");
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
        
        drawCanvas(); // 呼叫包裝函式
        updateUI();

        if (totalFilledSquares === totalSquares) {
            endGame();
            return;
        }

        // 無論是否得分，都切換玩家 (與前一版相同)
        switchPlayer();
        
        checkAndTriggerAIMove();
    }

    // "取消選取" 按鈕的函式 (與前一版相同)
    function cancelLine() {
        selectedDot1 = null;
        selectedDot2 = null;
        actionBar.classList.add('hidden');
        drawCanvas(); // 呼叫包裝函式
    }


    // ----- 輔助函式 (與前一版相同) -----

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
        const dr = Math.abs(dotA.r - dotB.r);
        const dc = Math.abs(dotA.c - dotB.c);
        return dr === 0 || dc === 0;
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
        const player2Name = (gameMode === 'pvc') ? "電腦" : "玩家 2";
        
        player1ScoreBox.innerHTML = `玩家 1: <span id="score1">${scores[1]}</span>`;
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
        let winnerMessage = "";
        const player2Name = (gameMode === 'pvc') ? "電腦" : "玩家 2";
        
        if (scores[1] > scores[2]) {
            winnerMessage = "玩家 1 獲勝！";
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
    
    // --- AI 相關函式 (與前一版相同) ---

    function checkAndTriggerAIMove() {
        // --- 【修改】加入 isAnimating 檢查 ---
        if (gameMode === 'pvc' && currentPlayer === 2 && !isGameOver() && !isAnimating) {
        // --- 【修改結束】 ---
            canvas.style.pointerEvents = 'none';
            actionBar.classList.add('hidden');
            
            setTimeout(() => {
                aiMove();
                if (currentPlayer === 1) {
                    canvas.style.pointerEvents = 'auto';
                }
            }, 600);
        } else {
            if (gameMode === 'pvp' || currentPlayer === 1) {
                    canvas.style.pointerEvents = 'auto';
            }
        }
    }

    function aiMove() {
        let availableSegments = [];
        for (const id in lines) {
            if (lines[id].players.length === 0) {
                availableSegments.push(lines[id]);
            }
        }
        
        if (availableSegments.length === 0) {
            if (!isGameOver()) switchPlayer();
            return;
        }

        let winningMoves = [];
        let safeMoves = [];
        let unsafeMoves = [];

        for (const segment of availableSegments) {
            let squaresCompleted = 0;
            let isUnsafe = false;

            squares.forEach(sq => {
                if (sq.filled || !sq.lineKeys.includes(segment.id)) {
                    return; 
                }

                let sidesDrawn = 0;
                sq.lineKeys.forEach(key => {
                    if (lines[key].players.length > 0) {
                        sidesDrawn++;
                    }
                });

                if (sidesDrawn === 3) {
                    squaresCompleted++;
                } else if (sidesDrawn === 2) {
                    isUnsafe = true;
                }
            });

            if (squaresCompleted > 0) {
                winningMoves.push(segment);
            } else if (isUnsafe) {
                unsafeMoves.push(segment);
            } else {
                safeMoves.push(segment);
            }
        }
        
        let segmentToDraw;
        if (winningMoves.length > 0) {
            segmentToDraw = winningMoves[Math.floor(Math.random() * winningMoves.length)];
        } else if (safeMoves.length > 0) {
            segmentToDraw = safeMoves[Math.floor(Math.random() * safeMoves.length)];
        } else if (unsafeMoves.length > 0) {
            segmentToDraw = unsafeMoves[Math.floor(Math.random() * unsafeMoves.length)];
        } else {
            segmentToDraw = availableSegments[Math.floor(Math.random() * availableSegments.length)];
        }

        if (!segmentToDraw) {
                if (!isGameOver()) switchPlayer();
                return;
        }
        
        if (!segmentToDraw.players.includes(currentPlayer)) {
            segmentToDraw.players.push(currentPlayer);
        }
        
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
        
        drawCanvas(); // 呼叫包裝函式
        updateUI();

        if (totalFilledSquares === totalSquares) {
            endGame();
            return;
        }

        // 無論 AI 是否得分，都切換回玩家 (與前一版相同)
        switchPlayer();
        
        // --- 【修改】 ---
        // 只有在動畫未播放時才恢復指針
        if (!isAnimating) {
            canvas.style.pointerEvents = 'auto';
        }
        // --- 【修改結束】 ---
    }

    // --- 結束 AI 相關函式 ---


    // 綁定所有事件 (與前一版相同)
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        handleCanvasClick(e);
    });
    resetButton.addEventListener('click', initGame);
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

    // 啟動遊戲
    initGame();
});