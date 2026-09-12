"""FANZA の発売・配信予定を集める。

出典: DMM.com アフィリエイト Web サービス
      https://affiliate.dmm.com/api/

## 何を取るか

`digital/videoa` を**発売日で月ごとに区切って**なめる。offset に上限（50,000）が
あるため、まとめて取ろうとすると途中で止まる。darekore.jp / gravure-meikan.jp と
同じやり方。

取るのは **先月から3か月先まで**。カレンダーなので、古いものは要らない。
ただし**一度取った月のファイルは消さない**（公開したURLを落とさないため）。

## アフィリエイトIDについて

`FANZA_AFFILIATE_ID` が空なら、**素の作品ページURLを組み立てる**。
参加規約 第7条が「申請していないサイトでのID利用」を禁止行為としているため、
承認が下りるまでアフィリエイトIDを付けない。

承認後に Secrets へIDを入れて取り直すと、API が `affiliateURL` を返すので
そちらに切り替わる。**URLを手で書き換えない**（素材の改変にあたるため）。

## 出力

  data/schedule.json   月ごとの作品
  data/state.json      いつ取ったか

作品1本の中身:

  c  品番        t  題名          d  発売・配信日
  u  作品ページのURL              i  パッケージ画像のURL
  p  価格（税込・APIが返したもの） l  レーベル
  g  ジャンル（名前の配列）        a  出演者（名前の配列）

環境変数:
  FANZA_API_ID          必須
  FANZA_AFFILIATE_ID    空でよい（承認後に入れる）
  MONTHS_AHEAD          何か月先まで取るか（既定 3）
  MONTHS_BACK           何か月前まで取るか（既定 1）
"""
import calendar
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

BASE = 'https://api.dmm.com/affiliate/v3'
MAX_OFFSET = 50000
PAUSE = 0.6

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'

# **1フロアだけ見る。** digital/videoa が単品動画で、ダイレクト報酬の料率が
# いちばん高い（35%、キャンペーン中は70%）。フロアを増やすと枚数が増え、
# darekore.jp と同じ「大量の薄いページ」に戻る。
SERVICE = 'digital'
FLOOR = 'videoa'


def fetch(url: str, tries: int = 5, wait: float = 3.0) -> dict:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return json.loads(response.read().decode('utf-8', 'replace'))
        except Exception as error:
            if attempt == tries - 1:
                print(f'    あきらめます: {error}', file=sys.stderr)
                return {}
            time.sleep(wait * (attempt + 1))
    return {}


def month_range(months_back: int, months_ahead: int) -> list:
    """先月から3か月先まで、YYYY-MM の一覧を作る。"""
    today = date.today()
    out = []

    for step in range(-months_back, months_ahead + 1):
        month = today.month + step
        year = today.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        out.append(f'{year:04d}-{month:02d}')

    return out


def month_bounds(label: str) -> tuple:
    year, month = (int(x) for x in label.split('-'))
    last = calendar.monthrange(year, month)[1]
    return f'{year:04d}-{month:02d}-01', f'{year:04d}-{month:02d}-{last:02d}'


def names(block, key: str) -> list:
    """iteminfo の中身を名前だけにする。API が返す形が不揃いなので受け止める。"""
    rows = (block or {}).get(key) or []
    out = []

    for row in rows:
        name = (row or {}).get('name') if isinstance(row, dict) else row
        if name and name not in out:
            out.append(str(name))

    return out


def tidy(item: dict, affiliate_id: str) -> dict:
    """API の返しから、ページに出すものだけを抜く。**推測で足さない。**"""
    info = item.get('iteminfo') or {}
    prices = item.get('prices') or {}

    # アフィリエイトIDが無いときは素のURL。**申請していないIDを使わない。**
    url = item.get('affiliateURL') if affiliate_id else item.get('URL')

    labels = names(info, 'label')

    # **定価と実売価格の両方を持つ。** 差があるものが「いま割引されているもの」。
    # 割引率はこちらで計算するが、**元になる2つの数字は API が返したものだけ**を使う。
    return {
        'c': item.get('content_id') or '',
        't': item.get('title') or '',
        'd': (item.get('date') or '')[:10],
        'u': url or item.get('URL') or '',
        'i': ((item.get('imageURL') or {}).get('large')
              or (item.get('imageURL') or {}).get('small') or ''),
        'p': str(prices.get('price') or ''),
        'lp': str(prices.get('list_price') or ''),
        'l': labels[0] if labels else '',
        'g': names(info, 'genre'),
        'a': names(info, 'actress'),
    }


def take_month(cred: dict, label: str) -> list:
    gte, lte = month_bounds(label)
    items = []
    offset = 1
    total = None

    while True:
        params = dict(cred, output='json', site='FANZA', service=SERVICE,
                      floor=FLOOR, hits=100, sort='date',
                      gte_date=f'{gte}T00:00:00', lte_date=f'{lte}T23:59:59',
                      offset=offset)

        payload = fetch(f'{BASE}/ItemList?' + urllib.parse.urlencode(params)).get('result', {})

        if total is None:
            total = int(payload.get('total_count') or 0)

        got = payload.get('items') or []
        if not got:
            break

        items.extend(got)
        offset += 100
        time.sleep(PAUSE)

        if offset > min(total or 0, MAX_OFFSET):
            break

    return items


def main() -> None:
    api_id = os.environ.get('FANZA_API_ID', '').strip()
    affiliate_id = os.environ.get('FANZA_AFFILIATE_ID', '').strip()

    if not api_id:
        print('環境変数 FANZA_API_ID が必要です。', file=sys.stderr)
        raise SystemExit(1)

    if not affiliate_id:
        print('FANZA_AFFILIATE_ID が空です。**素の作品URLで作ります**'
              '（サイト審査が通るまでは、これが正しい状態）。')

    # API は affiliate_id を必須にしている。**リンクに使うかどうかは別問題**で、
    # 空のときは返ってきた affiliateURL を使わず URL のほうを採る。
    cred = {'api_id': api_id, 'affiliate_id': affiliate_id or 'none-0'}

    months_back = int(os.environ.get('MONTHS_BACK', '1'))
    months_ahead = int(os.environ.get('MONTHS_AHEAD', '3'))

    DATA.mkdir(exist_ok=True)

    # **前に取ったものを土台にする。** 取れなかった月を空にしない
    # （公開したURLを落とさないため）。
    try:
        book = json.loads((DATA / 'schedule.json').read_text(encoding='utf-8'))
        months = book.get('months') or {}
    except Exception:
        months = {}

    for label in month_range(months_back, months_ahead):
        raw = take_month(cred, label)
        rows = [tidy(item, affiliate_id) for item in raw]
        rows = [row for row in rows if row['c'] and row['t'] and row['d']]
        rows.sort(key=lambda row: (row['d'], row['t']))

        if not rows and label in months:
            print(f'{label}: 0件だったので、前に取ったぶんを残します')
            continue

        months[label] = rows
        print(f'{label}: {len(rows):,}件')

    out = {
        'confirmedOn': date.today().isoformat(),
        'source': 'DMM.com アフィリエイト Web サービス（FANZA digital/videoa）',
        'sourceUrl': 'https://affiliate.dmm.com/api/',
        'affiliate': bool(affiliate_id),
        'months': dict(sorted(months.items())),
    }

    (DATA / 'schedule.json').write_text(
        json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    total = sum(len(rows) for rows in months.values())
    print(f'合計 {total:,}件 / {len(months)}か月ぶん')


if __name__ == '__main__':
    main()
