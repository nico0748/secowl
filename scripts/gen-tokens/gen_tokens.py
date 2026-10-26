"""SecOwl colour system generator (R2 設計、R3 で旧名を削除).
tokens.css と検証値（r2data.json）を出力する。値はすべて HCT（materialyoucolor 3.0.4）から求める。

使い方: python3 gen_tokens.py [出力先 tokens.css] [--data 検証値.json]
必要なもの（開発時だけ。アプリの依存には入れない）: pip install materialyoucolor==3.0.4 colorspacious numpy
"""
import json, re, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
from materialyoucolor.dynamiccolor.dynamic_scheme import DynamicScheme
from materialyoucolor.dynamiccolor.variant import Variant
from materialyoucolor.dynamiccolor.material_dynamic_colors import MaterialDynamicColors

SEED_HEX = '#0021C8'
PH = 272.0          # primary hue: OKLCH-matched to the logo at T40 (see doc)
P = dict(primary=(PH, 56), secondary=(PH, 16), tertiary=(320, 24), neutral=(PH, 4),
         neutral_variant=(PH, 8), error=(25, 84))
pal = {k: TonalPalette.from_hue_and_chroma(*v) for k, v in P.items()}
NV = pal['neutral_variant']; NEU = pal['neutral']
T = lambda p, t: hx(p.tone(t))

mdc = MaterialDynamicColors(spec="2021")
ROLES = ['primary','onPrimary','primaryContainer','onPrimaryContainer','inversePrimary','primaryFixed','primaryFixedDim','onPrimaryFixed','onPrimaryFixedVariant',
 'secondary','onSecondary','secondaryContainer','onSecondaryContainer','secondaryFixed','secondaryFixedDim','onSecondaryFixed','onSecondaryFixedVariant',
 'tertiary','onTertiary','tertiaryContainer','onTertiaryContainer','tertiaryFixed','tertiaryFixedDim','onTertiaryFixed','onTertiaryFixedVariant',
 'error','onError','errorContainer','onErrorContainer',
 'background','onBackground','surface','surfaceDim','surfaceBright','surfaceContainerLowest','surfaceContainerLow','surfaceContainer','surfaceContainerHigh','surfaceContainerHighest',
 'onSurface','surfaceVariant','onSurfaceVariant','outline','outlineVariant','inverseSurface','inverseOnSurface','surfaceTint','shadow','scrim']
S = {}
for mode, dark in (('L', False), ('D', True)):
    sc = DynamicScheme(Hct.from_int(ih(SEED_HEX)), Variant.TONAL_SPOT, 0.0, dark, spec_version="2021",
        primary_palette=pal['primary'], secondary_palette=pal['secondary'], tertiary_palette=pal['tertiary'],
        neutral_palette=pal['neutral'], neutral_variant_palette=pal['neutral_variant'], error_palette=pal['error'])
    S[mode] = {n: (hx(getattr(mdc, n).get_argb(sc)), round(getattr(mdc, n).get_hct(sc).tone)) for n in ROLES}
keb = lambda n: re.sub(r'([A-Z])', lambda m: '-' + m.group(1).lower(), n)
md = lambda m, n: S[m][n][0]

# ---------------- app surfaces / text ----------------
APP = {'L': {}, 'D': {}}
APP['L'].update(bg=md('L','surfaceContainer'), card=md('L','surfaceContainerLowest'), card_sub=md('L','surfaceContainerLow'),
                overlay=md('L','surfaceContainerLowest'))
APP['D'].update(bg=md('D','surfaceContainerLowest'), card=md('D','surfaceContainer'), card_sub=md('D','surfaceContainerHigh'),
                overlay=md('D','surfaceContainerHighest'))
for m in 'LD':
    a = APP[m]
    a.update(divider=md(m,'outlineVariant'), border=md(m,'outlineVariant'), border_strong=md(m,'outline'),
             text=md(m,'onSurface'), text_sub=md(m,'onSurfaceVariant'),
             selected_bg=md(m,'secondaryContainer'), selected_text=md(m,'onSecondaryContainer'),
             current_bg=md(m,'primaryContainer'), current_text=md(m,'onPrimaryContainer'), current_bar=md(m,'primary'),
             focus=md(m,'primary'), brand='#0021C8', on_brand='#FFFFFF')
