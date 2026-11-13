import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import sanitize from 'sanitize-html';
import Turndown from 'turndown';
import {load} from 'cheerio';
const root=process.cwd(), source=JSON.parse(await fs.readFile('.import/source.json','utf8'));
const uploads=path.resolve(root,'../Wiederherstellung/FTP-Upload/wp/wp-content/uploads');
for(const d of ['public/media','src/data','docs','src/content/seiten','src/content/beitraege','src/content/ergebnisse','src/content/galerien','src/content/termine']) await fs.mkdir(d,{recursive:true});
const json=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const slug=s=>s.toLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const paths={'34':'/wechsellandcup/','35':'/verein/','36':'/kontakt/','51':'/webcam/','60':'/reservierung/','108':'/bilder/','698':'/mitgliedschaft/','610':'/','742':'/veranstaltungen/'};
const ids={}, media={}, byFile={}, issues=[], inventory=[];
for(const p of source.posts){ if(['page','post'].includes(p.type)) ids[p.id]=paths[p.id]||`/${/^\d{4}$/.test(p.title)?'ergebnisse':'beitraege'}/${slug(p.title)}-${p.id}/`; else if(p.type==='envira')ids[p.id]=`/galerien/${slug(p.title)}-${p.id}/`; }
async function asset(file){
 file=decodeURIComponent(file).replaceAll('\\','/'); if(byFile[file])return byFile[file];
 const input=path.resolve(uploads,file); if(!input.startsWith(uploads+path.sep))throw Error('Invalid media path');
 const hash=crypto.createHash('sha256').update(file).digest('hex').slice(0,14),ext=path.extname(file).toLowerCase();
 try{
  if(['.jpg','.jpeg','.png'].includes(ext)){
   const image=sharp(input).rotate(); const meta=await image.metadata();
   for(const width of [640,1600]){const output=`public/media/${hash}-${width}.webp`;let cached=false;try{cached=(await fs.stat(output)).mtimeMs>=(await fs.stat(input)).mtimeMs;}catch{}if(!cached)await image.clone().resize({width,withoutEnlargement:true}).webp({quality:82}).toFile(output);}
   byFile[file]={src:`/media/${hash}-1600.webp`,thumb:`/media/${hash}-640.webp`,width:meta.width,height:meta.height};
  }else if(['.pdf','.xlsx','.mp4'].includes(ext)){await fs.copyFile(input,`public/media/${hash}${ext}`);byFile[file]={src:`/media/${hash}${ext}`};}
  else return null;
  return byFile[file];
 }catch(e){issues.push({file,reason:'Missing or undecodable media',detail:e.message});return null;}
}
for(const a of source.media){const item=await asset(a.file);if(item){media[a.id]={...item,alt:a.alt,title:a.title};for(const file of [a.file,...a.sizes])byFile[file]=item;}}
function url(u){
 if(!u)return '';try{const parsed=new URL(u,'https://www.tv-moenichwald.at');
 if(!['www.tv-moenichwald.at','tv-moenichwald.at'].includes(parsed.hostname))return u;
 const id=parsed.searchParams.get('page_id')||parsed.searchParams.get('p');if(id&&ids[id])return ids[id];
 const file=decodeURIComponent(parsed.pathname.split('/wp-content/uploads/')[1]||'');if(file&&byFile[file])return byFile[file].src;
 if(parsed.pathname==='/ep3wa'||parsed.pathname.startsWith('/ep3wa/'))return '/reservierung/';
 return u;
 }catch{return '';}
}
const td=new Turndown({headingStyle:'atx',bulletListMarker:'-'});
td.addRule('table',{filter:'table',replacement:(_c,node)=>'\n\n'+node.outerHTML+'\n\n'});
function clean(html){
 if(!/<(?:p|div|ul|ol|table|figure|h[1-6])\b/i.test(html||''))html=(html||'').replace(/\r?\n/g,'<br>');
 const $=load(html||'',null,false);$('script,iframe,style,form,input,textarea,button').remove();
 $('h1').each((_,e)=>{$(e).replaceWith(`<h2>${$(e).html()}</h2>`)});
 $('a').each((_,e)=>{$(e).attr('href',url($(e).attr('href')))});
 $('img').each((_,e)=>{const old=$(e).attr('src');$(e).attr('src',url(old));$(e).removeAttr('srcset');});
 const safe=sanitize($.html(),{allowedTags:sanitize.defaults.allowedTags.concat(['img','figure','figcaption']),allowedAttributes:{a:['href','title'],img:['src','alt'],td:['colspan','rowspan'],th:['colspan','rowspan']},allowedSchemes:['http','https','mailto','tel']});
 return td.turndown(safe).replace(/\[my_calendar[^\]]*\]/g,'[Alle Veranstaltungen](/veranstaltungen/)').replace(/\[ecwd[^\]]*\]/g,'[Veranstaltungsarchiv](/veranstaltungen/)');
}
async function markdown(collection,id,front,body){await fs.writeFile(`src/content/${collection}/${id}.md`,'---\n'+Object.entries(front).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n'+body+'\n');}
for(const p of source.posts.filter(p=>p.type==='envira')){
 const images=[];for(const [id,img] of Object.entries(p.gallery||{})){if(img.status!=='active')continue;let m=media[id];if(!m){const file=img.src?.split('/wp-content/uploads/')[1];if(file)m=await asset(file);}if(m)images.push({...m,alt:img.alt||p.title,caption:clean(img.caption||''),title:img.title||''});}
 await json(`src/content/galerien/${slug(p.title)}-${p.id}.json`,{title:p.title,legacyId:p.id,url:ids[p.id],images});
 inventory.push({id:p.id,type:p.type,title:p.title,target:ids[p.id],status:images.length?'migrated':'empty-gallery-preserved'});
}
// Preserve the two older real gallery tables as separate ordered albums.
for(const [kind,title,rows] of [
 ['bwg','Sektturnier 2016 – Photo Gallery',source.legacyGalleries.wp_bwg_image.slice().sort((a,b)=>Number(a[13])-Number(b[13]))],
 ['huge','Sektturnier 2016 – Galerie',source.legacyGalleries.wp_huge_itgallery_images.filter(r=>r[9]==='2')]
]){
 const images=[];
 for(const r of rows){const file=kind==='bwg'?'2017/04'+r[4]:r[4].split('/wp-content/uploads/')[1];const m=byFile[file]||await asset(file);if(m)images.push({...m,alt:title,caption:kind==='huge'?clean(r[3]):'',title:kind==='bwg'?r[2]:r[1]});}
 await json(`src/content/galerien/alt-${kind}.json`,{title,url:`/galerien/alt-${kind}/`,images});
}
for(const p of source.posts.filter(p=>['page','post'].includes(p.type))){
 let html=p.html;
 html=html.replace(/\[envira-gallery[^\]]*id=["']?(\d+)[^\]]*\]/g,(_,id)=>`<p><a href="${ids[id]||'/bilder/'}">${source.posts.find(p=>p.id===id)?.title||'Bildergalerie'} ansehen</a></p>`);
 html=html.replace(/<!--\s*wp:envira\/envira-gallery\s+({.*?})\s*\/?-->/g,(_,data)=>{try{const id=JSON.parse(data).galleryId;return `<p><a href="${ids[id]||'/bilder/'}">Bildergalerie ansehen</a></p>`;}catch{return '';}});
 let body=clean(html);const collection=p.type==='page'?'seiten':/^\d{4}$/.test(p.title)?'ergebnisse':'beitraege';
 const front={title:p.title,legacyId:p.id,url:ids[p.id],date:p.date.slice(0,10),modified:p.modified.slice(0,10),categories:p.categories,description:body.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[#*\[\]<>]/g,'').replace(/\s+/g,' ').slice(0,170),image:media[p.meta._thumbnail_id]?.src||'',year:/\b(20\d{2})\b/.exec(p.title)?.[1]||p.date.slice(0,4)};
 await markdown(collection,p.id,front,body);
 inventory.push({id:p.id,type:p.type,title:p.title,oldUrl:`/wp/?${p.type==='page'?'page_id':'p'}=${p.id}`,target:ids[p.id],status:'migrated'});
}
const events=[...source.events];
for(const p of source.posts.filter(p=>['tribe_events','ecwd_event'].includes(p.type))){
 if(/^EVENT \d+$/.test(p.title)){inventory.push({id:p.id,type:p.type,title:p.title,status:'excluded-demo',reason:'Unmodified plugin demo event'});continue;}
 const m=p.meta;events.push({id:`${p.type}-${p.id}`,legacyId:p.id,title:p.title,start:(m._EventStartDate||m.ecwd_event_date_from||'').replaceAll('/','-').replace(' ','T'),end:(m._EventEndDate||m.ecwd_event_date_to||'').replaceAll('/','-').replace(' ','T'),description:clean(p.html),recurrence:m.ecwd_event_repeat_event||'none',allDay:false});
}
for(const e of events){e.url=`/termine/${e.id}/`;ids[e.legacyId]=e.url;await json(`src/content/termine/${e.id}.json`,e);inventory.push({id:e.legacyId,type:'event',title:e.title,target:e.url,status:'migrated'});}
const reasons={nav_menu_item:'Navigation reconstructed in site configuration',cryout_serious_slide:'Slide content retained as historical gallery image; new static hero',wpcf7_contact_form:'Replaced by contact endpoint',elementor_library:'Editor configuration, no public content',wp_global_styles:'Replaced by Tailwind design',custom_css:'Replaced by Tailwind design',ecwd_calendar:'Replaced by events collection',tribe_organizer:'Related organizer metadata retained in migration source locally',tribe_venue:'Related venue metadata retained in migration source locally',ecwd_venue:'Plugin demo venue',ecwd_organizer:'Plugin demo organizer'};
for(const p of source.posts)if(!inventory.some(x=>x.id===p.id))inventory.push({id:p.id,type:p.type,title:p.title,status:'replaced-or-archived',reason:reasons[p.type]||'Requires review'});
await json('src/data/legacy-ids.json',ids);
const legacyMedia={};for(const [file,m]of Object.entries(byFile)){legacyMedia['/wp/wp-content/uploads/'+file]=m.src;legacyMedia['/wp-content/uploads/'+file]=m.src;}
await json('src/data/legacy-media.json',legacyMedia);await json('src/data/media.json',media);await json('docs/migration-inventory.json',inventory);
await json('docs/media-report.json',{attachments:source.media.length,migrated:Object.keys(media).length,issues,excludedLegacyDemoImages:9,legacyGalleryTables:Object.fromEntries(Object.entries(source.legacyGalleries).map(([k,v])=>[k,v.length]))});
await json('src/data/hero.json',media['407']);
await json('docs/plugin-records.json',source.posts.filter(p=>['tribe_organizer','tribe_venue'].includes(p.type)).map(p=>({id:p.id,type:p.type,title:p.title,content:clean(p.html)})));
console.log(JSON.stringify({publicRecords:inventory.length,regular:inventory.filter(x=>['page','post'].includes(x.type)).length,media:Object.keys(media).length,events:events.length,issues},null,2));
