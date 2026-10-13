export function buildReplyMessages(input={}) {
  const base=String(input.stylePrompt||'').trim()||'You are replying to a post on X (Twitter). Write a natural, human reply.';
  const system=base+'\n\nOutput only the reply text itself: no surrounding quotes, no explanations, no labels.';
  let user='The post you are replying to:\n"""\n'+String(input.tweetText||'').trim()+'\n"""';
  const tone=String(input.tone||'').slice(0,100),keywords=String(input.keywords||'').slice(0,500);
  if(tone)user+='\n\nReply style/type: '+tone;
  if(keywords)user+='\n\nNaturally work in these keywords/ideas: '+keywords;
  return [{role:'system',content:system},{role:'user',content:user}];
}
