import json,sys,re
from pathlib import Path
from sql_reader import rows,php_array,ROOT
records=list(rows()); posts={v[0]:{'id':v[0],'date':v[2],'html':v[4],'title':v[5],'status':v[7],'slug':v[11],'modified':v[14],'parent':v[17],'type':v[20]} for t,n,v in records if t=='wp_posts'}
meta={}
for t,n,v in records:
 if t=='wp_postmeta':meta.setdefault(v[1],{})[v[2]]=v[3]
def unser(s):
 try:return php_array(s)
 except:return {}
terms={v[0]:v[1] for t,n,v in records if t=='wp_terms'}
tax={v[0]:terms.get(v[1],'') for t,n,v in records if t=='wp_term_taxonomy' and v[2]=='category'}
for p in posts.values():
 p['categories']=[tax[v[1]] for t,n,v in records if t=='wp_term_relationships' and v[0]==p['id'] and v[1] in tax]
 p['meta']={k:v for k,v in meta.get(p['id'],{}).items() if k in ['_thumbnail_id','_wp_attached_file','_wp_attachment_image_alt','_EventStartDate','_EventEndDate','_EventVenueID','_EventOrganizerID','ecwd_event_date_from','ecwd_event_date_to','ecwd_event_repeat_event']}
 if p['type']=='envira':p['gallery']=unser(meta.get(p['id'],{}).get('_eg_gallery_data','')).get('gallery',{})
media=[]
for id,m in meta.items():
 if '_wp_attached_file' in m:
  data=unser(m.get('_wp_attachment_metadata','')); media.append({'id':id,'file':m['_wp_attached_file'],'sizes':[str(Path(m['_wp_attached_file']).parent/x['file']).replace('\\','/') for x in data.get('sizes',{}).values()],'alt':m.get('_wp_attachment_image_alt',''),'title':posts.get(id,{}).get('title',''),'caption':posts.get(id,{}).get('html','')})
events=[{'id':'mc-'+v[0],'legacyId':v[17],'title':v[3],'start':v[1]+'T'+v[8],'end':v[2]+'T'+v[9],'description':v[4],'recurrence':v[10],'allDay':v[8]=='00:00:00'} for t,n,v in records if t=='wp_my_calendar']
other={}
for t,n,v in records:
 if t in ['wp_bwg_gallery','wp_bwg_image','wp_huge_itgallery_gallerys','wp_huge_itgallery_images']:other.setdefault(t,[]).append(v)
out={'posts':[p for p in posts.values() if p['status']=='publish'],'media':media,'events':events,'legacyGalleries':other}
path=Path(__file__).resolve().parents[1]/'.import/source.json';path.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
print('Exported public records:',len(out['posts']),'attachments:',len(media),'calendar:',len(events))
