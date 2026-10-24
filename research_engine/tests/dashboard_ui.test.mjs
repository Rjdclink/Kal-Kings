import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../kalresearch/dashboard.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0].replace('setInterval(refresh,60000);refresh();','setInterval(refresh,60000);');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.open=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(){}
 reportValidity(){return true;}
}
function setup(){
 const nodes=new Map(['cards','other','status','refresh','loadchart','symbol','tv'].map(id=>[id,new Element('div')]));
 const document={createElement:tag=>new Element(tag),getElementById:id=>nodes.get(id),querySelectorAll:selector=>nodes.get('cards').children.filter(n=>n.className==='card'&&(selector!=='.card[open]'||n.open))};
 const context=vm.createContext({document,Date,Map,Set,Number,Math,AbortSignal,encodeURIComponent,setInterval:()=>{},fetch:async()=>{throw Error('offline');}});vm.runInContext(source,context);return {context,nodes};
}
const fixture=(symbol,profit)=>({symbol,status:'OBSERVED',forecast:{capital_usd:'1000',expected_profit_dollars:String(profit),loss_fraction:.2,p05_profit_dollars:'-50',p95_profit_dollars:'100',fee_rate_each_side:'.006',exit_slippage_rate:'.001',assumptions:'Test model'},consensus:{agreeing_venues:2,available_venues:3,direction:'up',votes:[{venue:'test'}],history_hours:100},orderbooks:[]});
test('three-field cards filter nonpositive estimates and remove expired results',()=>{
 const {context,nodes}=setup();context.assets=[fixture('BTC',25),fixture('ETH',-10)];vm.runInContext("for(const asset of assets)states.set(asset.symbol,{asset,capital:'1000',stamp:Date.now()/1000});render();",context);
 assert.equal(nodes.get('cards').children.length,1);const card=nodes.get('cards').children[0];assert.equal(card.children[0].children.length,3);assert.equal(card.children[0].children[0].textContent,'BTC / USD');assert.equal(card.children[0].children[2].textContent,'$25.00');
 vm.runInContext('for(const st of states.values())st.stamp=0;render();',context);assert.equal(nodes.get('cards').children[0].className,'empty');
});
test('edited amounts request fresh backend estimates and failures clear profit cards',async()=>{
 const {context,nodes}=setup();context.asset=fixture('BTC',25);vm.runInContext("states.set('BTC',{asset,capital:'250',stamp:Date.now()/1000});",context);
 const urls=[];context.fetch=async url=>{urls.push(url);return {ok:true,json:async()=>({assets:[{...fixture('BTC',6),forecast:{...fixture('BTC',6).forecast,capital_usd:'250'}}],observed_at_utc_epoch:Date.now()/1000})};};
 await vm.runInContext('refresh()',context);assert.deepEqual(urls,['/api/crypto?capital=250']);assert.equal(nodes.get('cards').children[0].children[0].children[1].textContent,'$250.00');
 context.fetch=async()=>{throw Error('offline');};await vm.runInContext('refresh()',context);assert.equal(nodes.get('cards').children[0].className,'empty');
});
