export function requestMetrics(value){
  if(value.event!=='request')return value;
  const bytes=x=>Buffer.byteLength(typeof x==='string'?x:JSON.stringify(x??null),'utf8');
  const messages=value.messages||[];let request={};
  try{request=JSON.parse(messages[0]?.content?.find(x=>x.type==='text')?.text||'{}').request||{};}catch{}
  return {...value,inputMetrics:{unit:'UTF-8 bytes; not tokens; excludes transport framing',system:bytes(value.system||''),initialInputs:bytes(request.inputs||{}),initialLibraryInventory:bytes(request.fixedLibrary||{}),messages:bytes(messages),historyMessages:Math.max(0,messages.length-1),source:'measured immediately before model call'}};
}
