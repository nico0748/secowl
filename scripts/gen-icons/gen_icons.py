"""
アプリアイコン一式を build/logo-white.png（白い透過ロゴ）から作ります。
開発時だけ使います（Python 3 と Pillow が必要です）。

  python3 scripts/gen-icons/gen_icons.py [元のロゴ.png]

元のロゴを渡すと、ノイズを取り除いて build/logo-white.png に保存してから書き出します。
書き出すもの:
  build/icon.png        1024px。macOS の作法どおり、角丸の面の外側は透明の余白にします
  build/icon.icns       macOS 用（Electron.app の差し替えと electron-builder で使います）
  public/mark-96.png    画面左上のロゴ
  public/favicon-*.png  ブラウザのタブ用
  public/apple-touch-icon.png
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
LOGO = ROOT / 'build' / 'logo-white.png'
BLUE = (0x00, 0x21, 0xC8, 255)  # 配色の基準色（seed）と同じ青
SS = 4  # 角丸の縁をなめらかにするための縮小前の倍率


def clean_logo(src: Path) -> Image.Image:
    """透明度の低いノイズを消し、ロゴの外接矩形で切り出します。"""
    im = Image.open(src).convert('RGBA')
    r, g, b, a = im.split()
    a = a.point(lambda v: 0 if v < 48 else v)
    # 孤立した小さな点を消すため、少し太らせてから細らせたマスクと掛け合わせます
    mask = a.point(lambda v: 255 if v else 0).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(9))
    a = Image.composite(a, Image.new('L', a.size, 0), mask)
    im = Image.merge('RGBA', (r, g, b, a))
    return im.crop(im.getbbox())


def rounded_tile(size: int, inset: int, radius_ratio: float) -> Image.Image:
    """透明なキャンバスに青い角丸の面を描きます（縁は縮小でアンチエイリアス）。"""
    big = size * SS
    tile = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    side = big - 2 * inset * SS
    ImageDraw.Draw(tile).rounded_rectangle(
        [inset * SS, inset * SS, inset * SS + side - 1, inset * SS + side - 1],
        radius=round(side * radius_ratio), fill=BLUE)
    return tile.resize((size, size), Image.LANCZOS)


def place_logo(tile: Image.Image, logo: Image.Image, inset: int, width_ratio: float) -> Image.Image:
    side = tile.width - 2 * inset
    w = round(side * width_ratio)
    h = round(logo.height * w / logo.width)
    lg = logo.resize((w, h), Image.LANCZOS)
    out = tile.copy()
    out.alpha_composite(lg, ((tile.width - w) // 2, (tile.height - h) // 2))
    return out


def full_square(size: int, logo: Image.Image, width_ratio: float = 0.8) -> Image.Image:
    """面いっぱいの正方形（角は表示側で丸めます）。縁に白い画素が残りません。"""
    return place_logo(Image.new('RGBA', (size, size), BLUE), logo, 0, width_ratio)


def main():
    if len(sys.argv) > 1:
        clean_logo(Path(sys.argv[1])).save(LOGO)
    logo = Image.open(LOGO).convert('RGBA')

    # macOS: 1024 のキャンバスに 824 の角丸（余白 100）
    icon = place_logo(rounded_tile(1024, 100, 0.225), logo, 100, 0.78)
    icon.save(ROOT / 'build' / 'icon.png')
    icon.save(ROOT / 'build' / 'icon.icns',
              sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])

    full_square(96, logo).save(ROOT / 'public' / 'mark-96.png')
    for s in (16, 32, 64):
        place_logo(rounded_tile(s, 0, 0.225), logo, 0, 0.84).save(ROOT / 'public' / f'favicon-{s}.png')
    full_square(180, logo).save(ROOT / 'public' / 'favicon-180.png')
    full_square(512, logo).convert('RGB').save(ROOT / 'public' / 'apple-touch-icon.png')
    print('アイコンを書き出しました')


if __name__ == '__main__':
    main()
