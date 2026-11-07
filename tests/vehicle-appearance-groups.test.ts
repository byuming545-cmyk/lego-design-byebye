import {beforeAll,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
import {appearanceGroups,groupPresentation,GROUP_NOTICE} from "../src/vehicles/appearance-groups.js";
import {createDesignDraft,PAINT_PRESETS} from "../src/vehicles/appearance-design.js";
import type {BodyPreview} from "../src/vehicles/body-preview.js";
let models:BodyPreview[];
beforeAll(async()=>{models=await Promise.all(["charger","golf"].map(async id=>JSON.parse(await readFile(`public/vehicle-demos/${id}.json`,"utf8")).preview.model));});
it("covers every actual instance exactly once, preserves native kind counts and all module lineage",()=>{
 for(const base of models){const before=JSON.stringify(base),g=appearanceGroups(base),members=g.groups.flatMap(x=>x.members);expect(members.map(p=>p.instanceId).sort()).toEqual(base.placements.map(p=>p.instanceId).sort());expect(new Set(members.map(p=>p.instanceId)).size).toBe(base.placements.length);expect(new Set(members.map(p=>p.partId)).size).toBe(base.sources.length);expect(g.status).toBe("DRAFT_NOT_BUILD_INSTRUCTIONS");expect(g.notice).toBe(GROUP_NOTICE);for(const m of members)expect(m.craft).toEqual(base.placements.find(p=>p.instanceId===m.instanceId)!.craft??null);expect(JSON.stringify(base)).toBe(before);}
});
it("reveals cumulative groups and highlights only current members, then restores all",()=>{
 for(const base of models){const g=appearanceGroups(base);for(let i=0;i<g.groups.length;i++){const view=groupPresentation(g,i);expect(view.visibleInstanceIds).toHaveLength(g.groups.slice(0,i+1).reduce((n,g)=>n+g.members.length,0));expect(view.highlightInstanceIds).toEqual(g.groups[i].members.map(p=>p.instanceId));}expect(groupPresentation(g,null)).toEqual({visibleInstanceIds:undefined,highlightInstanceIds:undefined});for(const i of [-1,1.5,g.groups.length])expect(()=>groupPresentation(g,i)).toThrow("GROUP_INDEX_INVALID");}
});
it("colour and visibility never reduce exported complete BOM or grant build qualification",async()=>{
 for(const b of models){const g=appearanceGroups(b),view=groupPresentation(g,0);expect(view.visibleInstanceIds!.length).toBeLessThan(b.placements.length);const d=await createDesignDraft(b,PAINT_PRESETS[3].options);expect(d.placements).toHaveLength(b.placements.length);expect(d.bom.reduce((n,b)=>n+b.quantity,0)).toBe(b.placements.length);expect(d.steps).toEqual(b.steps);expect(d.checks).toEqual(b.checks);expect(appearanceGroups(d.base)).toEqual(g);}
});
it.each(["duplicate","unknown","omitted","role","instance","qualification"])("rejects inconsistent source grouping: %s",kind=>{
 const b=structuredClone(models[0]);if(kind==="duplicate")b.steps.items[0].instanceIds.push(b.steps.items[0].instanceIds[0]);if(kind==="unknown")b.steps.items[0].instanceIds[0]="fictional";if(kind==="omitted")b.steps.items[0].instanceIds.pop();if(kind==="role")b.steps.items[0].role="roof";if(kind==="instance")b.placements.push(b.placements[0]);if(kind==="qualification")(b.steps as any).status="VALID";expect(()=>appearanceGroups(b)).toThrow("GROUP_");
});
