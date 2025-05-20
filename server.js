const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 12000; // 環境変数からポート番号を取得、デフォルトは12000

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// CORS設定
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// ルートへのアクセス
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// サーバーの起動
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});