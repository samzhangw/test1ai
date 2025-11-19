document.addEventListener('DOMContentLoaded', () => {
    // ... (前略)
    const winRateContainer = document.getElementById('win-rate-container');
    const winRateValue = document.getElementById('win-rate-value');
    const winRateBarFill = document.getElementById('win-rate-bar-fill');

    // --- AI Worker 訊息處理 ---
    function handleWorkerMessage(e) {
        const { type, dotA, dotB, winRate } = e.data; // 接收 winRate
        
        aiThinkingIndicator.classList.add('hidden');

        // 更新勝率 UI
        if (winRate !== undefined) {
            updateWinRateUI(winRate);
        }

        if (type === 'bestMoveFound') {
            const mainDotA = dots[dotA.r][dotA.c];
            const mainDotB = dots[dotB.r][dotB.c];
            executeAIMove(mainDotA, mainDotB);
        } 
        else if (type === 'hintFound') {
            // ... (提示邏輯)
        }
        // ...
    }

    // 【新增】更新勝率 UI 函式
    function updateWinRateUI(rate) {
        winRateContainer.classList.remove('hidden');
        
        // rate 是 AI 的勝率 (0-100)
        // 如果是 Player 2 (AI) 的回合，且 rate > 50，表示 P2 優勢
        // 為了統一顯示，我們定義：左邊 (0%) 是 P1 絕對優勢，右邊 (100%) 是 P2/AI 絕對優勢
        
        let displayRate = rate;
        
        // Minimax 回傳的勝率是「當前行動者」的勝率
        // 如果現在是 P1 (人類/電腦1) 行動，rate 代表 P1 的勝率 -> 需要反轉顯示 (因為條狀圖右邊是 P2)
        // 如果現在是 P2 (電腦2) 行動，rate 代表 P2 的勝率 -> 不需要反轉
        
        let finalPercent;
        
        if (currentPlayer === 1) {
            // P1 的勝率是 70%，那進度條應該顯示 30% (偏左，P1 端)
            finalPercent = 100 - displayRate;
        } else {
            // P2 的勝率是 70%，進度條顯示 70% (偏右，P2 端)
            finalPercent = displayRate;
        }
        
        // 限制範圍
        finalPercent = Math.max(0, Math.min(100, finalPercent));

        // 更新文字
        if (finalPercent < 50) {
            winRateValue.textContent = `P1 優勢 ${100 - finalPercent}%`;
            winRateValue.style.color = PLAYER_COLORS[1].text;
        } else if (finalPercent > 50) {
            winRateValue.textContent = `P2 優勢 ${finalPercent}%`;
            winRateValue.style.color = PLAYER_COLORS[2].text;
        } else {
            winRateValue.textContent = `勢均力敵`;
            winRateValue.style.color = '#64748b';
        }
        
        // 更新進度條顏色與長度
        winRateBarFill.style.width = `${finalPercent}%`;
        if (finalPercent < 50) {
            winRateBarFill.style.background = `linear-gradient(to right, ${PLAYER_COLORS[1].line}, ${PLAYER_COLORS[1].line})`;
        } else {
            winRateBarFill.style.background = `linear-gradient(to right, ${PLAYER_COLORS[2].line}, ${PLAYER_COLORS[2].line})`;
        }
    }

    // 遊戲重置時隱藏勝率條
    function initGame() {
        // ... (前略)
        winRateContainer.classList.add('hidden');
        // ... (後略)
    }
    // ...
});
