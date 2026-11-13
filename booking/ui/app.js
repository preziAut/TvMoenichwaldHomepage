const $=id=>document.getElementById(id);
const errors={FORBIDDEN:'Dafür fehlt die Berechtigung.',SLOT_TAKEN:'Diese Zeit wurde inzwischen belegt. Bitte wähle eine andere.',
  CANCELLATION_CLOSED:'Die Stornierungsfrist ist abgelaufen oder Stornieren ist deaktiviert.',
  OUTSIDE_BOOKING_WINDOW:'Die Buchung muss in der Zukunft und innerhalb des Buchungszeitraums liegen.',
  INVALID_SLOT:'Bitte wähle eine gültige Zeit innerhalb der Öffnungszeiten und der maximalen Dauer.',
  POLICY_CHANGED:'Die Regeln wurden inzwischen geändert. Bitte lade die Ansicht neu.',INVALID_POLICY:'Bitte prüfe die Einstellungen.',
  BOOKING_LIMIT:'Du hast die maximale Anzahl aktiver Buchungen erreicht.',REASON_REQUIRED:'Bitte gib eine Begründung mit mindestens drei Zeichen an.',
  IDEMPOTENCY_MISMATCH:'Diese Anfrage wurde bereits mit anderen Daten verwendet. Bitte öffne den Dialog erneut.',
  DEMO_SESSION_REQUIRED:'Die Testsitzung ist abgelaufen. Bitte wähle die Testrolle erneut.'};
