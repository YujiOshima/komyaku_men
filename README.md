# だれでもこみゃく面 v1.0

https://komyaku-men.web.app/

このアプリケーションは、カメラからのリアルタイム映像ストリームを取得し、映像内の顔を検出して、EXPO2025のキャラクター「こみゃく」を模した図形を動的に描画するWebアプリケーションです。

※このアプリは2025年大阪・関西万博の公式キャラクター「ミャクミャク」の二次創作です。
公式キャラクターの著作権等の扱いに関しては[二次創作ガイドライン](https://www.expo2025.or.jp/wp/wp-content/themes/expo2025orjp_2022/assets/pdf/character/character_terms.pdf)に準拠します。

## 機能

- カメラアクセスと映像表示
  - ユーザーのデバイスのカメラにアクセスし、リアルタイムで映像ストリームを取得
  - 取得した映像をWebページ上に表示

- 顔検出
  - MediaPipe Face Detection APIを使用して、カメラ映像からリアルタイムに顔を検出
  - 検出された顔の位置とサイズ情報を取得

- こみゃくの描画
  - 検出された各顔領域を覆うように、こみゃくを模した図形を描画
  - 赤色(RGB: 230, 0, 18)と青色(RGB: 0, 104, 183)の2色を使用

- リアルタイム追従
  - 顔が動いた場合、こみゃくも滑らかに追従
  - あっちこっち動いたり、増えたり、減ったり

## 技術スタック

- フロントエンド: HTML, CSS, JavaScript
- 顔検出: MediaPipe Face Detection API
- 描画: HTML Canvas API
- サーバー: Node.js, Express

## ディレクトリ構成

```
komyaku_men/
├── public/
│   ├── index.html
│   ├── js/
│   └── css/
├── server.js
├── package.json
└── README.md
```

## 使用方法

1. リポジトリをクローン
```
git clone https://github.com/YujiOshima/komyaku_men.git
```

2. 依存関係のインストール
```
npm install
```

3. アプリケーションの起動
```
npm start
```

4. ブラウザで以下のURLにアクセス
```
http://localhost:12000
```

5. 「カメラを開始」ボタンをクリックしてカメラへのアクセスを許可

## 注意事項

- Chromeでの動作を確認しています
- カメラへのアクセス許可が必要です

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。