/**
 * ミャクミャクメン - EXPO2025 Face Filter
 * カメラからのリアルタイム映像で顔検出し、コミャクキャラクターを重ねるアプリケーション
 */

// 定数定義
const COLORS = {
    RED: { r: 230, g: 0, b: 18 },    // EXPO2025 Red
    BLUE: { r: 0, g: 104, b: 183 }   // EXPO2025 Blue
};

// ミャクミャクの目の種類
const EYE_TYPES = {
    SINGLE: 'single',    // 中央に1つの目
    MULTIPLE: 'multiple' // 複数の目
};

// 顔追跡のための定数
const TRACKING = {
    IOU_THRESHOLD: 0.5,  // IOUがこの値以上なら同じ顔と判断
    MAX_AGE: 10          // 何フレーム検出されなかったら消すか
};

/**
 * 2つのバウンディングボックス間のIOU（Intersection over Union）を計算
 * @param {Object} box1 - 1つ目のバウンディングボックス {xMin, yMin, width, height}
 * @param {Object} box2 - 2つ目のバウンディングボックス {xMin, yMin, width, height}
 * @returns {number} IOU値（0～1）
 */
function calculateIOU(box1, box2) {
    // 各ボックスの座標を計算
    const box1XMax = box1.xMin + box1.width;
    const box1YMax = box1.yMin + box1.height;
    const box2XMax = box2.xMin + box2.width;
    const box2YMax = box2.yMin + box2.height;
    
    // 交差領域の座標を計算
    const xMin = Math.max(box1.xMin, box2.xMin);
    const yMin = Math.max(box1.yMin, box2.yMin);
    const xMax = Math.min(box1XMax, box2XMax);
    const yMax = Math.min(box1YMax, box2YMax);
    
    // 交差領域がない場合は0を返す
    if (xMax < xMin || yMax < yMin) {
        return 0;
    }
    
    // 交差領域の面積を計算
    const intersectionArea = (xMax - xMin) * (yMax - yMin);
    
    // 各ボックスの面積を計算
    const box1Area = box1.width * box1.height;
    const box2Area = box2.width * box2.height;
    
    // 合併領域の面積を計算
    const unionArea = box1Area + box2Area - intersectionArea;
    
    // IOUを計算して返す
    return intersectionArea / unionArea;
}

// アプリケーションのメインクラス
class MyakuMyakuApp {
    constructor() {
        // DOM要素
        this.video = document.getElementById('video');
        this.overlay = document.getElementById('overlay');
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.loadingElement = document.getElementById('loading');
        this.errorElement = document.getElementById('error-message');
        this.errorDetails = document.getElementById('error-details');
        this.retryButton = document.getElementById('retry-button');
        this.statusMessage = document.getElementById('status-message');
        
        // キャンバスコンテキスト
        this.ctx = this.overlay.getContext('2d');
        
        // 状態管理
        this.isRunning = false;
        this.faceDetector = null;
        this.videoStream = null;
        this.modelLoaded = false;
        this.facesDetected = 0;
        
        // 顔追跡のための状態管理
        this.trackedFaces = []; // 追跡中の顔情報を保持する配列
        this.nextFaceId = 1;    // 顔に割り当てるID（ユニーク）
        
        // イベントリスナーの設定
        this.startButton.addEventListener('click', () => this.start());
        this.stopButton.addEventListener('click', () => this.stop());
        this.retryButton.addEventListener('click', () => this.initializeApp());
        
        // ウィンドウリサイズ時の処理
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // 初期化
        this.initializeApp();
    }
    
