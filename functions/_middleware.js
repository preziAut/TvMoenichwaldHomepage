import {ids, media} from '../src/data/legacy-redirects.js';
export async function onRequest(context){
 const u=new URL(context.request.url);let pathname;try{pathname=decodeURIComponent(u.pathname);}catch{return new Response('Ungültige URL',{status:400});}
 const redirect=target=>Response.redirect(new URL(target,u.origin).href,301);
 if(pathname==='/ep3wa'||pathname.startsWith('/ep3wa/')){
  if(!context.env.WALDBACH_URL)return new Response('Die Reservierung ist vorübergehend nicht erreichbar.',{status:503});
  const target=new URL(context.env.WALDBACH_URL);if(target.origin===u.origin||target.protocol!=='https:')return new Response('Buchungsadresse nicht eingerichtet.',{status:503});
  target.pathname=target.pathname.replace(/\/$/,'')+pathname.slice('/ep3wa'.length);target.search=u.search;return Response.redirect(target.href,302);
 }
 if(pathname==='/joomla/images/webcampic/tv.jpg')return context.env.WEBCAM_URL?Response.redirect(context.env.WEBCAM_URL,302):new Response('Webcam nicht verfügbar',{status:503});
 if(media[pathname])return redirect(media[pathname]);
 if(['/','/wp','/wp/','/wp/index.php','/index.php'].includes(pathname)){
  const id=u.searchParams.get('page_id')||u.searchParams.get('p');
  if(id){if(Object.hasOwn(ids,id))return redirect(ids[id]);const page=await context.env.ASSETS.fetch(new URL('/404.html',u.origin));return new Response(page.body,{status:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  if(pathname!=='/')return redirect('/');
 }
 return context.next();
}