SURF = lambda m: [APP[m][k] for k in ('bg','card','card_sub','overlay')]
# text-muted: furthest tone from text-sub that still keeps >=4.5 on every app surface
def pick_muted(m):
    rng = range(60, 30, -1) if m == 'L' else range(40, 80)
    best = None
    for t in rng:
        c = T(NV, t)
        if min(cr(c, s) for s in SURF(m)) >= 4.5:
            best = (t, c); break
    return best
for m in 'LD':
    t, c = pick_muted(m); APP[m]['text_muted'] = c; APP[m]['text_muted_tone'] = t

# ---------------- severity ----------------
SEV_KEYS = ['critical','high','medium','low','info']
SEV_SPEC = {  # (hue, chroma, tone) for signal; tonal-fill tone (light only)
 'L': dict(critical=(0,80,24), high=(32,80,40), medium=(60,64,60), low=(225,60,38), info=(PH,4,56)),
 'D': dict(critical=(5,90,56), high=(36,80,72), medium=(90,72,84), low=(230,52,62), info=(PH,4,76)),
}
TONAL_L = dict(critical=62, high=72, medium=82, low=90)   # info = outlined (no fill)
SEV = {'L': {}, 'D': {}}
for m in 'LD':
    for k in SEV_KEYS:
        h, c, t = SEV_SPEC[m][k]; p = TonalPalette.from_hue_and_chroma(h, c)
        sig = hx(p.tone(t))
        on = None
        for ot in ((100, 10) if m == 'L' else (10, 100)):
            o = hx(p.tone(ot))
            if cr(o, sig) >= 4.5: on = o; break
        e = dict(signal=sig, on=on, hue=h, chroma=c, tone=t, design_hue=round(float(inv_harm(h, c)), 1))
        if m == 'L':
            if k == 'info':
                e.update(container='transparent', on_container=APP['L']['text'], border=T(NV, 50))
            else:
                ct = TONAL_L[k]; pc = TonalPalette.from_hue_and_chroma(h, min(c, 64)); cont = hx(pc.tone(ct))
                oc = next(hx(p.tone(x)) for x in (10, 20, 30) if cr(hx(p.tone(x)), cont) >= 4.5)  # darkest-first
                e.update(container=cont, container_tone=ct, on_container=oc, border=sig)
        else:
            # dark tonal = signal at 40% over the card + 1.5px signal border; text = palette T90
            if k == 'info':
                e.update(container='transparent', on_container=APP['D']['text'], border=sig)
            else:
                f, b = rgb1(sig), rgb1(APP['D']['card'])
                cont = '#%02X%02X%02X' % tuple(round((f[i] * .40 + b[i] * .60) * 255) for i in range(3))
                oc = next(hx(p.tone(x)) for x in (90, 95, 98, 100) if cr(hx(p.tone(x)), cont) >= 4.5)
                e.update(container=cont, on_container=oc, border=sig)
        SEV[m][k] = e
# text-safe severity colour (for coloured words, e.g. exporters.js:93)
for m in 'LD':
    for k in SEV_KEYS:
        h, c, _ = SEV_SPEC[m][k]; p = TonalPalette.from_hue_and_chroma(h, c)
        rng = range(50, 0, -2) if m == 'L' else range(50, 100, 2)
        for t in rng:
            x = hx(p.tone(t))
            if min(cr(x, s) for s in SURF(m)) >= 4.5: SEV[m][k]['text'] = x; break

# ---------------- status (stripe + icon pattern; no tinted fills) ----------------
STAT = {'L': {}, 'D': {}}
for m in 'LD':
    tl = 40 if m == 'L' else 80
    STAT[m]['error'] = md(m, 'error')
    STAT[m]['warning'] = tone(80, 64, 50) if m == 'L' else tone(75, 64, 66)  # R3: D warning T66 amber (card 6.31, 15° from sev-medium)
    STAT[m]['success'] = T(TonalPalette.from_hue_and_chroma(160, 48), tl)
    STAT[m]['info'] = md(m, 'primary')
    STAT[m]['surface'] = APP[m]['card']

