#!/usr/bin/env python3
"""Acquire unchanged files from the two reviewed pinned repositories. No guessed connectivity."""
import argparse, hashlib, json, pathlib, re, subprocess, datetime
parser=argparse.ArgumentParser();parser.add_argument('part_id');parser.add_argument('--output',required=True);args=parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}',args.part_id): raise ValueError('Invalid native ID')
base=pathlib.Path(__file__).resolve().parents[1]; out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
roots={s:base/'data/parts-foundation'/p for s,p in [('ldraw','ldraw'),('shadow','shadow')]}
manifests={s:json.loads((r/'manifest.json').read_text()) for s,r in roots.items()}
expected={'ldraw':'https://raw.githubusercontent.com/pybricks/ldraw/c43ed06a128a10ed65675166bf42eb6fd608b9b0/','shadow':'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/9b1131fb1991f8c0bfc072325e4e12f6271aba35/'}
for side in roots:
 if manifests[side]['sourceRoot']!=expected[side]: raise ValueError('Unreviewed source root')
known={s:{f['path']:f for f in m['files']} for s,m in manifests.items()}; files={s:{} for s in roots}; raw={s:{} for s in roots}; attempts=[]
def norm(p):
 p=p.replace('\\','/').lower()
 if not re.fullmatch(r'(?:parts|p)/[a-z0-9_./-]+\.dat',p) or '..' in p.split('/'): raise ValueError('Unsafe dependency')
 return p
def get(side,p,optional=False):
 p=norm(p)
 if p in raw[side]: return raw[side][p]
 if len(attempts)>1500: raise ValueError('Acquisition budget')
 if p in known[side]:
  data=(roots[side]/'files'/p).read_bytes();old=known[side][p]
  if len(data)!=old['bytes'] or hashlib.sha256(data).hexdigest()!=old['sha256']: raise ValueError('Base integrity failure')
  reuse=True
 else:
  url=expected[side]+p
  r=subprocess.run(['curl','--silent','--show-error','--location','--max-redirs','0','--connect-timeout','10','--max-time','25','--max-filesize','4000000','--write-out','\n%{http_code}',url],capture_output=True)
  data,_,status=r.stdout.rpartition(b'\n');status=status.decode(errors='replace');attempts.append({'source':side,'path':p,'url':url,'http':status,'exitCode':r.returncode})
  if r.returncode or status!='200':
   if optional and not r.returncode and status=='404': return None
   raise ValueError(f'Source unavailable: {url}: {status}, curl {r.returncode}')
  dest=out/side/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);reuse=False
 text=data.decode('utf-8-sig'); author=re.search(r'^0\s+Author:\s*(.*)',text,re.M);license=re.search(r'^0\s+!LICENSE\s+(.*)',text,re.M)
 if not license: raise ValueError(f'Missing license {p}')
 lic=license.group(1).strip(); lic='CC-BY-SA-4.0' if lic=='CC BY-SA 4.0, see LICENSE.md' else lic
 files[side][p]={'path':p,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'author':author.group(1).strip() if author else None,'license':lic,**({'reuse':True} if reuse else {})};raw[side][p]=text
 return text
def visit(p,stack=()):
 if p in stack: raise ValueError('Cyclic geometry dependency')
 if p in visited:return
 text=get('ldraw',p);visited.add(p)
 for line in text.splitlines():
  tokens=line.split()
  if tokens and tokens[0]=='1':
   ref=' '.join(tokens[14:]).replace('\\','/').lower(); directory=p.rsplit('/',1)[0]+'/'
   candidates=[ref] if ref.startswith(('parts/','p/')) else ([f'parts/{ref}'] if ref.startswith('s/') else [directory+ref,f'p/{ref}',f'parts/{ref}'])
   found=None
   for candidate in dict.fromkeys(candidates):
    if get('ldraw',candidate,True) is not None:found=candidate;break
   if not found:raise ValueError(f'Missing dependency {ref}')
   visit(found,stack+(p,))
visited=set()
try:
 visit('parts/'+args.part_id+'.dat')
 # Geometry inheritance is also connector inheritance. Missing shadow siblings are allowed, recorded 404s.
 pending=list(visited);seen=set()
 while pending:
  p=pending.pop()
  if p in seen:continue
  seen.add(p);text=get('shadow',p,True)
  if text:
   for ref in re.findall(r'!LDCAD\s+SNAP_INCL.*?\[ref=([^\]]+)\]',text):
    ref=ref.replace('\\','/').lower(); pending.append(ref if ref.startswith(('parts/','p/')) else 'parts/'+ref)
 root=raw['ldraw']['parts/'+args.part_id+'.dat']; name=root.splitlines()[0][2:]; author=files['ldraw']['parts/'+args.part_id+'.dat']['author']
 bundle={'schemaVersion':'bricklab-part-import-bundle-1','partId':args.part_id,'name':name,'author':author,'selectionBasis':'Representative exact native source expansion','importBasis':'Unchanged files from reviewed pinned source closure','reviewer':'source-integrity-and-license-pipeline','allowStagingValidation':True}
 for side,field,library in [('ldraw','geometry','LDraw'),('shadow','connections','LDCadShadowLibrary')]:
  bundle[field]={'library':library,'revision':manifests[side]['revision'],'license':files[side]['parts/'+args.part_id+'.dat']['license'],'sourceUrl':expected[side],'root':'parts/'+args.part_id+'.dat','files':list(files[side].values())}
 import shutil
 license_dir=out/'LICENSES';license_dir.mkdir(exist_ok=True)
 for src,name in [(roots['ldraw']/'CAreadme.txt','LDraw-CAreadme.txt'),(roots['ldraw']/'CAlicense4.txt','LDraw-CC-BY-4.txt'),(roots['shadow']/'LICENSE.md','Shadow-CC-BY-SA-4.md')]: shutil.copyfile(src,license_dir/name)
 (out/'ATTRIBUTION.md').write_text('Pinned native source bundle. Each author, licence, URL and digest is recorded per file in bundle.json. Reused dependencies require the matching reviewed base library. Licence texts are in LICENSES. No application-wide or third-party Studio/PDF licence is granted.\n')
 (out/'bundle.json').write_text(json.dumps(bundle,indent=2)+'\n');print(json.dumps({'part':args.part_id,'geometryFiles':len(files['ldraw']),'shadowFiles':len(files['shadow']),'newGeometry':sum(not f.get('reuse') for f in files['ldraw'].values())}))
finally:
 (out/'acquisition.json').write_text(json.dumps({'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'attempts':attempts},indent=2)+'\n')