    // アプリケーションの初期化
    async initializeApp() {
        // エラー表示をクリア
        this.hideError();
        
        // ローディング表示
        this.showLoading();
        this.updateStatus('TensorFlow.jsモデルを読み込んでいます...');
        
        try {
            // TensorFlow.jsモデルのロード
            await tf.ready();
            this.updateStatus('顔検出モデルを読み込んでいます...');
            
            this.faceDetector = await faceDetection.createDetector(
                faceDetection.SupportedModels.MediaPipeFaceDetector,
                { 
                    runtime: 'tfjs',
                    modelType: 'short' // 軽量モデルを使用
                }
            );
            
            console.log('Face detection model loaded successfully');
            this.modelLoaded = true;
            this.updateStatus('モデルの読み込みが完了しました。カメラを開始してください。');
            
            // ビデオコンテナのサイズを設定
            this.resizeCanvas();
            
            // ローディング非表示
            this.hideLoading();
        } catch (error) {
            console.error('Failed to initialize the application:', error);
            this.showError('モデルの読み込みに失敗しました', error.message);
        }
    }
    
    // ローディング表示
    showLoading() {
        this.loadingElement.classList.remove('hidden');
    }
    
    // ローディング非表示
    hideLoading() {
        this.loadingElement.classList.add('hidden');
    }
    
    // エラー表示
    showError(message, details = '') {
        this.hideLoading();
        this.errorElement.classList.remove('hidden');
        this.errorDetails.textContent = details;
        this.updateStatus(message);
    }
    
    // エラー非表示
    hideError() {
        this.errorElement.classList.add('hidden');
    }
    
    // ステータスメッセージ更新
    updateStatus(message) {
        this.statusMessage.textContent = message;
        console.log(message);
    }
    
    // キャンバスのリサイズ
    resizeCanvas() {
        const videoContainer = document.querySelector('.video-container');
        const containerWidth = videoContainer.clientWidth;
        const containerHeight = videoContainer.clientHeight || (containerWidth * 0.75); // 4:3 aspect ratio
        
        videoContainer.style.height = `${containerHeight}px`;
        
        this.video.width = containerWidth;
        this.video.height = containerHeight;
        
        this.overlay.width = containerWidth;
        this.overlay.height = containerHeight;
    }
    
    // カメラの開始
    async start() {
        if (this.isRunning) return;
        
        // モデルが読み込まれていない場合は初期化を再実行
        if (!this.modelLoaded) {
            await this.initializeApp();
            if (!this.modelLoaded) {
                return; // モデルの読み込みに失敗した場合は処理を中断
            }
        }
        
        this.updateStatus('カメラへのアクセスを要求しています...');
        
        try {
            // カメラへのアクセス
            this.videoStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            
            this.updateStatus('カメラへのアクセスが許可されました');
            
            // ビデオ要素にストリームを設定
            this.video.srcObject = this.videoStream;
            
            // ビデオが読み込まれたらキャンバスをリサイズ
            this.video.onloadedmetadata = () => {
                this.resizeCanvas();
                this.isRunning = true;
                this.startButton.disabled = true;
                this.stopButton.disabled = false;
                
                this.updateStatus('顔検出を開始しました');
                this.facesDetected = 0;
                
                // 顔検出ループの開始
                this.detectFaces();
            };
        } catch (error) {
            console.error('Failed to access the camera:', error);
            this.showError('カメラへのアクセスに失敗しました', 'カメラの使用許可を確認してください。');
        }
    }
    
    // カメラの停止
    stop() {
        if (!this.isRunning) return;
        
        // ビデオストリームの停止
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        
        // ビデオ要素のクリア
        this.video.srcObject = null;
        
        // キャンバスのクリア
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        
        // 状態の更新
        this.isRunning = false;
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        
        // 追跡情報をリセット
        this.trackedFaces = [];
        this.nextFaceId = 1;
        
        this.updateStatus('カメラを停止しました');
    }
    
