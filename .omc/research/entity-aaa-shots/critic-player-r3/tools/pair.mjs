import { writeFileSync } from 'node:fs';
import { encodePng } from '../../scripts/lib/png.mjs';
import { loadRgba } from '../../scripts/env-verify/assetColor.mjs';
const [fa,fb,outp,cx,cy,w,h,z]=process.argv.slice(2);
const CX=+cx,CY=+cy,W=+w,H=+h,Z=+(z||1);
const A=loadRgba(fa),B=loadRgba(fb);
const x0=Math.max(0,Math.min(A.w-W,CX-(W>>1))),y0=Math.max(0,Math.min(A.h-H,CY-(H>>1)));
const ow=W*Z*2+8,oh=H*Z,out=Buffer.alloc(ow*oh*4,0);
for(const [img,dx] of [[A,0],[B,W*Z+8]])for(let y=0;y<H*Z;y++)for(let x=0;x<W*Z;x++){
 const sx=x0+Math.floor(x/Z),sy=y0+Math.floor(y/Z),si=(sy*img.w+sx)*4,di=(y*ow+x+dx)*4;
 out[di]=img.rgba[si];out[di+1]=img.rgba[si+1];out[di+2]=img.rgba[si+2];out[di+3]=255;}
writeFileSync(outp,encodePng({width:ow,height:oh,colorType:6,channels:4,pixels:out}));
console.log('wrote',outp,ow,oh,'origin',x0,y0);