# ---------------- category (5 slots + other), shared hues across modes ----------------
CAT_SPEC = [(140,64,52,62),(310,64,40,58),(205,64,56,50),(115,56,40,46),(335,48,54,58)]
OTHER_SPEC = (PH, 8, 40, 48)
CAT = {'L': [], 'D': []}
for h, c, tl, td in CAT_SPEC:
    CAT['L'].append(tone(h, c, tl)); CAT['D'].append(tone(h, c, td))
CAT['L'].append(tone(OTHER_SPEC[0], OTHER_SPEC[1], OTHER_SPEC[2])); CAT['D'].append(tone(OTHER_SPEC[0], OTHER_SPEC[1], OTHER_SPEC[3]))

# ---------------- state layers (precomputed examples) ----------------
def mix(fg, bg, a):
    f, b = rgb1(fg), rgb1(bg); return '#%02X%02X%02X' % tuple(round((f[i] * a + b[i] * (1 - a)) * 255) for i in range(3))

# =============== CHECKS ===============
K = list(CVD)
chk = {}
def all4(a, b): return {k: round(dE(a, b, k), 1) for k in K}
for m in 'LD':
    sig = [SEV[m][k]['signal'] for k in SEV_KEYS]
    chk[f'sev_adj_{m}'] = {f'{a}↔{b}': all4(SEV[m][a]['signal'], SEV[m][b]['signal']) for a, b in zip(SEV_KEYS, SEV_KEYS[1:])}
    chk[f'sev_allpairs_min_{m}'] = min(dE(SEV[m][a]['signal'], SEV[m][b]['signal'], k) for i, a in enumerate(SEV_KEYS) for b in SEV_KEYS[i+1:] for k in K)
    chk[f'sev_gray_{m}'] = {f'{a}↔{b}': round(dEgray(SEV[m][a]['signal'], SEV[m][b]['signal']), 1) for a, b in zip(SEV_KEYS, SEV_KEYS[1:])}
    chk[f'sev_contrast_{m}'] = {k: dict(on=round(cr(SEV[m][k]['on'], SEV[m][k]['signal']), 2),
                                        vs_card=round(cr(SEV[m][k]['signal'], APP[m]['card']), 2),
                                        vs_bg=round(cr(SEV[m][k]['signal'], APP[m]['bg']), 2),
                                        tonal_text=(round(cr(SEV[m][k]['on_container'], SEV[m][k]['container'] if SEV[m][k]['container'] != 'transparent' else APP[m]['card']), 2)),
                                        tonal_border_vs_card=round(cr(SEV[m][k]['border'], APP[m]['card']), 2),
                                        text_token_min=round(min(cr(SEV[m][k]['text'], s) for s in SURF(m)), 2)) for k in SEV_KEYS}
    # salience: CAM16 chroma and dE from page
    chk[f'sev_salience_{m}'] = {k: dict(cam16_chroma=round(Hct.from_int(ih(SEV[m][k]['signal'])).chroma, 1),
                                        dE_page=round(dE(SEV[m][k]['signal'], APP[m]['bg']), 1)) for k in SEV_KEYS}
    # tonal pill fills
    fills = [SEV[m][k]['container'] if SEV[m][k]['container'] != 'transparent' else APP[m]['card'] for k in SEV_KEYS]
    chk[f'tonal_gray_{m}'] = {f'{a}↔{b}': dict(fill=round(dEgray(fa, fb), 1),
                                               border=round(dEgray(SEV[m][a]['border'], SEV[m][b]['border']), 1),
                                               border_all4=min(all4(SEV[m][a]['border'], SEV[m][b]['border']).values()))
                              for (a, fa), (b, fb) in zip(zip(SEV_KEYS, fills), list(zip(SEV_KEYS, fills))[1:])}
    # collisions: status vs severity
    sev_fills = {k: SEV[m][k]['container'] for k in SEV_KEYS if SEV[m][k]['container'] != 'transparent'}
    col = {}
    for sname, sval in [('md error-container', md(m, 'errorContainer')), ('app status surface', STAT[m]['surface'])]:
        for k, v in sev_fills.items():
            col[f'{sname} ↔ sev-{k} tonal'] = min(all4(sval, v).values())
    for sname in ('error', 'warning'):
        for k in SEV_KEYS:
            col[f'{sname} stripe ↔ sev-{k} signal'] = min(all4(STAT[m][sname], SEV[m][k]['signal']).values())
    chk[f'collision_{m}'] = {k: round(v, 1) for k, v in col.items()}
    # categories
    cats = CAT[m]
    chk[f'cat_adj_{m}'] = {f'cat-{i+1}↔{"cat-"+str(i+2) if i < 4 else "other"}': all4(cats[i], cats[i+1]) for i in range(5)}
    chk[f'cat_adj_{m}']['other↔cat-1（円の継ぎ目）'] = all4(cats[5], cats[0])
    chk[f'cat_allpairs_normal_min_{m}'] = round(min(dE(a, b) for i, a in enumerate(cats) for b in cats[i+1:]), 1)
    chk[f'cat_allpairs_cvd_min_{m}'] = round(min(dE(a, b, k) for i, a in enumerate(cats) for b in cats[i+1:] for k in K), 1)
    avoid = {**{f'sev-{k}': SEV[m][k]['signal'] for k in SEV_KEYS}, 'primary': md(m, 'primary'), 'success': STAT[m]['success'], 'error': STAT[m]['error'], 'warning': STAT[m]['warning']}
    chk[f'cat_vs_reserved_{m}'] = {f'cat-{i+1 if i < 5 else "other"}': {n: all4(c, v) for n, v in avoid.items()} for i, c in enumerate(cats)}
    chk[f'cat_contrast_{m}'] = [round(cr(c, APP[m]['card']), 2) for c in cats]
    # surfaces & text
    chk[f'surface_{m}'] = dict(bg_card=round(cr(APP[m]['bg'], APP[m]['card']), 3), card_sub=round(cr(APP[m]['card'], APP[m]['card_sub']), 3),
                               overlay_bg=round(cr(APP[m]['overlay'], APP[m]['bg']), 3), overlay_sub=round(cr(APP[m]['overlay'], APP[m]['card_sub']), 3),
                               dE_bg_card=round(dE(APP[m]['bg'], APP[m]['card']), 1), dE_card_overlay=round(dE(APP[m]['card'], APP[m]['overlay']), 1))
    chk[f'text_{m}'] = {n: {s: round(cr(APP[m][n], APP[m][s]), 2) for s in ('bg', 'card', 'card_sub', 'overlay')} for n in ('text', 'text_sub', 'text_muted')}
    chk[f'text_{m}']['muted_vs_sub_dE'] = round(dE(APP[m]['text_muted'], APP[m]['text_sub']), 1)
    chk[f'text_{m}']['sub_vs_text_dE'] = round(dE(APP[m]['text_sub'], APP[m]['text']), 1)
    chk[f'ui_{m}'] = dict(
        selected_text=round(cr(APP[m]['selected_text'], APP[m]['selected_bg']), 2),
        current_text=round(cr(APP[m]['current_text'], APP[m]['current_bg']), 2),
        current_bg_vs_card=round(cr(APP[m]['current_bg'], APP[m]['card']), 2),
        current_bar_vs_card=round(cr(APP[m]['current_bar'], APP[m]['card']), 2),
        focus_min=round(min(cr(APP[m]['focus'], s) for s in SURF(m) + [APP[m]['selected_bg'], APP[m]['current_bg']]), 2),
        border_strong_min=round(min(cr(APP[m]['border_strong'], s) for s in SURF(m)), 2),
        divider_on_card=round(cr(APP[m]['divider'], APP[m]['card']), 2),
        on_primary=round(cr(md(m, 'onPrimary'), md(m, 'primary')), 2),
        link_min=round(min(cr(md(m, 'primary'), s) for s in SURF(m)), 2),
        hover_on_card=mix(APP[m]['text'], APP[m]['card'], .08), pressed_on_card=mix(APP[m]['text'], APP[m]['card'], .10),
        hover_vs_selected_dE=round(dE(mix(APP[m]['text'], APP[m]['card'], .08), APP[m]['selected_bg']), 1),
        status_stripe_min={n: round(min(cr(STAT[m][n], s) for s in SURF(m) + [STAT[m]['surface']]), 2) for n in ('error', 'warning', 'success', 'info')},
        status_text_on_surface=round(cr(APP[m]['text'], STAT[m]['surface']), 2),
        brand_vs_bg=round(cr('#0021C8', APP[m]['bg']), 2),
    )

