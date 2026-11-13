const reply=(status,message)=>Response.json({message},{status,headers:{'Cache-Control':'no-store'}});
export async function onRequest({request,env}){
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
 const origin=new URL(request.url).origin;if(request.headers.get('Origin')!==origin)return reply(403,'Anfrage nicht erlaubt.');
 if(!env.RESEND_API_KEY||!env.TURNSTILE_SECRET_KEY||!env.CONTACT_FROM||!env.CONTACT_TO)return reply(503,'Das Formular ist noch nicht freigeschaltet. Bitte kontaktiere uns direkt per E-Mail.');
 if(Number(request.headers.get('content-length'))>18000)return reply(413,'Die Nachricht ist zu lang.');
 try{
  const bytes=await request.arrayBuffer();if(bytes.byteLength>18000)return reply(413,'Die Nachricht ist zu lang.');
  const f=await new Request(request.url,{method:'POST',headers:{'Content-Type':request.headers.get('Content-Type')||''},body:bytes}).formData();
  const read=k=>typeof f.get(k)==='string'?f.get(k).trim():'';
  if(read('website'))return reply(400,'Die Anfrage konnte nicht verarbeitet werden.');
  const name=read('name'),email=read('email'),subject=read('subject'),message=read('message'),token=read('cf-turnstile-response');
  if(name.length<2||name.length>100||subject.length<2||subject.length>150||message.length<10||message.length>5000||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n]/.test(name+email+subject)||read('privacy')!=='yes'||!token)return reply(400,'Bitte alle Felder ausfüllen und den Spam-Schutz bestätigen.');
  const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:request.headers.get('CF-Connecting-IP')||''}),signal:AbortSignal.timeout(10000)});
  const result=await verification.json();if(!result.success||result.hostname!==new URL(origin).hostname||result.action!=='contact')return reply(400,'Der Spam-Schutz ist abgelaufen. Bitte erneut bestätigen.');
  const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.CONTACT_FROM,to:[env.CONTACT_TO],reply_to:email,subject:`Website: ${subject}`,text:`Name: ${name}\nE-Mail: ${email}\n\n${message}`}),signal:AbortSignal.timeout(15000)});
  if(!sent.ok)return reply(502,'Der Versand ist gerade nicht möglich. Bitte versuche es später oder per E-Mail.');
  return reply(200,'Vielen Dank! Deine Nachricht wurde übermittelt.');
 }catch{return reply(502,'Der Versand ist gerade nicht möglich. Bitte versuche es später oder per E-Mail.');}
}
