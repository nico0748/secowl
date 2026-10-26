import numpy as np, colorspacious as cs, warnings; warnings.filterwarnings('ignore')
from materialyoucolor.hct import Hct
from materialyoucolor.palettes.tonal_palette import TonalPalette
from materialyoucolor.blend.blend import Blend
SEED=0xFF0021C8
def hx(a): return '#%06X'%(a&0xFFFFFF)
def ih(h): return int('FF'+h.lstrip('#'),16)
def hct(h,c,t): return hx(Hct.from_hct(h,c,t).to_int())
def tone(h,c,t): return hx(TonalPalette.from_hue_and_chroma(h,c).tone(t))
def rgb1(h): h=h.lstrip('#'); return np.array([int(h[i:i+2],16)/255 for i in (0,2,4)])
def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(h): r,g,b=rgb1(h); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def cr(a,b):
    la,lb=sorted([L(a),L(b)],reverse=True); return (la+0.05)/(lb+0.05)
CVD={'normal':None,'deut':'deuteranomaly','prot':'protanomaly','trit':'tritanomaly'}
_cache={}
def sim(h,k):
    key=(h,k)
    if key in _cache: return _cache[key]
    x=rgb1(h)
    if CVD[k]: x=np.clip(cs.cspace_convert(x,{"name":"sRGB1+CVD","cvd_type":CVD[k],"severity":100},"sRGB1"),0,1)
    u=cs.cspace_convert(x,"sRGB1","CAM02-UCS"); _cache[key]=u; return u
def dE(a,b,k='normal'): return float(np.linalg.norm(sim(a,k)-sim(b,k)))
def dEall(a,b): return {k:dE(a,b,k) for k in CVD}
def gray(h): # luminance-preserving gray
    y=L(h); v=(12.92*y if y<=0.0031308 else 1.055*y**(1/2.4)-0.055); g=round(v*255); return '#%02X%02X%02X'%(g,g,g)
def dEgray(a,b): return dE(gray(a),gray(b))
def harm(h,c=48): return Hct.from_int(Blend.harmonize(Hct.from_hct(h,c,50).to_int(),SEED)).hue
def inv_harm(target,c=48):
    best=min(((abs(((harm(d,c)-target+180)%360)-180),d) for d in np.arange(0,360,0.5)))
    return best[1]
def hue_of(h): return Hct.from_int(ih(h)).hue
