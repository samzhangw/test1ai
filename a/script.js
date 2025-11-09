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
    const lineLengthInput = document.getElementById('line-length');
    
    // --- 【已新增】 ---
    const scoreAgainModeSelect = document.getElementById('score-again-mode');
    // --- 【新增結束】 ---

    // 遊戲設定 (與前一版相同)
    let gridRows = 4;
    let gridCols = 4;
    let maxLineLength = 1; // 最大連線長度
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
    
    // --- 【已新增】 ---
    let scoreAndGo = true; // 儲存"得分後繼續"的設定
    // --- 【新增結束】 ---
    
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
        
        // 讀取並限制連線長度
        const desiredLength = parseInt(lineLengthInput && lineLengthInput.value ? lineLengthInput.value : '1', 10);
        const maxAllowedLength = Math.max(gridRows - 1, gridCols - 1); // 根據棋盤大小限制最大長度
        maxLineLength = Math.max(1, Math.min(maxAllowedLength, isNaN(desiredLength) ? 1 : desiredLength));
        if (lineLengthInput && lineLengthInput.value != String(maxLineLength)) {
            lineLengthInput.value = String(maxLineLength);
            lineLengthInput.max = maxAllowedLength; // 動態更新最大允許值
        }

        const canvasWidth = (gridCols - 1) * DOT_SPACING + PADDING * 2;
        const canvasHeight = (gridRows - 1) * DOT_SPACING + PADDING * 2;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        
        gameMode = gameModeSelect.value;
        
        // --- 【已新增】 ---
        scoreAndGo = (scoreAgainModeSelect && scoreAgainModeSelect.value === 'yes');
        // --- 【新增結束】 ---
        
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
                // 立即檢查連線長度是否符合規定
                const dr = Math.abs(selectedDot1.r - clickedDot.r);
                const dc = Math.abs(selectedDot1.c - clickedDot.c);
                const lineLength = Math.max(dr, dc);
                
                // 檢查是否為有效連線（橫線或直線）且長度必須剛好等於設定值
                if (!isValidLine(selectedDot1, clickedDot)) {
                    if (dr !== 0 && dc !== 0) {
                        alert("無效的線條 (只能畫橫線或直線)");
                    } else if (lineLength !== maxLineLength) {
                        alert(`連線長度必須剛好等於 ${maxLineLength} (目前選擇的長度為 ${lineLength})`);
                    }
                    selectedDot1 = null; // 取消選擇
                } else {
                    selectedDot2 = clickedDot;
                    actionBar.classList.remove('hidden');
                }
            }
        }
        drawCanvas(); // 呼叫包裝函式
    }

    // "確認連線" 按鈕的函式 (與前一版相同)
    function confirmLine() {
        if (!selectedDot1 || !selectedDot2) return;
        const dotA = selectedDot1;
        const dotB = selectedDot2;

        // 最終驗證：連線長度必須剛好等於設定值
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

        // 檢查是否至少有一個未畫過的虛線格（這是必要條件）
        // 規則：可以重疊已畫過的線段，但必須包含至少一個新的虛線格
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
        
        drawCanvas(); // 呼叫包裝函式
        updateUI();

        if (totalFilledSquares === totalSquares) {
            endGame();
            return;
        }

        // --- 【已修改】根據「得分」與「設定」決定是否切換玩家 ---
        if (scoredThisTurn && scoreAndGo) {
            // 得分了，且規則允許繼續 -> 不切換玩家
            
            // 如果是 AI 模式且剛才是 AI 得分 (雖然這在 confirmLine 不太可能，但以防萬一)
            if (gameMode === 'pvc' && currentPlayer === 2) {
                checkAndTriggerAIMove();
            } else {
                // 玩家 (P1) 得分了，繼續P1的回合
                // 或是 PVP 模式下，得分方繼續
                // 確保畫布可以點擊
                if (!isAnimating) canvas.style.pointerEvents = 'auto';
            }
        } else {
            // 情況 1: 沒有得分
            // 情況 2: 得分了，但規則設定為"輪流" (scoreAndGo === false)
            // -> 切換玩家
            switchPlayer();
            checkAndTriggerAIMove();
        }
        // --- 【修改結束】 ---
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

    // 驗證連線是否有效且符合長度限制（玩家和 AI 都必須遵守）
    // 規則：連線長度必須剛好等於設定值（不能小於或大於）
    function isValidLine(dotA, dotB) {
        if (!dotA || !dotB) return false;
        
        const dr = Math.abs(dotA.r - dotB.r);
        const dc = Math.abs(dotA.c - dotB.c);
        
        // 檢查是否為橫線或直線
        if (!(dr === 0 || dc === 0)) {
            return false;
        }
        
        // 嚴格檢查：連線長度必須剛好等於設定值（不能小於或大於）
        const lineLength = Math.max(dr, dc);
        if (lineLength !== maxLineLength) {
            return false; // 長度必須剛好等於 maxLineLength
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
                // 【修改】將 'auto' 移到 executeAIMove 中，因為 AI 可能會連續移動
                // if (currentPlayer === 1) {
                //     canvas.style.pointerEvents = 'auto';
                // }
            }, 600);
        } else {
            if (gameMode === 'pvp' || currentPlayer === 1) {
                    canvas.style.pointerEvents = 'auto';
            }
        }
    }

    function aiMove() {
        // 如果連線長度限制大於 1，只能使用長連線模式（因為單線段長度是1，不等於maxLineLength）
        if (maxLineLength > 1) {
            const longLineMove = findBestLongLineMove();
            if (longLineMove) {
                executeAIMove(longLineMove.dotA, longLineMove.dotB);
                return;
            } else {
                // 找不到符合長度的連線，AI 無法行動，切換回玩家
                if (!isGameOver()) switchPlayer();
                return;
            }
        }
        
        // 當 maxLineLength = 1 時，使用優化後的單個線段模式
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
            let riskScore = 0; // 風險分數
            let potentialSquares = 0; // 潛在方塊機會

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

                // 關鍵規則：最後圍成正方形的人得分！
                if (sidesDrawn === 3) {
                    // 已有三邊，AI 畫第四邊 → AI 得分！
                    squaresCompleted++;
                } else if (sidesDrawn === 2) {
                    // 已有兩邊，AI 畫第三邊 → 給對手創造完成機會，高風險！
                    isUnsafe = true;
                    riskScore += 10; // 高風險：對手下一步可以得分
                } else if (sidesDrawn === 1) {
                    // 已有一邊，AI 畫第二邊，風險較低
                    riskScore += 2;
                    isUnsafe = true;
                } else {
                    // 零邊，幾乎沒有風險
                    potentialSquares += 0.3;
                }
            });

            // 儲存更多評估資訊
            const moveInfo = {
                segment,
                squaresCompleted,
                isUnsafe,
                riskScore,
                potentialSquares
            };

            if (squaresCompleted > 0) {
                winningMoves.push(moveInfo);
            } else if (isUnsafe) {
                unsafeMoves.push(moveInfo);
            } else {
                safeMoves.push(moveInfo);
            }
        }
        
        let segmentToDraw;
        if (winningMoves.length > 0) {
            // 優化：選擇完成最多方塊且風險最低的
            winningMoves.sort((a, b) => {
                if (b.squaresCompleted !== a.squaresCompleted) {
                    return b.squaresCompleted - a.squaresCompleted;
                }
                return a.riskScore - b.riskScore;
            });
            segmentToDraw = winningMoves[0].segment;
        } else if (safeMoves.length > 0) {
            // 優化：選擇能創造最多潛在機會的
            safeMoves.sort((a, b) => b.potentialSquares - a.potentialSquares);
            segmentToDraw = safeMoves[0].segment;
        } else if (unsafeMoves.length > 0) {
            // 優化：選擇風險最小的
            unsafeMoves.sort((a, b) => a.riskScore - b.riskScore);
            segmentToDraw = unsafeMoves[0].segment;
        } else {
            // 如果以上都沒有，隨機選擇
            segmentToDraw = availableSegments[Math.floor(Math.random() * availableSegments.length)];
        }

        if (!segmentToDraw) {
                if (!isGameOver()) switchPlayer();
                return;
        }
        
        // 將單個線段轉換為點對
        const dotA = segmentToDraw.p1;
        const dotB = segmentToDraw.p2;
        executeAIMove(dotA, dotB);
    }
    
    // 尋找最佳長連線移動（優化版：減少不必要的循環）
    function findBestLongLineMove() {
        let winningMoves = [];
        let safeMoves = [];
        let unsafeMoves = [];
        
        // 優化：只檢查符合長度限制的點對，而不是所有組合
        // 對於橫線：檢查同一行，列間距為 maxLineLength
        // 對於直線：檢查同一列，行間距為 maxLineLength
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < gridCols; c++) {
                const dotA = dots[r][c];
                
                // 檢查橫線（向右）
                if (c + maxLineLength < gridCols) {
                    const dotB = dots[r][c + maxLineLength];
                    evaluateMove(dotA, dotB, winningMoves, safeMoves, unsafeMoves);
                }
                
                // 檢查直線（向下）
                if (r + maxLineLength < gridRows) {
                    const dotB = dots[r + maxLineLength][c];
                    evaluateMove(dotA, dotB, winningMoves, safeMoves, unsafeMoves);
                }
            }
        }
        
        // 優化後的優先選擇策略（針對「最後圍成的人得分」規則）
        if (winningMoves.length > 0) {
            // 優先完成方塊（搶先完成已有三邊的方塊）
            winningMoves.sort((a, b) => {
                // 首先比較完成的方塊數
                if (b.squaresCompleted !== a.squaresCompleted) {
                    return b.squaresCompleted - a.squaresCompleted;
                }
                // 如果方塊數相同，優先選擇防禦價值高的（搶先完成已有三邊的）
                if (b.defensiveValue !== a.defensiveValue) {
                    return b.defensiveValue - a.defensiveValue;
                }
                // 比較綜合評分
                if (b.totalScore !== a.totalScore) {
                    return b.totalScore - a.totalScore;
                }
                // 優先選擇風險較低的
                if (a.riskScore !== b.riskScore) {
                    return a.riskScore - b.riskScore;
                }
                // 優先選擇能畫更多新線段的
                return b.totalNewSegments - a.totalNewSegments;
            });
            return winningMoves[0];
        } else if (safeMoves.length > 0) {
            // 安全移動：優先考慮防禦價值（搶先完成已有三邊的方塊）
            safeMoves.sort((a, b) => {
                // 最高優先級：搶先完成已有三邊的方塊
                if (b.defensiveValue !== a.defensiveValue) {
                    return b.defensiveValue - a.defensiveValue;
                }
                // 比較綜合評分
                if (b.totalScore !== a.totalScore) {
                    return b.totalScore - a.totalScore;
                }
                // 優先選擇風險較低的
                if (a.riskScore !== b.riskScore) {
                    return a.riskScore - b.riskScore;
                }
                // 優先選擇能創造更多潛在方塊機會的
                if (b.potentialSquares !== a.potentialSquares) {
                    return b.potentialSquares - a.potentialSquares;
                }
                // 優先選擇能畫更多新線段的
                if (b.totalNewSegments !== a.totalNewSegments) {
                    return b.totalNewSegments - a.totalNewSegments;
                }
                // 優先選擇控制更多區域的
                return b.controlArea - a.controlArea;
            });
            return safeMoves[0];
        } else if (unsafeMoves.length > 0) {
            // 不安全移動：選擇綜合風險最低的（盡量避免給對手創造機會）
            unsafeMoves.sort((a, b) => {
                // 優先選擇綜合評分最高的（風險低、潛力高）
                if (b.totalScore !== a.totalScore) {
                    return b.totalScore - a.totalScore;
                }
                // 比較總風險分數（優先避免給對手創造完成機會）
                if (a.riskScore !== b.riskScore) {
                    return a.riskScore - b.riskScore;
                }
                // 優先選擇連鎖風險低的
                if (a.chainRisk !== b.chainRisk) {
                    return a.chainRisk - b.chainRisk;
                }
                // 優先選擇有防禦價值的（如果能搶先完成）
                if (b.defensiveValue !== a.defensiveValue) {
                    return b.defensiveValue - a.defensiveValue;
                }
                // 最後選擇能創造更多潛力的
                return b.potentialSquares - a.potentialSquares;
            });
            return unsafeMoves[0];
        }
        
        return null;
    }
    
    // 評估單個移動的價值（優化版：針對長連線的特殊邏輯）
    function evaluateMove(dotA, dotB, winningMoves, safeMoves, unsafeMoves) {
        // 檢查是否為有效連線且長度必須剛好等於設定值
        if (!isValidLine(dotA, dotB)) return;
        
        // 檢查是否至少有一個未畫過的虛線格
        const segments = getSegmentsForLine(dotA, dotB);
        if (segments.length === 0) return;
        const newSegments = segments.filter(seg => seg.players.length === 0);
        if (newSegments.length === 0) return; // 必須至少有一個虛線格
        
        // 評估這個連線的價值
        let squaresCompleted = 0;
        let isUnsafe = false;
        let totalNewSegments = newSegments.length;
        let potentialSquares = 0; // 能創造的潛在方塊機會
        let riskScore = 0; // 風險分數（給對手創造的機會）
        let chainRisk = 0; // 連鎖風險（可能引發的多個連續威脅）
        let defensiveValue = 0; // 防禦價值（阻止對手完成方塊）
        let controlArea = 0; // 控制區域（影響的方塊數量）
        
        // 統計這個移動會影響的所有方塊
        const affectedSquares = new Set();
        segments.forEach(seg => {
            squares.forEach(sq => {
                if (!sq.filled && sq.lineKeys.includes(seg.id)) {
                    affectedSquares.add(sq);
                }
            });
        });
        
        affectedSquares.forEach(sq => {
            let sidesBeforeMove = 0; // 移動前已畫的邊數
            let sidesAfterMove = 0; // 移動後總邊數
            let newSegmentsInSquare = 0; // 這個方塊中有多少新線段
            
            // 計算移動前的狀態和移動後的狀態
            sq.lineKeys.forEach(key => {
                const line = lines[key];
                if (line.players.length > 0) {
                    // 這個邊已經被畫了
                    sidesBeforeMove++;
                    sidesAfterMove++;
                } else if (segments.some(seg => seg.id === key)) {
                    // 這個移動會畫這個邊
                    sidesAfterMove++;
                    if (newSegments.some(seg => seg.id === key)) {
                        // 這是新的線段（之前未畫過）
                        newSegmentsInSquare++;
                    }
                }
            });
            
            controlArea++;
            
            // 關鍵規則：最後圍成正方形的人得分！
            // 如果移動前已有三邊，AI 畫新的第四邊就能得分
            
            if (sidesBeforeMove === 3 && newSegmentsInSquare > 0) {
                // 移動前已有三邊，AI 畫了新的第四邊 → AI 得分！
                squaresCompleted++;
                defensiveValue += 30; // 搶先完成的價值極高
            } else if (sidesBeforeMove === 2 && newSegmentsInSquare > 0 && sidesAfterMove === 3) {
                // 移動前兩邊，移動後三邊（AI 畫了第三邊）
                // 這給對手創造了完成方塊的機會，風險極高！
                riskScore += 20; // 極高風險：對手下一步可以得分
                isUnsafe = true;
                chainRisk += 5;
            } else if (sidesBeforeMove === 1 && newSegmentsInSquare > 0 && sidesAfterMove === 2) {
                // 移動前一邊，移動後兩邊（AI 畫了第二邊）
                // 風險較低，但還是給對手創造了潛在機會
                riskScore += 3;
                isUnsafe = true;
            } else if (sidesBeforeMove === 0 && newSegmentsInSquare > 0 && sidesAfterMove === 1) {
                // 移動前零邊，移動後一邊（AI 畫了第一邊）
                // 幾乎沒有風險
                potentialSquares += 0.2;
            }
            // 注意：如果 newSegmentsInSquare === 0，說明只是重疊已畫的線，不會改變狀態
        });
        
        // 計算綜合評分
        const move = { 
            dotA, 
            dotB, 
            squaresCompleted, 
            isUnsafe, 
            totalNewSegments,
            potentialSquares,
            riskScore: riskScore + chainRisk, // 總風險包含連鎖風險
            chainRisk,
            defensiveValue,
            controlArea,
            // 綜合評分（用於排序）
            // 優先完成方塊，避免給對手創造機會，優先搶先完成已有三邊的方塊
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
    
    // 執行 AI 移動（與玩家移動邏輯相同）
    function executeAIMove(dotA, dotB) {
        // 嚴格檢查：必須符合連線長度限制
        if (!isValidLine(dotA, dotB)) {
            console.warn("AI 嘗試繪製無效連線，已阻止");
            if (!isGameOver()) switchPlayer();
            return;
        }
        
        const segments = getSegmentsForLine(dotA, dotB);
        if (segments.length === 0) {
            // 如果無法執行，切換玩家
            if (!isGameOver()) switchPlayer();
            return;
        }

        // 嚴格檢查：必須至少有一個未畫過的虛線格才能執行移動
        const newSegments = segments.filter(seg => seg.players.length === 0);
        
        if (newSegments.length === 0) {
            // 如果沒有新的虛線格，AI 無法執行此移動，切換回玩家
            if (!isGameOver()) switchPlayer();
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
        
        drawCanvas(); // 呼叫包裝函式
        updateUI();

        if (totalFilledSquares === totalSquares) {
            endGame();
            return;
        }

        // --- 【已修改】根據「得分」與「設定」決定是否切換玩家 ---
        if (scoredThisTurn && scoreAndGo) {
            // AI 得分了，且規則允許繼續 -> AI 繼續
            // (不切換玩家，直接觸發下一次 AI 移動)
            checkAndTriggerAIMove();
            
        } else {
            // 情況 1: AI 沒得分
            // 情況 2: AI 得分了，但規則設定為"輪流"
            // -> 切換回玩家
            switchPlayer();
            
            // 只有在動畫未播放時才恢復指針
            if (!isAnimating) {
                canvas.style.pointerEvents = 'auto';
            }
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
    if (lineLengthInput) {
        lineLengthInput.addEventListener('change', initGame);
        lineLengthInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') initGame(); });
    }
    
    // --- 【已新增】 ---
    if (scoreAgainModeSelect) {
        scoreAgainModeSelect.addEventListener('change', initGame);
    }
    // --- 【新增結束】 ---

    // 啟動遊戲
    initGame();
});