# =============== CSS ===============
def block(m):
    o = []
    for n in ROLES:
        if n in ('background', 'onBackground'): continue
        o.append(f'  --md-sys-color-{keb(n)}: {md(m, n)};')
    a = APP[m]
    o += ['',
          f'  /* app surfaces (意図的な MD3 からの逸脱: §3.1) */',
          f'  --app-bg: {a["bg"]};', f'  --app-card: {a["card"]};', f'  --app-card-sub: {a["card_sub"]};', f'  --app-overlay: {a["overlay"]};',
          f'  --app-text-muted: {a["text_muted"]};   /* neutral-variant T{a["text_muted_tone"]} */']
    o.append('')
    for k in SEV_KEYS:
        e = SEV[m][k]
        o += [f'  --app-sev-{k}: {e["signal"]};', f'  --app-on-sev-{k}: {e["on"]};',
              f'  --app-sev-{k}-container: {e["container"]};', f'  --app-on-sev-{k}-container: {e["on_container"]};',
              f'  --app-sev-{k}-border: {e["border"]};', f'  --app-sev-{k}-text: {e["text"]};']
    o.append('')
    for n in ('error', 'warning', 'success', 'info'):
        o.append(f'  --app-status-{n}: {STAT[m][n]};')
    o.append('')
    for i, c in enumerate(CAT[m][:5], 1): o.append(f'  --app-cat-{i}: {c};')
    o.append(f'  --app-cat-other: {CAT[m][5]};')
    o.append('')
    # legacy primitives (theme-aware aliases so un-migrated app.css keeps working)
    if m == 'L':
        legacy = {'--sumi-50': a['card_sub'], '--sumi-100': md(m, 'surfaceContainerHigh'), '--sumi-200': a['divider'], '--sumi-300': md(m, 'outlineVariant'),
                  '--sumi-400': md(m, 'outline'), '--sumi-500': T(NV, 60), '--sumi-600': a['text_muted'], '--sumi-700': a['text_sub'],
                  '--forest-50': a['card_sub'], '--wood-50': a['card_sub'], '--sun-50': a['card_sub'],
                  '--sea-50': md(m, 'secondaryContainer'), '--sea-100': md(m, 'primaryContainer'), '--sea-300': md(m, 'primaryFixedDim')}
    else:
        legacy = {'--sumi-50': a['card_sub'], '--sumi-100': md(m, 'surfaceContainerHighest'), '--sumi-200': a['divider'], '--sumi-300': md(m, 'outlineVariant'),
                  '--sumi-400': md(m, 'outline'), '--sumi-500': T(NV, 50), '--sumi-600': a['text_muted'], '--sumi-700': a['text_sub'],
                  '--forest-50': a['card_sub'], '--wood-50': a['card_sub'], '--sun-50': a['card_sub'],
                  '--sea-50': md(m, 'secondaryContainer'), '--sea-100': md(m, 'primaryContainer'), '--sea-300': md(m, 'primary')}
    if LEGACY:
        o.append('  /* legacy DADS 名（テーマ追従の互換エイリアス） */')
        for k, v in legacy.items(): o.append(f'  {k}: {v};')
    return '\n'.join(o).rstrip()

