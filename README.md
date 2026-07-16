# nanapo_webapp

[ビット・トレード・ワン](https://bit-trade-one.co.jp/)社のUSB 7セグメントディスプレイ「[Nanapo (AD7SGPR)](https://bit-trade-one.co.jp/ad7sgpr/)」をブラウザから操作するWebアプリです。ビルド不要の静的サイトで、GitHub Pages（`/docs`）でそのまま公開できます。

## できること

- PCブラウザ・Androidブラウザから、USBで接続したNanapoへテキストボックスの文字列（最大8文字）をそのまま送信し、7セグディスプレイに表示させる
- `@CLR` / `@ANI` / `@7SG` / `@SGR` / `@BRI` / `@BRR` / `@HEX` など各種コマンドをボタンひとつで送信する
- Nanapo本体のボタンA（輝度）・B（7セグ表示ON/OFF）の操作状態をリアルタイムに表示する

## 対応環境

- **PC**: Google Chrome / Microsoft Edge などのChromium系ブラウザ（[Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) にネイティブ対応）
- **Android**: Chrome（[WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) 経由。Android版Chromeの Web Serial API はBluetoothシリアルのみの部分対応でUSBシリアルには使えないため、Android端末を検出した場合は常に [google/web-serial-polyfill](https://github.com/google/web-serial-polyfill) でWebUSB上にSerial互換のAPIを実装して利用します）
- HTTPS（またはlocalhost）での配信が必須です。GitHub Pagesはこれを満たします。
- Android端末の機種・OSによっては、標準のUSBシリアルドライバが先にデバイスを占有し、WebUSB経由で掴めない場合があります。その場合はブラウザからの接続に失敗します。

## 使い方

1. USBケーブルでNanapoをPCまたはAndroid端末に接続する
2. 公開されたページを開き、「接続」ボタンを押してデバイス選択ダイアログからNanapoを選ぶ
3. テキストボックスに表示したい文字列（英数字・記号、最大8文字）を入力し、「送信」ボタン（またはEnterキー）で送信する
4. 「各種コマンド」パネルのボタンを押すと、対応するコマンドがその場で送信される（`@HEX`は16桁の16進数を入力してから送信）
5. 「本体ボタン状態」パネルには、Nanapo本体のボタンA（輝度）・B（7セグ表示ON/OFF）を押したときの状態がリアルタイムに反映される。ボタンC/Dは応答フォーマットが非公開のため、コマンドの応答（`rxData:`で始まる行やエラーコード）ではない未知の受信内容として表示される

## 通信仕様

Nanapo (AD7SGPR) 側の仕様に合わせて、以下の固定パラメータで通信しています。

- 通信速度: 115200bps
- 改行コード: CRLF (`\r\n`)
- 送信した文字列がそのまま7セグディスプレイに表示されます（最大8文字）

詳細は [Bit Trade One 公式ドキュメント（AD7SGPR）](https://github.com/bit-trade-one/AD7SGPR) の `SendCommandSpecification.md` を参照してください。

## ローカルでの動作確認

`docs` ディレクトリを任意の静的サーバーで配信してください。

```sh
cd docs
python3 -m http.server 8080
```

`http://localhost:8080/` をChromeで開いて確認できます。

## ライセンス・クレジット

- Nanapo (AD7SGPR) はビット・トレード・ワン社の製品です。
- シリアル通信のポリフィルとして [google/web-serial-polyfill](https://github.com/google/web-serial-polyfill)（Apache License 2.0）を利用しています。
