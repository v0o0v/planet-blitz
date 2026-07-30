import { writeFileSync } from 'node:fs';
import { loadRgba } from '../../../../scripts/env-verify/assetColor.mjs';
import { encodePng } from '../../../../scripts/lib/png.mjs';
// crop.mjs out.png cx cy half zoom in1.png [in2.png ...]  -> side-by-side
const [out, cxs, cys, hs, zs, ...ins] = process.argv.slice(2);
const cx=+cxs, cy=+cys, half=+hs, zoom=+zs;
const imgs = ins.map(loadRgba);
const side = half*2*zoom;
const W = side*imgs.length + 4*(imgs.length-1), H = side;
const px = new Uint8Array(W*H*3);
imgs.forEach((im,k)=>{
  const x0 = k*(side+4);
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const sx = cx-half+Math.floor(x/zoom), sy = cy-half+Math.floor(y/zoom);
    const si = (sy*im.w+sx)*4, di = ((y)*W + x0+x)*3;
    px[di]=im.rgba[si]; px[di+1]=im.rgba[si+1]; px[di+2]=im.rgba[si+2];
  }
});
writeFileSync(out, encodePng({width:W,height:H,colorType:2,channels:3,pixels:px}));
console.log(out, W, H);