    /**
     * 検出された顔と追跡中の顔を照合し、追跡情報を更新する
     * @param {Array} detectedFaces - 現在のフレームで検出された顔の配列
     * @returns {Array} 更新された追跡顔情報の配列
     */
    updateTrackedFaces(detectedFaces) {
        // 検出された顔がない場合、追跡中の顔の年齢を増やす
        if (detectedFaces.length === 0) {
            this.trackedFaces.forEach(face => {
                face.age += 1;
            });
            
            // 一定期間検出されなかった顔を削除
            this.trackedFaces = this.trackedFaces.filter(face => face.age < TRACKING.MAX_AGE);
            return this.trackedFaces;
        }
        
        // 各追跡顔に対して、マッチングスコアを計算
        const matchMatrix = [];
        
        for (let i = 0; i < this.trackedFaces.length; i++) {
            matchMatrix[i] = [];
            const trackedFace = this.trackedFaces[i];
            
            for (let j = 0; j < detectedFaces.length; j++) {
                const detectedFace = detectedFaces[j];
                const box1 = {
                    xMin: trackedFace.box.xMin,
                    yMin: trackedFace.box.yMin,
                    width: trackedFace.box.width,
                    height: trackedFace.box.height
                };
                
                const box2 = {
                    xMin: detectedFace.box.xMin,
                    yMin: detectedFace.box.yMin,
                    width: detectedFace.box.width,
                    height: detectedFace.box.height
                };
                
                const iou = calculateIOU(box1, box2);
                matchMatrix[i][j] = iou;
            }
        }
        
        // 追跡中の顔の使用状態を追跡
        const assignedTracks = new Set();
        const assignedDetections = new Set();
        
        // IOUが閾値以上のペアをマッチングさせる
        for (let i = 0; i < this.trackedFaces.length; i++) {
            for (let j = 0; j < detectedFaces.length; j++) {
                if (matchMatrix[i][j] >= TRACKING.IOU_THRESHOLD) {
                    if (!assignedTracks.has(i) && !assignedDetections.has(j)) {
                        // 追跡中の顔を更新
                        const trackedFace = this.trackedFaces[i];
                        const detectedFace = detectedFaces[j];
                        
                        // 位置情報を更新
                        trackedFace.box = {
                            xMin: detectedFace.box.xMin,
                            yMin: detectedFace.box.yMin,
                            width: detectedFace.box.width,
                            height: detectedFace.box.height
                        };
                        
                        // 顔のランドマークを更新
                        trackedFace.landmarks = detectedFace.landmarks;
                        
                        // 年齢をリセット
                        trackedFace.age = 0;
                        
                        assignedTracks.add(i);
                        assignedDetections.add(j);
                    }
                }
            }
        }
        
        // 未割り当ての検出顔を新規追跡顔として追加
        for (let j = 0; j < detectedFaces.length; j++) {
            if (!assignedDetections.has(j)) {
                const detectedFace = detectedFaces[j];
                
                // 新しい追跡顔を作成
                const newTrackedFace = {
                    id: this.nextFaceId++,
                    box: {
                        xMin: detectedFace.box.xMin,
                        yMin: detectedFace.box.yMin,
                        width: detectedFace.box.width,
                        height: detectedFace.box.height
                    },
                    landmarks: detectedFace.landmarks,
                    age: 0,
                    // ミャクミャクの属性をランダムに設定
                    myakuAttributes: {
                        color: Math.random() < 0.5 ? COLORS.RED : COLORS.BLUE,
                        eyeType: Math.random() < 0.5 ? EYE_TYPES.SINGLE : EYE_TYPES.MULTIPLE,
                        eyeCount: Math.floor(Math.random() * 3) + 1, // 1～3個の目
                        scale: 0.9 + Math.random() * 0.2, // 0.9～1.1のスケール
                        // 目の配置のバリエーションを増やすための追加パラメータ
                        eyeOffset: Math.random() * 0.2, // 目の位置のランダムなオフセット
                        rotationOffset: Math.random() * Math.PI // 回転のランダムなオフセット
                    }
                };
                
                this.trackedFaces.push(newTrackedFace);
            }
        }
        
        // 未割り当ての追跡顔の年齢を増やす
        for (let i = 0; i < this.trackedFaces.length; i++) {
            if (!assignedTracks.has(i)) {
                this.trackedFaces[i].age += 1;
            }
        }
        
        // 一定期間検出されなかった顔を削除
        this.trackedFaces = this.trackedFaces.filter(face => face.age < TRACKING.MAX_AGE);
        
        return this.trackedFaces;
    }
    
