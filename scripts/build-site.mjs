/**
 * 発売・配信予定のカレンダーを組み立てる。
 *
 * **ページ数を3桁に抑える。** darekore.jp は 59,445ページを作って、
 * そのうち 21,147件を Google が取りに来なかった。作品1本につき1ページは作らない。
 *
 * ドメインは `SITE_DOMAIN` 1箇所だけで決まる。CNAME・canonical・サイトマップ・
 * OGP・連絡先メールはすべてここから作る。個別のファイルを書き換えない。
 */
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data')
const outDir = path.join(root, 'dist')

// **ドメインが決まるまでは github.io で動かす。** 独自ドメインを当てるときに
// `SITE_DOMAIN` を入れれば、CNAME・canonical・サイトマップ・連絡先が一斉に切り替わる。
const SITE_DOMAIN = process.env.SITE_DOMAIN || ''
const FALLBACK_HOST = 'syunnjack.github.io/shinsaku-calendar'

const SITE_URL = SITE_DOMAIN ? `https://${SITE_DOMAIN}` : `https://${FALLBACK_HOST}`
const SITE_NAME = '新作カレンダー'
const CONTACT = SITE_DOMAIN ? `info@${SITE_DOMAIN}` : 'syunnjack@gmail.com'

/** 1ページに並べる上限。**これを超えたら分ける。**
 *  hoiku-map.jp で一覧に全件を描いてトップが38MBになった前例がある。 */
const PAGE_SIZE = 600

/** 入口を作る下限。**少ないものはページにしない。**
 *  中身の薄いページを増やすと、Google が取りに来なくなる。 */
