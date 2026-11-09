import { inflateSync, deflateSync } from 'node:zlib';

// Build-time PNG thumbnail generator. Zero third-party dependencies.
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CHANNELS={0:1,2:3,3:1,4:2,6:4};
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{
  let c=i;
  for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
  return c>>>0;
});
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function chunk(type,body=Buffer.alloc(0)){
  const tag=Buffer.from(type,'ascii'),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  crc.writeUInt32BE(crc32(Buffer.concat([tag,body])));
  return Buffer.concat([len,tag,body,crc]);
}
function decodePNG(png){
  if(!Buffer.isBuffer(png)||!png.subarray(0,8).equals(SIGNATURE))throw Error('Not a PNG file');
  let width=0,height=0,depth=0,type=0,interlace=0,palette=null,alpha=null;
  const payload=[];
  let offset=8;
  while(offset+12<=png.length){
    const len=png.readUInt32BE(offset),name=png.toString('ascii',offset+4,offset+8);
    if(offset+12+len>png.length)throw Error('Truncated PNG');
    const v=png.subarray(offset+8,offset+8+len);
    offset+=12+len;
    if(name==='IHDR'){
      width=v.readUInt32BE(0);height=v.readUInt32BE(4);
      depth=v[8];type=v[9];interlace=v[12];
    }else if(name==='IDAT')payload.push(v);
    else if(name==='PLTE')palette=v;
    else if(name==='tRNS')alpha=v;
    else if(name==='IEND')break;
  }
  const channels=CHANNELS[type];
  if(!width||!height||width>12000||height>12000||!channels||
      interlace!==0||![8,16].includes(depth)||(type===3&&depth!==8))
    throw Error('Unsupported PNG format '+width+'x'+height+' depth '+depth+' type '+type);
  const byteDepth=depth/8,bpp=channels*byteDepth,stride=width*bpp;
  const input=inflateSync(Buffer.concat(payload));
  if(input.length<(stride+1)*height)throw Error('Truncated PNG pixels');
  const pixels=Buffer.alloc(stride*height);
  let cursor=0;
  for(let y=0;y<height;y++){
    const filter=input[cursor++],row=y*stride,prev=(y-1)*stride;
    if(filter>4)throw Error('Unknown PNG filter '+filter);
    for(let x=0;x<stride;x++){
      const left=x>=bpp?pixels[row+x-bpp]:0;
      const up=y>0?pixels[prev+x]:0;
      const ul=y>0&&x>=bpp?pixels[prev+x-bpp]:0;
      let pred=0;
      if(filter===1)pred=left;
      else if(filter===2)pred=up;
      else if(filter===3)pred=Math.floor((left+up)/2);
      else if(filter===4){
        const p=left+up-ul,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-ul);
        pred=a<=b&&a<=c?left:b<=c?up:ul;
      }
      pixels[row+x]=(input[cursor++]+pred)&255;
    }
  }
  return {width,height,pixels,type,byteDepth,bpp,palette,alpha};
}
export function makePreviewPNGDataURI(buffer,maxWidth=144){
  const pic=decodePNG(buffer);
  const w=Math.min(maxWidth,pic.width),h=Math.max(1,Math.round(pic.height*w/pic.width));
  const raw=Buffer.alloc(h*(1+w*3));
  for(let y=0;y<h;y++){
    const sy=Math.min(pic.height-1,Math.floor((y+.5)*pic.height/h));
    for(let x=0;x<w;x++){
      const sx=Math.min(pic.width-1,Math.floor((x+.5)*pic.width/w));
      const q=(sy*pic.width+sx)*pic.bpp;
      const data=pic.pixels,d=pic.byteDepth;
      let r=0,g=0,b=0,a=255;
      switch(pic.type){
        case 0:r=g=b=data[q];break;
        case 2:r=data[q];g=data[q+d];b=data[q+2*d];break;
        case 3:{
          const i=data[q];r=pic.palette?.[i*3]??0;
          g=pic.palette?.[i*3+1]??0;b=pic.palette?.[i*3+2]??0;
          a=pic.alpha?.[i]??255;break;
        }
        case 4:r=g=b=data[q];a=data[q+d];break;
        case 6:r=data[q];g=data[q+d];b=data[q+2*d];a=data[q+3*d];break;
      }
      const p=y*(1+w*3)+1+x*3;
      if(a===255){raw[p]=r;raw[p+1]=g;raw[p+2]=b;}
      else{
        raw[p]=Math.round((r*a+255*(255-a))/255);
        raw[p+1]=Math.round((g*a+255*(255-a))/255);
        raw[p+2]=Math.round((b*a+255*(255-a))/255);
      }
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const thumb=Buffer.concat([
    SIGNATURE,chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(raw,{level:7})),chunk('IEND')
  ]);
  return 'data:image/png;base64,'+thumb.toString('base64');
}