# R3: 画面の移行が済んだので旧名（--bg, --sumi-* など）は出力しない。--legacy で R2 と同じ出力に戻せる。
LEGACY = '--legacy' in sys.argv
STATIC_LEGACY = {  # identical in both modes (used with literal #fff text in app.css)
    '--sumi-1200': '#000000', '--sumi-1000': T(NEU, 6), '--sumi-900': T(NEU, 10), '--sumi-800': T(NEU, 30),
}

COMPAT = '  /* ---------------- 互換エイリアス（既存名。移行後に削除） ---------------- */\n  --bg: var(--app-bg);\n  --surface: var(--app-card);\n  --surface-sub: var(--app-card-sub);\n  --border: var(--app-border);\n  --border-strong: var(--app-border-strong);\n  --text: var(--app-text);\n  --text-sub: var(--app-text-sub);\n  --text-muted: var(--app-text-muted);\n  --primary: var(--app-primary);\n  --primary-hover: var(--app-primary-hover);\n  --primary-bg: var(--app-selected-bg);\n  --focus-ring: var(--app-focus-ring);\n  --shadow: var(--app-elev-0);\n\n  --sev-critical: var(--app-sev-critical);\n  --sev-high: var(--app-sev-high);\n  --sev-medium: var(--app-sev-medium);\n  --sev-low: var(--app-sev-low);\n  --sev-info: var(--app-sev-info);\n\n  --cat-1: var(--app-cat-1);\n  --cat-2: var(--app-cat-2);\n  --cat-3: var(--app-cat-3);\n  --cat-4: var(--app-cat-4);\n  --cat-5: var(--app-cat-5);\n  --cat-6: var(--app-cat-other);   /* 6 枠目は廃止（上位 5 件 + その他） */\n  --cat-other: var(--app-cat-other);\n\n  --sea-1000: var(--md-sys-color-on-primary-container);\n  --sea-900: var(--md-sys-color-on-primary-container);\n  --sea-800: var(--md-sys-color-primary);\n  --sea-700: var(--md-sys-color-primary);\n  --sea-600: var(--md-sys-color-primary);\n  --sea-500: var(--md-sys-color-primary);\n  --forest-800: var(--app-status-success);\n  --forest-600: var(--app-status-success);\n  --wood-700: var(--app-status-warning);\n  --wood-600: var(--app-status-warning);\n  --sun-1100: var(--md-sys-color-error);\n  --sun-800: var(--md-sys-color-error);\n' if LEGACY else ''
COMPAT_SEL = '  --text-sub: var(--app-selected-text);\n  --text-muted: var(--app-selected-text);\n' if LEGACY else ''
css = f'''/*
 * SecOwl デザイントークン
 * Material Design 3 (HCT / spec 2021) ベース。シード #0021C8（ロゴの群青）。
 * 生成: scripts/gen-tokens/gen_tokens.py（materialyoucolor 3.0.4）。手で値を変えないこと。
 * 書き出し（server/lib/export-colors.js）は Light の値を写して使う。値を変えたら合わせること。
 *
 * 層:
 *   --md-sys-color-*  MD3 のカラーロール（MD3 の意味どおり）
 *   --app-*           SecOwl のアプリ層。画面はこれだけを参照する
 *
 * MD3 からの意図的な逸脱（1 行で）:
 *   面の段をモードごとに割り当てる（Light: 地 T94 / カード T100、Dark: 地 T4 / カード T12 / ダイアログ T22）。
 *   MD3 の container 段は「強調度」の名前で、Light はカードを白い紙に、Dark はカードを地より明るく保つため。
 *   その他: 深刻度はカスタムカラー（harmonize + CVD 検証済み）、状態色の塗り container は使わない（線 + アイコン）。
 *
 * テーマ: 既定は OS 設定に追従。<html data-theme="light|dark"> で手動固定。
 */

:root {{
  color-scheme: light;

  /* ---- 余白・角丸（変更なし） ---- */
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
{chr(10).join(f"  {k}: {v};" for k, v in STATIC_LEGACY.items()) if LEGACY else ''}

  /* ---- MD3 state layer ---- */
  --md-state-hover: 8%;
  --md-state-focus: 10%;
  --md-state-pressed: 10%;
  --md-state-dragged: 16%;
  --md-state-disabled-content: 38%;
  --md-state-disabled-container: 12%;

  /* ---- 標高（影は浮く要素だけ） ---- */
  --app-elev-0: none;
  --app-elev-1: 0 1px 2px 0 rgb(0 0 0 / .30), 0 1px 3px 1px rgb(0 0 0 / .15);
  --app-elev-2: 0 1px 2px 0 rgb(0 0 0 / .30), 0 2px 6px 2px rgb(0 0 0 / .15);
  --app-elev-3: 0 1px 3px 0 rgb(0 0 0 / .30), 0 4px 8px 3px rgb(0 0 0 / .15);

  /* ---- Light 値 ---- */
{block('L')}
}}

@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    color-scheme: dark;
{chr(10).join('  ' + l if l else l for l in block('D').split(chr(10)))}
  }}
}}

:root[data-theme="dark"] {{
  color-scheme: dark;
{block('D')}
}}

/* ---- モード共通の参照（値は上のブロックで切り替わる） ---- */
:root {{
  /* app: 面・線・文字 */
  --app-divider: var(--md-sys-color-outline-variant);
  --app-border: var(--md-sys-color-outline-variant);          /* 装飾的な輪郭（カード） */
  --app-border-strong: var(--md-sys-color-outline);           /* 操作部品の境界（入力欄・未選択チップ） */
  --app-text: var(--md-sys-color-on-surface);
  --app-text-sub: var(--md-sys-color-on-surface-variant);

  /* app: 主色・選択・現在地・フォーカス */
  --app-primary: var(--md-sys-color-primary);
  --app-on-primary: var(--md-sys-color-on-primary);
  --app-selected-bg: var(--md-sys-color-secondary-container);
  --app-selected-text: var(--md-sys-color-on-secondary-container);
  --app-current-bg: var(--md-sys-color-primary-container);
  --app-current-text: var(--md-sys-color-on-primary-container);
  --app-current-bar: var(--md-sys-color-primary);
  --app-focus-ring: var(--md-sys-color-primary);
  --app-focus-ring-width: 3px;
  --app-focus-ring-offset: 2px;

  /* app: state layer（内容色を重ねる） */
  --app-hover-layer: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-state-hover), transparent);
  --app-pressed-layer: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-state-pressed), transparent);
  --app-primary-hover: color-mix(in srgb, var(--md-sys-color-on-primary) var(--md-state-hover), var(--md-sys-color-primary));
  --app-primary-pressed: color-mix(in srgb, var(--md-sys-color-on-primary) var(--md-state-pressed), var(--md-sys-color-primary));
  --app-selected-hover-layer: color-mix(in srgb, var(--md-sys-color-on-secondary-container) var(--md-state-hover), transparent);
  --app-disabled-text: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-state-disabled-content), transparent);
  --app-disabled-bg: color-mix(in srgb, var(--md-sys-color-on-surface) var(--md-state-disabled-container), transparent);
  --app-scrim: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);

  /* app: 状態色の面（塗り container は使わない。面 + 4px 線 + アイコン） */
  --app-status-surface: var(--app-card);

{COMPAT}}}

/* 選択中の要素の中では補助文字も on-secondary-container にする（R1 批評 N3 の強制） */
:where(.active, .on, .selected, [aria-selected="true"], [aria-current="page"]) {{
  --app-text-sub: var(--app-selected-text);
  --app-text-muted: var(--app-selected-text);
{COMPAT_SEL}}}
'''

data = dict(S=S, APP=APP, SEV=SEV, STAT=STAT, CAT=CAT, CAT_SPEC=CAT_SPEC, OTHER_SPEC=OTHER_SPEC, chk=chk,
            pal={k: {t: T(p, t) for t in (0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 45, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100)} for k, p in pal.items()},
            P=P, PH=PH)
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'styles', 'tokens.css')
if '--data' in sys.argv:
    json.dump(data, open(sys.argv[sys.argv.index('--data') + 1], 'w'), ensure_ascii=False, indent=1)
css = re.sub(r'\n{3,}', '\n\n', css)
css = re.sub(r'\n\n\}', '\n}', css)
open(out, 'w').write(css)
print('ok')
