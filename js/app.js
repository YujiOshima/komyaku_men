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
        
        this.updateStatus('カメラを停止しました');
    }
    
    // 顔検出ループ
    async detectFaces() {
        if (!this.isRunning || !this.faceDetector) return;
        
        try {
            // 顔検出の実行
            const faces = await this.faceDetector.estimateFaces(this.video);
            
            // キャンバスのクリア
            this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
            
            // 検出された顔の数を更新
            if (faces.length > 0 && this.facesDetected === 0) {
                this.updateStatus(`${faces.length}人の顔を検出しました！`);
                this.facesDetected = faces.length;
            } else if (faces.length > this.facesDetected) {
                this.updateStatus(`${faces.length}人の顔を検出しました！`);
                this.facesDetected = faces.length;
            } else if (faces.length === 0 && this.facesDetected > 0) {
                this.updateStatus('顔を検出できません。カメラに顔を向けてください。');
                this.facesDetected = 0;
            }
            
            // 検出された各顔に対してミャクミャクを描画
            faces.forEach(face => {
                this.drawMyakuMyaku(face);
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
    
    // ミャクミャクの描画
    drawMyakuMyaku(face) {
        // 顔の位置とサイズを取得
        const box = face.box;
        const centerX = box.xMin + box.width / 2;
        const centerY = box.yMin + box.height / 2;
        const size = Math.max(box.width, box.height);
        
        // ランダムに色を選択（赤または青）
        const color = Math.random() > 0.5 ? COLORS.RED : COLORS.BLUE;
        
        // 目の色（赤なら青、青なら赤）
        const eyeColor = color === COLORS.RED ? COLORS.BLUE : COLORS.RED;
        
        // ランダムに目のタイプを選択
        const eyeType = Math.random() > 0.5 ? EYE_TYPES.SINGLE : EYE_TYPES.MULTIPLE;
        
        // ミャクミャクの本体（円）を描画
        this.ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, size * 0.6, 0, Math.PI * 2);
        this.ctx.fill();
        
        if (eyeType === EYE_TYPES.SINGLE) {
            // 単一の大きな目を描画
            this.drawEye(centerX, centerY, size * 0.3, eyeColor, color);
        } else {
            // 複数の目を描画
            // 中央に小さめの目
            this.drawEye(centerX, centerY, size * 0.2, eyeColor, color);
            
            // 周囲に2〜3個の小さな目を追加
            const numExtraEyes = Math.floor(Math.random() * 2) + 2;
            for (let i = 0; i < numExtraEyes; i++) {
                // ランダムな角度と距離
                const angle = (i * (2 * Math.PI / numExtraEyes)) + (Math.random() * 0.5);
                const distance = size * (0.6 + Math.random() * 0.2);
                
                // 小さな目の位置
                const eyeX = centerX + Math.cos(angle) * distance;
                const eyeY = centerY + Math.sin(angle) * distance;
                const eyeSize = size * (0.15 + Math.random() * 0.1);
                
                // 小さな目の描画
                // 目の色をランダムに選択（メインと同じか逆か）
                const smallEyeColor = Math.random() > 0.5 ? color : eyeColor;
                const smallEyePupilColor = smallEyeColor === color ? eyeColor : color;
                
                this.drawEye(eyeX, eyeY, eyeSize, smallEyeColor, smallEyePupilColor);
            }
        }
    }
    
    // 目の描画（再利用可能な関数）
    drawEye(x, y, size, circleColor, pupilColor) {
        // 目の外側の円
        this.ctx.fillStyle = `rgb(${circleColor.r}, ${circleColor.g}, ${circleColor.b})`;
        this.ctx.beginPath();
        this.ctx.arc(x, y, size, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 白い部分
        this.ctx.fillStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 瞳（内側の円）
        this.ctx.fillStyle = `rgb(${pupilColor.r}, ${pupilColor.g}, ${pupilColor.b})`;
        this.ctx.beginPath();
        this.ctx.arc(x, y, size * 0.4, 0, Math.PI * 2);
        this.ctx.fill();
    }
}

// DOMが読み込まれたらアプリケーションを初期化
document.addEventListener('DOMContentLoaded', () => {
    new MyakuMyakuApp();
});