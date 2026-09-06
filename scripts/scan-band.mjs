/* A horizontal band from each of several pages, stacked. Reading an invoice
 * number off ten pages should not cost ten full pages. */
import fs from 'node:fs'
import zlib from 'node:zlib'
const pdfjs = await import(new URL('file:///C:/Users/davga/Skipper%20Management/node_modules/pdfjs-dist/legacy/build/pdf.mjs').href)
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
const crc=(b)=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0}
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,'latin1'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
const grayPng=(w,h,px)=>{const raw=Buffer.alloc((w+1)*h)
  for(let y=0;y<h;y++){raw[y*(w+1)]=0;px.copy(raw,y*(w+1)+1,y*w,y*w+w)}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=0
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])}
async function pageGray(doc,n){const page=await doc.getPage(n);const ops=await page.getOperatorList();const names=[]
  for(let i=0;i<ops.fnArray.length;i++) if(ops.fnArray[i]===pdfjs.OPS.paintImageXObject) names.push(ops.argsArray[i][0])
  if(!names.length) return null
  const nm=names[0]; const img=page.objs.has(nm)?page.objs.get(nm):doc.commonObjs.get(nm)
  const {width:w,height:h,kind,data}=img; const px=Buffer.alloc(w*h)
  if(kind===1){const st=(w+7)>>3;let ones=0
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const b=(data[y*st+(x>>3)]>>(7-(x&7)))&1;ones+=b;px[y*w+x]=b?255:0}
    if(ones<w*h/2)for(let i=0;i<px.length;i++)px[i]=255-px[i]}
  else if(kind===3){for(let i=0,j=0;i<w*h;i++,j+=4)px[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  else if(kind===2){for(let i=0,j=0;i<w*h;i++,j+=3)px[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  else return null
  return {w,h,px}}
const rot=({w,h,px})=>{const o=Buffer.alloc(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)o[(w-1-x)*h+y]=px[y*w+x];return {w:h,h:w,px:o}}

const [src,out,pagesArg,fromPct,toPct] = process.argv.slice(2)
const pages = pagesArg.split(',').map(Number)
const f = Number(fromPct)/100, t = Number(toPct)/100
const doc = await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(src))}).promise
const strips = []
for (const n of pages){ let g = await pageGray(doc,n); if(!g) continue; if(g.w>g.h) g=rot(g)
  const y0=Math.floor(g.h*f), y1=Math.floor(g.h*t), hh=y1-y0
  const s=Buffer.alloc(g.w*hh); g.px.copy(s,0,y0*g.w,y1*g.w)
  strips.push({n,w:g.w,h:hh,px:s}) }
const W = Math.max(...strips.map(s=>s.w))
const H = strips.reduce((a,s)=>a+s.h+8,8)
const canvas = Buffer.alloc(W*H, 90)
let y=8
for (const s of strips){ for(let r=0;r<s.h;r++) Buffer.from(s.px.subarray(r*s.w,r*s.w+s.w)).copy(canvas,(y+r)*W); y+=s.h+8 }
fs.writeFileSync(out, grayPng(W,H,canvas))
console.log(`${out} ${W}x${H}  pages ${strips.map(s=>s.n).join(',')} top-to-bottom`)
