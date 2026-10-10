// Generated from client/*.js and client/styles.css. Run npm run build.
window.__ModuleLoader__.load({id:'dsh-engineering-workbench',factory:require=>{
const css = "\n.ew,.ew-entry{font-family:\"Segoe UI\",\"Microsoft YaHei UI\",sans-serif;font-size:14px;line-height:1.5;color:#203745;box-sizing:border-box}.ew *{box-sizing:border-box}.ew button,.ew input,.ew select{font:inherit}.ew button{border:1px solid #c8d5dc;border-radius:7px;padding:8px 13px;background:#fff;color:#203745;cursor:pointer;white-space:nowrap;box-shadow:none}.ew button:hover{background:#e5eef2}.ew button:disabled{cursor:wait;opacity:.55}.ew button:focus-visible,.ew a:focus-visible,.ew input:focus-visible,.ew select:focus-visible,.ew [tabindex]:focus-visible{outline:3px solid #46a9bf;outline-offset:3px}.ew button.ew-primary{background:#257d8d;border-color:#257d8d;color:white}.ew button.ew-primary:hover{background:#1d6471}.ew button.ew-quiet{border-color:transparent;background:transparent}.ew button.ew-selected{background:#dceef0;border-color:#88b6bd;color:#125462}.ew-entry{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:inherit;border-radius:6px;padding:9px 12px;width:100%;cursor:pointer}.ew-entry:hover{background:rgba(90,130,150,.15)}\n.ew-workbench{--paper:#edf2f5;--panel:#fff;--ink:#203745;--muted:#627c8c;--line:#d8e2e8;position:fixed;inset:28px 32px;z-index:180;display:flex;flex-direction:column;background:var(--paper);border:1px solid #b3c8d4;border-radius:13px;box-shadow:0 18px 65px #16303b30;overflow:hidden}.ew header.ew-header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:17px 24px;background:var(--panel);border-bottom:1px solid var(--line)}.ew-brand{display:flex;align-items:center;gap:12px;min-width:180px}.ew-brand>svg{color:#257d8d}.ew h1{font-size:20px;line-height:1.25;font-weight:650;letter-spacing:.02em;margin:0}.ew small{color:var(--muted,#627c8c);font-size:12px}.ew-tabs{display:flex;gap:7px}.ew-tabs button{display:flex;align-items:center;gap:7px;border-color:transparent;background:transparent}.ew-tabs button.ew-selected{background:#e3eff2;color:#195867}.ew-header-right{display:flex;align-items:center;gap:10px}.ew-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#257d8d;margin-right:6px}.ew-content{flex:1;min-height:0;overflow:auto}.ew-selection{display:grid;grid-template-columns:270px minmax(0,1fr);height:100%;min-height:0}.ew-controls{padding:25px 22px;background:var(--panel);border-right:1px solid var(--line);overflow:auto}.ew h2{font-size:17px;margin:0 0 15px;font-weight:650}.ew h3{font-size:15px;margin:0 0 12px;font-weight:650}.ew p{margin:7px 0}.ew-help{font-size:12px;color:var(--muted);line-height:1.65}.ew-presets{display:grid;gap:7px;margin:16px 0 24px}.ew-presets button{display:flex;align-items:center;text-align:left;gap:10px;padding:10px 11px}.ew-stepno{width:23px;height:23px;border:1px solid #adc2cf;border-radius:50%;display:inline-flex;justify-content:center;align-items:center;font-size:12px;flex-shrink:0}.ew-control{margin:23px 0}.ew-control label{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.ew-control strong{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}.ew input[type=range]{width:100%;accent-color:#257d8d;cursor:pointer}.ew-range-labels{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}.ew-fixed{border-top:1px solid var(--line);padding-top:18px;font-size:12px;line-height:1.9;color:var(--muted)}.ew-radio{display:flex;gap:6px}.ew-radio button{flex:1;font-size:12px}.ew-results{padding:25px 28px 36px;overflow:auto;min-width:0}.ew-conclusion{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:22px}.ew-conclusion h2{font-size:27px;line-height:1.3;margin:6px 0 9px;font-weight:600}.ew-requirement{white-space:nowrap;font-size:12px;text-align:right;color:var(--muted);padding-left:15px}.ew-requirement strong{display:block;font-size:35px;font-weight:600;color:var(--ink);line-height:1.2;font-variant-numeric:tabular-nums}.ew-requirement span{font-size:16px;margin-left:5px}.ew-inline{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.ew-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;border-radius:4px;padding:3px 7px;white-space:nowrap}.ew-chip.good{background:#dcefe9;color:#1b7054}.ew-chip.bad{background:#f8e4df;color:#aa443e}.ew-chip.wait{background:#f5ebd7;color:#8c641f}.ew-chart{padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:9px;margin-bottom:22px}.ew-chart-head{display:flex;justify-content:space-between;gap:14px;margin-bottom:14px}.ew-legend{font-size:11px;display:flex;gap:15px;color:var(--muted)}.ew-legend i{display:inline-block;width:10px;height:7px;margin-right:4px;background:#bed7de}.ew-legend i.verified{background:#257d8d}.ew-bars{display:grid;gap:12px}.ew-bar-row{display:grid;grid-template-columns:140px 1fr 65px;gap:12px;align-items:center;font-size:12px}.ew-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ew-bar-track{height:15px;background:#edf2f5;position:relative;border-radius:3px}.ew-rated{position:absolute;inset:0 auto 0 0;background:#bed7de;border-radius:3px}.ew-verified{position:absolute;left:0;top:3px;height:9px;background:#257d8d;border-radius:2px}.ew-target-line{position:absolute;top:-6px;bottom:-6px;width:2px;background:#b87527;z-index:1}.ew-bar-value{text-align:right;font-variant-numeric:tabular-nums}.ew-section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:20px 0 12px}.ew-section-head h3{margin:0}.ew-table-wrap{overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px}.ew table{width:100%;border-collapse:collapse;text-align:left;font-size:12px;table-layout:auto}.ew th{font-size:11px;font-weight:600;color:var(--muted);padding:10px 12px;background:var(--paper);white-space:nowrap}.ew td{padding:11px 12px;border-top:1px solid var(--line);vertical-align:top}.ew tbody tr[data-selected=true]{background:#e7f2f4}.ew-model{font-weight:650}.ew td button{padding:0;border:0;color:#1b6f83;background:transparent;text-align:left}.ew-details{margin-top:15px;border-left:3px solid #257d8d;padding:15px 18px;background:var(--panel);border-radius:0 7px 7px 0}.ew-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px}.ew-check{display:grid;grid-template-columns:1fr auto;gap:4px;font-size:12px;border-bottom:1px solid var(--line);padding:8px 0}.ew-check small{display:block;font-size:11px}.ew-check .ew-check-value{grid-column:1/-1;color:var(--muted);overflow-wrap:anywhere}.ew-link{color:#1a7185;text-decoration:underline;text-underline-offset:3px}.ew-error{padding:12px 16px;background:#fae7e3;border:1px solid #e7b5ab;border-radius:6px;color:#963b31;font-size:13px;margin:14px 0;overflow-wrap:anywhere}.ew-loading{padding:60px 25px;text-align:center;color:var(--muted)}.ew-loading svg{display:block;margin:0 auto 15px;color:#257d8d}.ew-note{padding:12px 0;font-size:12px;color:var(--muted);line-height:1.65}.ew-pending{opacity:.7}.ew-subtabs{display:flex;gap:5px}.ew-subtabs button{font-size:12px;padding:6px 10px}.ew-board-content{padding:22px 25px;min-height:100%}.ew-board-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:17px}.ew-board-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px}.ew-board-canvas{height:430px;background:#fdfefe;border:1px solid var(--line);border-radius:9px;overflow:hidden;position:relative}.ew-board-canvas>svg,.ew-board-canvas>img{width:100%;height:100%;object-fit:contain}.ew-map{background:#163b4c}.ew .ew-map .ew-map-node{cursor:pointer;fill:#a9ced7;stroke:#163b4c;stroke-width:1.5px;vector-effect:non-scaling-stroke;outline:none;outline-offset:0}.ew .ew-map .ew-map-node.selected{fill:#f1c576;stroke:#fff;stroke-width:2px}.ew-map .ew-map-focus{fill:none;stroke:#79d9f1;stroke-width:2px;vector-effect:non-scaling-stroke;pointer-events:none;visibility:hidden}.ew-map .ew-map-node:focus-visible+.ew-map-focus{visibility:visible}.ew-map text{fill:#f0f6f8;font-size:3px;font-family:inherit}.ew-findings{display:grid;gap:8px;margin-top:10px}.ew-findings button{text-align:left;white-space:normal;padding:12px;font-size:12px;width:100%}.ew-findings strong{display:block;margin:5px 0;font-weight:600}.ew-refbox{background:var(--panel);padding:14px;border:1px solid var(--line);border-radius:7px;margin:13px 0;font-size:12px}.ew-refbox strong{font-size:17px}.ew-compare{margin-top:24px;padding-top:18px;border-top:1px solid var(--line)}.ew-compare-form{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.ew input[type=text],.ew select{padding:8px 10px;border:1px solid #c6d5de;background:var(--panel);color:var(--ink);border-radius:6px;min-width:80px}.ew input[type=text]{width:125px}.ew-diff-summary{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:16px 0}.ew-diff-summary strong{font-size:22px;font-weight:600}.ew-diff-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ew-diff-pane{border:1px solid var(--line);background:var(--panel);border-radius:8px;overflow:hidden}.ew-diff-pane header{padding:10px 14px;background:#e7eef2;font-size:12px;display:flex;justify-content:space-between}.ew-diff-pane.after header{background:#deeee8}.ew-diff-pane svg{width:100%;height:270px;background:white;display:block}.ew-timeline{max-width:980px;margin:auto;padding:25px}.ew-task{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:15px 18px;margin:11px 0}.ew-task-title{display:flex;justify-content:space-between;align-items:center;gap:15px}.ew-task-title strong{font-size:14px}.ew-task-steps{display:flex;flex-wrap:wrap;gap:12px;margin:14px 0 2px;font-size:12px}.ew-task-steps span{display:flex;gap:6px;align-items:center;color:var(--muted)}.ew-task-steps .done{color:#25745b}.ew-task-steps .running{color:#176d83}.ew-task-steps .failed{color:#aa443e}.ew-task-error{margin-top:10px;color:#aa443e;font-size:12px}.ew-float{position:fixed;z-index:195;width:285px;background:#fff;border:1px solid #a6c4ce;border-radius:10px;box-shadow:0 7px 24px #183d4b26;color:#203745}.ew-float-head{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;border-bottom:1px solid #e1e9ee;gap:10px}.ew-drag{display:flex;gap:8px;align-items:center;cursor:move;touch-action:none;flex:1;font-size:12px}.ew-float button{padding:3px 6px;font-size:11px}.ew-float-body{padding:13px 15px}.ew-float-label{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ew-float-time{font-size:24px;line-height:1.5;font-weight:600;font-variant-numeric:tabular-nums}.ew-progress{height:4px;background:#e1eaef;border-radius:4px;overflow:hidden;margin:8px 0}.ew-progress>span{display:block;height:100%;background:#257d8d}.ew-float small{font-size:11px}.ew-float.ew-mini{width:auto}.ew-float.ew-mini .ew-float-head{border:0}.ew-float-actions{display:flex;justify-content:space-between;align-items:center;margin-top:9px}.ew-busy-dot{display:inline-block;width:7px;height:7px;background:#b87527;border-radius:50%;margin-right:6px}.ew-offline{color:#a34b3e;font-size:12px}\n@media(prefers-color-scheme:dark){.ew-workbench{--paper:#192e3c;--panel:#233d4e;--ink:#e3edf2;--muted:#afc4d0;--line:#385766;color:var(--ink);border-color:#476673}.ew-workbench button,.ew-workbench input,.ew-workbench select{background:#294656;color:#e3edf2;border-color:#537484}.ew-workbench button:hover{background:#355565}.ew-workbench button.ew-selected{background:#2e5d69;color:#f4fbfc}.ew-workbench .ew-table-wrap{background:var(--panel)}.ew-workbench .ew-rated{background:#5b879a}.ew-workbench .ew-verified{background:#62b9bb}.ew-workbench tbody tr[data-selected=true]{background:#2c5061}.ew-workbench .ew-link,.ew-workbench td button{color:#8dcfdc}.ew-workbench .ew-diff-pane header{color:#203745}.ew-workbench .ew-diff-pane.after header{color:#205343}}\n@media(max-width:1000px){.ew-workbench{inset:12px}.ew header.ew-header{padding:12px 16px;gap:12px;flex-wrap:wrap}.ew-selection{grid-template-columns:225px minmax(0,1fr)}.ew-results{padding:20px}.ew-board-grid{grid-template-columns:minmax(0,1fr) 235px}.ew-checks{grid-template-columns:1fr}.ew-bar-row{grid-template-columns:105px 1fr 54px}.ew-requirement strong{font-size:29px}.ew-conclusion h2{font-size:23px}}\n@media(max-width:700px){.ew-workbench{inset:6px}.ew-header-right small{display:none}.ew .ew-brand{min-width:0}.ew h1{font-size:17px}.ew-tabs{order:3;width:100%;justify-content:space-between}.ew-tabs button{padding:6px 10px;font-size:12px}.ew-selection{display:block;height:auto}.ew-controls{border-right:0;border-bottom:1px solid var(--line);overflow:visible;padding:17px}.ew-presets{grid-template-columns:repeat(3,1fr);margin:12px 0}.ew-presets button{padding:8px 6px;font-size:11px;gap:5px}.ew-control{margin:14px 0}.ew-fixed{display:none}.ew-results{overflow:visible;padding:18px}.ew-conclusion h2{font-size:22px}.ew-board-content{padding:16px}.ew-board-grid,.ew-diff-grid{grid-template-columns:1fr}.ew-board-canvas{height:300px}.ew-float{max-width:calc(100vw - 20px)}.ew-legend{gap:5px}.ew-chart{padding:12px}.ew-chart-head{flex-direction:column;gap:2px}.ew-table-wrap{max-width:100%}.ew-board-header{flex-wrap:wrap}.ew-bar-row{grid-template-columns:95px 1fr 49px;gap:7px}.ew-diff-pane svg{height:230px}}\n@media(prefers-reduced-motion:reduce){.ew *{animation:none!important;transition:none!important}}\n\n/* Full business workflows: readable inputs, evidence tables, and durable task state. */\n.ew-business{padding:24px 28px 100px;max-width:1720px;margin:0 auto}.ew-page-intro{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:22px}.ew-page-intro h2{font-size:24px;margin:0 0 7px}.ew-page-intro p{color:var(--muted);font-size:13px}.ew-paper{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:21px;min-width:0}.ew-section{margin-top:20px}.ew-section-title{margin-top:24px!important}.ew-request-grid{display:grid;grid-template-columns:minmax(310px,.85fr) minmax(430px,1.15fr);gap:20px}.ew-inspection-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.6fr);gap:20px}.ew-inspection-grid>.ew-paper:nth-child(2){max-height:920px;overflow:auto}.ew-dataset{display:flex;align-items:center;gap:17px;flex-wrap:wrap;padding:12px 0 20px;font-size:12px}.ew-field{display:flex;flex-direction:column;gap:7px;min-width:0;margin:10px 0;font-size:13px}.ew-field>label{font-weight:600}.ew-field small{font-weight:400;line-height:1.6}.ew .ew-field input[type=text],.ew .ew-field input[type=number],.ew .ew-field select{width:100%;max-width:100%;min-width:0}.ew input[type=number]{padding:8px 10px;border:1px solid #c6d5de;border-radius:6px;color:var(--ink);background:var(--panel);font:inherit}.ew textarea{width:100%;max-width:100%;min-height:80px;resize:vertical;border:1px solid #b8ccd6;border-radius:6px;background:var(--panel);color:var(--ink);font:14px/1.7 \"Segoe UI\",\"Microsoft YaHei UI\",sans-serif;padding:11px 13px}.ew textarea:focus-visible{outline:3px solid #46a9bf;outline-offset:2px}.ew-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:15px 0}.ew-form-row{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:flex-end}.ew-form-row>.ew-field{flex:1;min-width:140px}.ew-form-row>button{margin:10px 0}.ew-checkbox{display:inline-flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.7;cursor:pointer;margin:10px 0}.ew-checkbox input{accent-color:#257d8d;margin-top:4px}.ew td .ew-checkbox{margin:0;min-width:100px}.ew-extra{margin-top:18px}.ew details summary{cursor:pointer;font-size:13px;font-weight:600;line-height:1.7;padding:7px 0}.ew-raw{margin-top:16px}.ew-raw pre,.ew-source-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;font:12px/1.65 \"Segoe UI\",\"Microsoft YaHei UI\",sans-serif;padding:15px;background:var(--paper);border-radius:6px;color:var(--ink);margin:12px 0}.ew-raw pre{font-family:Consolas,monospace}.ew-empty{padding:24px 16px;color:var(--muted);font-size:13px;background:var(--paper);border-radius:6px;line-height:1.8}.ew-bullets{padding-left:20px;margin:13px 0;font-size:13px;line-height:1.8}.ew-bullets li{margin:7px 0;overflow-wrap:anywhere}.ew-artifacts{display:flex;flex-wrap:wrap;gap:10px 20px;margin:15px 0}.ew-artifacts a{color:#1a7185;text-decoration:underline;text-underline-offset:3px;font-size:13px}.ew-wrap,.ew-paper td,.ew-source{overflow-wrap:anywhere}.ew-paper td{max-width:430px}.ew-paper td blockquote{border-left:2px solid #91b8c2;padding-left:10px;margin:8px 0;color:var(--muted);font-size:12px}.ew-warning-text{color:#a75b1e}.ew-examples{margin:12px 0}.ew-examples button{font-size:12px;margin-right:8px;margin-top:8px}.ew-file-import{position:relative;overflow:hidden;display:inline-block;color:#1a7185;text-decoration:underline;font-size:12px;cursor:pointer;padding:5px 0}.ew-file-import input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}.ew-source{border-bottom:1px solid var(--line);padding:12px 0;font-size:12px}.ew-supplements fieldset,.ew-target-row{margin:14px 0;border:1px solid var(--line);border-radius:6px;padding:12px 15px}.ew fieldset legend{font-size:12px;padding:0 6px;color:var(--muted)}.ew-property{flex:1;min-width:150px}.ew-property button{padding:3px 7px;font-size:11px}.ew-path-field{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:10px}.ew-path-field>button{margin-bottom:10px}.ew-filepicker{grid-column:1/-1;max-height:340px;overflow:auto;background:var(--paper);border:1px solid var(--line);padding:14px;border-radius:6px}.ew-filepicker ul{list-style:none;padding:0}.ew-filepicker li{margin:4px 0}.ew-filepicker li button{text-align:left;white-space:normal;width:100%;border:0;background:transparent;font-size:12px;padding:6px 10px}.ew-reference-image{width:100%;max-height:650px;object-fit:contain;background:white;border:1px solid var(--line);border-radius:6px}.ew-notice{padding:14px 17px;background:#deeee8;border-left:3px solid #257d8d;color:#235443;font-size:13px;line-height:1.7;border-radius:0 6px 6px 0}.ew-task-context{margin:20px 0 10px;border-left:3px solid #257d8d;padding:5px 15px;display:grid;gap:5px;font-size:13px;overflow-wrap:anywhere}.ew-confirmation{margin:24px 0;padding:22px;background:var(--panel);border:2px solid #b87527;border-radius:8px}.ew-confirmation h3{font-size:18px}.ew-confirmation p{font-size:13px}.ew-findings-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ew-finding{padding:16px;border:1px solid var(--line);border-radius:6px;min-width:0}.ew-finding>div:first-child{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.ew-finding strong{font-size:13px}.ew-finding p{font-size:12px;line-height:1.75}.ew-finding button{padding:3px 8px;font-size:12px}.ew-text-report{font-size:13px;line-height:1.8}.ew-text-report>h3{margin-top:24px;padding-top:14px;border-top:1px solid var(--line)}.ew-report{margin-top:22px;border-top:2px solid #257d8d;padding-top:12px}.ew-paper .ew-details{padding:16px 0 0;border:0}.ew-paper .ew-board-canvas{height:380px}.ew-business .ew-chart{border:0;padding:15px 0}.ew-business .ew-subtabs{flex-wrap:wrap}.ew [hidden]{display:none!important}\n@media(prefers-color-scheme:dark){.ew textarea{background:var(--panel);color:var(--ink);border-color:#537484}.ew-artifacts a{color:#8dcfdc}.ew-notice{background:#244e4b;color:#d4eee5}.ew-file-import{color:#8dcfdc}}\n@media(max-width:1100px){.ew-request-grid{grid-template-columns:1fr}.ew-inspection-grid{grid-template-columns:minmax(0,1fr) 280px}.ew-business{padding:20px 20px 90px}.ew-tabs{gap:3px}.ew-tabs button{padding:7px 9px}.ew-header-right small{display:none}}\n@media(max-width:760px){.ew-business{padding:16px 12px 90px}.ew-paper{padding:15px}.ew-page-intro{flex-direction:column;gap:8px}.ew-page-intro h2{font-size:21px}.ew-inspection-grid,.ew-findings-list{grid-template-columns:1fr}.ew-inspection-grid>.ew-paper:nth-child(2){max-height:none}.ew-form-row>.ew-field{min-width:130px}.ew-form-row{gap:7px}.ew-tabs{overflow:auto;justify-content:flex-start}.ew-tabs button{font-size:11px;padding:6px 7px}.ew-path-field{grid-template-columns:1fr}.ew-path-field>button{justify-self:start}.ew-board-canvas{height:300px!important}.ew .ew-field textarea{font-size:14px}.ew-dataset{gap:7px 14px}.ew-request-grid{grid-template-columns:minmax(0,1fr)}.ew-workbench .ew-tabs{width:100%;order:3}.ew-workbench .ew-header{flex-wrap:wrap}.ew-page-intro small{max-width:100%}}\n\n.ew-drawing-viewer{margin-top:18px;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:12px;min-width:0}.ew-drawing-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.ew-drawing-toolbar .ew-inline{flex-wrap:wrap}.ew-drawing-toolbar output{min-width:48px;text-align:center;font-variant-numeric:tabular-nums}.ew-drawing-area{display:grid;grid-template-columns:repeat(var(--panes),minmax(0,1fr));gap:12px}.ew-drawing-pane{min-width:0;border:1px solid var(--line);border-radius:5px;overflow:hidden}.ew-drawing-pane>header{padding:9px 12px;font-size:13px;font-weight:600;background:var(--paper)}.ew-drawing-stage{height:450px;background:#fff;overflow:hidden;touch-action:none;cursor:grab}.ew-drawing-stage:active{cursor:grabbing}.ew .ew-drawing-stage>svg{display:block;width:100%;height:100%;user-select:none}.ew-drawing-full{position:fixed;inset:8px;z-index:500;padding:16px;display:flex;flex-direction:column;box-shadow:0 0 0 100vmax #102f42aa;overflow:auto}.ew-drawing-full .ew-drawing-area{flex:1;min-height:0}.ew-drawing-full .ew-drawing-pane{display:flex;flex-direction:column}.ew-drawing-full .ew-drawing-stage{flex:1;height:auto;min-height:160px}.ew-change-mark{stroke:#178c63;fill:#27b88718;stroke-width:3px;vector-effect:non-scaling-stroke;pointer-events:none}.ew-change-mark>*{vector-effect:non-scaling-stroke;stroke-dasharray:5 3}.ew-change-mark.before{stroke:#c0572b;fill:#c0572b18}.ew-change-list{max-height:300px;overflow:auto;margin:16px 0;border:1px solid var(--line);border-radius:6px}.ew .ew-change-list button{display:block;width:100%;white-space:normal;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:10px 12px}.ew-change-list span{display:block;font-size:12px;margin-top:4px;overflow-wrap:anywhere}.ew-change-list b{font-weight:600}.ew-change-legend{display:flex;gap:18px;font-size:12px;margin:12px 0}.ew-change-legend .before{color:#b04b23}.ew-change-legend .after{color:#158258}@media(max-width:760px){.ew-drawing-area{grid-template-columns:1fr}.ew-drawing-stage{height:360px}.ew-drawing-full .ew-drawing-area{overflow:auto;display:block}.ew-drawing-full .ew-drawing-pane{margin-bottom:12px}.ew-drawing-full .ew-drawing-stage{min-height:55vh}.ew-drawing-toolbar button{font-size:12px;padding:6px 9px}}\n\n.ew-workbench:has(.ew-drawing-full){z-index:250}\n.ew-engineering{padding:24px 30px 120px;max-width:1800px;margin:auto}.ew-engineering .ew-inline{flex-wrap:wrap}.ew-engineering>.ew-form-row>.ew-path-field{flex:1;min-width:300px}.ew-section-head{display:flex;justify-content:space-between;gap:20px}.ew-engineering h2{margin:0;font-size:25px}.ew-engineering h3{margin-top:28px}.ew-conclusions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.ew-conclusions article{padding:18px;border:1px solid var(--line);border-radius:7px;background:var(--paper)}.ew-conclusions strong,.ew-conclusions small{display:block;margin:5px 0}.ew-reference-card,.ew-graphic-editor{margin:20px 0;padding:18px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}.ew-reference-text{max-height:250px;overflow:auto;white-space:pre-wrap}.ew-edit-canvas{width:100%;height:520px;display:block;touch-action:none;background:#fbfcf9;border:1px solid var(--line);margin-top:12px}.ew-edit-canvas text{pointer-events:none;fill:#25424b}.ew-graphic-editor.ew-drawing-full{background:var(--panel);margin:0}.ew-graphic-editor.ew-drawing-full .ew-edit-canvas{flex:1;min-height:300px}.ew-engineering fieldset{border:1px solid var(--line);border-radius:6px;margin:12px 0;padding:14px}.ew-header .ew-tabs{overflow:auto;max-width:68vw}.ew-header .ew-tabs button{white-space:nowrap}@media(max-width:900px){.ew-engineering{padding:20px 14px 100px}.ew-conclusions{grid-template-columns:1fr 1fr}.ew-header .ew-tabs{max-width:100%;width:100%}}\n.ew-edit-canvas { user-select: none; touch-action: none; }\n";
    const R = require('react');
    const h = R.createElement;
    const { useState, useEffect, useRef, useSyncExternalStore } = R;
    const statuses = { matches_listed_constraints: '满足已列条件', needs_confirmation: '资料待确认', incompatible: '不满足', pass: '满足', fail: '不满足', unknown: '待确认', checked: '局部检查符合', warning: '发现问题', not_applicable: '不适用' };
    const tone = value => ['matches_listed_constraints', 'pass', 'checked', 'done'].includes(value) ? 'good' : ['incompatible', 'fail', 'failed', 'warning'].includes(value) ? 'bad' : 'wait';
    const num = value => typeof value === 'number' ? Number(value.toFixed(1)).toLocaleString('zh-CN') : '—';
    const stamp = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
    function Icon({ name, size = 18 }) {
      const shapes = {
        grid: [h('rect', { key: 1, x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 2, x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 3, x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('path', { key: 4, d: 'M14 17h7M17.5 13.5v7' })],
        power: h('path', { d: 'M13 2 4 14h7l-1 8 10-13h-8z' }),
        circuit: [h('rect', { key: 1, x: 6, y: 6, width: 12, height: 12, rx: 2 }), h('path', { key: 2, d: 'M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4' })],
        activity: h('path', { d: 'M2 12h4l3-8 5 16 3-8h5' }),
        close: h('path', { d: 'm6 6 12 12M6 18 18 6' }),
        arrow: h('path', { d: 'M4 12h16m-6-6 6 6-6 6' }),
        check: h('path', { d: 'm5 12 4 4L19 6' }),
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, shapes[name] || shapes.grid);
    }
    const chip = value => h('span', { className: `ew-chip ${tone(value)}` }, statuses[value] || value);
    const button = (text, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, text);
    const link = (text, href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', className: 'ew-link' }, text);
    async function api(endpoint, body) {
      const response = await fetch(`/api/engineering-workbench/${endpoint}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok || !value.ok) throw new Error(value.error || `请求失败 (${response.status})`);
      return value.value;
    }

    const invoke = (group, action, args = {}, confirmation) => api('action', { group, action, args, ...(confirmation ? { confirmation } : {}) });
    function useWork() {
      const [busy, setBusy] = useState(''), [error, setError] = useState('');
      const lock = useRef(false);
      const run = async (label, fn) => {
        if (lock.current) return null;
        lock.current = true; setBusy(label); setError('');
        try { return await fn(); } catch (e) { setError(e.message); return null; }
        finally { lock.current = false; setBusy(''); }
      };
      return { busy, error, setError, run };
    }
    function Alert({ work }) { return h(R.Fragment, null, work.error && h('div', { className: 'ew-error', role: 'alert' }, work.error), work.busy && h('p', { className: 'ew-note', role: 'status' }, work.busy + '…')); }
    function Field({ label, children, hint }) {
      const id = R.useId();
      return h('div', { className: 'ew-field' }, h('label', { htmlFor: id }, label), R.isValidElement(children) ? R.cloneElement(children, { id, 'aria-label': label }) : children, hint && h('small', null, hint));
    }
    const textInput = (value, setter, props = {}) => h('input', { type: 'text', value, onChange: e => setter(e.target.value), ...props });
    const textarea = (value, setter, props = {}) => h('textarea', { value, onChange: e => setter(e.target.value), rows: 5, ...props });
    const selectInput = (value, setter, options, props = {}) => h('select', { value, onChange: e => setter(e.target.value), ...props }, options.map(o => h('option', { key: Array.isArray(o) ? o[0] : o, value: Array.isArray(o) ? o[0] : o }, Array.isArray(o) ? o[1] : o)));
    const checkbox = (label, value, setter, props = {}) => h('label', { className: 'ew-checkbox' }, h('input', { type: 'checkbox', checked: value, onChange: e => setter(e.target.checked), ...props }), label);
    const empty = text => h('p', { className: 'ew-empty' }, text);
    const compact = value => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    function Table({ columns, rows, rowKey }) {
      return h('div', { className: 'ew-table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, columns.map((c, i) => h('th', { key: i }, c[0])))),
        h('tbody', null, rows.map((r, i) => h('tr', { key: rowKey ? rowKey(r) : i }, columns.map((c, j) => h('td', { key: j }, typeof c[1] === 'function' ? c[1](r, i) : compact(r[c[1]]))))))));
    }
    function Raw({ value, title = '查看完整数据' }) { return h('details', { className: 'ew-raw' }, h('summary', null, title), h('pre', null, JSON.stringify(value, null, 2))); }
    function Artifacts({ value }) {
      const names = { htmlPath: '打开 HTML 报告', jsonPath: '下载 JSON 报告', markdownPath: '下载 Markdown 报告', json: '下载 JSON 报告', markdown: '下载 Markdown 报告', pdf: '候选 PDF', report: '校验记录', candidate: '下载候选原理图' };
      return h('div', { className: 'ew-artifacts' }, (value?.artifacts ?? []).filter(a => a.key !== 'preview').map(a => h('a', { key: a.url, href: a.url, target: '_blank', rel: 'noopener noreferrer', download: a.key === 'candidate' ? a.name : undefined }, names[a.key] || a.name)));
    }
    function Bullets({ items }) { return items?.length ? h('ul', { className: 'ew-bullets' }, items.map((x, i) => h('li', { key: i }, compact(x)))) : null; }
    function TextReport({ text }) {
      return h('div', { className: 'ew-text-report' }, String(text || '').split(/\n{2,}/).map((part, i) => {
        if (/^#{1,4} /.test(part) && !part.includes('\n')) return h('h3', { key: i }, part.replace(/^#+ /, ''));
        if (part.startsWith('|')) {
          const rows = part.split('\n').filter(line => !/^\|[\s:|-]+$/.test(line)).map(line => line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replace(/\\([|_*])/g, '$1')));
          if (rows.length) return h(Table, { key: i, columns: rows[0].map((c, j) => [c, r => r[j]]), rows: rows.slice(1) });
        }
        return h('p', { key: i, style: { whiteSpace: 'pre-wrap' } }, part);
      }));
    }
    function FilePicker({ value, onChange, label, extensions }) {
      const [opened, setOpened] = useState(false), [listing, setListing] = useState(null), [error, setError] = useState('');
      const browse = async dir => { try { setListing(await api('files?directory=' + encodeURIComponent(dir))); setError(''); } catch (e) { setError(e.message); } };
      return h('div', { className: 'ew-path-field' }, h(Field, { label }, textInput(value, onChange, { placeholder: '选择文件或输入工程目录内的路径' })), button(opened ? '关闭文件列表' : '选择文件', () => { if (!opened) browse(''); setOpened(!opened); }), opened && h('div', { className: 'ew-filepicker' },
        error && h('p', { role: 'alert' }, error), listing && h(R.Fragment, null, h('p', { className: 'ew-help' }, listing.root, listing.directory ? '/' + listing.directory : ''), listing.parent !== null && button('上级目录', () => browse(listing.parent)),
          h('ul', null, listing.entries.filter(f => f.directory || !extensions || extensions.some(ext => f.name.toLowerCase().endsWith(ext))).map(f => h('li', { key: f.path }, button((f.directory ? '文件夹 · ' : '') + f.name, () => { if (f.directory) browse(f.relative); else { onChange(f.path); setOpened(false); } })))), listing.truncated && h('small', null, '本目录仅显示前 400 项，可输入确切路径。'))));
    }
    function ConstraintEditor({ fields, value, onChange, disabled }) {
      const update = (i, patch) => onChange(value.map((row, j) => j === i ? { ...row, ...patch } : row));
      return h('div', { className: 'ew-supplements' }, value.map((row, i) => {
        const spec = fields[row.field] || { kind: 'number', unit: '' };
        return h('fieldset', { key: i, disabled, className: 'ew-form-row' }, h('legend', null, `补充条件 ${i + 1}`),
          h(Field, { label: '参数' }, selectInput(row.field, field => update(i, { field, operator: fields[field]?.kind === 'list' ? 'includes' : 'eq' }), Object.entries(fields).map(([k, v]) => [k, v.label]))),
          h(Field, { label: '关系' }, selectInput(row.operator, operator => update(i, { operator }), spec.kind === 'number' ? [['gte', '不少于'], ['lte', '不超过'], ['eq', '等于'], ['range', '范围']] : spec.kind === 'list' ? [['includes', '包含']] : [['eq', '等于']])),
          h(Field, { label: `要求值${spec.unit ? '（' + spec.unit + '）' : ''}` }, textInput(row.input || '', input => update(i, { input }), { placeholder: row.operator === 'range' ? '下限,上限' : '明确值', required: true })),
          h(Field, { label: '逐字原文依据' }, textInput(row.sourceQuote || '', sourceQuote => update(i, { sourceQuote }), { required: true })),
          checkbox('硬条件', row.hard !== false, hard => update(i, { hard })), button('删除条件', () => onChange(value.filter((_, j) => j !== i)))) ;
      }), button('添加补充条件', () => onChange([...value, { field: 'output_power_w', operator: 'gte', input: '', sourceQuote: '', hard: true }]), { disabled }));
    }
    function constraintArgs(rows, fields) {
      return rows.map(r => {
        const base = { field: r.field, operator: r.operator, hard: r.hard !== false, sourceQuote: r.sourceQuote };
        if (fields[r.field]?.kind !== 'number') return { ...base, textValue: r.input };
        if (r.operator === 'range') { const pair = r.input.split(/[,，]/).map(s => s.trim()); if (pair.length !== 2 || pair.some(s => !s || !Number.isFinite(Number(s)))) throw new Error('范围请填写两个数值，例如 180,264。'); return { ...base, min: Number(pair[0]), max: Number(pair[1]) }; }
        if (!r.input?.trim() || !Number.isFinite(Number(r.input))) throw new Error('补充条件需要有效数值。');
        return { ...base, value: Number(r.input) };
      });
    }

    function PositionMap({ components, selected, onSelect }) {
      const items = components.filter(c => c.position);
      if (!items.length) return h('div', { className: 'ew-loading' }, '当前快照没有可定位的封装坐标。');
      const xs = items.map(c => c.position.x), ys = items.map(c => c.position.y);
      const x0 = Math.min(...xs) - 9, y0 = Math.min(...ys) - 9, w = Math.max(...xs) - x0 + 9, hg = Math.max(...ys) - y0 + 9;
      const radius = Math.max(w, hg) / 115;
      return h('svg', { className: 'ew-map', viewBox: `${x0} ${y0} ${w} ${hg}`, role: 'group', 'aria-label': '按实际封装坐标绘制的器件位置图', onClick: () => onSelect([]), onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onSelect([]); } } }, h('defs', null, h('pattern', { id: 'ew-grid', width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, h('path', { d: 'M5 0H0V5', fill: 'none', stroke: '#295064', strokeWidth: .13 }))), h('rect', { x: x0, y: y0, width: w, height: hg, fill: 'url(#ew-grid)' }), items.map(c => {
        const x = c.position.x, y = 2 * y0 + hg - c.position.y;
        return h('g', { key: c.ref, onClick: e => { e.stopPropagation(); onSelect([c.ref]); } },
          h('circle', { className: `ew-map-node${selected.includes(c.ref) ? ' selected' : ''}`, cx: x, cy: y, r: selected.includes(c.ref) ? radius * 1.5 : radius, role: 'button', tabIndex: 0, 'aria-pressed': selected.includes(c.ref), 'aria-label': `定位 ${c.ref} ${c.value}`, onKeyDown: e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); onSelect([c.ref]); } } }, h('title', null, `${c.ref} ${c.value} (${num(x)}, ${num(c.position.y)}) mm`)),
          h('circle', { className: 'ew-map-focus', cx: x, cy: y, r: radius * 2.1, 'aria-hidden': true }),
          selected.includes(c.ref) && h('text', { x: x + radius * 2.5, y: y - radius * 2.5, style: { fontSize: radius * 2.2 } }, c.ref));
      }));
    }
    function Sheet({ view, parts = [], selected = [], focus, box, marks = [], side = 'after' }) {
      const frame = box || (focus ? `${Math.max(0, focus.at[0] - 24)} ${Math.max(0, focus.at[1] - 17)} 48 34` : `0 0 ${view.width} ${view.height}`);
      return h('svg', { viewBox: frame, role: 'img', 'aria-label': focus ? `${focus.ref} 周围原生原理图` : '图纸预览', className: 'ew-sheet' },
        h('image', { href: view.url, width: view.width, height: view.height }),
        parts.filter(p => selected.includes(p.ref)).map(p => h('circle', { key: p.uuid, cx: p.at[0], cy: p.at[1], r: 4.5, fill: '#e3b54a22', stroke: '#b87527', strokeWidth: .3 })),
        marks.filter(Boolean).map((m, i) => h('g', { key: i, className: 'ew-change-mark ' + side }, m.kind === 'wire' || m.kind === 'bus' || m.kind === 'polyline'
          ? h('polyline', { points: m.points.map(p => p.join(',')).join(' '), fill: 'none' })
          : h('circle', { cx: m.points[0][0], cy: m.points[0][1], r: m.kind === 'symbol' ? 5 : 2.5 }))));
    }
    function drawingFrame(view, points) {
      if (!points?.length) return { x: 0, y: 0, w: view.width, h: view.height };
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const w = Math.max(64, Math.max(...xs) - Math.min(...xs) + 40), height = Math.max(48, Math.max(...ys) - Math.min(...ys) + 20);
      return { x: (Math.min(...xs) + Math.max(...xs) - w) / 2, y: (Math.min(...ys) + Math.max(...ys) - height) / 2, w, h: height };
    }
    function DrawingViewer({ panes, focusKey = '', title = '图纸查看器' }) {
      const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 }), [full, setFull] = useState(false), [overview, setOverview] = useState(false);
      const container = useRef(null), area = useRef(null), drag = useRef(null), expand = useRef(null), close = useRef(null);
      const reset = () => setCamera({ zoom: 1, x: 0, y: 0 });
      const zoom = factor => setCamera(c => ({ ...c, zoom: Math.max(1, Math.min(12, c.zoom * factor)) }));
      useEffect(() => { reset(); setOverview(false); }, [focusKey]);
      useEffect(() => {
        const el = area.current;
        const wheel = e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
        el.addEventListener('wheel', wheel, { passive: false });
        return () => el.removeEventListener('wheel', wheel);
      }, []);
      useEffect(() => { if (full) close.current?.focus(); }, [full]);
      const leave = () => { setFull(false); setTimeout(() => expand.current?.focus(), 0); };
      const keyDown = e => {
        if (e.key === 'Escape' && full) { e.preventDefault(); e.stopPropagation(); leave(); }
        if (e.key === 'Tab' && full) {
          const buttons = [...container.current.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1).focus(); }
          else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0].focus(); }
        }
      };
      return h('section', { ref: container, className: 'ew-drawing-viewer' + (full ? ' ew-drawing-full' : ''), role: full ? 'dialog' : 'region', 'aria-label': title, 'aria-modal': full || undefined, onKeyDown: keyDown },
        h('div', { className: 'ew-drawing-toolbar' }, h('strong', null, title),
          h('div', { className: 'ew-inline' }, button('−', () => zoom(1 / 1.25), { 'aria-label': '缩小图纸', disabled: camera.zoom <= 1 }), h('output', { 'aria-label': '图纸缩放比例' }, Math.round(camera.zoom * 100) + '%'), button('+', () => zoom(1.25), { 'aria-label': '放大图纸', disabled: camera.zoom >= 12 }),
            button('适合窗口', reset), button(overview ? '回到所选变化' : '整张图纸', () => { setOverview(!overview); reset(); }, { disabled: !panes.some(p => p.points?.length) }),
            full ? button('退出全屏', leave, { ref: close }) : button('全屏查看', () => setFull(true), { ref: expand }))),
        h('p', { className: 'ew-help' }, '滚轮缩放，拖动平移；双击放大。前后图同步缩放与平移。'),
        h('div', { className: 'ew-drawing-area', ref: area, style: { '--panes': panes.length } }, panes.map(p => {
          const base = drawingFrame(p.view, overview ? null : p.points), c = camera;
          const box = `${base.x + base.w * ((1 - 1 / c.zoom) / 2 + c.x)} ${base.y + base.h * ((1 - 1 / c.zoom) / 2 + c.y)} ${base.w / c.zoom} ${base.h / c.zoom}`;
          return h('div', { key: p.id, className: 'ew-drawing-pane' }, h('header', null, p.title),
            h('div', { className: 'ew-drawing-stage', tabIndex: 0, 'aria-label': p.title + '，可缩放和平移', onDoubleClick: () => zoom(1.5),
              onKeyDown: e => { if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); if (['+', '='].includes(e.key)) zoom(1.25); else if (e.key === '-') zoom(1 / 1.25); else if (e.key === '0') reset(); else setCamera(c => ({ ...c, x: c.x + (e.key === 'ArrowLeft' ? -.08 : e.key === 'ArrowRight' ? .08 : 0) / c.zoom, y: c.y + (e.key === 'ArrowUp' ? -.08 : e.key === 'ArrowDown' ? .08 : 0) / c.zoom })); } },
              onPointerDown: e => { if (e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); const rect = e.currentTarget.getBoundingClientRect(); const scale = Math.min(rect.width / base.w, rect.height / base.h) * camera.zoom; drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, camera, scale, base }; },
              onPointerMove: e => { const d = drag.current; if (d?.pointer === e.pointerId) setCamera({ ...d.camera, x: d.camera.x - (e.clientX - d.x) / d.scale / d.base.w, y: d.camera.y - (e.clientY - d.y) / d.scale / d.base.h }); }, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } },
              h(Sheet, { view: p.view, box, marks: p.marks, side: p.id })));
        })));
    }
    function Task({ task, now }) {
      const elapsed = ((task.finishedAt || now) - task.startedAt) / 1000;
      return h('article', { className: 'ew-task' }, h('div', { className: 'ew-task-title' }, h('div', null, h('strong', null, task.label), h('div', null, h('small', null, `${task.origin === 'chat' ? 'DSH 对话工具' : '工作台操作'} · ${stamp(task.startedAt)}`))), h('div', { className: 'ew-inline' }, chip(task.state === 'done' ? 'pass' : task.state === 'failed' ? 'fail' : '运行中'), h('small', null, `${num(elapsed)} s`))), task.steps.length > 0 && h('div', { className: 'ew-task-steps' }, task.steps.map((s, i) => h('span', { className: s.state, key: i }, s.state === 'done' ? h(Icon, { name: 'check', size: 14 }) : `${i + 1}.`, s.label))), task.error && h('div', { className: 'ew-task-error' }, task.error));
    }

    function Selection() {
      const work = useWork();
      const [info, setInfo] = useState(null), [text, setText] = useState(''), [extras, setExtras] = useState([]);
      const [family, setFamily] = useState(''), [limit, setLimit] = useState(10), [include, setInclude] = useState(true);
      const [parsed, setParsed] = useState(null), [result, setResult] = useState(null), [candidate, setCandidate] = useState(null);
      const [chosen, setChosen] = useState([]), [report, setReport] = useState(null), [title, setTitle] = useState('客户需求与产品方案');
      const revision = useRef(0);
      useEffect(() => { work.run('读取产品资料库', async () => { const x = await invoke('selection', 'info'); setInfo(x); setLimit(x.maxCandidates); }); }, []);
      const invalidate = () => { revision.current++; setParsed(null); setResult(null); setCandidate(null); setChosen([]); setReport(null); };
      const changeText = v => { setText(v); invalidate(); };
      const changeExtras = v => { setExtras(v); invalidate(); };
      const args = () => ({ text, constraints: constraintArgs(extras, info?.fields || {}) });
      const searchArgs = () => ({ ...args(), ...(family ? { family } : {}), limit: Number(limit), includeIncompatible: include });
      const parse = () => work.run('解析并列出需求条件', async () => { const n = revision.current; const x = await invoke('selection', 'parse', args()); if (n === revision.current) setParsed(x); });
      const search = () => work.run('按需求检索与校验', async () => {
        const n = revision.current, x = await invoke('selection', 'search', searchArgs());
        if (n !== revision.current) return;
        setResult(x); setParsed(x.requirements); setCandidate(x.candidates[0] || null); setChosen([]); setReport(null);
      });
      const validate = productId => work.run('复核指定候选', async () => { const n = revision.current; const x = await invoke('selection', 'validate', { ...args(), productId, expectedCatalogRevision: result.catalogRevision }); if (n === revision.current) setCandidate(x.candidate); });
      const makeReport = action => work.run(action === 'export' ? '导出完整方案报告' : '生成方案报告', async () => {
        const n = revision.current, x = await invoke('selection', action, { ...searchArgs(), title, expectedCatalogRevision: result.catalogRevision, ...(chosen.length ? { productIds: chosen } : {}) });
        if (n === revision.current) setReport(x);
      });
      const requirements = parsed?.constraints ?? [];
      const fields = info?.fields || {};
      const expected = c => c.operator === 'range' ? `${c.min}–${c.max}${fields[c.field]?.unit || ''}` : `${({ gte: '≥', lte: '≤', eq: '=', includes: '包含' })[c.operator]} ${c.textValue ?? c.value}${fields[c.field]?.unit || ''}`;
      const sources = result?.sources || info?.sources || [];
      return h('div', { className: 'ew-business' },
        h('div', { className: 'ew-page-intro' }, h('div', null, h('h2', null, '客户需求与产品方案'), h('p', null, '保留客户原文，逐项核对条件、候选与资料依据。')), button('刷新资料库信息', () => work.run('刷新资料库', async () => { invalidate(); setInfo(await invoke('selection', 'info')); }), { disabled: !!work.busy })),
        h(Alert, { work }),
        info && h('div', { className: 'ew-dataset' }, h('strong', null, info.dataset), h('span', null, `${info.productCount} 个型号`), h('span', null, `版本 ${info.catalogVersion}`), h('span', { className: info.demo ? 'ew-warning-text' : '' }, info.demo ? '虚构演示库' : '已配置资料库'), h('small', null, '资料快照 ' + info.catalogRevision.slice(0, 12))),
        h('div', { className: 'ew-request-grid' },
          h('section', { className: 'ew-paper' }, h('h3', null, '需求原文'),
            h(Field, { label: '客户需求' }, textarea(text, changeText, { rows: 9, placeholder: '粘贴真实需求，例如输入/输出电压、功率、环境温度、效率、通信、认证及安装限制。未提供的条件不会自动补上。', maxLength: info?.maxInputChars || 500000 })),
            h('div', { className: 'ew-inline' }, h('label', { className: 'ew-file-import' }, '载入 TXT / Markdown', h('input', { type: 'file', accept: '.txt,.md,text/plain', onChange: async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) { work.setError('需求文件超过 2 MiB，请先提取相关段落。'); return; } changeText(await f.text()); e.target.value = ''; } })), h('small', null, 'PDF / Word 可在 DSH 读取后粘贴需求段落。')),
            h('details', { className: 'ew-examples' }, h('summary', null, '载入可选示例'),
              button('48V 通信电源需求', () => changeText('输入电压：180–264VAC；输出电压：48VDC；输出功率不少于3kW；效率至少96%；工作温度：-20–60℃；通信协议：CAN、RS485；认证：CE、UL；散热方式：风冷。'), { disabled: !!work.busy }),
              button('24V 控制柜电源需求', () => changeText('输出电压：24VDC；输入电压：176–264VAC；输入频率：50–60Hz；安装方式：导轨；本体宽度≤65mm；DC OK继电器：有；持续负载：300W；设计裕量：20%；环境温度：55℃；安装姿态：垂直且输入端子朝下；海拔：1000m；上方间距：50mm；下方间距：40mm；侧面间距：15mm。'), { disabled: !!work.busy })),
            h('div', { className: 'ew-form-row' }, h(Field, { label: '产品类别' }, selectInput(family, v => { setFamily(v); invalidate(); }, [['', '全部类别'], ...(info?.families || [])])), h(Field, { label: '候选展示上限' }, h('input', { type: 'number', value: limit, min: 1, max: info?.maxCandidates || 10, onChange: e => { setLimit(e.target.value); invalidate(); } }))),
            checkbox('同时列出不满足项，便于解释排除原因', include, v => { setInclude(v); invalidate(); }),
            h('div', { className: 'ew-actions' }, button('解析需求', parse, { disabled: !!work.busy || !text.trim() || !info }), button('检索并校验候选', search, { className: 'ew-primary', disabled: !!work.busy || !text.trim() || !info }))),
          h('section', { className: 'ew-paper' }, h('h3', null, '已提取条件'),
            requirements.length ? h(Table, { columns: [['条件', c => fields[c.field]?.label || c.field], ['要求', expected], ['类型', c => c.hard ? '硬条件' : '偏好'], ['原文依据', 'sourceQuote']], rows: requirements }) : empty('输入需求并解析后，这里显示实际提取的条件。'),
            parsed && h(R.Fragment, null, h('h3', { className: 'ew-section-title' }, '待确认与解析提示'), (parsed.unresolved?.length || parsed.warnings?.length) ? h(Bullets, { items: [...(parsed.unresolved || []), ...(parsed.warnings || [])] }) : h('p', { className: 'ew-help' }, '本次解析没有列出待确认项；仍需核对条件是否完整。'),
              h(Bullets, { items: parsed.calculations?.map(c => `${c.loadW} W × (1 + ${c.marginPct}%) = ${c.requiredContinuousW} W 连续能力要求`) })))),
        h('details', { className: 'ew-paper ew-extra' }, h('summary', null, `补充复杂条件${extras.length ? '（' + extras.length + ' 项）' : ''}`), h('p', { className: 'ew-help' }, '只能补充有原文依据的条件。需要更正已提取条件时，请修改需求原文后重新解析。'), h(ConstraintEditor, { fields, value: extras, onChange: changeExtras, disabled: !!work.busy })),
        result && h('section', { className: 'ew-paper ew-section' },
          h('div', { className: 'ew-section-head' }, h('h3', null, '候选比较'), h('small', null, `评估 ${result.totalEvaluated} 个，当前显示 ${result.candidates.length} 个；得分不是置信度。`)),
          result.candidates.length ? h(Table, { columns: [
            ['纳入方案', c => checkbox(c.productId, chosen.includes(c.productId), yes => { revision.current++; setChosen(x => yes ? [...x, c.productId] : x.filter(id => id !== c.productId)); setReport(null); }, { 'aria-label': '纳入方案 ' + c.productId })],
            ['型号 / 名称', c => h('div', null, button(c.productId, () => setCandidate(c), { className: 'ew-quiet' }), h('small', null, c.productName))],
            ['结论', c => chip(c.status)], ['已核验连续能力', c => c.power?.verifiedContinuousW === undefined ? '—' : c.power.verifiedContinuousW + ' W'],
            ['未满足或待确认', c => c.checks.filter(k => k.status !== 'pass').map(k => k.label).join('、') || '已列条件逐项通过'],
            ['操作', c => button('重新复核', () => validate(c.productId), { disabled: !!work.busy, 'aria-label': '复核 ' + c.productId })],
          ], rows: result.candidates, rowKey: c => c.productId }) : empty('当前资料库没有符合筛选条件的候选。可显示不满足项以查看排除原因。'),
          h(PowerOverview, { result }),
          candidate && h('div', { className: 'ew-details' }, h('h3', null, candidate.productId + ' 的逐项校验'), h(Table, { columns: [['条件', 'label'], ['要求', 'expected'], ['资料值', 'actual'], ['结果', c => chip(c.status)], ['依据', c => h('div', null, c.reason, c.quote && h('blockquote', null, c.quote), c.source && h('small', null, c.source.id + ' · ' + c.source.version + ' · ' + (c.source.location || '')))]], rows: candidate.checks })),
          h('details', { className: 'ew-extra' }, h('summary', null, '资料来源与原件'), sources.map((s, i) => h('div', { key: s.id || i, className: 'ew-source' }, h('strong', null, s.title || s.id), h('p', null, s.version, ' · ', s.location), s.previewUrl ? link('打开原件', s.previewUrl) : h('small', null, s.previewError || '未登记可预览的本机原件'), s.url && /^https?:/.test(s.url) && h('span', null, '　', link('官网来源', s.url))))),
          h('div', { className: 'ew-section-head' }, h('h3', null, '方案与报告'), h('small', null, chosen.length ? `选择 ${chosen.length} 个候选，生成时再次校验` : '未指定候选，按插件规则生成完整报告')),
          h(Field, { label: '报告标题' }, textInput(title, v => { revision.current++; setTitle(v); setReport(null); }, { maxLength: 200 })),
          h('div', { className: 'ew-actions' }, button('生成方案', () => makeReport('report'), { disabled: !!work.busy, className: 'ew-primary' }), button('导出 HTML / Markdown / JSON', () => makeReport('export'), { disabled: !!work.busy })),
          report && h('div', { className: 'ew-report' }, h(Artifacts, { value: report }), h(TextReport, { text: report.markdown }))),
        info && h('details', { className: 'ew-extra' }, h('summary', null, '资料库范围与限制'), h(Bullets, { items: info.limitations }), h(Raw, { value: info, title: '资料库信息' })));
    }
    function PowerOverview({ result }) {
      const rows = result.candidates.filter(c => c.power).slice(0, 8);
      if (!rows.length) return null;
      const required = result.requirements.calculations?.[0]?.requiredContinuousW;
      const max = Math.max(required || 0, ...rows.map(c => c.power.ratedW || 0), 1) * 1.12;
      return h('div', { className: 'ew-chart ew-section' }, h('h3', null, '候选连续供电能力'), h('p', { className: 'ew-help' }, '浅色为额定值，深色为本次明确工况下已核验值。未知能力显示为“—”。'), h('div', { className: 'ew-bars' }, rows.map(c => h('div', { className: 'ew-bar-row', key: c.productId }, h('span', null, c.productId), h('div', { className: 'ew-bar-track' }, h('span', { className: 'ew-rated', style: { width: (c.power.ratedW || 0) / max * 100 + '%' } }), h('span', { className: 'ew-verified', style: { width: (c.power.verifiedContinuousW || 0) / max * 100 + '%' } }), required !== undefined && h('span', { className: 'ew-target-line', style: { left: required / max * 100 + '%' } })), h('span', null, num(c.power.verifiedContinuousW) + ' W')))));
    }

    const kindNames = { mcu: '单片机', adc: 'ADC', isolator: '隔离器件', mosfet: 'MOSFET', regulator: '稳压器', crystal: '晶体 / 晶振', connector: '连接器', capacitor: '电容', resistor: '电阻', diode: '二极管', opamp: '运放', generic: '通用器件' };
    function Findings({ report, onSelect }) {
      if (!report) return null;
      return h('section', null, h('div', { className: 'ew-section-head' }, h('h3', null, report.conclusion), h('small', null, `${report.summary.warning} 项需处理，${report.summary.unknown} 项待确认`)),
        h('div', { className: 'ew-findings-list' }, report.findings.map(f => h('article', { key: f.id, className: 'ew-finding' }, h('div', null, chip(f.status), h('strong', null, f.title)), h('p', null, f.details), h('p', { className: 'ew-help' }, '依据：', f.basis), h('div', { className: 'ew-inline' }, f.refs.map(ref => button(ref, () => onSelect?.([ref]), { key: ref, disabled: !onSelect, 'aria-label': '定位检查器件 ' + ref })), f.net && h('small', null, '网络：' + f.net))))),
        h('details', { className: 'ew-extra' }, h('summary', null, '本次检查范围'), h(Bullets, { items: [report.coverage.connectivity, report.coverage.placement, report.coverage.isolation, '未检查：' + report.coverage.notChecked.join('、'), ...(report.notes || [])] })));
    }
    function PCB() {
      const work = useWork();
      const [caps, setCaps] = useState(null), [tab, setTab] = useState('project'), [inspection, setInspection] = useState(null), [report, setReport] = useState(null), [visual, setVisual] = useState(null), [view, setView] = useState('positions'), [selected, setSelected] = useState([]);
      const [ref, setRef] = useState(''), [detail, setDetail] = useState(null), [netFilter, setNetFilter] = useState(''), [exported, setExported] = useState(null);
      const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [guide, setGuide] = useState(null);
      const [snapshot, setSnapshot] = useState(''), [snapshotResult, setSnapshotResult] = useState(null);
      const [watch, setWatch] = useState(null), [popup, setPopup] = useState(false), [seconds, setSeconds] = useState(3);
      const [queryBusy, setQueryBusy] = useState(false), [queryError, setQueryError] = useState('');
      const queryVersion = useRef(0);
      useEffect(() => () => { queryVersion.current++; }, []);
      const loadProject = async () => { const i = await invoke('pcb', 'inspect'); const r = await invoke('pcb', 'review'); setInspection(i); setReport(r); setExported(null); };
      useEffect(() => { work.run('读取评审配置', async () => { const c = await invoke('pcb', 'capabilities'); setCaps(c); if (c.configuredProject) await loadProject(); }); }, []);
      useEffect(() => {
        if (tab !== 'watch') return;
        let stopped = false, initialized = false, timer;
        const tick = async () => { try { const v = await invoke('pcb', 'watch'); if (!stopped) { setWatch(v); if (!initialized) { setPopup(!!v.settings?.popup); setSeconds(v.settings?.pollSeconds || 3); initialized = true; } } } catch (e) { if (!stopped) work.setError(e.message); } finally { if (!stopped) timer = setTimeout(tick, 4000); } };
        tick(); return () => { stopped = true; clearTimeout(timer); };
      }, [tab]);
      const inspectRef = async value => {
        const requested = value.trim(), version = ++queryVersion.current;
        setRef(requested); setSelected(requested ? [requested] : []); setDetail(null); setQueryError(''); setQueryBusy(true);
        try {
          const x = await invoke('pcb', 'inspect', requested ? { ref: requested } : {});
          if (version !== queryVersion.current) return;
          if (x.component) { setDetail(x); setSelected([x.component.ref]); } else setInspection(x);
        } catch (e) { if (version === queryVersion.current) setQueryError(e.message); }
        finally { if (version === queryVersion.current) setQueryBusy(false); }
      };
      const locate = refs => {
        if (view === 'pcb') setView('positions');
        if (refs[0]) inspectRef(refs[0]);
        else { queryVersion.current++; setSelected([]); setRef(''); setDetail(null); setQueryBusy(false); setQueryError(''); }
      };
      const updateProject = () => work.run('从已保存工程更新网表与图纸', async () => { const v = await api('refresh-project', {}); setVisual(v); await loadProject(); });
      const setWatcher = enabled => work.run(enabled ? '开启快照监听' : '停止快照监听', async () => { setWatch(await invoke('pcb', 'setWatch', { enabled, popup, pollSeconds: Number(seconds) })); });
      const components = visual?.components || inspection?.components || [];
      return h('div', { className: 'ew-business' },
        h('div', { className: 'ew-page-intro' }, h('div', null, h('h2', null, 'PCB 与原理图评审'), h('p', null, '从器件清单、实际网表和项目规则核对问题。')), caps && h('small', { className: 'ew-wrap' }, caps.configuredProject || '尚未配置默认工程')),
        h('nav', { className: 'ew-subtabs', 'aria-label': 'PCB 评审功能' }, [['project', '工程与网络'], ['guide', '器件检查清单'], ['snapshot', '输入快照评审'], ['watch', '变更监听']].map(([k, title]) => button(title, () => setTab(k), { key: k, className: tab === k ? 'ew-selected' : '', 'aria-pressed': tab === k }))),
        h(Alert, { work }),
        tab === 'project' && h(R.Fragment, null,
          h('div', { className: 'ew-actions' }, button('重新评审导出项目', () => work.run('读取并评审项目', loadProject), { disabled: !!work.busy || !caps?.configuredProject }), button('从已保存 KiCad 工程更新', updateProject, { disabled: !!work.busy || !caps?.configuredProject, className: 'ew-primary' }), report && button('导出评审报告', () => work.run('导出评审报告', async () => setExported(await invoke('pcb', 'export', { expectedRevision: report.revision }))), { disabled: !!work.busy || !caps?.reportExportEnabled })),
          h('p', { className: 'ew-help' }, '评审读取已导出快照；更新按钮会重新导出已保存的 KiCad 工程，并更新评审快照。未保存编辑不在检查范围内。'),
          h(Artifacts, { value: exported }),
          inspection && h('div', { className: 'ew-inspection-grid' },
            h('section', { className: 'ew-paper' }, h('div', { className: 'ew-section-head' }, h('h3', null, inspection.project), h('small', null, `${inspection.counts.components} 个器件，${inspection.counts.nets} 个网络`)),
              h('div', { className: 'ew-subtabs' }, [['positions', '器件定位'], ['pcb', 'PCB 原图'], ['schematic', '原理图']].map(([k, label]) => button(label, () => setView(k), { key: k, className: view === k ? 'ew-selected' : '', disabled: k !== 'positions' && !visual }))),
              h('div', { className: 'ew-board-canvas ew-section' }, view === 'positions' ? h(PositionMap, { components, selected, onSelect: locate }) : view === 'pcb' ? h('img', { src: visual.pcb, alt: 'KiCad 导出的真实 PCB 铜层与丝印' }) : h(Sheet, { view: visual.schematic, parts: visual.placements, selected })),
              h('p', { className: 'ew-help' }, view === 'positions' ? '封装参考点位置，不代表焊盘和铜皮；点击器件查询引脚网络，点击空白处或按 Esc 取消选择。' : '原生 KiCad 导出图纸。多页原理图当前预览首张，可在同步页检查网表。'),
              h(Alert, { work: { busy: queryBusy ? '查询器件网络' : '', error: queryError } }),
              h('div', { className: 'ew-form-row' }, h(Field, { label: '精确位号' }, textInput(ref, setRef, { placeholder: '例如 U1' })), button('查询器件网络', () => inspectRef(ref), { disabled: !!work.busy || queryBusy })),
              detail && h('div', { className: 'ew-refbox' }, h('h3', null, detail.component.ref + ' · ' + detail.component.value), h('p', null, '封装：' + (detail.component.footprint || '未提供')), h(Table, { columns: [['网络', 'name'], ['连接端点', n => n.nodes.map(p => p.ref + '.' + p.pin).join('、')]], rows: detail.nets }), h(Raw, { value: detail.component, title: '装配状态、属性与坐标' }))),
            h('section', { className: 'ew-paper' }, h('h3', null, '网络与器件目录'), h(Field, { label: '筛选网络名称' }, textInput(netFilter, setNetFilter)), h(Table, { columns: [['网络', 'name'], ['引脚数', 'pinCount']], rows: inspection.nets.filter(n => n.name.toLowerCase().includes(netFilter.toLowerCase())) }),
              h('details', { className: 'ew-extra' }, h('summary', null, '器件目录'), h(Table, { columns: [['位号', c => button(c.ref, () => locate([c.ref]), { disabled: !!work.busy })], ['值', 'value'], ['封装', 'footprint']], rows: inspection.components })), inspection.truncated && h('p', { className: 'ew-help' }, '总览最多显示 200 项，请按位号查询具体器件。'))),
          report && h('section', { className: 'ew-paper ew-section' }, h(Findings, { report, onSelect: locate }))),
        tab === 'guide' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '按器件查询检查清单'),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '器件型号或用途' }, textInput(query, setQuery, { placeholder: '例如 STM32、隔离芯片、输入滤波电容' })), h(Field, { label: '器件类别' }, selectInput(kind, setKind, [['', '按名称推测'], ...(caps?.kinds || Object.keys(kindNames)).map(k => [k, kindNames[k] || k])])), button('查询检查清单', () => work.run('查询器件检查清单', async () => setGuide(await invoke('pcb', 'guide', { query, ...(kind ? { kind } : {}) }))), { className: 'ew-primary', disabled: !!work.busy || !query.trim() })),
          guide ? h(R.Fragment, null, h('p', { className: 'ew-note' }, guide.classification, '。', guide.note), h(Table, { columns: [['类别', 'category'], ['需检查的内容', 'check'], ['检查位置', 'location'], ['依据', c => c.basis.title]], rows: guide.checks }), h('h3', { className: 'ew-section-title' }, '需补充资料'), h(Bullets, { items: guide.requiredInputs })) : empty('选择类别或输入具体器件，查看原理图、布局、走线、工艺和安规检查位置。')),
        tab === 'snapshot' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '评审调用者提供的快照'), h('p', { className: 'ew-help' }, '适用于 AD / KiCad 导出后整理的统一数据。结果会保留“调用者提供”的来源标记。'),
          h(Field, { label: '快照 JSON（board 与 context）' }, textarea(snapshot, v => { setSnapshot(v); setSnapshotResult(null); }, { rows: 12, spellCheck: false, placeholder: '{"board":{…},"context":{…}}' })),
          button('评审输入快照', () => work.run('评审输入快照', async () => { JSON.parse(snapshot); setSnapshotResult(await invoke('pcb', 'snapshot', { snapshotJson: snapshot })); }), { className: 'ew-primary', disabled: !!work.busy || !snapshot.trim() }), snapshotResult && h(R.Fragment, null, h(Findings, { report: snapshotResult }), h('details', { className: 'ew-extra' }, h('summary', null, '完整评审文本'), h(TextReport, { text: snapshotResult.markdown })))),
        tab === 'watch' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '导出快照变化监听'), h('p', { className: 'ew-help' }, '两次读取稳定后提示新增或变化的问题。监测的是导出文件；请先保存并重新导出设计。设置作用于当前 DSH 运行会话，重启恢复原配置。'),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '检查间隔（秒）' }, h('input', { type: 'number', value: seconds, min: 1, max: 3600, onChange: e => setSeconds(e.target.value) })), checkbox('显示本机 Windows 提醒', popup, setPopup), button('开启 / 更新监听', () => setWatcher(true), { disabled: !!work.busy, className: 'ew-primary' }), button('停止监听', () => setWatcher(false), { disabled: !!work.busy || !watch?.settings?.enabled })),
          watch && h(R.Fragment, null, h('p', { role: 'status' }, '状态：', ({ disabled: '未开启', starting: '启动中', settling: '等待数据稳定', watching: '正在监听', error: '读取失败', stopped: '已停止' })[watch.state] || watch.state, '　最近检查：', stamp(watch.lastCheckedAt)), watch.lastError && h('div', { className: 'ew-error' }, watch.lastError), h(Table, { columns: [['状态', f => chip(f.status)], ['检查项', 'title'], ['位置', f => f.refs.join('、')], ['说明', 'details']], rows: watch.findings || [] }))),
        caps && h('details', { className: 'ew-extra' }, h('summary', null, '支持范围与配置'), h(Bullets, { items: caps.checks }), h(Bullets, { items: caps.limits }), h(Raw, { value: caps })));
    }

    const newRequirement = () => ({ id: 'item-' + Math.random().toString(36).slice(2, 9), kind: 'component', ref: '', properties: { value: '' }, certain: false, evidence: { quote: '', page: 1 } });
    const blankContract = () => ({ schemaVersion: 1, scope: 'partial', requirements: [], unresolved: [] });
    function readContractDraft(text) {
      const c = JSON.parse(text);
      if (!c || c.schemaVersion !== 1 || c.scope !== 'partial' || !Array.isArray(c.requirements) || !Array.isArray(c.unresolved) || c.unresolved.some(s => typeof s !== 'string')) throw new Error('条目需要 schemaVersion:1、scope:partial、requirements 数组和 unresolved 字符串数组。');
      const ids = new Set();
      for (const r of c.requirements) {
        if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !['component', 'absent', 'connected', 'disconnected'].includes(r.kind) || typeof r.certain !== 'boolean' || typeof r.evidence?.quote !== 'string') throw new Error('每个条目需要唯一 id、有效类型、certain 和 evidence.quote。');
        ids.add(r.id);
        if (['component', 'absent'].includes(r.kind) && typeof r.ref !== 'string') throw new Error('元件条目需要字符串位号 ref。');
        if (r.kind === 'component' && (!r.properties || Array.isArray(r.properties) || typeof r.properties !== 'object' || Object.entries(r.properties).some(([k, v]) => !['value', 'footprint', 'libId', 'dnp'].includes(k) || typeof v !== (k === 'dnp' ? 'boolean' : 'string')))) throw new Error('元件属性只接受 value、footprint、libId 字符串和 dnp 布尔值。');
        if (['connected', 'disconnected'].includes(r.kind) && (!Array.isArray(r.pins) || r.pins.some(p => !p || typeof p.ref !== 'string' || typeof p.pin !== 'string'))) throw new Error('连接条目需要 pins 数组，每个端点包含字符串 ref、pin。');
      }
      return c;
    }
    function targetDraft(text) {
      const contract = blankContract();
      for (const original of text.split(/[；;\n]+/)) {
        const quote = original.trim().replace(/[。.]$/, ''); if (!quote) continue;
        const value = quote.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(?:改为|修改为|设为|=|＝)\s*([A-Za-z0-9 .µμΩ%+\/-]+)$/);
        const fitted = quote.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(不装|不装配|装配|安装)$/);
        if (value) contract.requirements.push({ ...newRequirement(), ref: value[1], properties: { value: value[2].trim() }, certain: true, evidence: { quote } });
        else if (fitted) contract.requirements.push({ ...newRequirement(), ref: fitted[1], properties: { dnp: fitted[2].startsWith('不') }, certain: true, evidence: { quote } });
        else contract.unresolved.push(quote);
      }
      return contract;
    }
    function ContractEditor({ value, onChange, imageTarget, disabled }) {
      const update = (i, patch) => onChange({ ...value, requirements: value.requirements.map((r, j) => i === j ? { ...r, ...patch } : r) });
      const kinds = [['component', '元件属性'], ['absent', '元件应不存在'], ['connected', '指定引脚连接'], ['disconnected', '两个引脚断开']];
      return h('div', null,
        value.requirements.map((row, i) => h('fieldset', { key: row.id, className: 'ew-target-row', disabled },
          h('legend', null, `检查条目 ${i + 1}`), h('div', { className: 'ew-form-row' },
            h(Field, { label: '检查类型' }, selectInput(row.kind, kind => update(i, { kind, ...(kind === 'component' ? { properties: { value: '' }, ref: row.ref || '' } : kind === 'absent' ? { ref: row.ref || '' } : { pins: [{ ref: '', pin: '' }, { ref: '', pin: '' }] }) }), kinds)),
            ['component', 'absent'].includes(row.kind) && h(Field, { label: '位号' }, textInput(row.ref || '', ref => update(i, { ref }), { placeholder: 'R1' })),
            ['connected', 'disconnected'].includes(row.kind) && h(Field, { label: '引脚端点（逗号分隔）' }, textInput((row.pins || []).map(p => p.ref + '.' + p.pin).join(', '), v => update(i, { pins: v.split(/[,，]/).map(s => { const a = s.trim().split('.'); return { ref: a[0] || '', pin: a.slice(1).join('.') }; }) }), { placeholder: 'U1.3, J1.2' })),
            row.kind === 'connected' && checkbox('只允许这些端点，无额外连接', !!row.exact, exact => update(i, { exact }))),
          row.kind === 'component' && h('div', { className: 'ew-form-row' }, Object.entries(row.properties || {}).map(([key, value]) => h('div', { className: 'ew-property', key }, key === 'dnp' ? checkbox('不装配（DNP）', value, v => update(i, { properties: { ...row.properties, dnp: v } })) : h(Field, { label: ({ value: '目标元件值', footprint: '目标封装', libId: '目标符号库 ID' })[key] || key }, textInput(value, v => update(i, { properties: { ...row.properties, [key]: v } }))), button('移除属性', () => update(i, { properties: Object.fromEntries(Object.entries(row.properties).filter(([k]) => k !== key)) }), { 'aria-label': '移除属性 ' + key }))),
            h(Field, { label: '添加属性' }, selectInput('', key => { if (key) update(i, { properties: { ...row.properties, [key]: key === 'dnp' ? false : '' } }); }, [['', '选择属性'], ...[['value', '元件值'], ['footprint', '封装'], ['libId', '符号库'], ['dnp', '装配状态']].filter(([k]) => !(k in (row.properties || {})))]))),
          h('div', { className: 'ew-form-row' }, h(Field, { label: imageTarget ? '可见证据描述' : '逐字原文依据' }, textInput(row.evidence?.quote || '', quote => update(i, { evidence: { ...row.evidence, quote } }))), imageTarget && h(Field, { label: '证据页码' }, h('input', { type: 'number', min: 1, value: row.evidence?.page || 1, onChange: e => update(i, { evidence: { ...row.evidence, page: Number(e.target.value) } }) })), checkbox('我已核对位号对应、数值和连接', row.certain, certain => update(i, { certain })), button('删除条目', () => onChange({ ...value, requirements: value.requirements.filter((_, j) => j !== i) }))))),
        button('添加目标条目', () => onChange({ ...value, requirements: [...value.requirements, newRequirement()] }), { disabled }),
        h(Field, { label: '尚未确认的事项（每行一项）' }, textarea(value.unresolved.join('\n'), text => onChange({ ...value, unresolved: text.split('\n').filter(x => x.trim()) }), { rows: 3, disabled })),
        h('p', { className: 'ew-help' }, '未确认条目和未解决事项会保留为未知，并阻止写回。文字依据必须逐字来自原文；图像依据需要实际读取对应页。'));
    }
    function Comparison({ value }) {
      if (!value) return null;
      return h('div', { className: 'ew-comparison' }, h('div', { className: 'ew-section-head' }, h('h3', null, value.matches ? '所列目标已满足' : '存在差异或待确认项'), chip(value.matches ? 'pass' : 'unknown')),
        h('p', { className: 'ew-help' }, value.scope === 'declared_requirements_only' ? '只核对明确列出的目标，不表示整张图纸等同。' : '原生目标同时核对实际网表与绘图结构。'),
        h(Table, { columns: [['检查内容', c => c.id || c.kind || c.field || '差异'], ['位置', c => c.ref || c.pins?.map(p => p.ref + '.' + p.pin).join('、') || c.net || '—'], ['状态', c => ({ match: '满足', difference: '有差异', unknown: '待确认' })[c.status] || c.kind || '差异'], ['要求 / 实际', c => h('div', null, c.properties && h('p', null, '目标：' + compact(c.properties)), c.expected !== undefined && h('p', null, '要求：' + compact(c.expected)), h('p', null, '实际：' + compact(c.actual ?? c.detail ?? c)))]], rows: value.checks || value.differences || [] }),
        h(Bullets, { items: value.unresolved }), value.unexpectedChanges?.length > 0 && h('div', { className: 'ew-error' }, '发现未在目标中声明的变化，不能写回。', h(Bullets, { items: value.unexpectedChanges })), h(Raw, { value, title: '完整网表与图形差异' }));
    }
    function SchematicChanges({ verification, reference }) {
      const data = verification.changeSet, changes = data?.changes || [];
      const [selected, setSelected] = useState(changes[0]?.id || ''), [showTarget, setShowTarget] = useState(false);
      const change = changes.find(c => c.id === selected);
      const panes = [['before', '修改前快照'], ['after', '候选副本']].map(([id, title]) => ({ id, title, view: verification.views[id], points: change?.[id]?.points, marks: (change ? [change] : changes).map(c => c[id]).filter(Boolean) }));
      if (showTarget && reference) panes.push({ id: 'target', title: '目标 JPG / PDF 原件', view: reference });
      return h('section', { className: 'ew-section', 'aria-label': '本次实际修改' },
        h('h3', null, data ? `本次实际变化：${data.counts.components} 个器件、${data.counts.wires} 段导线、${data.counts.other} 处标注 / 图形` : '请重新验证以生成实际修改清单'),
        h('p', { className: 'ew-help' }, '这里比较修改前与候选，目标检查结果列在下方。点击变化可在两侧分别定位；移动的器件按各自真实位置显示。'),
        changes.length ? h('div', { className: 'ew-change-list' }, button('查看全部变化', () => setSelected(''), { className: !selected ? 'ew-selected' : '' }), changes.map(c => button(h(R.Fragment, null, h('b', null, c.title), ...c.fields.map((f, i) => h('span', { key: i }, f.name + '：' + compact(f.before) + ' → ' + compact(f.after)))), () => setSelected(c.id), { key: c.id, className: selected === c.id ? 'ew-selected' : '', 'aria-pressed': selected === c.id }))) : h('p', { className: 'ew-note' }, '候选与修改前没有检测到可显示的变化。'),
        h('div', { className: 'ew-change-legend' }, h('span', { className: 'before' }, '橙色：修改前的位置 / 内容'), h('span', { className: 'after' }, '绿色：候选中的位置 / 内容')),
        change && (!change.before || !change.after) && h('p', { className: 'ew-help' }, !change.before ? '这是新增对象，修改前没有对应位置。' : '这是移除对象，候选中已不存在。'),
        reference && checkbox('同时对照目标原图', showTarget, setShowTarget),
        h(DrawingViewer, { title: '修改前后对比', panes, focusKey: selected }));
    }
    function Schematic() {
      const work = useWork();
      const [caps, setCaps] = useState(null), [current, setCurrent] = useState(''), [targetType, setTargetType] = useState('text'), [targetPath, setTargetPath] = useState(''), [targetText, setTargetText] = useState('');
      const [tasks, setTasks] = useState([]), [task, setTask] = useState(null), [target, setTarget] = useState(null), [page, setPage] = useState(1);
      const [contract, setContract] = useState(blankContract), [savedContract, setSavedContract] = useState(''), [contractJSON, setContractJSON] = useState('');
      const [inspection, setInspection] = useState(null), [which, setWhich] = useState('candidate'), [candidateRevision, setCandidateRevision] = useState(''), [comparison, setComparison] = useState(null), [verification, setVerification] = useState(null);
      const [operations, setOperations] = useState(''), [useOperations, setUseOperations] = useState(false), [notice, setNotice] = useState(''), [confirmation, setConfirmation] = useState(null), [closedProject, setClosedProject] = useState(false);
      const [focusRef, setFocusRef] = useState(''), [step, setStep] = useState('target');
      const listTasks = async () => setTasks(await api('tasks'));
      useEffect(() => { work.run('读取原理图工作区', async () => { setCaps(await invoke('schematic', 'capabilities')); const c = await api('bootstrap'); setCurrent(c.currentSchematic || ''); await listTasks(); }); }, []);
      const clearVerification = () => { setVerification(null); setConfirmation(null); setClosedProject(false); };
      const changeContract = v => { setContract(v); setContractJSON(JSON.stringify(v, null, 2)); clearVerification(); setComparison(null); };
      const inspect = async (id, selected = 'candidate') => { const v = await invoke('schematic', 'inspect', { taskId: id, which: selected }); setInspection(v); setWhich(selected); if (selected === 'candidate') setCandidateRevision(v.revision); return v; };
      const loadTask = id => work.run('载入原理图任务', async () => {
        if (!id) return;
        setOperations(''); setUseOperations(false); setFocusRef('');
        const t = await api('task?id=' + encodeURIComponent(id)); setTask(t); setTarget(null); setNotice(''); setInspection(null); setComparison(null); setCandidateRevision(''); clearVerification();
        const c = t.contract || blankContract(); setContract(c); setContractJSON(JSON.stringify(c, null, 2)); setSavedContract(t.contract ? JSON.stringify(c) : ''); setPage(1); setStep('target');
        if (!t.applied) { setTarget(await invoke('schematic', 'read', { taskId: id, page: 1 })); await inspect(id); }
        else setNotice(t.rolledBack ? '该任务已回退到写回前状态。' : '该任务已写回；可以核对写回信息并回退。');
      });
      const begin = () => work.run('保存当前图和目标的独立快照', async () => {
        setOperations(''); setUseOperations(false); setFocusRef(''); setCandidateRevision('');
        const x = await invoke('schematic', 'begin', { currentPath: current, ...(targetType === 'text' ? { targetText } : { targetPath }) });
        const t = await api('task?id=' + encodeURIComponent(x.taskId)); setTask(t); setComparison(null); setInspection(null); clearVerification(); setSavedContract(''); setNotice(''); setPage(1); setStep('target');
        const source = await invoke('schematic', 'read', { taskId: t.taskId, page: 1 }); setTarget(source);
        const c = source.kind === 'text' ? targetDraft(source.text) : blankContract(); setContract(c); setContractJSON(JSON.stringify(c, null, 2));
        await inspect(t.taskId); await listTasks();
      });
      const readTarget = interpret => work.run(interpret ? '正在识别图纸，通常需要 1–5 分钟' : '读取指定目标页', async () => {
        if (interpret) { const latest = await invoke('schematic', 'capabilities'); setCaps(latest); if (!latest.visionConfigured) throw new Error(latest.vision?.reason || '请先连接支持图片的 DSH 模型。'); }
        const v = await invoke('schematic', 'read', { taskId: task.taskId, page: Number(page), interpret }); setTarget(v);
        if (v.contract) { changeContract(readContractDraft(JSON.stringify(v.contract))); setNotice(`已识别 ${v.contract.requirements.length} 个检查条目、${v.contract.unresolved.length} 个待确认事项。请逐条确认目标位号与当前工程的对应关系，再勾选保存；原理图尚未修改。`); }
        else if (interpret) throw new Error(v.vision?.reason || v.instruction || '识别没有返回条目，请检查模型后重试。');
      });
      const define = () => work.run('保存带证据的目标条目', async () => { await invoke('schematic', 'define', { taskId: task.taskId, expectedTargetRevision: task.target.revision, contract }); setSavedContract(JSON.stringify(contract)); clearVerification(); setNotice('目标条目已保存，可以比较和修改候选。'); });
      const isNative = task?.target.kind === 'schematic';
      const contractReady = isNative || (savedContract && savedContract === JSON.stringify(contract));
      const compare = selected => work.run('核对原理图与目标', async () => { setComparison(await invoke('schematic', 'compare', { taskId: task.taskId, which: selected })); setStep('compare'); });
      const prepare = () => work.run('修改独立候选原理图', async () => {
        clearVerification();
        let ops;
        if (useOperations) { ops = JSON.parse(operations); if (!Array.isArray(ops) || !ops.length) throw new Error('高级修改操作必须为非空数组。'); }
        const v = await invoke('schematic', 'prepare', { taskId: task.taskId, expectedRevision: candidateRevision, ...(ops ? { operations: ops } : {}) });
        setCandidateRevision(v.revision); setComparison(null); setNotice(v.changed ? '候选副本已修改，请验证。原文件尚未写回。' : '候选与本次操作一致，没有产生变化。'); await inspect(task.taskId); setStep('candidate');
      });
      const verify = () => work.run('重新比较、运行 ERC 并生成前后图纸', async () => { clearVerification(); const v = await invoke('schematic', 'verify', { taskId: task.taskId }); setVerification(v); setComparison(v.comparison); setCandidateRevision(v.candidateHash); setStep('verify'); });
      const requestChange = action => work.run('核对本次工程修改', async () => { setClosedProject(false); setConfirmation(await api('confirmation', { action, taskId: task.taskId, ...(action === 'apply' ? { verificationToken: verification.token } : {}) })); });
      const confirmChange = () => work.run(confirmation.action === 'apply' ? '备份并写回工程' : '回退工程写回', async () => {
        const v = await invoke('schematic', confirmation.action, { taskId: task.taskId, ...(confirmation.action === 'apply' ? { verificationToken: verification.token } : {}) }, confirmation.id);
        const t = await api('task?id=' + encodeURIComponent(task.taskId)); setTask(t); setConfirmation(null); setClosedProject(false); setNotice(v.status === 'applied' ? '已备份并写回当前原理图。请在 KiCad 重新打开核对；PCB 没有随之修改。' : '已恢复写回前的原始文件。'); await listTasks();
      });
      const sourceImage = target?.artifacts?.find(a => a.key === 'preview');
      const referenceView = sourceImage && { url: sourceImage.url, width: target.preview.width || 1200, height: target.preview.height || 800 };
      const focus = inspection?.placements?.find(p => p.ref === focusRef);
      return h('div', { className: 'ew-business' },
        h('div', { className: 'ew-page-intro' }, h('div', null, h('h2', null, '原理图目标同步'), h('p', null, '读取目标、核对差异、修改独立候选，再验证和应用。')), h('small', null, caps?.allowApply ? '已启用验证后的受控写回' : '当前配置只允许候选修改与验证')),
        h(Alert, { work }), notice && h('p', { className: 'ew-notice', role: 'status' }, notice),
        h('section', { className: 'ew-paper' }, h('h3', null, '选择已有任务或创建新任务'),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '已有原理图任务' }, selectInput(task?.taskId || '', loadTask, [['', '选择任务'], ...tasks.map(t => [t.taskId, `${t.current.split(/[\\/]/).pop()} · ${t.kind} · ${({ candidate: '候选', applied: '已写回', restored: '已回退' })[t.state]} · ${t.taskId.slice(0, 8)}`])], { disabled: !!work.busy })), button('刷新任务列表', () => work.run('刷新任务', listTasks), { disabled: !!work.busy })),
          h('details', { className: 'ew-extra', open: !task }, h('summary', null, '创建新任务'),
            h(FilePicker, { label: '当前原理图', value: current, onChange: setCurrent, extensions: ['.kicad_sch'] }),
            h(Field, { label: '目标类型' }, selectInput(targetType, setTargetType, [['text', '直接输入文字要求'], ['schematic', '目标 KiCad 原理图'], ['reference', '图片 / PDF'], ['document', 'TXT / Markdown 要求文件']])),
            targetType === 'text' ? h(Field, { label: '目标要求原文' }, textarea(targetText, setTargetText, { rows: 5, placeholder: '例如：R1 改为 10k；C1 改为 100nF；R9 不装。连接要求也可逐条录入并保留原文证据。', maxLength: 100000 })) : h(FilePicker, { label: '目标文件', value: targetPath, onChange: setTargetPath, extensions: targetType === 'schematic' ? ['.kicad_sch'] : targetType === 'reference' ? ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] : ['.txt', '.md'] }),
            button('创建并读取目标', begin, { className: 'ew-primary', disabled: !!work.busy || !current.trim() || !(targetType === 'text' ? targetText.trim() : targetPath.trim()) }))),
        task && h(R.Fragment, null,
          h('div', { className: 'ew-task-context' }, h('strong', null, '当前任务 ' + task.taskId.slice(0, 8)), h('span', null, task.current), h('small', null, `目标类型：${task.target.kind}。每个任务持有独立快照和候选。`)),
          !task.applied && h(R.Fragment, null,
            h('nav', { className: 'ew-subtabs ew-section', 'aria-label': '原理图任务步骤' }, [['target', '目标与证据'], ['compare', '差异比较'], ['candidate', '候选修改'], ['verify', '验证与写回']].map(([k, label]) => button(label, () => setStep(k), { key: k, className: step === k ? 'ew-selected' : '' }))),
            step === 'target' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '目标原件与检查条目'),
              ['pdf', 'image'].includes(task.target.kind) && h(R.Fragment, null, h('div', { className: 'ew-form-row' }, h(Field, { label: '目标页码' }, h('input', { type: 'number', min: 1, value: page, onChange: e => setPage(e.target.value) })), button('读取此页', () => readTarget(false), { disabled: !!work.busy }), button('识别本页为条目草稿', () => readTarget(true), { className: 'ew-primary', disabled: !!work.busy })), h('p', { className: 'ew-help' }, caps?.vision?.reason || '点击识别，将检查当前 DSH 模型是否支持图片。'), sourceImage && h('details', { className: 'ew-extra', open: !contract.requirements.length }, h('summary', null, '查看目标原图（点击展开 / 收起）'), h(DrawingViewer, { title: '目标原图', focusKey: sourceImage.url, panes: [{ id: 'target', title: `目标原件第 ${target.preview.page} 页`, view: referenceView }] })), target?.preview && h('details', null, h('summary', null, `第 ${target.preview.page} / ${target.preview.pages} 页可提取文字（不证明连线）`), h('pre', { className: 'ew-source-text' }, target.preview.text))),
              target?.kind === 'text' && h(R.Fragment, null, h('blockquote', { className: 'ew-source-text' }, target.text), button('从简单改值 / 装配要求提取草稿', () => { changeContract(targetDraft(target.text)); setNotice('仅提取明确的改值和装配语句，其他文字保留在待确认事项。请核对后保存。'); }, { disabled: !!work.busy })),
              isNative ? h('p', { className: 'ew-notice' }, '目标是原生 KiCad 图纸，直接比较实际网表及绘图结构，无需人工建立条目。') : h(R.Fragment, null,
                h(ContractEditor, { value: contract, onChange: changeContract, imageTarget: ['pdf', 'image'].includes(task.target.kind), disabled: !!work.busy }),
                h('details', { className: 'ew-extra' }, h('summary', null, '导入 / 编辑完整目标条目'), h(Field, { label: '目标条目 JSON' }, textarea(contractJSON, setContractJSON, { rows: 10, spellCheck: false })), button('载入条目草稿', () => { try { changeContract(readContractDraft(contractJSON)); } catch (e) { work.setError(e.message); } }, { disabled: !!work.busy })),
                button('保存并确认目标条目', define, { className: 'ew-primary', disabled: !!work.busy || !contract.requirements.length }), contractReady && h('span', { className: 'ew-help' }, '　当前条目已保存'))),
            step === 'compare' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '比较实际原理图与目标'), h('div', { className: 'ew-actions' }, button('比较修改前', () => compare('current'), { disabled: !!work.busy || !contractReady }), button('比较候选图', () => compare('candidate'), { disabled: !!work.busy || !contractReady, className: 'ew-primary' })), !contractReady && h('p', { className: 'ew-help' }, '请先保存目标条目。'), h(Comparison, { value: comparison })),
            step === 'candidate' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '候选图、器件与原始对象'),
              h('div', { className: 'ew-form-row' }, h(Field, { label: '查看图纸' }, selectInput(which, value => work.run('读取图纸与网络', () => inspect(task.taskId, value)), [['current', '修改前快照'], ['candidate', '候选副本'], ...(isNative ? [['target', '目标原图']] : [])])), button('读取图纸与对象', () => work.run('读取图纸与网络', () => inspect(task.taskId, which)), { disabled: !!work.busy })),
              inspection?.views?.sheet && h(DrawingViewer, { title: which === 'current' ? '修改前图纸' : which === 'target' ? '目标图纸' : '候选图纸', focusKey: inspection.revision + ':' + focusRef, panes: [{ id: which, title: which === 'current' ? '修改前快照' : which === 'target' ? '目标原图' : '候选副本', view: inspection.views.sheet, points: focus ? [focus.at.slice(0, 2)] : null, marks: focus ? [{ kind: 'symbol', points: [focus.at.slice(0, 2)] }] : [] }] }),
              inspection && h(R.Fragment, null, h(Field, { label: '聚焦器件' }, selectInput(focusRef, setFocusRef, [['', '整张图纸'], ...inspection.placements.map(p => [p.ref, `${p.ref} · ${p.value}`])])), h('details', { className: 'ew-extra' }, h('summary', null, '器件、网络与对象 UUID'), h(Table, { columns: [['位号', 'ref'], ['值', 'value'], ['封装', 'footprint'], ['不装配', c => c.dnp ? '是' : '否'], ['UUID', 'uuid']], rows: inspection.placements }), h(Raw, { value: inspection.board.nets, title: '逐脚网络' }), h(Raw, { value: inspection.objects, title: '原始图形与符号对象（高级修改依据）' }))),
              h('div', { className: 'ew-section-head' }, h('h3', null, '修改方式')), checkbox('使用高级修改操作（增删件、连线、图形、符号库）', useOperations, v => { setUseOperations(v); clearVerification(); }),
              useOperations ? h(Field, { label: '高级修改操作 JSON' }, textarea(operations, v => { setOperations(v); clearVerification(); }, { rows: 10, spellCheck: false, placeholder: '[{"op":"set_properties","ref":"R1","properties":{"Value":"10k"}}]' })) : h('p', { className: 'ew-help' }, isNative ? '自动同步单页原生目标，保留同位号元件关联。' : '按已保存的明确目标修改已有元件属性。连接和增删件需要基于实际 UUID 的高级操作。'),
              h('details', { className: 'ew-extra' }, h('summary', null, '支持的高级修改方式'), h(Bullets, { items: ['set_properties：按位号设置 Value、Footprint、dnp 等属性。', 'insert：插入完整对象 S-expression；replace：按 UUID 替换并保留 UUID；delete：按 UUID 删除。', 'upsert_library_symbol：新增或更新内嵌符号。连接修改必须依据实际引脚位置与网络，不能凭图面距离猜测。', '每次操作都绑定当前候选内容版本；修改后需要重新验证。'] })),
              button('修改候选副本', prepare, { disabled: !!work.busy || !candidateRevision || !contractReady, className: 'ew-primary' })),
            step === 'verify' && h('section', { className: 'ew-paper ew-section' }, h('div', { className: 'ew-section-head' }, h('h3', null, '验证、前后对比与写回'), button('验证候选并生成对比', verify, { disabled: !!work.busy || !contractReady, className: 'ew-primary' })),
              verification && h(R.Fragment, null,
                h('div', { className: 'ew-diff-summary' }, chip(verification.canApply ? 'pass' : 'unknown'), h('strong', null, `目标差异 ${verification.comparison.differences?.length || 0} 项`), h('span', null, `ERC：${verification.erc.errors} 个错误，${verification.erc.warnings} 个警告`)),
                h(SchematicChanges, { key: verification.token, verification, reference: referenceView }),
                h(Artifacts, { value: verification }), h(Comparison, { value: verification.comparison }),
                h('p', { className: 'ew-note' }, verification.canApply ? '所列目标满足且 ERC 无错误，可以核对后写回。警告仍需工程师复核。' : '目标差异、未知项或 ERC 错误尚未解决，写回不可用。'),
                button('核对并准备写回', () => requestChange('apply'), { disabled: !!work.busy || !verification.canApply || !caps?.allowApply, className: 'ew-primary' })))),
          task.applied && h('section', { className: 'ew-paper ew-section' }, h('h3', null, task.rolledBack ? '已回退' : '已写回'), h('p', { className: 'ew-wrap' }, '当前工程：', task.current), h('p', { className: 'ew-wrap' }, '原始备份：', task.applied.backup), h('p', null, '写回时间：', task.applied.appliedAt), !task.rolledBack && button('核对并准备回退', () => requestChange('rollback'), { disabled: !!work.busy })),
          confirmation && h('section', { className: 'ew-confirmation', role: 'region', 'aria-label': '确认工程修改' }, h('h3', null, confirmation.action === 'apply' ? '确认写回这一个原理图' : '确认恢复写回前版本'), h('p', { className: 'ew-wrap' }, confirmation.current), h('p', null, confirmation.warning), checkbox('我已保存并关闭该 KiCad 工程，并确认以上文件和修改', closedProject, setClosedProject), h('div', { className: 'ew-actions' }, button(confirmation.action === 'apply' ? '确认写回' : '确认回退', confirmChange, { disabled: !!work.busy || !closedProject, className: 'ew-primary' }), button('取消', () => setConfirmation(null), { disabled: !!work.busy })))),
        caps && h('details', { className: 'ew-extra' }, h('summary', null, '输入、修改与验证边界'), h(Bullets, { items: caps.rules })));
    }

    const engineeringTitles = { datasheet: '读手册', selection: '产品方案', 'schematic-review': '原理图评审', 'pcb-review': 'PCB 评审', compare: '原理图对比', align: '向目标对齐' };
    const engineeringStatus = { pass: '已列条件符合', fail: '发现差异 / 问题', unknown: '待确认', not_performed: '未执行', warning: '发现警告', failed: '检查失败', suggestions: '扩展检查建议', different: '有差异', ready: '已建立任务' };
    const es = value => engineeringStatus[value] || value || '—';
    const et = body => api('engineering', body);
    function Engineering({ kind, requestedTask }) {
      const work = useWork(), [left, setLeft] = useState(''), [right, setRight] = useState(''), [output, setOutput] = useState('');
      const [task, setTask] = useState(null), [records, setRecords] = useState([]), [chosen, setChosen] = useState([]), [focus, setFocus] = useState('');
      const [relatedSchematic, setRelatedSchematic] = useState('');
      const [native, setNative] = useState(true), [extended, setExtended] = useState(true), [checks, setChecks] = useState([]), [metrics, setMetrics] = useState([]);
      const pair = kind === 'compare' || kind === 'align', review = kind.endsWith('review');
      const refreshList = async () => setRecords((await et({ action: 'list' })).filter(t => t.kind === kind));
      useEffect(() => { api('bootstrap').then(c => setLeft(kind === 'pcb-review' ? c.pcbPath || '' : kind !== 'datasheet' ? c.currentSchematic || '' : '')).catch(() => {}); refreshList().catch(() => {}); }, []);
      const execute = (action, extra = {}) => work.run('正在' + ({ create: '读取文件', review: '评审', extract: '提取并交叉核对', prepare: '生成候选', verify: '验证候选', export: '保存报告' }[action] || '处理任务'), async () => {
        const result = await et({ action, taskId: task?.id, revision: task?.revision, ...extra }); setTask(result); setChosen([]); if (action === 'create' || action === 'open') setFocus(''); await refreshList(); return result;
      });
      const current = task?.candidate || task?.left;
      const source = current?.design, target = task?.right?.design;
      const diffNames = { value: '数值', footprint: '封装', dnp: '装配状态', libId: '型号 / 符号', position: '图面位置', 'pin-net': '引脚连接', 'net-name-only': '仅网络名不同', 'mapping-unconfirmed': '对应关系待确认', 'unmatched-source': '源图未匹配', 'unmatched-target': '目标图未匹配' };
      const describeObject = id => [...(source?.components || []), ...(target?.components || [])].find(c => c.id === id)?.ref || id;
      const selectTask = async id => { if (!id) return; const result = await execute('open', { taskId: id }); if (result) { setLeft(result.left.source); setRight(result.right?.source || ''); setOutput(result.outputDirectory || ''); setChecks(result.checks || []); setMetrics(result.metrics || []); } };
      useEffect(() => { if (requestedTask) selectTask(requestedTask); }, [requestedTask]);
      const issueObject = row => {
        const identities = [...(row.objects || []), ...(row.items || []).map(x => x.uuid), ...(row.components || [])];
        return source?.components.find(c => identities.some(id => [c.id, c.uuid, c.ref].includes(typeof id === 'string' ? id : id?.ref) || c.pins?.some(p => p.uuid === id)))?.id;
      };
      const confirmation = operation => work.run('复核文件版本', async () => {
        const prepared = await et({ action: 'confirmation', taskId: task.id, operation });
        const message = operation === 'apply' ? '已经查看实际元件、连接和图形变化。保存并关闭 EDA 后，确认覆盖原工程？系统会保留备份，PCB 需另行更新。' : '确认从此任务的备份回退？后续人工改动不会被覆盖。';
        if (window.confirm(message)) setTask(await et({ action: operation, taskId: task.id, confirmation: prepared.confirmation }));
      });
      return h('div', { className: 'ew-engineering' },
        h('div', { className: 'ew-section-head' }, h('div', null, h('h2', null, engineeringTitles[kind]), h('p', { className: 'ew-help' }, '每项任务拥有独立文件快照、检查范围和记录。默认工程仅用于预填。')), h('div', null, task && chip('版本 ' + task.revision))),
        h(Alert, { work }),
        h('div', { className: 'ew-form-row' }, h(FilePicker, { label: pair ? '源原理图' : kind === 'datasheet' ? 'PDF 手册' : '待评审工程', value: left, onChange: setLeft, extensions: kind === 'datasheet' ? ['.pdf'] : kind === 'pcb-review' ? ['.kicad_pcb', '.pcbdoc'] : undefined }), pair && h(FilePicker, { label: '目标原理图 / 图片 / PDF', value: right, onChange: setRight }), h(Field, { label: '报告保存目录（可留空）' }, textInput(output, setOutput, { placeholder: '留空则保存在此任务目录' }))),
        kind === 'pcb-review' && h('details', null, h('summary', null, '可选：关联原理图以执行原生一致性检查'), h(FilePicker, { label: '关联原理图（留空继续评审 PCB）', value: relatedSchematic, onChange: setRelatedSchematic, extensions: ['.kicad_sch'] })),
        h('div', { className: 'ew-inline' }, button('新建独立任务', () => execute('create', { kind, left, right: pair ? right : undefined, relatedSchematic: relatedSchematic || undefined, outputDirectory: output || undefined }), { disabled: !!work.busy || !left || pair && !right }), h(Field, { label: '打开已有记录' }, selectInput(task?.id || '', selectTask, [['', '选择此任务的记录'], ...records.map(t => [t.id, `${t.label} · ${new Date(t.createdAt).toLocaleString()}`])]))),
        task && h(R.Fragment, null,
          h('p', { className: 'ew-help' }, '任务 ' + task.id + ' · ' + task.left.source),
          (!task.sourceFresh && !task.applied || task.targetFresh === false || task.candidateFresh === false) && h('p', { className: 'ew-error' }, '源工程、目标或候选已在此任务之外改变。旧结果只用于查看历史，不能沿用旧确认覆盖文件。'),
          h('div', { className: 'ew-inline' }, button('导出报告 / 资料卡', () => execute('export')), task.candidate && button('验证候选', () => execute('verify')), task.validation?.canOverwrite && button('覆盖原工程', () => confirmation('apply')), task.applied && button('回退此版本', () => confirmation('rollback'))), h(Artifacts, { value: task }),
          task.validation && h('div', { className: task.validation.canOverwrite ? 'ew-note' : 'ew-error' }, '原生检查：' + es(task.validation.native.status) + '。' + (task.validation.native.reason || '') + (task.validation.canOverwrite ? '允许确认保存。' : '当前不能覆盖原工程；可保留候选继续处理。') + ' 修改原理图不会自动更新 PCB。'),
          ['left', ...(pair ? ['right'] : [])].map(side => task[side].design.format === 'reference' && h(ReferencePanel, { key: side, task, side, execute, work })),
          source?.previews?.length > 0 && h(EngineeringViewer, { task, focus }),
          kind === 'pcb-review' && h(BoardObjects, { design: source, focus }),
          review && h(R.Fragment, null,
            h('h3', null, '检查范围'), h('div', { className: 'ew-inline' }, checkbox('原生 ERC / DRC', native, setNative), checkbox('扩展检查建议', extended, setExtended), button('开始评审', () => execute('review', { native, extended, checks }), { disabled: !!work.busy })),
            h(RuleEditor, { value: checks, onChange: setChecks, components: source.components, nets: source.nets }),
            task.review && h(R.Fragment, null, h('h3', null, '检查结果'), h('p', null, '原生：' + es(task.review.native.status) + ' · 扩展：' + es(task.review.extension.status)), h(Bullets, { items: task.review.missing }),
              task.review.native.reason && h('p', { className: 'ew-error' }, task.review.native.reason), task.review.extension.reason && h('p', { className: 'ew-note' }, task.review.extension.reason),
              h(Table, { columns: [['检查项', r => r.rule || r.type || r.description || r.detector], ['结论', r => es(r.status || r.severity)], ['证据 / 描述', r => r.reason || r.description || r.summary || r.formula], ['位置', r => (r.objects || r.items || r.components || []).map(x => typeof x === 'string' ? describeObject(x) : x.description || x.uuid).join(', ')], ['定位', r => button('定位器件', () => setFocus(issueObject(r)), { disabled: !issueObject(r) })]], rows: [...(task.review.native.violations || []), ...task.review.rules, ...(task.review.extension.findings || [])] }))),
          pair && h(R.Fragment, null,
            h('h3', null, '元件对应关系'), h('p', { className: 'ew-help' }, '位号相同只是建议。不同型号、不同引脚定义需逐项核对；不能据此认定可互换。'),
            h(MappingEditor, { task, onSave: mappings => execute('mapping', { mappings }) }),
            kind === 'align' && h(LayoutCalibration, { task, execute }),
            h(FunctionEditor, { value: metrics, onChange: setMetrics }),
            button('比较元件、连接和功能指标', () => execute('compare', { metrics }), { disabled: !!work.busy }),
            task.comparison && h(R.Fragment, null,
              h('div', { className: 'ew-conclusions' }, [['components', '元件匹配'], ['connectivity', '连接相同'], ['functional', '已列功能指标一致'], ['requirements', '已列设计要求满足']].map(([key, title]) => h('article', { key }, h('small', null, title), h('strong', null, es(task.comparison.conclusions[key]))))),
              h('p', { className: 'ew-help' }, '完整电路功能等价：未验证。图面位置差异不直接视为电气或功能差异。'),
              h(Table, { columns: [['选择', d => checkbox('', chosen.includes(d.id), yes => setChosen(yes ? [...chosen, d.id] : chosen.filter(x => x !== d.id)))], ['层次 / 差异', d => `${d.layer} · ${diffNames[d.kind] || d.kind}`], ['对象', d => button(d.objects.map(describeObject).join(' ↔ '), () => setFocus(d.objects[0]))], ['源 → 目标', d => `${compact(d.before)} → ${compact(d.after)}`], ['状态', d => es(d.status)]], rows: task.comparison.differences }),
              h(Table, { columns: [['指标', r => r.id], ['源', r => `${r.left.value ?? '未知'} ${r.left.unit}`], ['目标', r => `${r.right.value ?? '未知'} ${r.right.unit}`], ['一致性', r => es(r.status)], ['满足要求', r => es(r.requirements)]], rows: task.comparison.functional })),
            kind === 'align' && h(R.Fragment, null,
              h('div', { className: 'ew-inline' }, button('将所选差异对齐到目标', () => execute('prepare', { differences: chosen }), { disabled: !chosen.length || !!work.busy }), h('small', null, '未选择的差异继续保留；未知数值不猜填。')),
              task.manualDifferences?.length > 0 && h('p', { className: 'ew-note' }, '候选已建立。所选连接、型号或引脚差异需要在下方编辑器中逐项调整；再次比较和验证后才能保存。'),
              h(GraphicEditor, { key: task.id, design: source, focus, task, execute, work }),
              task.actualChanges?.length > 0 && h(R.Fragment, null, h('h3', null, '实际修改记录'), h(Table, { columns: [['对象', c => c.id], ['变化', c => c.kind], ['定位', c => button('在图中查看', () => setFocus(c.id))]], rows: task.actualChanges }))))));
    }
    function EngineeringViewer({ task, focus }) {
      const [leftPage, setLeftPage] = useState(0), [rightPage, setRightPage] = useState(0);
      const design = (task.candidate || task.left).design, other = task.right?.design;
      const parts = [design, other].filter(Boolean), pages = [leftPage, rightPage], setters = [setLeftPage, setRightPage];
      useEffect(() => { if (!focus) return; parts.forEach((d, i) => { const id = i ? task.mappings.find(m => m.left === focus)?.right : focus; const c = [...d.components, ...d.objects].find(c => c.id === id); const page = d.previews.findIndex(p => p.document === c?.document); if (page >= 0) setters[i](page); }); }, [focus, task.id]);
      const marks = (side, document) => (task.actualChanges || []).map(c => c[side]).filter(o => o && o.document === document && (o.at?.length || o.points?.length)).map(o => ({ kind: o.kind, points: o.points?.length ? o.points : [o.at] }));
      const panes = parts.map((d, i) => { const view = d.previews[Math.min(pages[i], d.previews.length - 1)]; const mapped = i ? task.mappings.find(m => m.left === focus)?.right : focus; const c = d.components.find(c => c.id === mapped); return view && { id: i ? 'target' : 'after', title: i ? '目标资料' : task.candidate ? '修改候选' : '源工程', view, marks: !i && d.format === 'kicad' ? marks('after', view.document) : [], points: d.format === 'kicad' && c?.at && c.document === view.document ? [c.at] : undefined }; }).filter(Boolean);
      if (task.candidate && task.left.design.previews[0]) { const view = task.left.design.previews[Math.min(leftPage, task.left.design.previews.length - 1)], c = task.left.design.components.find(c => c.id === focus); panes.unshift({ id: 'before', title: '修改前', view, marks: task.left.design.format === 'kicad' ? marks('before', view.document) : [], points: task.left.design.format === 'kicad' && c?.document === view.document ? [c.at] : undefined }); }
      return h('section', null, h('div', { className: 'ew-inline' }, parts.map((d, i) => d.previews.length > 1 && h(Field, { key: i, label: i ? '目标页' : '源工程页' }, selectInput(String(pages[i]), s => setters[i](Number(s)), d.previews.map((p, j) => [String(j), p.name || `第 ${j + 1} 页`]))))), h(DrawingViewer, { panes, focusKey: focus + ':' + leftPage + ':' + rightPage + ':' + task.revision, title: '原图与修改候选 · 同步缩放' }));
    }
    function BoardObjects({ design, focus }) {
      const [selected, setSelected] = useState([]), [show, setShow] = useState(false);
      const part = design.components.find(c => selected.includes(c.ref));
      useEffect(() => { const c = design.components.find(c => c.id === focus); if (c) { setSelected([c.ref]); setShow(true); } }, [focus]);
      return h('section', null, button(show ? '收起器件与网络' : '器件定位与实际焊盘网络', () => setShow(!show)), show && h(R.Fragment, null,
        h(PositionMap, { components: design.components, selected, onSelect: setSelected }), h('p', { className: 'ew-help' }, '此图显示封装参考点。铜皮间距、未布线和制造规则由原生 DRC 检查；参考点距离不用于判断电气间隙。'),
        part && h('div', { className: 'ew-refbox' }, h('strong', null, part.ref + ' · ' + part.footprint), button('取消选择', () => setSelected([])), h(Table, { columns: [['焊盘', p => p.number], ['实际网络', p => design.nets.filter(n => n.nodes.some(x => x.component === part.id && x.pin === p.number)).map(n => n.name).join(', ') || '无网络']], rows: part.pins }))));
    }
    function EngineeringMaterials({ onOpen }) {
      const work = useWork(), [records, setRecords] = useState([]);
      const refresh = () => work.run('读取资料与任务', async () => setRecords(await et({ action: 'list' })));
      useEffect(() => { refresh(); }, []);
      return h('section', null, h('h2', null, '资料管理'), h('p', { className: 'ew-help' }, '各任务保留自己的源文件快照、证据和报告。打开记录可查看资料卡、导出或继续处理；选择文件时仍需明确本次任务输入。'), h(Alert, { work }), button('刷新记录', refresh), h(Table, { columns: [['名称', r => r.label], ['任务', r => engineeringTitles[r.kind]], ['创建时间', r => new Date(r.createdAt).toLocaleString()], ['版本', r => r.revision], ['打开', r => button('打开此记录', () => onOpen(r.kind, r.id))]], rows: records }));
    }
    function MappingEditor({ task, onSave }) {
      const [rows, setRows] = useState(task.mappings);
      useEffect(() => setRows(task.mappings), [task.revision, task.id]);
      const update = (i, patch) => setRows(rows.map((m, j) => i === j ? { ...m, ...patch } : m));
      return h('div', null, h(Table, { columns: [['源器件', (m) => (task.candidate || task.left).design.components.find(c => c.id === m.left)?.ref || m.left], ['目标器件', (m, i) => selectInput(m.right, right => update(i, { right, confirmed: false }), [['', '未对应'], ...task.right.design.components.map(c => [c.id, `${c.ref} · ${c.value || '未知值'} · ${c.document}`])])], ['对应确认', (m, i) => checkbox('已核对', m.confirmed, confirmed => update(i, { confirmed }))], ['引脚对应（源:目标）', (m, i) => textInput(Object.entries(m.pins || {}).map(([a,b]) => a + ':' + b).join(', '), text => { const pins = {}; for (const pair of text.split(',')) { const [a,b] = pair.split(':').map(s => s.trim()); if (a && b) pins[a] = b; } update(i, { pins, confirmed: false }); }, { placeholder: '空白使用相同引脚号' })]], rows }), button('保存对应关系', () => onSave(rows)));
    }
    function LayoutCalibration({ task, execute }) {
      const [a, setA] = useState(''), [b, setB] = useState(''), [flipY, setFlipY] = useState((task.left.design.format === 'altium') !== (task.right.design.format === 'altium'));
      const choices = [['', '选择已核对的对应器件'], ...task.mappings.filter(m => m.confirmed && m.right).map(m => [m.left, task.left.design.components.find(c => c.id === m.left)?.ref || m.left])];
      return h('details', null, h('summary', null, '图面坐标校准（图片、PDF 和跨格式对齐时使用）'), h('p', { className: 'ew-help' }, '选择两个器件作为固定位置，目标图其余器件按这两个位置换算缩放和方向。不能直接把图片像素当成工程毫米。'), h('div', { className: 'ew-inline' }, h(Field, { label: '第一个锚点' }, selectInput(a, setA, choices)), h(Field, { label: '第二个锚点' }, selectInput(b, setB, choices)), checkbox('翻转目标纵坐标方向', flipY, setFlipY), button('校准目标图面', () => execute('calibrate', { anchors: [a,b], flipY }), { disabled: !a || !b || a === b })), task.calibration && h('p', { className: 'ew-note' }, `已校准，缩放系数 ${task.calibration.scale.toFixed(5)}；更改器件对应关系后需重新校准。`));
    }
    function ReferencePanel({ task, side, execute, work }) {
      const snap = task[side], design = snap.design, [page, setPage] = useState(String(design.page || 1)), [text, setText] = useState(''), [reviewed, setReviewed] = useState(false);
      useEffect(() => { setText(snap.draft ? JSON.stringify(snap.draft.first, null, 2) : ''); setReviewed(false); }, [snap.draft?.sourceHash, snap.draft?.page, snap.draft?.first, design.page]);
      return h('section', { className: 'ew-reference-card' }, h('h3', null, side === 'right' ? '目标资料识别' : task.kind === 'datasheet' ? '资料卡' : '源资料识别'),
        h('div', { className: 'ew-inline' }, h(Field, { label: `页码 / 共 ${design.pages} 页` }, textInput(page, setPage, { type: 'number', min: 1, max: design.pages })), button('读取此页', () => execute('page', { side, page: Number(page) })), button('提取两遍并核对', () => execute('extract', { side }), { disabled: !!work.busy })),
        snap.draft && h('p', { className: 'ew-note' }, snap.draft.crossCheck === 'agree' ? '两次识别一致，仍未人工确认。' : '两次识别有差异，请核对原图。'),
        h('details', null, h('summary', null, '本页文字'), h('pre', { className: 'ew-reference-text' }, design.text || '此页无文本层，可使用图像识别。')),
        h('details', { open: !!text }, h('summary', null, '校对 / 导入结构化条目（每项保留页码、原文和图中位置）'), h('textarea', { value: text, onChange: e => setText(e.target.value), rows: 12, 'aria-label': '识别条目' }), checkbox('我已对照本页核对这些条目', reviewed, setReviewed), button('保存本页条目', () => { try { execute('evidence', { side, data: JSON.parse(text), reviewed }); } catch { work.setError('条目不是有效 JSON，请修正后保存。'); } }, { disabled: !text || !!work.busy })),
        task.kind === 'datasheet' && h(Table, { columns: [['参数 / 引脚', x => x.name || x.pin], ['数值', x => x.value], ['条件', x => x.conditions], ['出处', x => `第 ${x.page} 页 · ${x.quote}`], ['核对状态', x => x.verification === 'human-reviewed' ? '人工已核对' : '待确认']], rows: task.evidence }));
    }
    const ruleInputs = { divider: ['vin', 'rTop', 'rBottom'], rc: ['r', 'c'], current: ['vin', 'vf', 'r'], power: ['current', 'r'], ldo: ['vin', 'vout', 'current'], 'voltage-domain': ['driverMin', 'driverMax', 'receiverMin', 'receiverMax'] };
    const ruleLabels = { divider: '分压', rc: 'RC 截止频率', current: '限流', power: '电阻功耗', ldo: 'LDO 功耗', 'voltage-domain': '电压域', decoupling: '去耦', pullup: '上拉' };
    function MetricFields({ value, onChange }) {
      return h('div', { className: 'ew-form-row' }, h(Field, { label: '计算项' }, selectInput(value.kind || 'divider', kind => onChange({ ...value, kind, inputs: {} }), Object.entries(ruleLabels).filter(([k]) => ruleInputs[k]))), (ruleInputs[value.kind || 'divider'] || []).map(key => h(Field, { key, label: key + '（V / A / Ω / F，支持 10k、100n）' }, textInput(String(value.inputs?.[key] ?? ''), x => onChange({ ...value, inputs: { ...value.inputs, [key]: x } })))), h(Field, { label: '适用工况' }, textInput(value.conditions || '', conditions => onChange({ ...value, conditions }))), h(Field, { label: '参数出处 / 测量依据' }, textInput(value.evidence?.[0]?.quote || '', quote => onChange({ ...value, evidence: quote ? [{ quote, verification: 'user-supplied' }] : [] }))), h(Field, { label: '允许最小值（可空）' }, textInput(String(value.min ?? ''), min => onChange({ ...value, min: min === '' ? undefined : Number(min) }))), h(Field, { label: '允许最大值（可空）' }, textInput(String(value.max ?? ''), max => onChange({ ...value, max: max === '' ? undefined : Number(max) }))));
    }
    function FunctionEditor({ value, onChange }) {
      return h('details', null, h('summary', null, '功能指标与工况（可选；留空则不判断功能一致）'), value.map((row, i) => h('fieldset', { key: row.id }, h('legend', null, row.id), h('h4', null, '源图'), h(MetricFields, { value: row.left, onChange: left => onChange(value.map((r,j) => i === j ? { ...r, left } : r)) }), h('h4', null, '目标图'), h(MetricFields, { value: row.right, onChange: right => onChange(value.map((r,j) => i === j ? { ...r, right } : r)) }), button('删除指标', () => onChange(value.filter((_,j) => i !== j))))), button('增加一个指标', () => onChange([...value, { id: '指标 ' + (value.length + 1), left: { kind: 'divider', inputs: {} }, right: { kind: 'divider', inputs: {} }, tolerance: .000001 }])));
    }
    function RuleEditor({ value, onChange, components, nets }) {
      return h('details', null, h('summary', null, '扩展规则与工况依据（可选）'), value.map((row, i) => { const update = next => onChange(value.map((r,j) => i === j ? next : r)); return h('fieldset', { key: row.id }, h('legend', null, row.id), h(Field, { label: '规则' }, selectInput(row.kind, kind => update({ id: row.id, kind, inputs: {} }), Object.entries(ruleLabels))), ['decoupling', 'pullup'].includes(row.kind) ? h('div', { className: 'ew-form-row' }, h(Field, { label: '器件' }, selectInput(row.component || '', component => update({ ...row, component }), [['', '请选择'], ...components.map(c => [c.id, `${c.ref} · ${c.document}`])])), ...['pin', 'returnNet'].map(k => h(Field, { key: k, label: k === 'pin' ? '引脚号' : '另一端网络名（地或上拉电源）' }, k === 'returnNet' ? selectInput(row[k] || '', v => update({ ...row, [k]: v }), [['', '选择完整网络名'], ...(nets || []).map(n => [n.name,n.name])]) : textInput(row[k] || '', v => update({ ...row, [k]: v })))), h(Field, { label: '手册或规则依据' }, textInput(row.evidence?.[0]?.quote || '', quote => update({ ...row, evidence: quote ? [{ quote }] : [] })))) : h(MetricFields, { value: row, onChange: update }), button('删除规则', () => onChange(value.filter((_,j) => j !== i)))); }), button('添加检查项', () => onChange([...value, { id: '规则 ' + (value.length + 1), kind: 'divider', inputs: {} }])));
    }
    function GraphicEditor({ design, focus, task, execute, work }) {
      const [keepConnections, setKeepConnections] = useState(true), [newRef, setNewRef] = useState(''), [newValue, setNewValue] = useState(''), [template, setTemplate] = useState(''), [pinsConfirmed, setPinsConfirmed] = useState(false), [library, setLibrary] = useState(''), [symbolName, setSymbolName] = useState('');
      const [selected, setSelected] = useState([]), [search, setSearch] = useState(''), [mode, setMode] = useState('select'), [start, setStart] = useState(null), [zoom, setZoom] = useState(1), [full, setFull] = useState(false), [documentId, setDocumentId] = useState(design.documents[0]?.id), [label, setLabel] = useState(''), [propertyValue, setPropertyValue] = useState(''), [propertyKey, setPropertyKey] = useState('Value');
      const svg = useRef(null), drag = useRef(null), [box, setBox] = useState(null), [viewCenter, setViewCenter] = useState(null);
      const parts = design.components.filter(c => c.document === documentId), objects = design.objects.filter(o => o.document === documentId);
      const points = [...parts.map(c => c.at), ...objects.flatMap(o => o.points || [])].filter(p => p?.length >= 2);
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]), minx = Math.min(...xs, 0) - 10, miny = Math.min(...ys, 0) - 10;
      const width = Math.max(80, Math.max(...xs, 80) - minx + 10), height = Math.max(60, Math.max(...ys, 60) - miny + 10);
      const selectedPart = parts.find(c => selected.includes(c.id)), center = viewCenter || [minx + width / 2, miny + height / 2];
      const viewBox = `${center[0] - width / zoom / 2} ${center[1] - height / zoom / 2} ${width / zoom} ${height / zoom}`;
      const coords = e => { const point = svg.current.createSVGPoint(); point.x = e.clientX; point.y = e.clientY; const p = point.matrixTransform(svg.current.getScreenCTM().inverse()); return [Math.round(p.x / 1.27) * 1.27, Math.round(p.y / 1.27) * 1.27]; };
      const edit = operations => execute('edit', { operations, grid: 1.27 });
      useEffect(() => { if (focus) { setSelected([focus]); const c = design.components.find(c => c.id === focus); if (c) { setDocumentId(c.document); setViewCenter(c.at); setZoom(3); } } }, [focus]);
      useEffect(() => { setSelected([]); setViewCenter(null); setZoom(1); setDocumentId(design.documents[0]?.id); }, [task.id]);
      useEffect(() => { if (selectedPart) setPropertyValue(propertyKey === 'Value' ? selectedPart.value || '' : propertyKey === 'Footprint' ? selectedPart.footprint || '' : selectedPart.properties?.Datasheet || ''); }, [selectedPart?.id, propertyKey, task.revision]);
      const down = e => {
        if (work.busy || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); const p = coords(e), id = e.target.closest('[data-object]')?.getAttribute('data-object');
        if (mode === 'wire') { if (start) { edit([{ op: 'wire', from: start, to: p, document: documentId }]); setStart(null); } else setStart(p); return; }
        if (mode === 'label' || mode === 'junction') { edit([{ op: mode, at: p, text: label, document: documentId }]); return; }
        if (id) { const selection = e.shiftKey ? [...new Set([...selected, id])] : selected.includes(id) ? selected : [id]; setSelected(selection); drag.current = { at: p, selection }; }
        else { setSelected([]); drag.current = { at: p, selection: [], box: true }; setBox({ a: p, b: p }); }
        svg.current.setPointerCapture(e.pointerId);
      };
      const up = e => {
        const d = drag.current; drag.current = null; if (!d) return; const p = coords(e);
        if (d.box) { setSelected(parts.filter(c => c.at[0] >= Math.min(p[0], d.at[0]) && c.at[0] <= Math.max(p[0], d.at[0]) && c.at[1] >= Math.min(p[1], d.at[1]) && c.at[1] <= Math.max(p[1], d.at[1])).map(c => c.id)); setBox(null); }
        else if (p[0] !== d.at[0] || p[1] !== d.at[1]) { const ops = parts.filter(c => d.selection.includes(c.id)).map(c => ({ op: 'move', id: c.id, disconnect: !keepConnections, at: [c.at[0] + p[0] - d.at[0], c.at[1] + p[1] - d.at[1]] })); if (ops.length) edit(ops); }
      };
      return h('section', { className: 'ew-graphic-editor' + (full ? ' ew-drawing-full' : ''), onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); setSelected([]); setStart(null); setBox(null); setFull(false); } } },
        h('h3', null, '对齐差异编辑器'), h('p', { className: 'ew-help' }, '点击选择，空白处框选，拖动器件保持连接。导线点击两端绘制；旋转后请验证实际连接。对象按原生坐标显示，完整符号外观请查看上方原图。'),
        h('div', { className: 'ew-inline' }, h(Field, { label: '页面' }, selectInput(documentId, id => { setDocumentId(id); setSelected([]); setViewCenter(null); setZoom(1); }, design.documents.map(d => [d.id, d.id + (d.instances > 1 ? '（重复实例，禁止自动写入）' : '')]))), textInput(search, setSearch, { placeholder: '搜索位号' }), button('定位', () => { const c = design.components.find(c => c.ref.toLowerCase() === search.toLowerCase()); if (c) { setDocumentId(c.document); setSelected([c.id]); setViewCenter(c.at); setZoom(4); } }), button(full ? '退出全屏' : '全屏编辑', () => setFull(!full)), button('−', () => setZoom(Math.max(.5, zoom / 1.4))), button('+', () => setZoom(Math.min(15, zoom * 1.4))), button('适合窗口', () => { setZoom(1); setSelected([]); setViewCenter(null); })),
        h('div', { className: 'ew-inline' }, ...[['select','选择 / 移动'], ['wire','绘制导线'], ['junction','连接点'], ['label','网络标注']].map(([key,title]) => button(title, () => { setMode(key); setStart(null); }, { className: mode === key ? 'ew-selected' : '' })), mode === 'label' && textInput(label, setLabel, { placeholder: '网络名称' }), button('旋转 90°', () => edit(selected.map(id => ({ op: 'rotate', id }))), { disabled: !selected.length }), button('删除所选对象', () => edit(selected.map(id => ({ op: 'delete', id }))), { disabled: !selected.length }), button('撤销', () => execute('undo'), { disabled: !task.canUndo }), button('重做', () => execute('redo'), { disabled: !task.canRedo })),
        h('svg', { ref: svg, className: 'ew-edit-canvas', viewBox, tabIndex: 0, 'aria-label': '原生对象编辑画布', onPointerDown: down, onPointerUp: up, onPointerMove: e => { if (drag.current?.box) setBox({ a: drag.current.at, b: coords(e) }); }, onPointerCancel: () => { drag.current = null; setBox(null); }, onWheel: e => { setZoom(z => Math.max(.5, Math.min(15, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); } },
          objects.filter(o => o.points?.length).map(o => h('polyline', { key: o.id, 'data-object': o.id, points: o.points.map(p => p.join(',')).join(' '), fill: 'none', stroke: selected.includes(o.id) ? '#b87527' : '#287357', strokeWidth: selected.includes(o.id) ? .7 : .3, style: { cursor: 'pointer' }, pointerEvents: 'stroke' })),
          objects.filter(o => o.at && /junction|label/i.test(o.kind)).map(o => h('circle', { key: o.id, 'data-object': o.id, cx: o.at[0], cy: o.at[1], r: .7, fill: selected.includes(o.id) ? '#b87527' : '#287357' })),
          parts.map(c => h('g', { key: c.id, 'data-object': c.id, style: { cursor: 'move' } }, h('rect', { x: c.at[0] - 3, y: c.at[1] - 2, width: 6, height: 4, fill: selected.includes(c.id) ? '#ffe3a5' : '#fffdf3', stroke: selected.includes(c.id) ? '#b87527' : '#294652', strokeWidth: .25 }), h('text', { x: c.at[0], y: c.at[1] - 3, fontSize: 1.7, textAnchor: 'middle' }, c.ref + ' ' + (c.value || '待确认')), c.pins?.map((pin, i) => pin.at && h('circle', { key: i, cx: pin.at[0], cy: pin.at[1], r: .35, fill: '#a74135' }, h('title', null, pin.number + ' ' + pin.name))))),
          box && h('rect', { x: Math.min(box.a[0], box.b[0]), y: Math.min(box.a[1], box.b[1]), width: Math.abs(box.b[0] - box.a[0]), height: Math.abs(box.b[1] - box.a[1]), fill: '#32849622', stroke: '#328496', strokeWidth: .3 }), start && h('circle', { cx: start[0], cy: start[1], r: 1, fill: '#b87527' })),
        h('div', { className: 'ew-inline' }, h('span', null, selected.length ? `已选 ${selected.length} 个对象` : '未选择'), selectInput(propertyKey, setPropertyKey, [['Value','数值'], ['Footprint','封装'], ['Datasheet','手册链接']]), textInput(propertyValue, setPropertyValue, { placeholder: '属性值' }), button('修改所选器件属性', () => edit(selected.map(id => ({ op: 'properties', id, properties: { [propertyKey]: propertyValue } }))), { disabled: !selectedPart }), button('取消选择', () => { setSelected([]); setBox(null); setStart(null); }), checkbox('拖动保持连接（取消即显式断开）', keepConnections, setKeepConnections)),
        h('details', null, h('summary', null, '新增器件（明确符号与引脚定义）'),
          design.format === 'kicad' ? h(R.Fragment, null, h(Field, { label: '复用源工程中的完整符号' }, selectInput(template, id => { setTemplate(id); setPinsConfirmed(false); }, [['', '选择已有符号'], ...task.left.design.components.map(c => [c.id, `${c.ref} · ${c.libId}`])])), h('p', { className: 'ew-help' }, '引脚定义：' + (task.left.design.components.find(c => c.id === template)?.pins.map(p => p.number + ':' + p.name).join(', ') || '请选择符号'))) : h(R.Fragment, null, h(FilePicker, { label: 'AD 符号库 SchLib', value: library, onChange: setLibrary, extensions: ['.schlib'] }), h(Field, { label: '库内准确符号名' }, textInput(symbolName, setSymbolName))),
          h('div', { className: 'ew-inline' }, h(Field, { label: '新位号' }, textInput(newRef, setNewRef)), h(Field, { label: '已知数值（缺值留空，待确认）' }, textInput(newValue, setNewValue)), checkbox('已核对符号和引脚定义', pinsConfirmed, setPinsConfirmed), button('在视图中心新增', () => edit([{ op: design.format === 'kicad' ? 'add-from-component' : 'add-component', side: 'source', template, library, symbolName, ref: newRef, value: newValue, pinsConfirmed, at: center.map(x => Math.round(x / 1.27) * 1.27), document: documentId }]), { disabled: !newRef || !pinsConfirmed || design.format === 'kicad' && !template || design.format === 'altium' && (!library || !symbolName) }))));
    }

    function apply(ctx) {
      const slots = ctx.get('slots');
      let state = { open: false, tab: 'pcb-review', minimized: innerWidth < 700, snapshot: { tasks: [], now: Date.now() }, offline: false, position: { right: 20, bottom: 22 } };
      try { const saved = JSON.parse(localStorage.getItem('dsh-engineering-workbench-position')); if (Number.isFinite(saved?.right) && Number.isFinite(saved?.bottom)) state.position = { right: Math.max(8, Math.min(saved.right, innerWidth - 295)), bottom: Math.max(8, Math.min(saved.bottom, innerHeight - 220)) }; } catch {}
      const listeners = new Set();
      const update = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(); };
      const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
      const get = () => state;
      const useStore = () => useSyncExternalStore(subscribe, get, get);
      let stopped = false, timer, pollRunning = false;
      async function poll() {
        if (stopped || pollRunning) return; pollRunning = true;
        try { const snapshot = await api('status'); if (!stopped) update({ snapshot, offline: false }); }
        catch { if (!stopped) update({ offline: true }); }
        finally { pollRunning = false; if (!stopped) timer = setTimeout(poll, 1000); }
      }
      ctx.effect(() => { const style = document.createElement('style'); style.dataset.engineeringWorkbench = 'true'; style.textContent = css; document.head.appendChild(style); poll(); return () => { stopped = true; clearTimeout(timer); style.remove(); listeners.clear(); }; });
      function Entry(props) { const s = useStore(); return button([h(Icon, { key: 1, name: 'grid' }), props.wide === false ? null : h('span', { key: 2 }, '工程工作台')], () => update({ open: !s.open }), { className: 'ew-entry', title: '工程工作台', 'aria-label': '打开工程工作台' }); }
      function Workspace() {
        const s = useStore(); const panel = useRef(null), opened = useRef(false), visited = useRef(new Set()); if (s.open) visited.current.add(s.tab);
        if (s.open) opened.current = true;
        useEffect(() => { if (s.open) panel.current?.focus(); }, [s.open]);
        if (!opened.current) return null;
        return h('section', { className: 'ew ew-workbench', style: { display: s.open ? undefined : 'none' }, role: 'dialog', 'aria-label': '工程工作台', ref: panel, tabIndex: -1, onKeyDown: e => { if (e.key === 'Escape') update({ open: false }); } },
          h('header', { className: 'ew-header' }, h('div', { className: 'ew-brand' }, h(Icon, { name: 'circuit', size: 29 }), h('div', null, h('h1', null, '工程工作台'), h('small', null, '需求、证据与工程变化'))), h('nav', { className: 'ew-tabs', 'aria-label': '工作台功能' }, [...Object.entries(engineeringTitles).map(([key,title]) => [key,title,key === 'selection' ? 'power' : 'circuit']), ['materials','资料管理','grid'], ['activity','执行记录','activity'], ['legacy','历史同步任务','circuit']].map(([key, title, icon]) => button([h(Icon, { key: 'icon', name: icon, size: 16 }), title], () => update({ tab: key }), { key, className: s.tab === key ? 'ew-selected' : '', 'aria-pressed': s.tab === key }))), h('div', { className: 'ew-header-right' }, h('small', { className: s.offline ? 'ew-offline' : '' }, h('i', { className: 'ew-dot' }), s.offline ? '连接中断' : '本机引擎已连接'), button(h(Icon, { name: 'close' }), () => update({ open: false }), { className: 'ew-quiet', 'aria-label': '关闭工作台' }))),
          h('main', { className: 'ew-content' }, ...Object.keys(engineeringTitles).filter(key => visited.current.has(key)).map(key => h('div', { key, hidden: s.tab !== key }, key === 'selection' ? h(Selection) : h(Engineering, { kind: key, requestedTask: s.requested?.kind === key ? s.requested.id : undefined }))), s.tab === 'materials' && h(EngineeringMaterials, { onOpen: (kind, id) => update({ tab: kind, requested: { kind, id } }) }), visited.current.has('legacy') && h('div', { hidden: s.tab !== 'legacy' }, h(Schematic)), s.tab === 'activity' && h('div', { className: 'ew-timeline' }, h('h2', null, '实际执行记录'), h('p', { className: 'ew-help' }, '记录工作台操作和该 DSH profile 的工程工具调用。耗时与步骤状态来自真实执行；重启后重新记录。'), s.snapshot.tasks.length ? s.snapshot.tasks.map(t => h(Task, { key: t.id, task: t, now: s.snapshot.now })) : h('div', { className: 'ew-loading' }, '输入需求、评审电路或处理原理图后，这里会出现执行记录。'))));
      }
      function Floating() {
        const s = useStore(); const drag = useRef(null);
        const task = s.snapshot.tasks.find(t => t.state === 'running') || s.snapshot.tasks[0];
        const elapsed = task ? Math.max(0, ((task.finishedAt || s.snapshot.now) - task.startedAt) / 1000) : 0;
        const done = task?.steps.filter(x => x.state === 'done').length || 0;
        const save = p => { update({ position: p }); try { localStorage.setItem('dsh-engineering-workbench-position', JSON.stringify(p)); } catch {} };
        const clamp = p => ({ right: Math.max(8, Math.min(p.right, Math.max(8, innerWidth - 295))), bottom: Math.max(8, Math.min(p.bottom, Math.max(8, innerHeight - 230))) });
        useEffect(() => { const resize = () => { save(clamp(get().position)); if (innerWidth < 700) update({ minimized: true }); }; window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
        const handle = { className: 'ew-drag', tabIndex: 0, role: 'button', 'aria-label': '拖动进度面板，或使用方向键移动', onPointerDown: e => { drag.current = { x: e.clientX, y: e.clientY, ...s.position }; e.currentTarget.setPointerCapture(e.pointerId); }, onPointerMove: e => { if (drag.current) update({ position: clamp({ right: drag.current.right - e.clientX + drag.current.x, bottom: drag.current.bottom - e.clientY + drag.current.y }) }); }, onPointerUp: () => { drag.current = null; save(get().position); }, onPointerCancel: () => { drag.current = null; }, onKeyDown: e => { const d = { ArrowLeft: [16, 0], ArrowRight: [-16, 0], ArrowUp: [0, 16], ArrowDown: [0, -16] }[e.key]; if (d) { e.preventDefault(); save(clamp({ right: s.position.right + d[0], bottom: s.position.bottom + d[1] })); } } };
        return h('aside', { className: `ew ew-float${s.minimized ? ' ew-mini' : ''}`, style: s.position, 'aria-label': '工程任务悬浮面板' },
          h('div', { className: 'ew-float-head' }, h('div', handle, h(Icon, { name: 'activity', size: 15 }), '工程进度'), button(s.minimized ? '展开' : '收起', () => update({ minimized: !s.minimized }), { className: 'ew-quiet' })),
          !s.minimized && h('div', { className: 'ew-float-body' }, h('div', { className: 'ew-float-label', title: task?.label }, task?.state === 'running' && h('i', { className: 'ew-busy-dot' }), task?.label || '等待工程任务'), h('div', { className: 'ew-float-time' }, num(elapsed), h('small', null, ' 秒')), task?.steps.length > 0 && h('div', { className: 'ew-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': task.steps.length, 'aria-valuenow': done, 'aria-label': '已完成实际步骤' }, h('span', { style: { width: `${done / task.steps.length * 100}%` } })), h('small', { role: 'status' }, s.offline ? '连接中断，显示最后已知状态' : !task ? '从侧栏打开工作台开始处理任务' : task.state === 'failed' ? '执行失败，请查看记录' : task.state === 'done' ? '已完成' : task.steps.find(x => x.state === 'running')?.label || '工具执行中'), h('div', { className: 'ew-float-actions' }, h('small', null, `${s.snapshot.tasks.filter(t => t.state === 'running').length} 项正在执行`), button('打开工作台', () => update({ open: true }), { className: 'ew-quiet' }))));
      }
      slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'engineering-workbench.open', order: 15, label: () => '工程工作台' }, Entry));
      slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'engineering-workbench.workspace', order: 30 }, Workspace));
      slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'engineering-workbench.progress', order: 31 }, Floating));
    }

return {name:'engineering-workbench-client',inject:['slots'],apply};
}});
