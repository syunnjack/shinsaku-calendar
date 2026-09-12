# shinsaku-cal.jp を当てる手順

**この順番を守る。飛ばさない。設定したら触らない。**

2026年9月に `guradol.jp` で失敗している。証明書が出ないので、カスタムドメインの
再設定・解除・Pages の再作成を5回以上繰り返した。**GitHub は設定を変えるたびに
「このドメインは追加されたばかりです」へ戻すため、発行処理が毎回振り出しに戻る。**
さらに `cname=""` を API で投げて Pages サイトごと消し、本番を10分落とした。
3日かけて開通しなかった。**原因は待てなかったことで、設定内容ではない。**

---

## 1. DNS を向ける（お名前.com 側）

A レコードを GitHub Pages の4つに向ける。

```
A  @  185.199.108.153
A  @  185.199.109.153
A  @  185.199.110.153
A  @  185.199.111.153
```

`www` の CNAME は任意。付けるなら `syunnjack.github.io`。
**これは阻害要因ではない。** 稼働中の darekore.jp も同じ設定で動いている。

## 2. 反映を待つ

```bash
python scripts/check-domain.py shinsaku-cal.jp
```

`GitHub Pages を向いている` と出るまで待つ。**反映前に Pages を設定しない。**
お名前.com の申請からレジストリ反映まで **1〜数時間**かかる。

## 3. ビルドのドメインを入れる

リポジトリの **Settings → Secrets and variables → Actions → Variables** に

```
SITE_DOMAIN = shinsaku-cal.jp
```

を追加する。**個別のファイルを書き換えない。** CNAME・canonical・サイトマップ・
OGP・連絡先メールは、すべてここから作られる。

## 4. デプロイする

`main` に push するか、Actions から `Deploy to GitHub Pages` を手で回す。
`dist/CNAME` が出るので、デプロイのたびにカスタムドメインが再適用される。

## 5. Settings → Pages でカスタムドメインを設定する

**Web UI から行う。API は使わない。**
`PUT /repos/.../pages -f cname=""` は Pages サイトごと消す。

## 6. 待つ。触らない。

証明書は `new`（発行待ち）から始まる。DNS が正しく向いていれば数分〜数時間で
`approved` になる。**24時間は何もしない。** この間に設定を変えると振り出しに戻る。

状態を見るのは `check-domain.py` だけにする。**これは読むだけで何も変えない。**

## 7. HTTPS を有効にする

`approved` になったら、Settings → Pages の **Enforce HTTPS** を入れる。

## 8. サイトマップの送信は HTTPS が開通してから

サイトマップの中身はすべて `https://` で書かれているので、開通前に送ると
全件が取得エラーになる。

---

## やってはいけないこと

- 証明書の発行待ちに、カスタムドメインを設定し直す
- `cname=""` を API で投げる
- 発行待ちの原因を推測して、正しく設定されている DNS レコードを消させる
- HTTP のまま放置する
