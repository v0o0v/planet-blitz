import { writeFileSync } from 'node:fs';
import { encodePng } from '../../scripts/lib/png.mjs';
import { loadRgba } from '../../scripts/env-verify/assetColor.mjs';
const [inp,outp,cx,cy,w,h,z] = process.argv.slice(2);
const CX=+cx,CY=+cy,W=+w,H=+h,Z=+(z||1);
const {w:sw,h:sh,rgba:src}=loadRgba(inp);
const x0=Math.max(0,Math.min(sw-W,CX-(W>>1))), y0=Math.max(0,Math.min(sh-H,CY-(H>>1)));
const ow=W*Z, oh=H*Z; const out=Buffer.alloc(ow*oh*4);
for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
  const sx=x0+Math.floor(x/Z), sy=y0+Math.floor(y/Z);
  const si=(sy*sw+sx)*4, di=(y*ow+x)*4;
  out[di]=src[si];out[di+1]=src[si+1];out[di+2]=src[si+2];out[di+3]=255;
}
writeFileSync(outp, encodePng({width:ow,height:oh,colorType:6,channels:4,pixels:out}));
console.log('wrote',outp,ow,oh,'src',sw,sh,'origin',x0,y0);
