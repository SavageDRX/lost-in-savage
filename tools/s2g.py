"""Decode Savage .s2g textures to PIL images.
Header: 'S2Graphic' + u8 ver + u8 mips + u32 w + u32 h + u32 glFormat (0x83F2 DXT3, 0x83F3 DXT5, 0x83F1 DXT1) + u8 alpha + u32 top-mip bytes.
Top mip data starts at byte 29."""
import sys, struct, numpy as np
from PIL import Image

def _colors(c):
    c0=c[...,0].astype(np.uint32)|(c[...,1].astype(np.uint32)<<8); c1=c[...,2].astype(np.uint32)|(c[...,3].astype(np.uint32)<<8)
    def rgb(v): return np.stack([((v>>11)&31)*255/31,((v>>5)&63)*255/63,(v&31)*255/31],-1).astype(np.float32)
    p0,p1=rgb(c0),rgb(c1)
    pal=np.stack([p0,p1,(2*p0+p1)/3,(p0+2*p1)/3],-2)
    bits=c[...,4].astype(np.uint32)|(c[...,5].astype(np.uint32)<<8)|(c[...,6].astype(np.uint32)<<16)|(c[...,7].astype(np.uint32)<<24)
    k=np.stack([(bits>>(2*i))&3 for i in range(16)],-1)          # bh,bw,16
    return np.take_along_axis(pal,k[...,None].repeat(3,-1),-2)    # bh,bw,16,3

def _alpha5(a):
    a0=a[...,0].astype(np.float32); a1=a[...,1].astype(np.float32)
    bits=np.zeros(a.shape[:-1],np.uint64)
    for i in range(6): bits|=a[...,2+i].astype(np.uint64)<<np.uint64(8*i)
    k=np.stack([(bits>>np.uint64(3*i))&np.uint64(7) for i in range(16)],-1).astype(np.int64)
    pal8=np.stack([a0,a1]+[((7-i)*a0+i*a1)/7 for i in range(1,7)],-1)
    pal6=np.stack([a0,a1]+[((5-i)*a0+i*a1)/5 for i in range(1,5)]+[np.zeros_like(a0),np.full_like(a0,255)],-1)
    pal=np.where((a0>a1)[...,None],pal8,pal6)
    return np.take_along_axis(pal,k,-1)

def _alpha3(a):
    v=np.stack([(a[...,i//2]>>(4*(i%2)))&15 for i in range(16)],-1).astype(np.float32)
    return v*17

def decode(path, rgba=False):
    b=open(path,'rb').read()
    assert b[:9]==b'S2Graphic', 'not s2g'
    w,h,fmt=struct.unpack_from('<III',b,11)
    data=b[29:]
    bw,bh=max(1,w//4),max(1,h//4)
    if fmt==0x83F1:
        blk=np.frombuffer(data[:bw*bh*8],np.uint8).reshape(bh,bw,8); col=_colors(blk); al=np.full(col.shape[:-1],255,np.float32)
    else:
        blk=np.frombuffer(data[:bw*bh*16],np.uint8).reshape(bh,bw,16); col=_colors(blk[...,8:16])
        al=_alpha5(blk[...,:8]) if fmt==0x83F3 else _alpha3(blk[...,:8])
    px=np.concatenate([col,al[...,None]],-1).reshape(bh,bw,4,4,4).transpose(0,2,1,3,4).reshape(bh*4,bw*4,4)
    im=Image.fromarray(np.clip(px,0,255).astype(np.uint8),'RGBA')
    return im if rgba else im.convert('RGB')

if __name__=='__main__':
    for p in sys.argv[2:]:
        im=decode(p); im.save(sys.argv[1]+'/'+p.replace('/','__').split('terrain__')[-1].replace('.s2g','.png')); print(p,im.size)
