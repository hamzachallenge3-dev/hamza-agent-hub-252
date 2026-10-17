/** Concrete argument shapes for model calls; role allowlists still authorize execution. */
export const TOOL_SCHEMAS: Record<string, Record<string, string>> = {
  workspace_read: {path:'string'}, workspace_list:{path:'string'},
  workspace_write:{path:'string',content:'string'}, workspace_grep:{path:'string',pattern:'string'},
  dispatch_agent:{agent_id:'string',subtask:'string'}, clean_leads:{text:'string',csv:'string'},
  sheets_to_json:{csv:'string',dialect:'string'}, extract_contacts:{html:'string',url:'string'},
  seo_audit_html:{html:'string',url:'string'}, forge_detect:{url:'string'}, github_url_tricks:{url:'string'},
  hub_list_agents:{pack:'string'}, hub_agent_browse:{query:'string',agent_id:'string',pack:'string'},
  hub_tools13_lookup:{query:'string'}, hub_freellmapi_chat:{prompt:'string',model:'string'},
  film_pack_prepare:{video_path:'string',out_path:'string',interval:'number',max_frames:'number'},
  n8n_workflow_validate:{workflow:'object'}, context_compact:{text:'string',max_lines:'number'},
  html_extract_links:{html:'string'}, hub_tools13_capabilities:{},
  run_command:{command:'string',cwd:'string',timeout_ms:'number'},
  browser_session:{op:'string',allow_domains:'array',profile:'string',allow_downloads:'boolean',allow_uploads:'boolean'},
  browser_navigate:{url:'string',wait_for:'string',timeout_ms:'number'},
  browser_snapshot:{},
  // expect_text / expect_selector are how an action becomes verified rather
  // than merely "no exception thrown".
  browser_act:{action:'string',selector:'string',role:'string',name:'string',label:'string',placeholder:'string',text:'string',value:'string',expect_text:'string',expect_selector:'string'},
  browser_extract:{kind:'string',selector:'string',attribute:'string'},
  browser_screenshot:{full_page:'boolean'},
  web_search:{query:'string'},
  hub_integrations:{integration_id:'string'},
};
export function modelTool(name: string) {
  // `array` needs an `items` schema or strict providers reject the whole request.
  const property = (type: string) => (type === 'array' ? {type, items:{type:'string'}} : {type});
  return {type:'function', function:{ name, description:name,
    parameters:{type:'object', properties:Object.fromEntries(Object.entries(TOOL_SCHEMAS[name] ?? {}).map(([key,type]) => [key,property(type)]))} }};
}