    // 顔検出ループ
    async detectFaces() {
        if (!this.isRunning || !this.faceDetector) return;
        
        try {
            // 顔検出の実行
            const detectedFaces = await this.faceDetector.estimateFaces(this.video);
            
            // キャンバスのクリア
            this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
            
            // 検出された顔の数を更新
            if (detectedFaces.length > 0 && this.facesDetected === 0) {
                this.updateStatus(`${detectedFaces.length}人の顔を検出しました！`);
                this.facesDetected = detectedFaces.length;
            } else if (detectedFaces.length > this.facesDetected) {
                this.updateStatus(`${detectedFaces.length}人の顔を検出しました！`);
                this.facesDetected = detectedFaces.length;
            } else if (detectedFaces.length === 0 && this.facesDetected > 0) {
                this.updateStatus('顔を検出できません。カメラに顔を向けてください。');
                this.facesDetected = 0;
            }
            
            // 追跡情報を更新
            const trackedFaces = this.updateTrackedFaces(detectedFaces);
            
            // 追跡中の各顔に対してミャクミャクを描画
            trackedFaces.forEach(face => {
                this.drawTrackedMyakuMyaku(face);
            });
            
            // 次のフレームで再度実行
            requestAnimationFrame(() => this.detectFaces());
        } catch (error) {
            console.error('Face detection error:', error);
            
            // 深刻なエラーの場合はユーザーに通知
            if (error.message && error.message.includes('model')) {
                this.showError('顔検出モデルでエラーが発生しました', error.message);
                this.stop();
                return;
            }
            
            // 一時的なエラーの場合は継続
            requestAnimationFrame(() => this.detectFaces());
        }
    }
    
    /**
     * 追跡中の顔に対してミャクミャクを描画
     * @param {Object} trackedFace - 追跡中の顔情報
     */
    drawTrackedMyakuMyaku(trackedFace) {
        const { box, myakuAttributes } = trackedFace;
        
        // 顔の中心座標
        const centerX = box.xMin + box.width / 2;
        const centerY = box.yMin + box.height / 2;
        
        // 顔のサイズに基づいてミャクミャクのサイズを決定
        const size = Math.max(box.width, box.height) * myakuAttributes.scale;
        
        if (myakuAttributes.eyeType === EYE_TYPES.SINGLE) {
            // 単一の体と目を描画
            const bodySize = size * 0.6;
            this.drawBodyWithEye(centerX, centerY, bodySize, myakuAttributes.color, 0.5); // 目のサイズは体の50%
        } else {
            // 複数の体と目を描画
            // 中央の体は少し小さめに
            const centralBodySize = size * 0.45; // Singleの時より小さく
            
            // 中央の体と目を描画（目のサイズは体の30%～80%でランダム）
            const centralEyeRatio = 0.3 + Math.random() * 0.5; // 30%～80%
            this.drawBodyWithEye(centerX, centerY, centralBodySize, myakuAttributes.color, centralEyeRatio);
            
            // 周囲に追加の体と目を描画
            const numExtraBodies = myakuAttributes.eyeCount;
            for (let i = 0; i < numExtraBodies; i++) {
                // 固定の角度と距離（追跡中は同じパターンを維持）
                const angle = (i * (2 * Math.PI / numExtraBodies)) + myakuAttributes.rotationOffset;
                
                // 顔領域内のランダムな位置に配置
                const distance = size * (0.4 + Math.random() * 0.3); // 顔領域内に収まるよう調整
                
                // 体の位置
                const bodyX = centerX + Math.cos(angle) * distance;
                const bodyY = centerY + Math.sin(angle) * distance;
                
                // 体のサイズはランダム（中央より小さめ）
                const bodySize = centralBodySize * (0.6 + Math.random() * 0.4); // 中央の60%～100%
                
                // 目のサイズは体の30%～80%でランダム
                const eyeRatio = 0.3 + Math.random() * 0.5;
                
                // 体と目を描画
                this.drawBodyWithEye(bodyX, bodyY, bodySize, myakuAttributes.color, eyeRatio);
            }
        }
        
        // デバッグ情報（開発時のみ）
        // this.ctx.fillStyle = 'white';
        // this.ctx.font = '12px Arial';
        // this.ctx.fillText(`ID: ${trackedFace.id}`, centerX - 20, centerY + size * 0.6 + 20);
    }
    