let state,selected,requestKey;
const displayTime=iso=>new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
const displayDate=iso=>new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',dateStyle:'medium',timeStyle:'short'}).format(new Date(iso));
async function api(path,method='GET',body) {
  const response=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok) throw new Error(errors[data.error]??'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.');
  return data;
}
function notice(text,error=false) {$('message').textContent=text;$('message').classList.toggle('error',error);}
function node(tag,text,cls) {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function tabs(admin) {
  $('calendar-view').hidden=admin;$('admin-view').hidden=!admin;
  $('calendar-tab').setAttribute('aria-pressed',String(!admin));$('admin-tab').setAttribute('aria-pressed',String(admin));
}
function policyPreview() {
  const seconds=Number($('cancel-value').value)*Number($('cancel-unit').value);
  $('policy-preview').textContent=!$('cancel-enabled').checked?'Mitglieder können neue Buchungen nicht selbst stornieren.':
    seconds===0?'Neue Buchungen können bis zum Beginn storniert werden.':`Neue Buchungen sind bis ${seconds/60} Minuten vor Beginn stornierbar.`;
}
function render() {
  $('admin-tab').hidden=state.role!=='admin';
  $('rules').textContent=`Bis zu ${state.policy.advanceDays} Tage voraus · maximal ${state.policy.maxDurationMinutes/60} Stunden`;
  $('calendar-head').replaceChildren();const heading=node('tr');heading.append(node('th','Zeit'));
  state.courts.forEach(c=>heading.append(node('th',c.name)));$('calendar-head').append(heading);
  $('calendar-body').replaceChildren();
  for(const slot of state.slots) {
    const row=node('tr');const time=node('th',slot.label);time.scope='row';row.append(time);
    for(const court of state.courts) {
      const item=state.allocations.find(r=>r.courtId===court.id&&r.startsAt<slot.endsAt&&r.endsAt>slot.startsAt);
      const label=item?(item.kind==='block'?'Gesperrt':item.ownedByMe?'Meine Buchung':'Belegt'):'Reservieren +';
      const button=node('button',label,`slot ${item?(item.kind==='block'?'block':item.ownedByMe?'mine':'occupied'):''}`);
      button.type='button';button.setAttribute('aria-label',`${court.name}, ${slot.label}, ${label}`);
      button.disabled=item?(!item.ownedByMe&&state.role!=='admin'):new Date(slot.startsAt)<=new Date();
      button.addEventListener('click',()=>openDialog(court,slot,item));
      const cell=node('td');cell.append(button);row.append(cell);
    }
    $('calendar-body').append(row);
  }
  $('cancel-enabled').checked=state.policy.cancellationEnabled;$('cancel-unit').value='3600';
  $('cancel-value').value=String(state.policy.cancellationSeconds/3600);
  $('revision').textContent=`Aktuelle Regelversion: ${state.policy.revision}`;policyPreview();
}
async function refresh() {state=await api(`/api/state?day=${encodeURIComponent($('day').value)}`);render();}
async function chooseIdentity() {
  try{await api('/api/demo-session','POST',{choice:$('identity').value});await refresh();tabs(false);notice('');}
  catch(error){notice(error.message,true);}
}
function openDialog(court,slot,item) {
  selected={court,slot,item};requestKey=crypto.randomUUID();$('dialog-error').textContent='';$('reason').value='';$('kind').value='booking';
  $('booking-title').textContent=item?'Reservierung aufheben':`${court.name} reservieren`;
  $('booking-summary').textContent=item?`${court.name} · ${displayDate(item.startsAt)} – ${displayTime(item.endsAt)}`:`${court.name} · ${displayDate(slot.startsAt)}`;
  $('create-fields').hidden=Boolean(item);$('kind-label').hidden=state.role!=='admin';
  $('reason-label').hidden=!(item&&state.role==='admin');
  $('reason').required=Boolean(item&&state.role==='admin');
  $('confirm').textContent=item?'Reservierung aufheben':'Verbindlich reservieren';
  $('dialog-note').textContent=item?(state.role==='admin'?'Als Administrator wird die Aufhebung mit Begründung protokolliert.':
    `Stornierbar bis ${displayDate(item.cancellationDeadline)}.`):
    (state.policy.cancellationEnabled?`Stornierungsfrist: ${state.policy.cancellationSeconds/60} Minuten vor Beginn.`:'Für diese Buchung ist die eigene Stornierung deaktiviert.');
  $('booking-dialog').showModal();
}
$('identity').addEventListener('change',chooseIdentity);
$('day').addEventListener('change',()=>refresh().catch(e=>notice(e.message,true)));
$('calendar-tab').addEventListener('click',()=>tabs(false));
$('admin-tab').addEventListener('click',()=>tabs(true));
$('close-dialog').addEventListener('click',()=>$('booking-dialog').close());
$('kind').addEventListener('change',()=>{
  const blocked=$('kind').value==='block';$('reason-label').hidden=!blocked;$('reason').required=blocked;
  $('confirm').textContent=blocked?'Platz sperren':'Verbindlich reservieren';
});
for(const id of ['cancel-enabled','cancel-value','cancel-unit']) $(id).addEventListener('input',policyPreview);
$('booking-form').addEventListener('submit',async event=>{
  event.preventDefault();$('confirm').disabled=true;$('dialog-error').textContent='';
  try {
    if(selected.item) await api(`/api/bookings/${selected.item.id}`,'DELETE',state.role==='admin'?{reason:$('reason').value}:{});
    else {
      const minutes=Number($('duration').value);
      await api('/api/bookings','POST',{courtId:selected.court.id,startsAt:selected.slot.startsAt,
        endsAt:new Date(Date.parse(selected.slot.startsAt)+minutes*60000).toISOString(),requestKey,
        kind:$('kind').value,...($('kind').value==='block'?{reason:$('reason').value}:{})});
    }
    $('booking-dialog').close();await refresh();notice(selected.item?'Die Reservierung wurde aufgehoben.':'Deine Testreservierung wurde gespeichert.');
  }catch(error){$('dialog-error').textContent=error.message;}finally{$('confirm').disabled=false;}
});
$('policy-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;
  try {
    const seconds=Number($('cancel-value').value)*Number($('cancel-unit').value);
    if(!Number.isSafeInteger(seconds)||seconds<0||seconds>2592000) throw new Error('Bitte eine Frist zwischen 0 und 720 Stunden mit ganzen Sekunden eingeben.');
    await api('/api/policy','POST',{expectedRevision:state.policy.revision,policy:{...state.policy,cancellationEnabled:$('cancel-enabled').checked,cancellationSeconds:seconds}});
    await refresh();notice('Gespeichert. Die neue Stornierungsfrist gilt für neue Buchungen.');
  }catch(error){notice(error.message,true);}finally{button.disabled=false;}
});
const tomorrow=new Date(Date.now()+86400000);
const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vienna',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(tomorrow).map(p=>[p.type,p.value]));
$('day').value=`${dateParts.year}-${dateParts.month}-${dateParts.day}`;
await chooseIdentity();
