/** Public, on-device inference profiles. Rotating a shift does not start inference itself. */
export const AGENTS=Object.freeze([
 {name:'Qwen 2.5 · Markets',model:'onnx-community/Qwen2.5-0.5B-Instruct',role:'Review sports contract labels and market discrepancies',keyRequired:false},
 {name:'SmolLM2 · Crypto',model:'onnx-community/SmolLM2-360M-Instruct-ONNX',role:'Summarize cryptocurrency spot price context and changes',keyRequired:false},
 {name:'Qwen 3 · Risk',model:'onnx-community/Qwen3-0.6B-ONNX',role:'Challenge assumptions, missing hedge legs and risk limits',keyRequired:false},
 {name:'SmolLM2 · Briefing',model:'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',role:'Produce a short operator briefing and identify missing evidence',keyRequired:false},
]);
export function activeAgent(ms=Date.now()){
  if(!Number.isFinite(Number(ms)))throw Error('Invalid clock');
  const slot=Math.floor((Number(ms)%86400000)/21600000);
  const nextUTC=new Date((Math.floor(Number(ms)/21600000)+1)*21600000).toISOString();
  return {...AGENTS[slot],slot,nextUTC,mode:'ON_DEVICE_ON_DEMAND'};
}
export function buildAgentBrief(data,agent=activeAgent()){
  const sports=(data?.kalshi||[]).slice(0,4).map(m=>`${m.event}: ${m.source||'exchange'} YES ${m.yesAsk??'unknown'}`).join('; ');
  const crypto=(data?.crypto||[]).slice(0,6).map(x=>`${x.symbol}: ${x.price}`).join('; ');
  return `You are Kal Kings ${agent.name}. Role: ${agent.role}. Based ONLY on supplied exchange observations, give a 3-sentence factual assessment and explicitly identify missing data. Do not invent odds, model probabilities, fills or profit. No orders. Market samples: ${sports||'none'}. Crypto reference: ${crypto||'none'}. Identified potential but unreviewed gaps: ${Math.max(0,Math.min(999,Number(data?.gapCount)||0))}. Do not offer trade instructions based solely on market consensus.`.slice(0,2400);
}