    // ミャクミャクの描画
    drawMyakuMyaku(face) {
        // 顔の位置とサイズを取得
        const box = face.box;
        const centerX = box.xMin + box.width / 2;
        const centerY = box.yMin + box.height / 2;
        const size = Math.max(box.width, box.height);
        
        // ランダムに色を選択（赤または青）
        const color = Math.random() > 0.5 ? COLORS.RED : COLORS.BLUE;
        
        // ランダムに目のタイプを選択
        const eyeType = Math.random() > 0.5 ? EYE_TYPES.SINGLE : EYE_TYPES.MULTIPLE;
        
        if (eyeType === EYE_TYPES.SINGLE) {
            // 単一の体と目を描画
            const bodySize = size * 0.6;
            this.drawBodyWithEye(centerX, centerY, bodySize, color, 0.5); // 目のサイズは体の50%
        } else {
            // 複数の体と目を描画
            // 中央の体は少し小さめに
            const centralBodySize = size * 0.45; // Singleの時より小さく
            
            // 中央の体と目を描画（目のサイズは体の30%～80%でランダム）
            const centralEyeRatio = 0.3 + Math.random() * 0.5; // 30%～80%
            this.drawBodyWithEye(centerX, centerY, centralBodySize, color, centralEyeRatio);
            
            // 周囲に2〜3個の追加の体と目を描画
            const numExtraBodies = Math.floor(Math.random() * 2) + 2;
            for (let i = 0; i < numExtraBodies; i++) {
                // ランダムな角度と距離
                const angle = (i * (2 * Math.PI / numExtraBodies)) + (Math.random() * 0.5);
                
                // 顔領域内のランダムな位置に配置
                const distance = size * (0.4 + Math.random() * 0.3);
                
                // 体の位置
                const bodyX = centerX + Math.cos(angle) * distance;
                const bodyY = centerY + Math.sin(angle) * distance;
                
                // 体のサイズはランダム（中央より小さめ）
                const bodySize = centralBodySize * (0.6 + Math.random() * 0.4); // 中央の60%～100%
                
                // 目のサイズは体の30%～80%でランダム
                const eyeRatio = 0.3 + Math.random() * 0.5;
                
                // 体と目を描画
                this.drawBodyWithEye(bodyX, bodyY, bodySize, color, eyeRatio);
            }
        }
    }
    
    // 目の描画（再利用可能な関数）
    /**
     * 目を描画する関数
     * @param {number} x - 目のX座標
     * @param {number} y - 目のY座標
     * @param {number} size - 目のサイズ
     */
    drawEye(x, y, size) {
        // 白い部分
        this.ctx.fillStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(x, y, size, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 青い瞳
        this.ctx.fillStyle = `rgb(${COLORS.BLUE.r}, ${COLORS.BLUE.g}, ${COLORS.BLUE.b})`;
        this.ctx.beginPath();
        this.ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
        this.ctx.fill();
    }
    
    /**
     * 体と目を描画する関数
     * @param {number} x - 体のX座標
     * @param {number} y - 体のY座標
     * @param {number} bodySize - 体のサイズ
     * @param {Object} bodyColor - 体の色
     * @param {number} eyeRatio - 体に対する目のサイズ比率 (0.3～0.8)
     */
    drawBodyWithEye(x, y, bodySize, bodyColor, eyeRatio = 0.5) {
        // 体（円）を描画
        this.ctx.fillStyle = `rgb(${bodyColor.r}, ${bodyColor.g}, ${bodyColor.b})`;
        this.ctx.beginPath();
        this.ctx.arc(x, y, bodySize, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 目のサイズを体のサイズに対する比率で計算
        const eyeSize = bodySize * eyeRatio;
        
        // 目を描画
        this.drawEye(x, y, eyeSize);
    }
}

// DOMが読み込まれたらアプリケーションを初期化
document.addEventListener('DOMContentLoaded', () => {
    new MyakuMyakuApp();
});