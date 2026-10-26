"""SecOwl のカラートークンを作る。

値はすべてデジタル庁デザインシステムのプリミティブカラー（dads.py）から選び、
WCAG のコントラスト比と、色覚タイプごとの見えの差を確かめてから書き出す。
確かめに通らない組み合わせがあれば、その場で止まる。

使い方: python3 gen_tokens.py [出力先 tokens.css] [--data 検証値.json]
必要なもの（開発時だけ。アプリの依存には入れない）: pip install colorspacious numpy
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from colour import CVD, cr, dE, dE_gray, dE_min, pick
from dads import BLACK, DADS, WHITE, gray, p

MODES = ('L', 'D')
SEV_KEYS = ('critical', 'high', 'medium', 'low', 'info')

# ---------------------------------------------------------------- 面
# ライトは「灰色の台に白い紙」。ダークは Solid Gray の暗い側（950・850 は dads.py の拡張）。
SURFACE = {
    'L': dict(bg=gray(100), card=WHITE, card_sub=gray(50), overlay=WHITE),
    'D': dict(bg=gray(950), card=gray(900), card_sub=gray(850), overlay=gray(800)),
}
SURF = lambda m: [SURFACE[m][k] for k in ('bg', 'card', 'card_sub', 'overlay')]

# ---------------------------------------------------------------- 文字・線
# 注記文字を探す順。面に近い側（ライトは薄い側、ダークは暗い側）から見て、最初に 4.5 を満たす段を使う。
STEPS_TEXT = {'L': (500, 536, 600, 700, 800), 'D': (400, 300, 100)}
TEXT = {
    'L': dict(text=gray(900), text_sub=gray(700)),
    'D': dict(text=gray(50), text_sub=gray(200)),
}
for m in MODES:
    # 補助のさらに下の文字。4 つの面すべてで 4.5 以上を保てる、いちばん面に近い段。
    steps = [(s, gray(s)) for s in STEPS_TEXT[m] if gray(s) not in TEXT[m].values()]
    step, value = pick(steps, lambda c: min(cr(c, s) for s in SURF(m)) >= 4.5)
    TEXT[m]['text_muted'] = value
    TEXT[m]['text_muted_step'] = step

BORDER = {'L': dict(border=gray(200)), 'D': dict(border=gray(700))}
for m in MODES:
    # 操作部品の境界。図形の規定（1.4.11）どおり、4 つの面すべてで 3:1 以上。
    # 注記文字と同じく、面に近い側から見て最初に満たした段を使う（必要以上に強い線にしない）。
    steps = [(s, gray(s)) for s in ((420, 500, 600, 700) if m == 'L' else (500, 400, 300))]
    step, value = pick(steps, lambda c: min(cr(c, s) for s in SURF(m)) >= 3.0)
    BORDER[m]['border_strong'] = value
    BORDER[m]['border_strong_step'] = step

# ---------------------------------------------------------------- 基調色（キーカラー = Blue）
KEY = {
    'L': dict(primary=p('blue', 900), on_primary=WHITE, primary_hover=p('blue', 1000), primary_pressed=p('blue', 1100),
              selected_bg=p('blue', 50), selected_text=p('blue', 1000),
              current_bg=p('blue', 100), current_text=p('blue', 1000), current_bar=p('blue', 900),
              info_bg=p('blue', 50), info_text=p('blue', 1000),
              focus=p('blue', 900),
              inverse_surface=gray(900), on_inverse_surface=gray(50)),
    # 暗い画面では、押せるものを明るい側へ寄せる（押すと明るくなる向きも入れ替える）。
    'D': dict(primary=p('blue', 300), on_primary=p('blue', 1200), primary_hover=p('blue', 200), primary_pressed=p('blue', 100),
              selected_bg=p('blue', 1200), selected_text=p('blue', 200),
              current_bg=p('blue', 1000), current_text=p('blue', 100), current_bar=p('blue', 300),
              info_bg=p('blue', 1200), info_text=p('blue', 200),
              focus=p('blue', 300),
              inverse_surface=gray(50), on_inverse_surface=gray(900)),
}

# ---------------------------------------------------------------- 深刻度
# 段の決め方: 面（fill）は文字が 4.5 以上のれる濃さ、枠（border）は面の上で 3:1 以上、
# text は 4 つの面すべてで 4.5 以上。緊急→重要は同じ赤の濃淡、以下は色相で分ける。
# ライトは濃い側、ダークは明るい側。緊急→重要は赤の濃淡、警告は黄、注意は青、なしは無彩色。
SEV_SPEC = {
    'L': dict(critical=('red', 1100), high=('red', 900), medium=('yellow', 700), low=('blue', 700), info=(None, 600)),
    'D': dict(critical=('red', 600), high=('red', 300), medium=('yellow', 300), low=('blue', 400), info=(None, 500)),
}
# 枠と色付き文字を探す向き（濃いほうへ / 薄いほうへ）
DARKER = {'L': (800, 900, 1000, 1100, 1200), 'D': (400, 300, 200, 100, 50)}
SEV = {'L': {}, 'D': {}}
for m in MODES:
    for k in SEV_KEYS:
        fam, step = SEV_SPEC[m][k]
        fill = gray(step) if fam is None else p(fam, step)
        # 面の上の文字は白か墨。先に通ったほうを使う
        on = next((c for c in (WHITE, gray(900), BLACK) if cr(c, fill) >= 4.5), None)
        assert on, f'{m} sev-{k}: {fill} の上に白も墨も 4.5 でのらない'
        ramp = [(s, gray(s)) for s in ((500, 600, 700, 800) if m == 'L' else (400, 300, 200))] if fam is None \
            else [(s, p(fam, s)) for s in DARKER[m] if s in DADS[fam]]
        # 枠: 面より 1 段は外側から探し、4 つの面すべてで 3:1 以上
        cand = [(s, c) for s, c in ramp if (s >= step if m == 'L' else s <= step)]
        bstep, border = pick(cand, lambda c: min(cr(c, s) for s in SURF(m)) >= 3.0)
        tstep, text = pick(cand, lambda c: min(cr(c, s) for s in SURF(m)) >= 4.5)
        SEV[m][k] = dict(fill=fill, on=on, border=border, text=text, step=step, border_step=bstep, text_step=tstep,
                         family=fam or 'solid_gray')

# ---------------------------------------------------------------- 状態色
# デジタル庁の semantic color（success/error/warning）から始めて、文字として 4.5 を満たす段まで濃くする。
STATUS_FROM = {
    'L': dict(error=('red', (900, 1000, 1100)), warning=('orange', (800, 900, 1000)),
              success=('green', (800, 900, 1000)), info=('blue', (900, 1000))),
    'D': dict(error=('red', (400, 300, 200)), warning=('orange', (400, 300, 200)),
              success=('green', (400, 300, 200)), info=('blue', (400, 300, 200))),
}
STATUS = {'L': {}, 'D': {}}
for m in MODES:
    for name, (fam, steps) in STATUS_FROM[m].items():
        _, value = pick([(s, p(fam, s)) for s in steps], lambda c: min(cr(c, s) for s in SURF(m)) >= 4.5)
        STATUS[m][name] = value

# ---------------------------------------------------------------- 確かめ
checks = {}
for m in MODES:
    s, t, b = SURFACE[m], TEXT[m], BORDER[m]
    checks[f'surface_{m}'] = dict(bg_card=round(cr(s['bg'], s['card']), 3), card_sub=round(cr(s['card'], s['card_sub']), 3),
                                  dE_bg_card=round(dE(s['bg'], s['card']), 1), dE_card_sub=round(dE(s['card'], s['card_sub']), 1))
    checks[f'text_{m}'] = {n: {k: round(cr(t[n], s[k]), 2) for k in s} for n in ('text', 'text_sub', 'text_muted')}
    checks[f'text_{m}']['dE_sub_muted'] = round(dE(t['text_sub'], t['text_muted']), 1)
    checks[f'text_{m}']['dE_text_sub'] = round(dE(t['text'], t['text_sub']), 1)
    checks[f'border_{m}'] = dict(border_on_card=round(cr(b['border'], s['card']), 2),
                                 border_strong_min=round(min(cr(b['border_strong'], x) for x in SURF(m)), 2),
                                 border_strong_step=b['border_strong_step'])
    key = KEY[m]
    checks[f'key_{m}'] = dict(on_primary=round(cr(key['on_primary'], key['primary']), 2),
                              primary_min=round(min(cr(key['primary'], x) for x in SURF(m)), 2),
                              hover_vs_primary=round(dE(key['primary_hover'], key['primary']), 1),
                              selected_text=round(cr(key['selected_text'], key['selected_bg']), 2),
                              current_text=round(cr(key['current_text'], key['current_bg']), 2),
                              info_text=round(cr(key['info_text'], key['info_bg']), 2),
                              current_bg_vs_card=round(cr(key['current_bg'], s['card']), 2),
                              current_bar_vs_card=round(cr(key['current_bar'], s['card']), 2),
                              focus_min=round(min(cr(key['focus'], x) for x in SURF(m) + [key['selected_bg'], key['current_bg']]), 2),
                              on_inverse=round(cr(key['on_inverse_surface'], key['inverse_surface']), 2))
    checks[f'sev_{m}'] = {k: dict(fill=SEV[m][k]['fill'], on=round(cr(SEV[m][k]['on'], SEV[m][k]['fill']), 2),
                                  fill_vs_surfaces=round(min(cr(SEV[m][k]['fill'], x) for x in SURF(m)), 2),
                                  border_min=round(min(cr(SEV[m][k]['border'], x) for x in SURF(m)), 2),
                                  text_min=round(min(cr(SEV[m][k]['text'], x) for x in SURF(m)), 2),
                                  step=f"{SEV[m][k]['family']}-{SEV[m][k]['step']}") for k in SEV_KEYS}
    fills = [SEV[m][k]['fill'] for k in SEV_KEYS]
    pairs = [(i, j) for i in range(5) for j in range(i + 1, 5)]
    checks[f'sev_dE_{m}'] = {f'{SEV_KEYS[i]}↔{SEV_KEYS[j]}': {kind: round(dE(fills[i], fills[j], kind), 1) for kind in CVD}
                             for i, j in pairs}
    checks[f'sev_dE_min_{m}'] = round(min(dE_min(fills[i], fills[j]) for i, j in pairs), 1)
    checks[f'sev_gray_{m}'] = {f'{SEV_KEYS[i]}↔{SEV_KEYS[i+1]}': round(dE_gray(fills[i], fills[i + 1]), 1) for i in range(4)}
    checks[f'sev_vs_key_{m}'] = {k: round(dE_min(SEV[m][k]['fill'], KEY[m]['primary']), 1) for k in SEV_KEYS}
    checks[f'status_{m}'] = {n: dict(value=v, min_cr=round(min(cr(v, x) for x in SURF(m)), 2),
                                     dE_vs_sev=round(min(dE_min(v, SEV[m][k]['fill']) for k in SEV_KEYS), 1))
                             for n, v in STATUS[m].items()}

# 止める条件（通らなければ書き出さない）
for m in MODES:
    t, b, key = TEXT[m], BORDER[m], KEY[m]
    for n in ('text', 'text_sub', 'text_muted'):
        assert min(cr(t[n], x) for x in SURF(m)) >= 4.5, f'{m} {n} のコントラストが足りません'
    assert dE(t['text_sub'], t['text_muted']) >= 5, f'{m} 補助文字と注記文字が見分けにくい: {dE(t["text_sub"], t["text_muted"]):.1f}'
    assert min(cr(b['border_strong'], x) for x in SURF(m)) >= 3.0, f'{m} border-strong が 3:1 未満'
    assert cr(key['on_primary'], key['primary']) >= 4.5, f'{m} on-primary が 4.5 未満'
    assert min(cr(key['primary'], x) for x in SURF(m)) >= 4.5, f'{m} primary（リンクの色）が 4.5 未満'
    assert cr(key['selected_text'], key['selected_bg']) >= 4.5, f'{m} 選択中の文字が 4.5 未満'
    assert cr(key['current_text'], key['current_bg']) >= 4.5, f'{m} 現在地の文字が 4.5 未満'
    assert cr(key['info_text'], key['info_bg']) >= 4.5, f'{m} 案内帯の文字が 4.5 未満'
    assert min(cr(key['focus'], x) for x in SURF(m) + [key['selected_bg'], key['current_bg']]) >= 3.0, f'{m} フォーカスの輪が 3:1 未満'
    assert cr(key['on_inverse_surface'], key['inverse_surface']) >= 4.5, f'{m} 反転面の文字が 4.5 未満'
    fills = [SEV[m][k]['fill'] for k in SEV_KEYS]
    worst = min((dE_min(fills[i], fills[j]), SEV_KEYS[i], SEV_KEYS[j]) for i in range(5) for j in range(i + 1, 5))
    assert worst[0] >= 12, f'{m} 深刻度が見分けにくい: {worst[1]}↔{worst[2]} ΔE {worst[0]:.1f}'
    for i in range(4):  # 隣の段は明るさだけでも見分けられること（白黒印刷・モノクロ表示）
        g = dE_gray(fills[i], fills[i + 1])
        assert g >= 10 or dE_min(fills[i], fills[i + 1]) >= 20, f'{m} {SEV_KEYS[i]}↔{SEV_KEYS[i+1]} の明るさ差が小さい: {g:.1f}'
    for k in SEV_KEYS:
        e = SEV[m][k]
        assert cr(e['on'], e['fill']) >= 4.5, f'{m} sev-{k} の文字が 4.5 未満'
        assert min(cr(e['border'], x) for x in SURF(m)) >= 3.0, f'{m} sev-{k} の枠が 3:1 未満'
        assert min(cr(e['text'], x) for x in SURF(m)) >= 4.5, f'{m} sev-{k} の色付き文字が 4.5 未満'
    for n, v in STATUS[m].items():
        assert min(cr(v, x) for x in SURF(m)) >= 4.5, f'{m} status-{n} が 4.5 未満'

# ---------------------------------------------------------------- 書き出し
def block(m, indent='  '):
    s, t, b, key = SURFACE[m], TEXT[m], BORDER[m], KEY[m]
    o = ['/* 面 */',
         f'--app-bg: {s["bg"]};', f'--app-card: {s["card"]};', f'--app-card-sub: {s["card_sub"]};', f'--app-overlay: {s["overlay"]};',
         '',
         '/* 文字・線 */',
         f'--app-text: {t["text"]};', f'--app-text-sub: {t["text_sub"]};',
         f'--app-text-muted: {t["text_muted"]};   /* Solid Gray {t["text_muted_step"]} */',
         f'--app-border: {b["border"]};', f'--app-border-strong: {b["border_strong"]};', f'--app-divider: {b["border"]};',
         '',
         '/* 基調色・選択・現在地 */',
         f'--app-primary: {key["primary"]};', f'--app-on-primary: {key["on_primary"]};',
         f'--app-primary-hover: {key["primary_hover"]};', f'--app-primary-pressed: {key["primary_pressed"]};',
         f'--app-selected-bg: {key["selected_bg"]};', f'--app-selected-text: {key["selected_text"]};',
         f'--app-current-bg: {key["current_bg"]};', f'--app-current-text: {key["current_text"]};', f'--app-current-bar: {key["current_bar"]};',
         f'--app-info-bg: {key["info_bg"]};', f'--app-info-text: {key["info_text"]};',
         f'--app-focus-ring: {key["focus"]};',
         f'--app-inverse-surface: {key["inverse_surface"]};', f'--app-on-inverse-surface: {key["on_inverse_surface"]};',
         '',
         '/* 深刻度（面・面の上の文字・枠・色付きの文字） */']
    for k in SEV_KEYS:
        e = SEV[m][k]
        o += [f'--app-sev-{k}: {e["fill"]};', f'--app-on-sev-{k}: {e["on"]};',
              f'--app-sev-{k}-border: {e["border"]};', f'--app-sev-{k}-text: {e["text"]};']
    o += ['', '/* 状態 */']
    for n in ('error', 'warning', 'success', 'info'):
        o.append(f'--app-status-{n}: {STATUS[m][n]};')
    return '\n'.join(indent + x if x else '' for x in o)


HEAD = f'''/*
 * SecOwl デザイントークン
 * デジタル庁デザインシステムのプリミティブカラーだけで組んでいます
 * （@digital-go-jp/design-tokens 2.1.0 / Figma 2.18.1、CC BY 4.0）。
 * 生成: scripts/gen-tokens/gen_tokens.py。手で値を変えないこと。
 * 書き出し（server/lib/export-colors.js）は Light の値を写して使う。値を変えたら合わせること。
 *
 * 層:
 *   --app-*  SecOwl のアプリ層。画面はこれだけを参照する
 *
 * 選び方（詳しくは生成スクリプト）:
 *   面      ライトは灰色の台（Solid Gray 100）に白い紙、ダークは Solid Gray の暗い側
 *   基調色  キーカラーの Blue。ライトは 900、ダークは 300
 *   深刻度  緊急→重要は赤の濃淡、警告は黄、注意は青、なしは無彩色。
 *           面は文字が 4.5 以上、枠は面の上で 3:1 以上、色付きの文字は 4.5 以上
 *   検証    4 つの色覚タイプでの見えの差と、白黒にしたときの明るさ差を生成時に確かめています
 *
 * テーマ: 既定は OS 設定に追従。<html data-theme="light|dark"> で手動固定。
 */
'''

FIXED = '''  /* ---- 余白・角丸 ---- */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --radius: 8px;
  --radius-sm: 6px;

  /* ---- 固定色（テーマに追従しない） ---- */
  --app-brand: #0021C8;            /* ロゴタイル。PNG と同じ値 */
  --app-on-brand: #FFFFFF;
  --app-mask-fill: #1A1A1C;        /* 墨消し。証跡画像に焼き込む値なので両モード共通（従来の値のまま） */
  --app-canvas-paper: #FFFFFF;     /* マスク編集・レポートプレビューの下地 */
  --app-icon-plate: #FFFFFF;       /* ツールアイコンの下地 */

  /* ---- 重ねる層の濃さ ---- */
  --app-state-hover: 8%;
  --app-state-pressed: 10%;
  --app-state-disabled-content: 38%;
  --app-state-disabled-container: 12%;

  /* ---- 影（浮く要素だけ。デジタル庁デザインシステムの elevation 1〜3） ---- */
  --app-elev-0: none;
  --app-elev-1: 0 2px 8px 1px rgb(0 0 0 / .10), 0 1px 5px 0 rgb(0 0 0 / .30);
  --app-elev-2: 0 2px 12px 2px rgb(0 0 0 / .10), 0 1px 6px 0 rgb(0 0 0 / .30);
  --app-elev-3: 0 4px 16px 3px rgb(0 0 0 / .10), 0 1px 6px 0 rgb(0 0 0 / .30);
'''

DERIVED = '''/* ---- モード共通（上のブロックの値から作る） ---- */
:root {
  --app-focus-ring-width: 3px;
  --app-focus-ring-offset: 2px;

  /* 重ねる層（内容色を薄く重ねる） */
  --app-hover-layer: color-mix(in srgb, var(--app-text) var(--app-state-hover), transparent);
  --app-pressed-layer: color-mix(in srgb, var(--app-text) var(--app-state-pressed), transparent);
  --app-selected-hover-layer: color-mix(in srgb, var(--app-selected-text) var(--app-state-hover), transparent);
  --app-disabled-text: color-mix(in srgb, var(--app-text) var(--app-state-disabled-content), transparent);
  --app-disabled-bg: color-mix(in srgb, var(--app-text) var(--app-state-disabled-container), transparent);
  --app-scrim: color-mix(in srgb, #000000 32%, transparent);

  /* 状態色の面（塗りの帯は使わない。面 + 線 + アイコン） */
  --app-status-surface: var(--app-card);
}

/* 選択中の要素の中では、補助文字も選択中の文字色にする */
:where(.active, .on, .selected, [aria-selected="true"], [aria-current="page"]) {
  --app-text-sub: var(--app-selected-text);
  --app-text-muted: var(--app-selected-text);
}
'''

css = f'''{HEAD}
:root {{
  color-scheme: light;

{FIXED}
  /* ---- Light ---- */
{block('L')}
}}

@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    color-scheme: dark;
{block('D', '    ')}
  }}
}}

:root[data-theme="dark"] {{
  color-scheme: dark;
{block('D')}
}}

{DERIVED}'''

args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'styles', 'tokens.css')
if '--data' in sys.argv:
    data = dict(surface=SURFACE, text=TEXT, border=BORDER, key=KEY, sev=SEV, status=STATUS, checks=checks)
    json.dump(data, open(sys.argv[sys.argv.index('--data') + 1], 'w'), ensure_ascii=False, indent=1)
open(out, 'w').write(css)
print(f'ok {out}')
