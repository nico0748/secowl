"""配色の検証に使う計算。コントラスト比（WCAG 2.x）と、色覚タイプごとの見えの差。

必要なもの（開発時だけ。アプリの依存には入れない）: pip install colorspacious numpy
"""
import warnings

import colorspacious as cs
import numpy as np

warnings.filterwarnings('ignore')

# 色覚のタイプ。normal 以外は colorspacious の severity 100（一番強い）で見る。
CVD = {'normal': None, 'deut': 'deuteranomaly', 'prot': 'protanomaly', 'trit': 'tritanomaly'}


def rgb1(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(h):
    r, g, b = rgb1(h)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def cr(a, b):
    """コントラスト比。1〜21。"""
    hi, lo = sorted([luminance(a), luminance(b)], reverse=True)
    return (hi + 0.05) / (lo + 0.05)


_sim_cache = {}


def _sim(h, kind):
    key = (h, kind)
    if key not in _sim_cache:
        x = rgb1(h)
        if CVD[kind]:
            x = np.clip(cs.cspace_convert(x, {'name': 'sRGB1+CVD', 'cvd_type': CVD[kind], 'severity': 100}, 'sRGB1'), 0, 1)
        _sim_cache[key] = cs.cspace_convert(x, 'sRGB1', 'CAM02-UCS')
    return _sim_cache[key]


def dE(a, b, kind='normal'):
    """見えの差（CAM02-UCS）。10 を超えると別の色として見分けやすい。"""
    return float(np.linalg.norm(_sim(a, kind) - _sim(b, kind)))


def dE_min(a, b):
    """4 つの色覚タイプのうち、いちばん見分けにくいときの差。"""
    return min(dE(a, b, k) for k in CVD)


def to_gray(h):
    """明るさだけを残した灰色（白黒印刷・モノクロ表示の代わり）。"""
    y = luminance(h)
    v = 12.92 * y if y <= 0.0031308 else 1.055 * y ** (1 / 2.4) - 0.055
    g = round(v * 255)
    return '#%02X%02X%02X' % (g, g, g)


def dE_gray(a, b):
    return dE(to_gray(a), to_gray(b))


def pick(steps, test):
    """steps を順に試して、最初に test を満たした値を返す。見つからなければ例外。"""
    for step, value in steps:
        if test(value):
            return step, value
    raise AssertionError(f'条件を満たす段がありません: {[s for s, _ in steps]}')
