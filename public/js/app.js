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

// --- 座標・サイズを最大変化量だけ近づける ---
function approachWithLimit(prev, target, maxDelta) {
    const diff = target - prev;
    if (Math.abs(diff) > maxDelta) {
        return prev + Math.sign(diff) * maxDelta;
    }
    return target;
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
        this.captureButton = document.getElementById('captureButton');
        this.capturedImage = document.getElementById('capturedImage');
        // DOM要素 - 画像用
        this.imageFileInput = document.getElementById('imageFileInput');
        this.loadedImage = document.getElementById('loadedImage');
        this.loadImageButton = document.getElementById('loadImageButton');
        this.clearImageButton = document.getElementById('clearImageButton');
        this.downloadButton = document.getElementById('downloadButton');
        
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
        this.startButton.addEventListener('click', () => {
            this.clearImage();
            this.captureButton.disabled = false;
            this.start();
        });
        this.stopButton.addEventListener('click', () => {
            this.captureButton.disabled = true;
            this.stop();
        });
        this.retryButton.addEventListener('click', () => this.initializeApp());
        this.captureButton.addEventListener('click', () => this.capturePhoto());
        
        // イベントリスナーの設定 - 画像用
        this.intervalId = null;
        this.loadImageButton.addEventListener('click', async () => {
            if (this.imageFileInput.files.length != 1) {
                return;
            }

            this.initializeLoadImage();
            const file = this.imageFileInput.files[0];
            const { image, scaleX, scaleY } = await this.loadImage(file);

            this.intervalId = setInterval(
                async () => this.detectFacesImage(image, scaleX, scaleY),
                1000
            );
        });
        this.clearImageButton.addEventListener('click', () => this.clearImage());
        this.downloadButton.addEventListener('click', () => this.downlodaImage());

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
                    maxFaces: 3,
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
        this.captureButton.disabled = true;
        this.capturedImage.style.display = 'none';
        
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
     * @param {number} [scaleX=1] 元画像の縦の縮尺比
     * @param {number} [scaleY=1] 元画像の横の縮尺比
     * @param {number} [scale=1] 面のサイズを調整する縮尺比
     */
    drawTrackedMyakuMyaku(trackedFace, scaleX = 1, scaleY = 1, scale = 1) {
        const { box, myakuAttributes } = trackedFace;
        
        const scaledBox = {
            xMin: box.xMin * scaleX,
            yMin: box.yMin * scaleY,
            width: box.width * scaleX,
            height: box.height * scaleY
        };

        // 顔の中心座標
        const centerX = scaledBox.xMin + scaledBox.width / 2;
        const centerY = scaledBox.yMin + scaledBox.height / 2;
        
        // 顔のサイズに基づいてミャクミャクのサイズを決定
        const size = Math.max(scaledBox.width, scaledBox.height) * myakuAttributes.scale * scale;
        
        // --- 複数目・体モードのとき、3～8秒間隔で周囲の目と体の数を1～3個でランダムに増減 ---
        if (myakuAttributes.eyeType === EYE_TYPES.MULTIPLE) {
            const now = performance.now ? performance.now() : Date.now();
            if (!myakuAttributes._eyeCountChangeTime) {
                myakuAttributes._eyeCountChangeTime = now + 3000 + Math.random() * 5000; // 3～8秒後
            }
            if (now > myakuAttributes._eyeCountChangeTime) {
                // 1～3個（中央以外）
                let current = myakuAttributes.eyeCount || 1;
                let next = current + (Math.random() < 0.5 ? 1 : -1);
                if (next < 1) next = 1;
                if (next > 3) next = 3;
                myakuAttributes.eyeCount = next;
                myakuAttributes._eyeCountChangeTime = now + 3000 + Math.random() * 5000;
            }
        }
        
        if (myakuAttributes.eyeType === EYE_TYPES.SINGLE) {
            // bodyStates[0]を単体体用に確保
            if (!myakuAttributes.bodyStates || myakuAttributes.bodyStates.length !== 1) {
                myakuAttributes.bodyStates = [{
                    eyeOffsetX: undefined,
                    eyeOffsetY: undefined,
                    drawX: undefined,
                    drawY: undefined,
                    prevDrawX: undefined,
                    prevDrawY: undefined,
                    eyeX: undefined,
                    eyeY: undefined,
                    prevEyeX: undefined,
                    prevEyeY: undefined
                }];
            }
            const s = myakuAttributes.bodyStates[0];
            const bodySize = size * 0.6;
            // 体の中心
            const idealX = centerX;
            const idealY = centerY;
            // 前回の位置を保存
            s.prevDrawX = s.drawX;
            s.prevDrawY = s.drawY;
            s.prevEyeX = s.eyeX;
            s.prevEyeY = s.eyeY;
            if (s.drawX === undefined) {
                s.drawX = idealX;
                s.drawY = idealY;
            } else {
                const maxMove = 5;
                s.drawX = approachWithLimit(s.drawX, idealX, maxMove);
                s.drawY = approachWithLimit(s.drawY, idealY, maxMove);
            }
            // 目の初期オフセット（体の半径内でランダム）
            if (s.eyeOffsetX === undefined || s.eyeOffsetY === undefined) {
                const r = bodySize * 0.5 * Math.random();
                const theta = Math.random() * Math.PI * 2;
                s.eyeOffsetX = Math.cos(theta) * r;
                s.eyeOffsetY = Math.sin(theta) * r;
                s.eyeX = s.drawX + s.eyeOffsetX;
                s.eyeY = s.drawY + s.eyeOffsetY;
            } else {
                const dx = s.drawX - (s.prevDrawX ?? s.drawX);
                const dy = s.drawY - (s.prevDrawY ?? s.drawY);
                s.eyeX = (s.eyeX ?? s.drawX) + dx + (Math.random() - 0.5) * 4; // -2～+2px
                s.eyeY = (s.eyeY ?? s.drawY) + dy + (Math.random() - 0.5) * 4; // -2～+2px
            }
            this.drawBody(s.drawX, s.drawY, bodySize, myakuAttributes.color, 0.5);
            this.drawEye(s.eyeX, s.eyeY, bodySize * 0.5);
        } else {
            // 複数の体と目を描画
            const centralBodySize = size * 0.45;
            const numExtraBodies = myakuAttributes.eyeCount;
            // bodyStates: [中央, ...周囲]
            if (!myakuAttributes.bodyStates || myakuAttributes.bodyStates.length !== numExtraBodies + 1) {
                // 初期化（中央＋周囲）
                myakuAttributes.bodyStates = [];
                // 中央
                const color = Math.random() > 0.5 ? COLORS.RED : COLORS.BLUE;
                myakuAttributes.bodyStates.push({
                    eyeRatio: 0.3 + Math.random() * 0.2,
                    color: color,
                });
                // 周囲
                for (let i = 0; i < numExtraBodies; i++) {
                    myakuAttributes.bodyStates.push({
                        angle: (i * (2 * Math.PI / numExtraBodies)) + myakuAttributes.rotationOffset,
                        distanceRatio: 0.4 + Math.random() * 0.3, // 0.4～0.7
                        bodySizeRatio: 0.6 + Math.random() * 0.4, // 0.6～1.0
                        eyeRatio: 0.3 + Math.random() * 0.5,
                        color: color,
                    });
                }
            } else {
                // 更新（最大10%までしか変化しない）
                // 中央
                let state = myakuAttributes.bodyStates[0];
                let newEyeRatio = 0.3 + Math.random() * 0.5;
                state.eyeRatio = clampChange(state.eyeRatio, newEyeRatio, 0.01);
                // 色は変えない
                // 周囲
                for (let i = 0; i < numExtraBodies; i++) {
                    let s = myakuAttributes.bodyStates[i+1];
                    let newDistance = 0.4 + Math.random() * 0.3;
                    let newBodySize = 0.6 + Math.random() * 0.4;
                    let newEyeRatio = 0.3 + Math.random() * 0.5;
                    // --- 角度を前回値±0.03rad以内で変化 ---
                    let angleDelta = (Math.random() - 0.5) * 0.06; // -0.03～+0.03
                    s.angle += angleDelta;
                    // 0～2πの範囲に収める
                    if (s.angle < 0) s.angle += Math.PI * 2;
                    if (s.angle > Math.PI * 2) s.angle -= Math.PI * 2;
                    s.distanceRatio = clampChange(s.distanceRatio, newDistance, 0.1);
                    s.bodySizeRatio = clampChange(s.bodySizeRatio, newBodySize, 0.1);
                    s.eyeRatio = clampChange(s.eyeRatio, newEyeRatio, 0.1);
                    // 色は変えない
                }
            }
            // --- 描画 ---
            // 中央
            const centralState = myakuAttributes.bodyStates[0];
            // 前回の体・目の位置を保存
            centralState.prevDrawX = centralState.drawX;
            centralState.prevDrawY = centralState.drawY;
            centralState.prevEyeX = centralState.eyeX;
            centralState.prevEyeY = centralState.eyeY;
            if (centralState.drawX === undefined) {
                centralState.drawX = centerX;
                centralState.drawY = centerY;
            } else {
                const maxMove = 5;
                centralState.drawX = approachWithLimit(centralState.drawX, centerX, maxMove);
                centralState.drawY = approachWithLimit(centralState.drawY, centerY, maxMove);
            }
            // 目の初期オフセット（体の半径内でランダム）
            if (centralState.eyeOffsetX === undefined || centralState.eyeOffsetY === undefined) {
                const r = centralBodySize * 0.5 * Math.random();
                const theta = Math.random() * Math.PI * 2;
                centralState.eyeOffsetX = Math.cos(theta) * r;
                centralState.eyeOffsetY = Math.sin(theta) * r;
                centralState.eyeX = centralState.drawX + centralState.eyeOffsetX;
                centralState.eyeY = centralState.drawY + centralState.eyeOffsetY;
            } else {
                const dx = centralState.drawX - (centralState.prevDrawX ?? centralState.drawX);
                const dy = centralState.drawY - (centralState.prevDrawY ?? centralState.drawY);
                centralState.eyeX = (centralState.eyeX ?? centralState.drawX) + dx;
                centralState.eyeY = (centralState.eyeY ?? centralState.drawY) + dy;
            }
            this.drawBody(centralState.drawX, centralState.drawY, centralBodySize, centralState.color, centralState.eyeRatio);
            // 周囲
            for (let i = 0; i < numExtraBodies; i++) {
                const s = myakuAttributes.bodyStates[i+1];
                // 理想の位置・サイズ
                const angle = s.angle;
                const distance = size * s.distanceRatio;
                const idealX = centerX + Math.cos(angle) * distance;
                const idealY = centerY + Math.sin(angle) * distance;
                const idealSize = centralBodySize * s.bodySizeRatio;
                // 前回値がなければ初期化
                // 前回の位置を保存
                s.prevDrawX = s.drawX;
                s.prevDrawY = s.drawY;
                s.prevEyeX = s.eyeX;
                s.prevEyeY = s.eyeY;
                if (s.drawX === undefined) {
                    s.drawX = idealX;
                    s.drawY = idealY;
                    s.drawSize = idealSize;
                } else {
                    // 最大変化量(px)
                    const maxMove = 5; // 1フレームで最大5pxまで
                    s.drawX = approachWithLimit(s.drawX, idealX, maxMove);
                    s.drawY = approachWithLimit(s.drawY, idealY, maxMove);
                    // サイズもなめらかに
                    const maxSizeMove = 3; // 1フレームで最大10pxまで
                    s.drawSize = approachWithLimit(s.drawSize, idealSize, maxSizeMove);
                }
                // 目の初期オフセット（体の半径内でランダム）
                if (s.eyeOffsetX === undefined || s.eyeOffsetY === undefined) {
                    const r = s.drawSize * 0.5 * Math.random();
                    const theta = Math.random() * Math.PI * 2;
                    s.eyeOffsetX = Math.cos(theta) * r;
                    s.eyeOffsetY = Math.sin(theta) * r;
                    // 初回は体の中心＋オフセット
                    s.eyeX = s.drawX + s.eyeOffsetX;
                    s.eyeY = s.drawY + s.eyeOffsetY;
                } else {
                    // 体の移動分だけ目も動かす
                    const dx = s.drawX - (s.prevDrawX ?? s.drawX);
                    const dy = s.drawY - (s.prevDrawY ?? s.drawY);
                    s.eyeX = (s.eyeX ?? s.drawX) + dx;
                    s.eyeY = (s.eyeY ?? s.drawY) + dy;
                }
                this.drawBody(s.drawX, s.drawY, s.drawSize, s.color, s.eyeRatio);
                // 目のサイズを体のサイズに対する比率で計算
                const eyeSize = s.drawSize * s.eyeRatio;
                // 目を描画（体中心＋オフセット）
                this.drawEye(s.eyeX, s.eyeY, eyeSize);
            }
            // 目のサイズを体のサイズに対する比率で計算
            const centralEyeSize = centralBodySize * centralState.eyeRatio;
            // 目を描画（体中心＋オフセット）
            this.drawEye(centralState.eyeX, centralState.eyeY, centralEyeSize);
// --- 座標・サイズを最大変化量だけ近づける ---
function approachWithLimit(prev, target, maxDelta) {
    const diff = target - prev;
    if (Math.abs(diff) > maxDelta) {
        return prev + Math.sign(diff) * maxDelta;
    }
    return target;
}

        }

// --- ユーティリティ関数 ---
// 前回値から最大rateだけしか変化しないようにする
function clampChange(prev, next, rate) {
    if (prev === undefined) return next;
    const maxChange = Math.abs(prev) * rate;
    if (Math.abs(next - prev) > maxChange) {
        return prev + Math.sign(next - prev) * maxChange;
    }
    return next;
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
            this.drawBody(centerX, centerY, bodySize, color, 0.5); // 目のサイズは体の50%
            this.drawEye(centerX, centerY, bodySize * 0.5);
        } else {
            // 複数の体と目を描画
             // 中央の体は少し小さめに
            const centralBodySize = size * 0.45; // Singleの時より小さく
            
            // 中央の体と目を描画（目のサイズは体の30%～80%でランダム）
            const centralEyeRatio = 0.3 + Math.random() * 0.5; // 30%～80%
            this.drawBody(centerX, centerY, centralBodySize, color, centralEyeRatio);
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
                this.drawBody(bodyX, bodyY, bodySize, color, eyeRatio);
                this.drawEye(bodyX, bodyY, bodySize * eyeRatio);
            }

            this.drawEye(centerX, centerY, centralBodySize * centralEyeRatio);
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
    drawBody(x, y, bodySize, bodyColor, eyeRatio = 0.5) {
        // 体（円）を描画
        this.ctx.fillStyle = `rgb(${bodyColor.r}, ${bodyColor.g}, ${bodyColor.b})`;
        this.ctx.beginPath();
        this.ctx.arc(x, y, bodySize, 0, Math.PI * 2);
        this.ctx.fill();
        

    }

    /**
     * 写真撮影ボタン押下時 - 現在の映像フレームを画像として取得し表示
     */
    capturePhoto() {
        if (!this.isRunning || !this.video) return;
        // overlay(canvas)の表示サイズ
        const overlayDisplayWidth = this.overlay.width;
        const overlayDisplayHeight = this.overlay.height;
        // videoの実サイズ
        const videoWidth = this.video.videoWidth;
        const videoHeight = this.video.videoHeight;

        // アスペクト比計算
        const overlayAspect = overlayDisplayWidth / overlayDisplayHeight;
        const videoAspect = videoWidth / videoHeight;

        let sx, sy, sWidth, sHeight;
        if (videoAspect > overlayAspect) {
            // videoが横長 → 横をクロップ
            sHeight = videoHeight;
            sWidth = Math.round(overlayAspect * videoHeight);
            sx = Math.round((videoWidth - sWidth) / 2);
            sy = 0;
        } else {
            // videoが縦長 → 縦をクロップ
            sHeight = Math.round(videoWidth / overlayAspect);
            sWidth = videoWidth;
            sx = 0;
            sy = Math.round((videoHeight - sHeight) / 2);
        }

        // 合成用キャンバスをoverlay表示サイズで作成
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = overlayDisplayWidth;
        tempCanvas.height = overlayDisplayHeight;
        const tempCtx = tempCanvas.getContext('2d');
        // videoからアスペクト比維持でクロップして描画
        tempCtx.drawImage(
            this.video,
            sx, sy, sWidth, sHeight,
            0, 0, overlayDisplayWidth, overlayDisplayHeight
        );
        // overlayもそのまま重ねる
        tempCtx.drawImage(this.overlay, 0, 0, overlayDisplayWidth, overlayDisplayHeight);
        // ダウンロード
        const imageDataUrl = tempCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imageDataUrl;
        a.download = 'komyaku_capture.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    
    async loadImage(file) {
        if (!file) {
            throw new Error('画像ファイルが指定されていません。');
        }

        const reader = new FileReader();

        // FileReaderの読み込み完了を待つPromise
        const readFile = new Promise((resolve, reject) => {
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
            reader.readAsDataURL(file);
        });

        const imageDataUrl = await readFile;

        const image = new Image();

        // Imageの読み込み完了を待つPromise
        const loadImagePromise = new Promise((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
            image.src = imageDataUrl;
        });

        await loadImagePromise;

        this.loadedImage.src = image.src;

        const originalWidth = image.naturalWidth;
        const originalHeight = image.naturalHeight;

        // this.loadedImageの読み込み完了を待つPromise
        const loadLoadedImagePromise = new Promise((resolve) => {
            this.loadedImage.onload = () => resolve();
        });

        await loadLoadedImagePromise;

        const renderedWidth = this.loadedImage.clientWidth;
        const renderedHeight = this.loadedImage.clientHeight;
        const scaleX = renderedWidth / originalWidth;
        const scaleY = renderedHeight / originalHeight;

        console.log(`画像を読み込みました。width: ${renderedWidth}, height: ${renderedHeight}`);
        return { image: image, scaleX: scaleX, scaleY: scaleY };
    }

    /**
     * 画像ファイルに対してミャクミャクを描画
     */
    async detectFacesImage(image, scaleX, scaleY) {
        try {
            // 顔検出の実行
            const detectedFaces = await this.faceDetector.estimateFaces(image);

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
                this.drawTrackedMyakuMyaku(face, scaleX, scaleY, 1.1);
            });

        } catch (error) {
            console.error('Face detection error:', error);

            // 深刻なエラーの場合はユーザーに通知
            if (error.message && error.message.includes('model')) {
                this.showError('顔検出モデルでエラーが発生しました', error.message);
                this.stop();
                return;
            }

            // 一時的なエラーの場合は再実行
            this.detectFacesImage(face, scaleX, scaleY);
        }
    }

    downlodaImage() {
        // overlay(canvas)の表示サイズ
        const overlayDisplayWidth = this.overlay.width;
        const overlayDisplayHeight = this.overlay.height;
        // imageの実サイズ
        const imageWidth = this.loadedImage.naturalWidth;
        const imageHeight = this.loadedImage.naturalHeight;

        // アスペクト比計算
        const overlayAspect = overlayDisplayWidth / overlayDisplayHeight;
        const imageAspect = imageWidth / imageHeight;

        let sx, sy, sWidth, sHeight;
        if (imageAspect > overlayAspect) {
            // imageが横長 → 横をクロップ
            sHeight = imageHeight;
            sWidth = Math.round(overlayAspect * imageHeight);
            sx = Math.round((imageWidth - sWidth) / 2);
            sy = 0;
        } else {
            // imageが縦長 → 縦をクロップ
            sHeight = Math.round(overlayAspect * imageWidth);
            sWidth = imageWidth;
            sx = 0;
            sy = Math.round((imageHeight - sHeight) / 2);
        }

        // 合成用キャンバスをoverlay表示サイズで作成
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = overlayDisplayWidth;
        tempCanvas.height = overlayDisplayHeight;
        const tempCtx = tempCanvas.getContext('2d');
        // 画像からアスペクト比維持でクロップして描画
        tempCtx.drawImage(
            this.loadedImage,
            sx, sy, sWidth, sHeight,
            0, 0, overlayDisplayWidth, overlayDisplayHeight
        );
        // overlayもそのまま重ねる
        tempCtx.drawImage(this.overlay, 0, 0, overlayDisplayWidth, overlayDisplayHeight);
        // ダウンロード
        const imageDataUrl = tempCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imageDataUrl;
        a.download = 'komyaku_capture.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    initializeLoadImage() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.intervalId = null;
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        
        this.loadedImage.classList.remove('hidden');
        this.clearImageButton.disabled = false;
        this.downloadButton.disabled = false;
    }

    clearImage() {
        if(this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.intervalId = null;
        this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

        this.imageFileInput.value = '';
        this.loadedImage.src = '';
        this.loadedImage.classList.add('hidden');
        this.clearImageButton.disabled = true;
        this.downloadButton.disabled = true;
    }
}

// DOMが読み込まれたらアプリケーションを初期化
document.addEventListener('DOMContentLoaded', () => {
    new MyakuMyakuApp();
});