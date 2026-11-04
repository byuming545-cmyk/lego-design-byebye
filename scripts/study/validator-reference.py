"""D: Run only reviewed AST definitions, no third-party entrypoints/installers.
Requires the exact separately checked-out MIT reference. Never imported by production.
"""
import ast, contextlib, io, json, os, re, subprocess, sys
from pathlib import Path
from typing import Any, Dict, List, Optional
repo=Path(sys.argv[1]); fixtures=json.loads(Path(sys.argv[2]).read_text());output=Path(sys.argv[3])
revision=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
if revision!='0635308c5e0876de20633fecd7eb718ebd554b7c':raise ValueError('Unreviewed external version')
def selected(file,name,namespace):
 tree=ast.parse((repo/file).read_text());node=next(n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name==name)
 exec(compile(ast.Module(body=[node],type_ignores=[]),str(file),'exec'),namespace)
 return namespace[name]
namespace={'os':os,'re':re,'List':List,'Dict':Dict,'Any':Any,'Optional':Optional}
Parser=selected(Path('src/validator/shadow_parser.py'),'ShadowParser',namespace)
check=selected(Path('src/validator/connections.py'),'check_explicit_connection',{'Dict':Dict,'Any':Any})
parser=Parser(fixtures['shadowDirectory']);parsed=[]
for part in fixtures['parts']:
 log=io.StringIO()
 with contextlib.redirect_stdout(log):points=parser.parse_part('parts/'+part+'.dat')
 parsed.append({'partId':part,'externalPoints':len(points),'diagnostics':log.getvalue().splitlines(),'scope':'Only this reference shadow parser, not its full checker.'})
comparisons=[{'case':item['case'],'externalAccepts':check(item['a'],item['b']),'ourResult':item['ourResult'],'scope':'Interface check only; no source admission, geometry or collision assertion.'} for item in fixtures['connections']]
output.write_text(json.dumps({'revision':revision,'parser':parsed,'connections':comparisons,'executed':'Only two reviewed AST definitions, no package install or repository script entrypoint.','productionAuthority':False},indent=2)+'\n')