const MIN_GENRE = 20
const MIN_LABEL = 15

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function slugify(name) {
  return String(name ?? '').trim().replace(/[\/\\?#]/g, '-').replace(/\s+/g, '-')
}

function jpDate(iso) {
  const [y, m, d] = String(iso).split('-')
  return `${Number(y)}年${Number(m)}月${Number(d)}日`
}

function monthLabel(label) {
  const [y, m] = String(label).split('-')
  return `${Number(y)}年${Number(m)}月`
}

/** 曜日。カレンダーなので、何曜日に出るかは読む人の役に立つ。 */
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
function weekday(iso) {
  return WEEK[new Date(`${iso}T00:00:00+09:00`).getDay()] ?? ''
}

const PAGE_CSS = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  background:#f7f8fb; color:#1b1f2a; line-height:1.75; }
.wrap { max-width:980px; margin:0 auto; padding:20px 16px 64px; }
.site-head { border-bottom:1px solid #e2e6ef; padding-bottom:10px; margin-bottom:14px; }
.site-name { font-weight:700; color:#2b4d7e; text-decoration:none; font-size:17px; }
.crumbs { font-size:13px; color:#6b7280; margin:0 0 14px; }
.crumbs a { color:#2b4d7e; }
h1 { font-size:23px; margin:0 0 6px; }
h2 { font-size:18px; margin:30px 0 10px; border-top:1px solid #e2e6ef; padding-top:14px; }
h3 { font-size:15px; margin:20px 0 8px; color:#4b5563; }
.lead { margin:0 0 16px; }
.note { font-size:13px; color:#6b7280; margin:6px 0 0; }
.pr { display:inline-block; font-size:11px; color:#6b7280; border:1px solid #d7dbe4;
  border-radius:4px; padding:1px 6px; margin-left:8px; vertical-align:middle; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0; }
.chips a { font-size:13px; color:#2b4d7e; text-decoration:none; border:1px solid #dfe3ec;
  border-radius:18px; padding:4px 12px; background:#fff; }
.chip-count { margin-left:6px; color:#8a909c; font-size:12px; }
.day { font-size:15px; font-weight:700; margin:26px 0 8px; color:#2b4d7e; }
.works { list-style:none; padding:0; margin:0; display:grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap:14px; }
.works li a { display:block; color:inherit; text-decoration:none; }
/* 表紙は枠に合わせて縮めるだけ。**切り抜かない。**
   DMM の画像利用の基本ルールが「拡大・縮小のみ可。その他の加工（切り抜き等）は
   ご遠慮ください」としているため。cover にすると横長の画像が左右で切れる。 */
.works img, .works .no-cover { display:block; width:100%; aspect-ratio:16/11;
  object-fit:contain; background:#fff; border:1px solid #e2e6ef; border-radius:6px; }
.work-title { display:block; font-size:13px; margin-top:6px; }
.work-meta { display:block; font-size:12px; color:#6b7280; margin-top:2px; }
.campaigns { list-style:none; padding:0; margin:10px 0 0; }
.campaigns li { border:1px solid #dfe3ec; border-radius:8px; padding:10px 14px; margin-bottom:8px; background:#fff; }
.pager { display:flex; gap:10px; flex-wrap:wrap; margin:22px 0 0; font-size:14px; }
.pager a, .pager span { border:1px solid #dfe3ec; border-radius:6px; padding:5px 12px;
  background:#fff; text-decoration:none; color:#2b4d7e; }
.pager span { color:#9aa1ad; }
footer { margin-top:44px; border-top:1px solid #e2e6ef; padding-top:14px; font-size:13px; color:#6b7280; }
footer a { color:#2b4d7e; }
.adult { font-weight:700; color:#8b4054; }
.site-nav { display:flex; flex-wrap:wrap; gap:12px; margin:10px 0; }
@media (prefers-color-scheme: dark) {
  body { background:#12151c; color:#e8eaf0; }
  .chips a, .works img, .works .no-cover, .pager a, .pager span, .campaigns li { background:#1a1e27; border-color:#262b36; }
  .site-head, h2, footer { border-color:#262b36; }
}
`

/**
 * 割引率。**定価と実売価格の差から計算する。**
 *
 * どちらも API が返した数字で、こちらが決めた値は入っていない。
 * 差が無ければ 0 を返し、呼び出し側は何も出さない。
 * **「お得」「激安」のような評価の言葉は使わない。** 数字だけを出す。
 */
function discount(work) {
  const price = Number(work.p)
  const list = Number(work.lp)
  if (!price || !list || list <= price) return 0
  return Math.round((1 - price / list) * 100)
}

/** 作品を表紙つきで並べる。**リンク先は作品ページ。画像は権利者が返したURL。** */
function renderWorks(works, affiliate) {
  if (!works?.length) return ''

  const items = works.map((work) => {
    const cover = work.i
      ? `<img src="${escapeHtml(work.i)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="160" height="110" />`
      : '<span class="no-cover"></span>'

    // 出演者も出す。**商品情報（題名・出演者名など）の掲載に制限は無い**と
    // DMM の画像利用の制限に明記されている。ただし人ごとのページは作らない
    // （名鑑の作り直しにしないため）。
    const cast = (work.a ?? []).slice(0, 3).join('、')
    const off = discount(work)
    const price = work.p
      ? (off
        ? `${Number(work.lp).toLocaleString('ja-JP')}円 → ${Number(work.p).toLocaleString('ja-JP')}円（${off}%引き）`
        : `${Number(work.p).toLocaleString('ja-JP')}円`)
      : ''
    const meta = [cast, work.l, price].filter(Boolean).join('／')

    // 承認が下りるまでは素のURL。**申請していないIDを使わない**（参加規約 第7条）。
    const rel = affiliate ? 'nofollow sponsored noopener' : 'nofollow noopener'

    return `<li><a href="${escapeHtml(work.u)}" target="_blank" rel="${rel}">`
      + cover
      + `<span class="work-title">${escapeHtml(work.t)}</span>`
      + (meta ? `<span class="work-meta">${escapeHtml(meta)}</span>` : '')
      + '</a></li>'
  }).join('')

  return `<ul class="works">${items}</ul>`
}

/** 日付ごとに見出しを立てて並べる。カレンダーなので、日付が主役。 */
function renderByDay(works, affiliate) {
  const byDay = new Map()
  for (const work of works) {
    if (!byDay.has(work.d)) byDay.set(work.d, [])
    byDay.get(work.d).push(work)
  }

  return [...byDay.entries()]
    .map(([day, rows]) => `<h3 class="day">${escapeHtml(jpDate(day))}（${weekday(day)}）`
      + `<span class="chip-count">${rows.length.toLocaleString('ja-JP')}件</span></h3>`
      + renderWorks(rows, affiliate))
    .join('')
}

function shell({ title, description, canonical, crumbs, body, schema }) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="rating" content="adult" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    ${schema ? `<script type="application/ld+json">${jsonLd(schema)}</script>` : ''}
    <link rel="stylesheet" href="/assets/page.css" />
  </head>
  <body>
    <div class="wrap">
      <header class="site-head"><a class="site-name" href="/">${escapeHtml(SITE_NAME)}</a></header>
      <nav class="crumbs">${crumbs}</nav>
      ${body}
      <footer>
        <p class="adult">このサイトは18歳未満の方に向けたものではありません。</p>
        <nav class="site-nav">
          <a href="/">トップ</a>
          <a href="/sale/">いま割引されているもの</a>
          <a href="/month/">月から探す</a>
          <a href="/genre/">ジャンルから探す</a>
          <a href="/label/">レーベルから探す</a>
          <a href="/about/">このサイトについて</a>
          <a href="/privacy/">プライバシーポリシー</a>
        </nav>
        <p>掲載内容の訂正・削除のご依頼は <a href="mailto:${CONTACT}">${CONTACT}</a> へご連絡ください。確認のうえ対応します。</p>
      </footer>
    </div>
  </body>
</html>
`
}

/** 一覧を PAGE_SIZE ごとに分ける。1ページに全件描くと数十MBになる。 */
function paginate(rows) {
  const pages = []
  for (let at = 0; at < rows.length; at += PAGE_SIZE) pages.push(rows.slice(at, at + PAGE_SIZE))
  return pages.length ? pages : [[]]
}

function pager(base, page, pages) {
  if (pages <= 1) return ''

  const link = (n, label) => n === page
    ? `<span>${label}</span>`
    : `<a href="${n === 1 ? base : `${base}${n}/`}">${label}</a>`

  return `<nav class="pager">${Array.from({ length: pages }, (_, i) => link(i + 1, `${i + 1}`)).join('')}</nav>`
}

/**
 * 独自ドメインがまだ無いときは、GitHub Pages のプロジェクトURLが
 * `.../shinsaku-calendar/` という**サブパス**になる。
 * ページ内のリンクは `/month/` のように絶対パスで書いてあるので、
 * そのままだと全部 404 になる。**書き出すときにまとめて前置きする。**
 *
 * 外部リンクは `http` で始まるので当たらない。ドメインを当てたら
 * `BASE` が空になり、何も足さなくなる。
 */
const BASE = SITE_DOMAIN ? '' : '/shinsaku-calendar'

function rebase(html) {
  return BASE ? html.replace(/(href|src)="\//g, `$1="${BASE}/`) : html
}

async function write(dir, html) {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), rebase(html), 'utf8')
}

async function main() {
  // **データが無くても最後まで作る。** ここで return すると dist ができず、
  // デプロイのワークフローが「artifact が無い」で失敗する。
  // 中身が空のサイトが出るだけで、壊れはしない。
  let book = { months: {} }
  try {
    book = JSON.parse(await readFile(path.join(dataDir, 'schedule.json'), 'utf8'))
  } catch {
    console.log('データがまだありません。**空のまま組み立てます**'
      + '（取得を走らせれば中身が入ります）。')
  }

  const months = book.months ?? {}
  const affiliate = Boolean(book.affiliate)
  const confirmedOn = book.confirmedOn || new Date().toISOString().slice(0, 10)
  const all = Object.values(months).flat()
  const today = new Date().toISOString().slice(0, 10)

  if (!affiliate) {
    console.log('**アフィリエイトIDが入っていないデータです。** '
      + '素の作品URLで作ります（サイト審査が通るまでは、これが正しい状態）。')
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(path.join(outDir, 'assets'), { recursive: true })
  await writeFile(path.join(outDir, 'assets/page.css'), PAGE_CSS, 'utf8')
  // **独自ドメインが決まるまで CNAME を書かない。** 空の CNAME を置くと
  // Pages のサイトごと落ちる（guradol で一度やっている）。
  if (SITE_DOMAIN) await writeFile(path.join(outDir, 'CNAME'), `${SITE_DOMAIN}\n`, 'utf8')

  const urls = [`${SITE_URL}/`]

  // 出典の書き方。**どのページにも同じものを出す。**
  const sourceNote = `<p class="note">出典: <a href="${escapeHtml(book.sourceUrl || 'https://affiliate.dmm.com/api/')}"`
    + ` target="_blank" rel="noopener">${escapeHtml(book.source || 'DMM.com アフィリエイト Web サービス')}</a>`
    + `（${escapeHtml(confirmedOn)} 取得）。発売日・題名・レーベル・ジャンル・出演者は、`
    + `API が公開しているものをそのまま出しています。当サイトによる評価や順位付けはしていません。</p>`

  const adNote = affiliate
    ? '<p class="note">作品へのリンクはアフィリエイトリンクです。'
      + '<span class="pr">広告</span></p>'
    : ''

  // ---- 月別・旬別 ------------------------------------------------------------
  // **過去の月も消さない。** 出典から消えたらページごと消す作りにして、
  // darekore.jp で404が119件出た。一度公開したURLは残す。
  //
  // **10日区切りのページも作る。** 2026-09-12 に「AV 新作 発売予定」で
  // 検索したところ、FANZA 公式の発売日カレンダーが
  // 「09月 1日～10日」「09月 21日～30日」という**10日区切りのページ**で
  // 2つとも上位に出ていた。月まるごとより、この粒度が探されている。
  // 月3枚 × 収録月数なので、ページ数は3桁に収まる。
  const monthKeys = Object.keys(months).sort()

  /** その月を10日ごとに3つに割る。末日が31日でも30日でも3つ目に入れる。 */
  const TENS = [
    { slug: '1-10', from: 1, to: 10 },
    { slug: '11-20', from: 11, to: 20 },
    { slug: '21-31', from: 21, to: 31 },
  ]

  const tenLabel = (label, span) => {
    const [, month] = label.split('-')
    return `${monthLabel(label)} ${span.from}日〜${span.to}日`
  }

  for (const label of monthKeys) {
    const rows = months[label]
    const pages = paginate(rows)

    for (let page = 1; page <= pages.length; page += 1) {
      const base = `/month/${label}/`
      const canonical = `${SITE_URL}${page === 1 ? base : `${base}${page}/`}`
      const dir = page === 1
        ? path.join(outDir, 'month', label)
        : path.join(outDir, 'month', label, String(page))

      const days = new Set(rows.map((row) => row.d)).size
      const title = `${monthLabel(label)}に出るアダルト動画 ${rows.length.toLocaleString('ja-JP')}本｜${SITE_NAME}`
      const description = `${monthLabel(label)}に発売・配信されるFANZAの単品動画 ${rows.length.toLocaleString('ja-JP')}本を、`
        + `発売日の順に並べています（${days}日ぶん）。`

      await write(dir, shell({
        title,
        description,
        canonical,
        crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ <a href="/month/">月から探す</a> ＞ ${escapeHtml(monthLabel(label))}`,
        body: `<h1>${escapeHtml(monthLabel(label))}に出るもの</h1>
          <p class="lead">${escapeHtml(description)}${pages.length > 1 ? `${page}ページ目です。` : ''}</p>
          ${adNote}
          <div class="chips">${TENS.map((span) =>
            `<a href="/month/${escapeHtml(label)}/${span.slug}/">${span.from}日〜${span.to}日</a>`).join('')}</div>
          ${renderByDay(pages[page - 1], affiliate)}
          ${pager(base, page, pages.length)}
          ${sourceNote}`,
      }))

      urls.push(canonical)
    }

    // 10日区切り。**その区間に1本も無ければページを作らない。**
    for (const span of TENS) {
      const slice = rows.filter((row) => {
        const day = Number(String(row.d).slice(8, 10))
        return day >= span.from && day <= span.to
      })

      if (!slice.length) continue

      const base = `/month/${label}/${span.slug}/`
      const canonical = `${SITE_URL}${base}`
      const days = new Set(slice.map((row) => row.d)).size
      const name = tenLabel(label, span)

      const description = `${name}に発売・配信されるFANZAの単品動画 `
        + `${slice.length.toLocaleString('ja-JP')}本を、発売日の順に並べています（${days}日ぶん）。`

      await write(path.join(outDir, 'month', label, span.slug), shell({
        title: `${name}に出るアダルト動画 ${slice.length.toLocaleString('ja-JP')}本｜${SITE_NAME}`,
        description,
        canonical,
        crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ <a href="/month/">月から探す</a>`
          + ` ＞ <a href="/month/${escapeHtml(label)}/">${escapeHtml(monthLabel(label))}</a> ＞ ${span.from}日〜${span.to}日`,
        body: `<h1>${escapeHtml(name)}に出るもの</h1>
          <p class="lead">${escapeHtml(description)}</p>
          ${adNote}
          ${renderByDay(slice.slice(0, PAGE_SIZE), affiliate)}
          <h2>同じ月のほかの期間</h2>
          <div class="chips">${TENS.filter((other) => other.slug !== span.slug)
            .map((other) => `<a href="/month/${escapeHtml(label)}/${other.slug}/">${other.from}日〜${other.to}日</a>`)
            .join('')}<a href="/month/${escapeHtml(label)}/">${escapeHtml(monthLabel(label))}のすべて</a></div>
          ${sourceNote}`,
      }))

      urls.push(canonical)
    }
  }

  // 月の入口
  await write(path.join(outDir, 'month'), shell({
    title: `月から探す｜${SITE_NAME}`,
    description: `${monthKeys.length}か月ぶんの発売・配信予定を、月ごとにまとめています。`,
    canonical: `${SITE_URL}/month/`,
    crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ 月から探す`,
    body: `<h1>月から探す</h1>
      <p class="lead">${monthKeys.length}か月ぶんを収録しています。過去の月も残しています。</p>
      <div class="chips">${monthKeys.slice().reverse().map((label) =>
        `<a href="/month/${escapeHtml(label)}/">${escapeHtml(monthLabel(label))}`
        + `<span class="chip-count">${months[label].length.toLocaleString('ja-JP')}</span></a>`).join('')}</div>
      ${sourceNote}`,
  }))
  urls.push(`${SITE_URL}/month/`)

  // ---- ジャンル別・レーベル別 ------------------------------------------------
  const group = (key, min) => {
    const map = new Map()

    for (const work of all) {
      const values = key === 'g' ? (work.g ?? []) : (work.l ? [work.l] : [])
      for (const value of values) {
        if (!map.has(value)) map.set(value, [])
        map.get(value).push(work)
      }
    }

    return [...map.entries()]
      .filter(([, rows]) => rows.length >= min)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'))
  }

  const sets = [
    ['genre', 'ジャンル', group('g', MIN_GENRE)],
    ['label', 'レーベル', group('l', MIN_LABEL)],
  ]

  for (const [kind, label, entries] of sets) {
    for (const [name, rows] of entries) {
      const slug = slugify(name)
      const sorted = [...rows].sort((a, b) => b.d.localeCompare(a.d) || a.t.localeCompare(b.t, 'ja'))
      const shown = sorted.slice(0, PAGE_SIZE)
      const canonical = `${SITE_URL}/${kind}/${encodeURI(slug)}/`

      const description = `${label}「${name}」の作品 ${rows.length.toLocaleString('ja-JP')}本を、`
        + `発売日の新しい順に並べています。${rows.length > PAGE_SIZE
          ? `そのうち新しい ${PAGE_SIZE.toLocaleString('ja-JP')}本です。` : ''}`

      await write(path.join(outDir, kind, slug), shell({
        title: `${name}の新作・発売予定 ${rows.length.toLocaleString('ja-JP')}本｜${SITE_NAME}`,
        description,
        canonical,
        crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ <a href="/${kind}/">${escapeHtml(label)}から探す</a> ＞ ${escapeHtml(name)}`,
        body: `<h1>${escapeHtml(name)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
          ${adNote}
          ${renderByDay(shown, affiliate)}
          ${sourceNote}`,
      }))

      urls.push(canonical)
    }

    await write(path.join(outDir, kind), shell({
      title: `${label}から探す｜${SITE_NAME}`,
      description: `作品数が ${kind === 'genre' ? MIN_GENRE : MIN_LABEL}本以上の${label}だけを並べています。`,
      canonical: `${SITE_URL}/${kind}/`,
      crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ ${escapeHtml(label)}から探す`,
      body: `<h1>${escapeHtml(label)}から探す</h1>
        <p class="lead">収録している ${all.length.toLocaleString('ja-JP')}本を${label}で数えました。
          <strong>${kind === 'genre' ? MIN_GENRE : MIN_LABEL}本以上あるものだけ</strong>を出しています。
          中身の薄いページを増やさないためです。</p>
        <div class="chips">${entries.map(([name, rows]) =>
          `<a href="/${kind}/${encodeURI(slugify(name))}/">${escapeHtml(name)}`
          + `<span class="chip-count">${rows.length.toLocaleString('ja-JP')}</span></a>`).join('')}</div>
        ${sourceNote}`,
    }))
    urls.push(`${SITE_URL}/${kind}/`)

    console.log(`${label}: ${entries.length}件`)
  }

  // ---- セール ---------------------------------------------------------------
  // **割引は「定価と実売価格に差があるもの」だけ。** 「お得」「激安」のような
  // 評価は書かない。数字はどちらも API が返したもの。
  const onSale = all.filter((work) => discount(work) > 0)
    .sort((a, b) => discount(b) - discount(a) || a.d.localeCompare(b.d))
    .slice(0, PAGE_SIZE)

  // 公式メルマガに書いてあったキャンペーン。**期間内のものだけ出す。**
  // 期間が過ぎたものは自動で消えるので、ファイルからは消さなくてよい。
  let campaigns = []
  try {
    const file = JSON.parse(await readFile(path.join(dataDir, 'campaigns.json'), 'utf8'))
    campaigns = (file.campaigns ?? []).filter((row) => !row.to || row.to >= today)
      .sort((a, b) => String(a.to || '').localeCompare(String(b.to || '')))
  } catch {
    console.log('キャンペーンのファイルが読めないので、そのぶんは出しません。')
  }

  const campaignHtml = campaigns.length
    ? `<h2>開催中のセール・キャンペーン<span class="pr">広告</span></h2>
      <ul class="campaigns">${campaigns.map((row) => {
        const span = [row.from ? jpDate(row.from) : '', row.to ? jpDate(row.to) : '']
          .filter(Boolean).join(' 〜 ')
        const name = row.url
          ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="${affiliate ? 'nofollow sponsored noopener' : 'nofollow noopener'}">${escapeHtml(row.name)}</a>`
          : escapeHtml(row.name)
        return `<li><strong>${name}</strong>`
          + (span ? `<span class="work-meta">${escapeHtml(span)}</span>` : '')
          + (row.note ? `<span class="work-meta">${escapeHtml(row.note)}</span>` : '')
          + '</li>'
      }).join('')}</ul>
      <p class="note">DMM の公式のお知らせに書かれていたものだけを載せています。
        内容と期間は公式ページでご確認ください。</p>`
    : ''

  if (onSale.length || campaigns.length) {
    const description = onSale.length
      ? `定価より安くなっているFANZAの単品動画 ${onSale.length.toLocaleString('ja-JP')}本を、割引率の高い順に並べています。`
      : '開催中のセール・キャンペーンをまとめています。'

    await write(path.join(outDir, 'sale'), shell({
      title: `いま割引されているもの｜${SITE_NAME}`,
      description,
      canonical: `${SITE_URL}/sale/`,
      crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ いま割引されているもの`,
      body: `<h1>いま割引されているもの</h1>
        <p class="lead">${escapeHtml(description)}
          割引率は<strong>APIが返した定価と販売価格の差</strong>から計算したものです。
          当サイトが「お得かどうか」を判断したものではありません。</p>
        ${campaignHtml}
        ${adNote}
        ${onSale.length ? `<h2>割引率の高い順</h2>${renderWorks(onSale, affiliate)}` : ''}
        ${sourceNote}`,
    }))

    urls.push(`${SITE_URL}/sale/`)
    console.log(`割引: ${onSale.length.toLocaleString('ja-JP')}本 / キャンペーン ${campaigns.length}件`)
  }

  // ---- トップ ---------------------------------------------------------------
  // **これから出るものだけを出す。** カレンダーなので、過ぎたものは月別に置く。
  const upcoming = all.filter((work) => work.d >= today)
    .sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t, 'ja'))
    .slice(0, PAGE_SIZE)

  const latest = all.filter((work) => work.d < today)
    .sort((a, b) => b.d.localeCompare(a.d) || a.t.localeCompare(b.t, 'ja'))
    .slice(0, 60)

  const topDescription = upcoming.length
    ? `これから発売・配信されるFANZAの単品動画 ${upcoming.length.toLocaleString('ja-JP')}本を、`
      + `発売日の順に並べています。${confirmedOn} 時点のデータです。`
    : `FANZAの単品動画 ${all.length.toLocaleString('ja-JP')}本を、発売日の順に並べています。`

  await write(outDir, shell({
    title: `${SITE_NAME}｜FANZAの発売・配信予定を日付から`,
    description: topDescription,
    canonical: `${SITE_URL}/`,
    crumbs: `${escapeHtml(SITE_NAME)}`,
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: topDescription,
    },
    body: `<h1>これから出るもの</h1>
      <p class="lead">${escapeHtml(topDescription)}</p>
      ${adNote}
      ${renderByDay(upcoming, affiliate)}
      ${latest.length ? `<h2>直前に出たもの</h2>${renderByDay(latest, affiliate)}` : ''}
      <h2>ほかの探し方</h2>
      <div class="chips"><a href="/sale/">いま割引されているもの</a><a href="/month/">月から探す</a><a href="/genre/">ジャンルから探す</a><a href="/label/">レーベルから探す</a></div>
      ${sourceNote}`,
  }))

  // ---- 固定ページ -----------------------------------------------------------
  await write(path.join(outDir, 'about'), shell({
    title: `このサイトについて｜${SITE_NAME}`,
    description: 'このサイトが載せているもの・載せていないもの、出典、削除依頼の窓口について。',
    canonical: `${SITE_URL}/about/`,
    crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ このサイトについて`,
    body: `<h1>このサイトについて</h1>
      <p class="lead">FANZA の単品動画について、<strong>これから出るものを日付から引く</strong>ためのカレンダーです。</p>
      <h2>載せているもの</h2>
      <p>題名・品番・発売日・レーベル・ジャンル・出演者・価格・パッケージ画像。
        いずれも DMM.com アフィリエイト Web サービスが公開しているものです。</p>
      <h2>載せていないもの</h2>
      <p><strong>出典で確認できないことは書きません。</strong>
        当サイトによる評価・順位付け・おすすめはしていません。
        出演者の身体的特徴・所属・経歴も、出典に無いものは書きません。
        利用者による投稿機能は置いていません。</p>
      <h2>数え方</h2>
      <p>件数は、API が返した作品の数です。同じ作品が別の品番で複数あることがあり、
        その場合は別の件数として数えています。</p>
      <h2>訂正・削除のご依頼</h2>
      <p>ご本人および関係者の方から掲載を希望しない旨のご連絡をいただいた場合、確認のうえ削除します。
        記載内容の誤りについても同じ窓口で承ります。
        <a href="mailto:${CONTACT}">${CONTACT}</a></p>
      ${sourceNote}`,
  }))
  urls.push(`${SITE_URL}/about/`)

  await write(path.join(outDir, 'privacy'), shell({
    title: `プライバシーポリシー｜${SITE_NAME}`,
    description: 'アクセス情報の扱いと、第三者配信の広告について。',
    canonical: `${SITE_URL}/privacy/`,
    crumbs: `<a href="/">${escapeHtml(SITE_NAME)}</a> ＞ プライバシーポリシー`,
    body: `<h1>プライバシーポリシー</h1>
      <h2>1. アクセス情報</h2>
      <p>当サイトは静的なページのみで構成され、フォームや会員登録はありません。
        利用者から個人情報を直接お預かりすることはありません。</p>
      <h2>2. 外部サイトへのリンク</h2>
      <p>作品へのリンクは、DMM.com（FANZA）の作品ページへ繋がります。
        リンク先での取り扱いは、各サイトの方針に従います。</p>
      <h2>3. アフィリエイトプログラム</h2>
      <p>当サイトは DMM.com アフィリエイトに参加しています。
        作品へのリンクを経由して購入された場合、当サイトに紹介料が支払われることがあります。
        その旨は「広告」と表示しています。</p>
      <h2>4. お問い合わせ</h2>
      <p><a href="mailto:${CONTACT}">${CONTACT}</a></p>`,
  }))
  urls.push(`${SITE_URL}/privacy/`)

  // ---- robots / sitemap ------------------------------------------------------
  await writeFile(path.join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'utf8')

  await writeFile(path.join(outDir, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((url) => `  <url><loc>${url}</loc><lastmod>${confirmedOn}</lastmod></url>`).join('\n')
    + '\n</urlset>\n', 'utf8')

  console.log(`収録 ${all.length.toLocaleString('ja-JP')}本 / ${monthKeys.length}か月`)
  console.log(`ページ: ${urls.length.toLocaleString('ja-JP')}件`)
}

main()
